/* apprentice.js — 雲端學徒 (Cloud Apprentice): desktop opt-in companion, alternative to 雲寶.
   Like pet.js it never calls app.js; it only listens to the quiz CustomEvents:
     quiz:answered  {correct}  → happy (small hop) / wrong (small nod)
     quiz:examStart            → think (slight tilt), held until the exam ends
     quiz:examDone  {pct}      → celebrate (double hop) at ≥75% (same 達標 line as pet.js) / wrong
   "rare" (驚訝) has no game event yet; it is reachable through window.CloudApprentice.express.
   Drawing is done by apprentice-rig.js (2D layer rig: body, head group, face parts, hair).
   Companion slot: claiming sets <html data-companion="apprentice"> and dispatches
   "companion:changed"; pet.js stands down while the attribute is present. Phones/tablets never
   see the apprentice — 雲寶 stays the companion there.
   Storage: localStorage "app_companion" ("apprentice" | absent), "app_apprentice_min" ("1" = mini). */
"use strict";
(function () {
  const KEY = "app_companion", MIN_KEY = "app_apprentice_min";
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
  let exprT, poseT, breathT, layoutF = 0, sw = null;

  /* ---------- expressions & poses (the rig blinks on its own while the eyes are neutral) ---------- */
  function show(name) {
    const s = STATE[name];
    if (!rig || !s) return;
    rig.setEyes(s.eyes); rig.setMouth(s.mouth); rig.setBrows(s.brows[0], s.brows[1]);
    shown = name; aim();
  }
  function aim() {                          // held gaze for the state, else follow the pointer
    if (!rig) return;
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
    panel.onclick = () => { if (get(MIN_KEY) === "1") { put(MIN_KEY, null); layout(); } };
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
    }, err => console.warn(err));   // fail closed: the card stays hidden if layers are missing
  }
  function destroy() {
    clearTimeout(exprT); clearTimeout(poseT); clearTimeout(breathT); cancelAnimationFrame(layoutF); layoutF = 0;
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
  });
  on("quiz:examStart", () => { held = "think"; express("think"); pose(1.5, 0); breathe(0.8, 0.7); });
  on("quiz:examDone", d => {
    held = null;
    if ((d.pct || 0) >= 75) {
      express("celebrate", 4200); rig.hop(-480); setTimeout(() => rig && rig.hop(-420), 460); pose(-1, 0, 1300);
      breathe(1.7, 1.3, 5000);
    } else { express("wrong", 4200); pose(-0.8, 10, 3000); breathe(1, 1); rig.sigh(); }
  });

  window.CloudApprentice = {
    express: (name, ms = 2500) => express(name, ms),
    mouth: shape => rig && MOUTHS.includes(shape) && rig.setMouth(shape),   // manual only (no lip sync)
    outfit: id => (rig ? rig.setOutfit(id) : Promise.resolve(false)),        // not persisted yet (no outfits shipped)
    states: STATE, mouths: MOUTHS,
    state: () => ({ state: shown, held, ready, rig: rig ? rig.state() : null }),
  };
  if (desktop.addEventListener) desktop.addEventListener("change", sync);
  sync();
})();
