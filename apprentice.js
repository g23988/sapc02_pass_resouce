/* apprentice.js — 雲端學徒 (Cloud Apprentice): desktop opt-in companion, alternative to 雲寶.
   Like pet.js it never calls app.js; it only listens to the quiz CustomEvents:
     quiz:answered  {correct}  → happy (small hop) / wrong (small nod)
     quiz:examStart            → think (slight tilt), held until the exam ends
     quiz:examDone  {pct,exam} → celebrate (double hop) at the exam's pass_pct (manifest; 75 if unknown) / wrong
   Speech: after the instant reaction she may say a line from apprentice-lines.js (static pool,
   no LLM on this site): streaks, a question she remembers you missing, today's count milestones,
   exam start / halfway / result tier, a daily greeting, idleness and pokes on the card. Generic
   lines are rationed (chance + 15 s cooldown) so she does not comment on every answer.
   Drawing is done by apprentice-rig.js (2D layer rig: body, head group, face parts, hair).
   Companion slot: claiming sets <html data-companion="apprentice"> and dispatches
   "companion:changed"; pet.js stands down while the attribute is present. Phones/tablets never
   see the apprentice — 雲寶 stays the companion there.
   Storage: localStorage "app_companion" ("apprentice" | absent), "app_apprentice_min" ("1" = mini),
   "app_apprentice_mem" (her own memory: today's count, last visit, recent line ids, last result per
   question — kept apart from app.js progress so the two never couple). */
"use strict";
(function () {
  const KEY = "app_companion", MIN_KEY = "app_apprentice_min", MEM_KEY = "app_apprentice_mem";
  // Game states → rig parts. Eyes: neutral | closed | sparkle | smile. Brows: [dy px, inward rot °].
  // gaze null = eyes follow the pointer. Composed from the delivered parts only — nothing redrawn.
  const STATE = {
    idle:      { eyes: "neutral", mouth: "closed",     brows: [0, 0],   gaze: null },         // 中性
    happy:     { eyes: "sparkle", mouth: "open-smile", brows: [-4, 0],  gaze: null },         // 答對開心
    think:     { eyes: "neutral", mouth: "u",          brows: [-6, 0],  gaze: [-0.6, -0.9] }, // 思考
    wrong:     { eyes: "neutral", mouth: "smile",      brows: [4, 8],   gaze: [0, 0.5] },     // 失落但不放棄
    rare:      { eyes: "neutral", mouth: "o",          brows: [-10, 0], gaze: [0, 0] },       // 驚訝
    celebrate: { eyes: "smile",   mouth: "open-smile", brows: [-4, 0],  gaze: null },         // 得意大笑
  };
  // Manual mouth switching for a future speech system. Nothing drives it yet — no lip sync.
  const MOUTHS = ["closed", "smile", "a", "i", "u", "e", "o", "open-smile", "frown"];
  const FULL_MAX = 260, FULL_MIN = 180;

  const desktop = window.matchMedia("(min-width: 1024px) and (pointer: fine)");
  const get = k => { try { return localStorage.getItem(k); } catch { return null; } };
  const put = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} };
  const active = () => document.documentElement.dataset.companion === "apprentice";

  let panel = null, rig = null, shown = "idle", held = null, ready = false, pointer = null;
  let exprT, poseT, breathT, layoutF = 0, sw = null, gazeHold = 0;

  /* ---------- expressions & poses (the rig blinks on its own while the eyes are neutral) ---------- */
  function show(name) {
    const s = STATE[name];
    if (!rig || !s) return;
    rig.setEyes(s.eyes); rig.setMouth(s.mouth); rig.setBrows(s.brows[0], s.brows[1]);
    shown = name; aim();
  }
  function aim() {                          // held gaze for the state, else follow the pointer
    if (!rig || Date.now() < gazeHold) return;
    const g = STATE[shown] && STATE[shown].gaze;
    if (g) return rig.setGaze(g[0], g[1]);
    if (!pointer || !panel) return rig.setGaze(0, 0);
    const r = panel.getBoundingClientRect();
    rig.setGaze((pointer[0] - (r.left + r.width / 2)) / 600, (pointer[1] - (r.top + r.height * 0.3)) / 420);
  }
  const onPointer = e => { pointer = [e.clientX, e.clientY]; aim(); };
  function express(name, ms) {
    if (!panel || !STATE[name]) return;
    clearTimeout(exprT);
    show(name);
    if (ms) exprT = setTimeout(rest, ms);
  }
  function rest() { clearTimeout(exprT); show(held || "idle"); }
  function pose(tilt, nod, ms) {           // a brief head pose that eases back unless held
    if (!rig) return;
    clearTimeout(poseT);
    rig.tilt(tilt); rig.nod(nod);
    if (ms) poseT = setTimeout(() => { rig.tilt(held === "think" ? 1.5 : 0); rig.nod(0); }, ms);
  }
  function breathe(rate, depth, ms) {       // excited / focused breathing that settles back to calm
    if (!rig) return;
    clearTimeout(breathT);
    rig.setBreath({ rate, depth });
    if (ms) breathT = setTimeout(() => rig && rig.setBreath(held === "think" ? { rate: 0.8, depth: 0.7 } : { rate: 1, depth: 1 }), ms);
  }
  // one-shot motions named by the line pool (all built from the rig's existing springs)
  function move(m) {
    if (!rig) return;
    const rest = held === "think" ? 1.5 : 0;
    if (m === "hop") rig.hop(-380);
    else if (m === "hop2") { rig.hop(-420); setTimeout(() => rig && rig.hop(-360), 460); }
    else if (m === "nod") pose(0, 9, 650);
    else if (m === "tilt") pose(2.2, 0, 1500);
    else if (m === "shake") [2, -2, 1.4, -1, rest].forEach((d, i) => setTimeout(() => rig && rig.tilt(d), i * 170));
    else if (m === "sigh") rig.sigh();
    else if (m === "look") { gazeHold = Date.now() + 1400; rig.setGaze(0.75, -0.35); setTimeout(aim, 1450); }
  }

  /* ---------- speech: bubble above her head, typed out while the mouth moves ---------- */
  // mouth shapes cycled while typing, chosen by mood so a smile does not turn into a gasp
  const TALK = { happy: ["open-smile", "a", "e"], celebrate: ["open-smile", "a", "e"], wrong: ["u", "o", "e"],
    think: ["u", "o", "i"], rare: ["o", "a", "u"], idle: ["a", "e", "o", "i"] };
  const PAUSE = /[，。！？、…～,.!?\s（）]/;
  const calm = window.matchMedia("(prefers-reduced-motion: reduce)");
  let bubble = null, sayT, speakT, typeT = 0, lastSay = 0;
  function placeBubble() {
    if (!bubble || !panel) return;
    const r = panel.getBoundingClientRect();
    const w = panel.classList.contains("mini") ? Math.max(150, Math.min(240, Math.floor(freeRight()) - 24)) : r.width;
    bubble.style.width = w + "px";
    bubble.style.right = Math.round(window.innerWidth - r.right) + "px";
    bubble.style.bottom = Math.round(window.innerHeight - r.top + 10) + "px";
    bubble.style.setProperty("--tail", Math.round(r.width / 2 - 7) + "px");   // points at her head
  }
  function stopTalk() {
    clearInterval(typeT); typeT = 0;
    if (rig && STATE[shown]) rig.setMouth(STATE[shown].mouth);
  }
  function hideBubble() { clearTimeout(sayT); stopTalk(); if (bubble) bubble.classList.remove("on"); }
  function say(text, state, motion) {
    if (!panel || !ready || !text) return false;
    if (!bubble) {
      bubble = document.createElement("div");
      bubble.className = "ap-say"; bubble.setAttribute("role", "status");
      bubble.innerHTML = '<span class="ap-typed"></span><span class="ap-rest"></span>';   // rest keeps the final size
      document.body.appendChild(bubble);
    }
    clearTimeout(sayT); stopTalk();
    const chars = [...text], still = calm.matches, typeMs = still ? 0 : chars.length * 55;
    const hold = Math.min(6500, 1800 + chars.length * 60);
    if (state && STATE[state]) express(state, typeMs + hold);
    if (motion && !still) move(motion);
    const typed = bubble.firstChild, restEl = bubble.lastChild;
    typed.textContent = still ? text : ""; restEl.textContent = still ? "" : text;
    placeBubble(); bubble.classList.add("on");
    lastSay = Date.now();
    if (!still) {
      const shapes = TALK[shown] || TALK.idle;
      let i = 0;
      typeT = setInterval(() => {
        if (!rig || i >= chars.length) return stopTalk();
        const c = chars[i++];
        typed.textContent += c; restEl.textContent = chars.slice(i).join("");
        // open on most characters, close on punctuation and every third beat so it reads as speech
        rig.setMouth(PAUSE.test(c) || i % 3 === 0 ? "closed" : shapes[Math.floor(Math.random() * shapes.length)]);
      }, 55);
    }
    sayT = setTimeout(hideBubble, typeMs + hold);
    return true;
  }

  /* ---------- what to say: situation → a fresh line from the pool ---------- */
  const mem = (() => {
    let m = null;
    try { m = JSON.parse(get(MEM_KEY) || "null"); } catch {}
    m = m && typeof m === "object" ? m : {};
    return { day: String(m.day || ""), count: +m.count || 0, last: +m.last || 0, greet: String(m.greet || ""),
      recent: Array.isArray(m.recent) ? m.recent.slice(-40) : [], qs: m.qs && typeof m.qs === "object" ? m.qs : {} };
  })();
  function saveMem() {
    const k = Object.keys(mem.qs);
    if (k.length > 4000) k.slice(0, k.length - 3500).forEach(x => delete mem.qs[x]);
    put(MEM_KEY, JSON.stringify(mem));
  }
  function rollDay() {
    const d = new Date(), day = d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate();
    if (mem.day !== day) { mem.day = day; mem.count = 0; }
  }
  const chance = p => Math.random() < p;
  const passFor = id => { const e = (window.EXAMS || []).find(x => x.id === id); return (e && +e.pass_pct) || 75; };
  function pick(sit, vars) {
    const L = window.APPRENTICE_LINES, list = L && L[sit];
    if (!Array.isArray(list) || !list.length) return null;
    const def = (L.defaults && L.defaults[sit]) || [];
    const fill = s => s.replace(/\{(\w+)\}/g, (m, k) => (vars && vars[k] != null ? vars[k] : m));
    const all = list.map((e, i) => {
      const [t, st, mo] = Array.isArray(e) ? e : [e];
      return { id: sit + "#" + i, text: fill(String(t)), state: st === undefined ? def[0] : st, motion: mo === undefined ? def[1] : mo };
    }).filter(c => !/\{\w+\}/.test(c.text));                 // a placeholder we cannot fill → skip the line
    if (!all.length) return null;
    const fresh = all.filter(c => !mem.recent.includes(c.id));
    const c = fresh.length ? fresh[Math.floor(Math.random() * fresh.length)]
      : all.sort((a, b) => mem.recent.indexOf(a.id) - mem.recent.indexOf(b.id))[0];   // else the stalest
    mem.recent = mem.recent.filter(x => x !== c.id).concat(c.id).slice(-40);
    return c;
  }
  // priority lines (milestones, streaks, exams, greetings) skip the cooldown; the delay lets the
  // instant reaction (hop / nod) land first, so the line reads as her following up
  function speak(sit, vars, priority, delay = 650) {
    if (!panel || !ready || document.hidden) return;
    if (!priority && Date.now() - lastSay < 15000) return;
    const c = pick(sit, vars);
    if (!c) return;
    lastSay = Date.now(); saveMem();
    clearTimeout(speakT);
    speakT = setTimeout(() => say(c.text, c.state, c.motion), delay);
  }
  function greet() {
    const now = Date.now(), prev = mem.last;
    rollDay(); mem.last = now;
    if (mem.greet !== mem.day) {
      mem.greet = mem.day;
      const gap = prev ? Math.floor((now - prev) / 86400000) : 0, h = new Date().getHours();
      if (gap >= 3) speak("return", { gap }, true, 1200);
      else speak(h < 5 || h >= 23 ? "greet.late" : h < 11 ? "greet.morning" : h < 14 ? "greet.noon"
        : h < 18 ? "greet.afternoon" : "greet.evening", null, true, 1200);
    }
    saveMem();
  }
  let run = 0, exam = null, lastAct = Date.now(), idleSaid = false, idleT = 0, pokes = [], lastPoke = 0;
  function talkAnswered(d) {
    rollDay(); mem.count++; mem.last = lastAct = Date.now(); idleSaid = false;
    const key = (d.exam || "") + ":" + d.qid, prev = d.qid == null ? undefined : mem.qs[key];
    if (d.qid != null) { delete mem.qs[key]; mem.qs[key] = d.correct ? 1 : 0; }   // re-insert = most recent
    const before = run, n = mem.count;
    run = d.correct ? Math.max(0, run) + 1 : Math.min(0, run) - 1;
    if (n === 100) speak("milestone100", null, true);
    else if ([10, 30, 50, 150, 200, 300].includes(n)) speak("milestone", { count: n }, true);
    else if (d.correct) {
      if (run === 3 || run === 5 || run === 10) speak("streak" + run, null, true);
      else if (run >= 15 && run % 5 === 0) speak("streakBig", { streak: run }, true);
      else if (prev === 0 && chance(0.85)) speak("redeem", null, true);
      else if (before <= -2) speak("comeback", null, true);
      else if (new Date().getHours() < 5 && chance(0.25)) speak("late");
      else if (chance(0.3)) speak("correct");
    } else {
      if (before >= 5) speak("streakBroken", { streak: before }, true);
      else if (run === -3 || run === -5 || run === -8) speak("wrongStreak", null, true);
      else if (prev === 0 && chance(0.7)) speak("wrongAgain", null, true);
      else if (prev === 1 && chance(0.7)) speak("slipped", null, true);
      else if (chance(0.4)) speak("wrong");
    }
    saveMem();
  }
  function poke() {
    const now = Date.now();
    pokes = pokes.filter(t => now - t < 6000).concat(now);
    if (pokes.length >= 4) { pokes = []; lastPoke = now; return speak("pokeSpam", null, true, 0); }
    if (now - lastPoke < 2500) return;
    lastPoke = now; speak("poke", null, true, 0);
  }
  function idleCheck() {
    if (!panel || !ready || held || idleSaid || document.hidden) return;
    if (Date.now() - lastAct > 240000) { idleSaid = true; speak("idle", null, true, 0); }
  }

  /* ---------- layout: full card when the right margin has room, else a round mini avatar ---------- */
  function freeRight() {
    const view = document.querySelector("main.view:not(.hidden)");
    if (!view) return 0;
    let right = 0;
    for (const c of view.children) {
      const r = c.getBoundingClientRect();
      if (r.width) right = Math.max(right, r.right);
    }
    return window.innerWidth - right;
  }
  function layout() {
    layoutF = 0;
    if (!panel) return;
    const w = Math.min(FULL_MAX, Math.floor(freeRight()) - 28);
    const mini = get(MIN_KEY) === "1" || w < FULL_MIN;
    const was = panel.classList.contains("mini"), oldW = panel.style.getPropertyValue("--ap-w");
    panel.classList.toggle("mini", mini);
    if (mini) panel.style.removeProperty("--ap-w"); else panel.style.setProperty("--ap-w", w + "px");
    panel.title = mini ? (get(MIN_KEY) === "1" ? "點我展開雲端學徒" : "畫面較窄，雲端學徒先縮小陪你") : "";
    if (rig && (was !== mini || oldW !== panel.style.getPropertyValue("--ap-w"))) rig.setFraming(mini ? "mini" : "card");
    if (bubble && bubble.classList.contains("on")) placeBubble();
  }
  const queueLayout = () => { if (!layoutF) layoutF = requestAnimationFrame(layout); };

  /* ---------- build / destroy ---------- */
  function build() {
    if (!window.ApprenticeRig) return;
    panel = document.createElement("aside");
    panel.id = "apprentice";
    panel.setAttribute("aria-label", "雲端學徒");
    const canvas = document.createElement("canvas");
    canvas.className = "ap-canvas";
    canvas.setAttribute("aria-hidden", "true");
    const min = document.createElement("button");
    min.type = "button"; min.className = "ap-min"; min.textContent = "–";
    min.title = "縮小"; min.setAttribute("aria-label", "縮小雲端學徒");
    min.onclick = e => { e.stopPropagation(); put(MIN_KEY, "1"); layout(); };
    panel.onclick = () => { if (get(MIN_KEY) === "1") { put(MIN_KEY, null); layout(); } else if (ready) poke(); };
    panel.append(canvas, min);
    document.body.appendChild(panel);
    layout();
    rig = window.ApprenticeRig.create(canvas, { framing: panel.classList.contains("mini") ? "mini" : "card" });
    window.addEventListener("resize", queueLayout);
    document.addEventListener("click", queueLayout, true);   // view tabs change the free margin
    document.addEventListener("mousemove", onPointer, { passive: true });
    const p = panel;
    rig.ready.then(() => {
      if (panel !== p) return;
      ready = true; rig.resize(); show(held || "idle"); panel.classList.add("ready");
      idleT = setInterval(idleCheck, 20000);
      greet();
    }, err => console.warn(err));   // fail closed: the card stays hidden if layers are missing
  }
  function destroy() {
    clearTimeout(exprT); clearTimeout(poseT); clearTimeout(breathT); cancelAnimationFrame(layoutF); layoutF = 0;
    clearTimeout(speakT); clearInterval(idleT); hideBubble();
    if (bubble) { bubble.remove(); bubble = null; }
    window.removeEventListener("resize", queueLayout);
    document.removeEventListener("click", queueLayout, true);
    document.removeEventListener("mousemove", onPointer);
    if (rig) rig.destroy();
    if (panel) panel.remove();
    panel = rig = null; shown = "idle"; held = null; ready = false;
  }

  /* ---------- companion slot + switch button (desktop only) ---------- */
  function claim(on) {
    if (on === active()) return;
    if (on) document.documentElement.dataset.companion = "apprentice";
    else delete document.documentElement.dataset.companion;
    if (on) build(); else destroy();
    document.dispatchEvent(new CustomEvent("companion:changed", { detail: { companion: on ? "apprentice" : "pet" } }));
    syncSwitch();
  }
  function syncSwitch() {
    if (!sw) return;
    const on = active();
    sw.textContent = on ? "☁" : "🧪";
    sw.title = on ? "換回雲寶" : "換成雲端學徒";
    sw.setAttribute("aria-label", sw.title);
  }
  function sync() {
    if (desktop.matches) {
      if (!sw) {
        sw = document.createElement("button");
        sw.id = "companionSwitch"; sw.type = "button";
        sw.onclick = () => { const on = !active(); put(KEY, on ? "apprentice" : null); claim(on); };
        document.body.appendChild(sw);
      }
      claim(get(KEY) === "apprentice");
      syncSwitch();
    } else {
      claim(false);
      if (sw) { sw.remove(); sw = null; }
    }
  }

  /* ---------- quiz events ---------- */
  const on = (type, fn) => document.addEventListener(type, e => { if (panel) fn(e.detail || {}); });
  on("quiz:answered", d => {
    if (held) return;
    if (d.correct) { express("happy", 2600); rig.hop(-420); pose(1.2, 0, 1200); breathe(1.5, 1.2, 3500); }
    else { express("wrong", 3200); pose(-0.8, 10, 2600); rig.sigh(); }
    talkAnswered(d);
  });
  on("quiz:examStart", d => {
    held = "think"; express("think"); pose(1.5, 0); breathe(0.8, 0.7);
    lastAct = Date.now(); idleSaid = false;
    const n = +d.n || 0;
    exam = { n, seen: new Set(), half: n < 10 };            // short exams get no halfway line
    speak(n >= 50 ? "examStartLong" : "examStart", { n }, true);
  });
  on("quiz:examPick", d => {
    lastAct = Date.now();
    if (!exam || exam.half) return;
    exam.seen.add(d.qid);
    if (exam.seen.size >= Math.ceil(exam.n / 2)) { exam.half = true; speak("examHalf", null, true, 300); }
  });
  on("quiz:examDone", d => {
    held = null; exam = null; lastAct = Date.now();
    const pct = +d.pct || 0, pass = passFor(d.exam);
    if (pct >= pass) {
      express("celebrate", 4200); rig.hop(-480); setTimeout(() => rig && rig.hop(-420), 460); pose(-1, 0, 1300);
      breathe(1.7, 1.3, 5000);
    } else { express("wrong", 4200); pose(-0.8, 10, 3000); breathe(1, 1); rig.sigh(); }
    const tier = pct >= 100 ? "perfect" : pct >= Math.min(99, pass + 15) ? "great" : pct >= pass ? "pass" : pct >= pass - 10 ? "close" : "low";
    speak("examDone." + tier, { pct, pass, short: Math.max(1, pass - pct) }, true, 900);
  });

  window.CloudApprentice = {
    express: (name, ms = 2500) => express(name, ms),
    mouth: shape => rig && MOUTHS.includes(shape) && rig.setMouth(shape),   // manual only (no lip sync)
    outfit: id => (rig ? rig.setOutfit(id) : Promise.resolve(false)),        // not persisted yet (no outfits shipped)
    say: (text, o = {}) => say(String(text), o.state, o.motion),             // any line, e.g. from a future director
    speak: (situation, vars) => speak(situation, vars, true, 0),               // a pool line, for previews / tests
    states: STATE, mouths: MOUTHS,
    state: () => ({ state: shown, held, ready, rig: rig ? rig.state() : null }),
  };
  if (desktop.addEventListener) desktop.addEventListener("change", sync);
  sync();
})();
