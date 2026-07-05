/* pet.js — 雲寶 (Cloudlet) virtual pet. Fully decoupled from the quiz app:
   listens only to CustomEvents, never calls app.js functions or touches its state.
     quiz:answered  detail {qid, correct}   → feed on correct (once per qid per day)
     quiz:examDone  detail {pct, total}     → big meal
   Storage: localStorage "app_pet" (state) + "app_pet_enabled" (toggle).
   Uninstall = delete pet.js/pet.css + the two dispatchEvent lines in app.js. */
"use strict";
(function () {
  const KEY = "app_pet", EN_KEY = "app_pet_enabled";
  const enabled = () => localStorage.getItem(EN_KEY) !== "0"; // default: on

  /* ---------- state ---------- */
  const DEF = {
    stage: 0,        // 0 蛋, 1 幼雲, 2 小雲寶, 3 大雲寶, 4 雲王
    feeds: 0, xp: 0,
    coins: 0, items: {},    // shop: 雲朵幣（與 XP 等量入帳）與家具/玩具
    acc: {}, worn: {}, gachaDay: "",   // accessories owned / equipped-per-slot / last free-spin day
    hunger: 70, mood: 80, clean: 90,   // 0–100
    lastTick: Date.now(),
    day: "", fedIds: [],    // daily anti-farm guard
    streakDays: 0, lastStudyDay: "",   // consecutive study-day streak
    aff: {}, nightFeeds: 0, bestExamPct: 0, form: "",   // breeding: affinity / hidden-form trackers / final form
    wrongIds: [],                     // questions once missed → revenge targets
    quests: null,                     // daily quests {date, list}
    todayStats: { c: 0, w: 0, xp: 0 },
  };
  let S;
  function load() {
    let raw = {};
    try { raw = JSON.parse(localStorage.getItem(KEY)) || {}; } catch {}
    S = { ...DEF, ...raw };
    const v = raw.ver || 1;      // read version from the RAW save (DEF spread must not mask it)
    if (v < 2) {                 // v2: five-stage growth tree
      if (S.stage === 3) S.stage = 4;
      else if (S.stage === 2) S.stage = 3;
      else if (S.stage === 1 && S.xp >= 25) S.stage = 2;
    }
    if (v < 3) S.coins = (S.coins || 0) + S.xp;   // v3: shop — backfill coins from lifetime xp
    if (v < 4) {                                   // v4: accessories/wardrobe — migrate the old shop hat
      S.acc = S.acc || {}; S.worn = S.worn || {};
      if (S.items && S.items.hat) { S.acc.tophat = true; S.worn.head = "tophat"; delete S.items.hat; }
    }
    S.ver = 4;
  }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch {} };
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const today = () => new Date().toISOString().slice(0, 10);

  function rollDay() {
    const d = today();
    if (S.day !== d) { S.day = d; S.fedIds = []; S.todayStats = { c: 0, w: 0, xp: 0 }; }
    if (!S.quests || S.quests.date !== d) genQuests();
  }
  /* ---------- daily quests ---------- */
  const QUEST_DESC = {
    correct: t => `答對 ${t} 題`,
    revenge: t => `復仇 ${t} 題（答對曾錯的題）`,
    pat: t => `摸摸雲寶 ${t} 次`,
    exam: () => `完成 1 場模擬考`,
  };
  function genQuests() {
    const pk = a => a[Math.floor(Math.random() * a.length)];
    S.quests = { date: today(), announced: false, list: [
      { type: "correct", target: pk([8, 10, 12]), got: 0, done: false },
      { type: "revenge", target: pk([1, 2]), got: 0, done: false },
      Math.random() < 0.5 ? { type: "pat", target: 3, got: 0, done: false }
                          : { type: "exam", target: 1, got: 0, done: false },
    ] };
  }
  function quest(type, n) {
    const q = ((S.quests || {}).list || []).find(x => x.type === type && !x.done);
    if (!q) return;
    q.got += (n || 1);
    if (q.got >= q.target) {
      q.done = true;
      setTimeout(() => {
        gainXp(8);
        say(`📋 委託完成：「${QUEST_DESC[q.type](q.target)}」 +8 XP`, 3200);
        if (S.quests.list.every(x => x.done)) setTimeout(() => {
          gainXp(15); express("starUntil", 5000);
          say("🎁 今日委託全數完成！寶箱獎勵 +15 XP", 4200);
          [0, 250, 500].forEach(t => setTimeout(() => float(pick(["🎁", "✨", "🎉"])), t));
        }, 2000);
      }, 600);
    }
    save();
  }
  /* gentle offline decay — no death, floors keep the pet recoverable */
  function applyDecay() {
    const h = (Date.now() - S.lastTick) / 3600000;
    if (h < 0.02) return;
    S.hunger = clamp(S.hunger - h * 0.8, 12, 100);
    S.mood = clamp(S.mood - h * 0.5, 25, 100);
    S.clean = clamp((S.clean == null ? 90 : S.clean) - h * 0.7, 0, 100);  // slowly gets grubby
    S.dusty = h >= 72;                       // long absence → "想你" greeting
    S.lastTick = Date.now();
    save();
  }

  /* ---------- DOM ----------
     The pet lives on the RIGHT EDGE of the viewport and strolls vertically:
     y = translateY offset from the top of the strip. */
  let layer, pet, bubble, y = 300, dir = 1, mode = "idle", brainT, bubbleT, walkEndT;
  /* transient expressions — timed flags rendered by refreshLook (so they survive re-renders) */
  const fx = { blushUntil: 0, starUntil: 0, happyUntil: 0, worried: false, exam: false };
  let streak = 0, wrongStreak = 0, pats = [];   // session-only counters
  const Y_MIN = 70;                                       // below the topbar
  const yMax = () => window.innerHeight - 170;            // above the ☁ toggle button
  const $make = (tag, cls, html) => { const el = document.createElement(tag); if (cls) el.className = cls; if (html != null) el.innerHTML = html; return el; };

  const PET_SVG = `
  <div class="pet-flip">
    <div class="pet-egg">🥚</div>
    <svg class="pet-svg" viewBox="0 0 72 52" aria-hidden="true">
      <g class="body">
        <circle cx="20" cy="30" r="13"/><circle cx="37" cy="22" r="16"/><circle cx="54" cy="31" r="12"/>
        <rect x="10" y="28" width="54" height="17" rx="8.5"/>
      </g>
      <g class="headband"><rect x="15" y="12" width="44" height="5.5" rx="2.7" transform="rotate(-5 37 15)"/><circle cx="58" cy="13" r="2.6"/></g>
      <g class="crown"><path d="M29 8.5 L31.5 2.5 L37 6.5 L42.5 2.5 L45 8.5 Z"/><circle cx="31.5" cy="2.5" r="1.2"/><circle cx="42.5" cy="2.5" r="1.2"/></g>
      <text class="acc acc-guard" x="56" y="17" text-anchor="middle" font-size="12">🛡️</text>
      <text class="acc acc-gear" x="56" y="17" text-anchor="middle" font-size="12">⚙️</text>
      <text class="acc acc-sage" x="37" y="10" text-anchor="middle" font-size="12">🎓</text>
      <text class="acc acc-night" x="56" y="15" text-anchor="middle" font-size="12">🌙</text>
      <text class="acc acc-gold" x="56" y="15" text-anchor="middle" font-size="11">✨</text>
      <text class="tacc tacc-arch" x="57" y="18" text-anchor="middle" font-size="9">📐</text>
      <text class="tacc tacc-guard" x="57" y="18" text-anchor="middle" font-size="9">🛡</text>
      <text class="tacc tacc-gear" x="57" y="18" text-anchor="middle" font-size="9">🔧</text>
      <text class="tacc tacc-sage" x="57" y="18" text-anchor="middle" font-size="9">📖</text>
      <g class="face">
        <g class="eyes">
          <circle class="eye" cx="29" cy="30" r="2.6"/><circle class="eye" cx="45" cy="30" r="2.6"/>
          <path class="eye-closed" d="M26 30 q3 2.6 6 0"/><path class="eye-closed" d="M42 30 q3 2.6 6 0"/>
          <path class="eye-happy" d="M26 31 q3 -3.2 6 0"/><path class="eye-happy" d="M42 31 q3 -3.2 6 0"/>
          <text class="eye-star" x="29" y="33" text-anchor="middle" font-size="9">✦</text>
          <text class="eye-star" x="45" y="33" text-anchor="middle" font-size="9">✦</text>
        </g>
        <circle class="cheek" cx="23" cy="36" r="2.8"/><circle class="cheek" cx="51" cy="36" r="2.8"/>
        <path class="mouth m-smile" d="M33 36 q4 4.5 8 0"/>
        <path class="mouth m-flat" d="M33 37.5 h8"/>
        <path class="mouth m-o" d="M37 35.5 a2.6 2.9 0 1 0 .01 0"/>
        <path class="mouth m-worry" d="M32 38 q2.5 -2 5 0 q2.5 2 5 0"/>
      </g>
    </svg>
    <span class="pet-zzz">💤</span>
    <span class="pet-sweat">💧</span>
    <span class="pet-sun">☀️</span>
    <span class="pet-rain">🌧️</span>
    <span class="pet-carry">⚽</span>
  </div>
  <div class="pet-worn"></div>`;

  function build() {
    layer = $make("div"); layer.id = "petLayer";
    pet = $make("div"); pet.id = "pet"; pet.innerHTML = PET_SVG; pet.title = "雲寶（點我摸摸）";
    bubble = $make("div"); bubble.id = "petBubble";
    bubble.addEventListener("click", e => {
      if (e.target.id === "petRebirth") doRebirth();
      else if (e.target.id === "petCard") exportCard();
      else if (e.target.id === "petShopBtn") toggleShop();
      else if (e.target.id === "petWardrobeBtn") toggleWardrobe();
      else if (e.target.id === "petGachaBtn") toggleGacha();
    });
    layer.append(pet, bubble);
    document.body.appendChild(layer);
    y = clamp(window.innerHeight - 240, Y_MIN, yMax());
    place(0);
    placeItems();
    refreshLook();
    renderWorn();
    pet.addEventListener("click", pat);
    pet.addEventListener("dblclick", spin);
    pet.addEventListener("mousedown", onGrab);
    pet.addEventListener("transitionend", e => { if (e.propertyName === "transform") arrive(); });
    brainT = setInterval(think, 3000);
    document.addEventListener("mousemove", onMouse);
    document.addEventListener("mousemove", onLook);
    document.addEventListener("mousemove", onDragMove);
    document.addEventListener("mouseup", onRelease);
    document.addEventListener("mousemove", onBallMove);
    document.addEventListener("mouseup", onBallRelease);
    document.addEventListener("mousemove", onShowerMove);
    document.addEventListener("mouseup", onShowerRelease);
    pet.addEventListener("touchstart", onPetTouchStart, { passive: true });
    document.addEventListener("touchmove", onTouchMove, { passive: false });
    document.addEventListener("touchend", onTouchEnd);
  }
  function destroy() {
    clearInterval(brainT); clearTimeout(bubbleT); clearTimeout(walkEndT);
    cancelAnimationFrame(physRAF); dragging = false;
    cancelAnimationFrame(ballRAF); clearTimeout(fetchT); ballDrag = false;
    if (looseBall) { looseBall.remove(); looseBall = null; }
    if (shopEl) { shopEl.remove(); shopEl = null; }
    if (wardrobeEl) { wardrobeEl.remove(); wardrobeEl = null; }
    if (gachaEl) { gachaEl.remove(); gachaEl = null; }
    despawnBoss(false);
    document.removeEventListener("mousemove", onMouse);
    document.removeEventListener("mousemove", onLook);
    document.removeEventListener("mousemove", onDragMove);
    document.removeEventListener("mouseup", onRelease);
    document.removeEventListener("mousemove", onBallMove);
    document.removeEventListener("mouseup", onBallRelease);
    document.removeEventListener("mousemove", onShowerMove);
    document.removeEventListener("mouseup", onShowerRelease);
    document.removeEventListener("touchmove", onTouchMove);
    document.removeEventListener("touchend", onTouchEnd);
    if (looseShower) { looseShower.remove(); looseShower = null; }
    if (layer) layer.remove();
    layer = pet = bubble = null;
  }

  /* ---------- look & movement ---------- */
  function refreshLook() {
    if (!pet) return;
    pet.className = "";
    pet.classList.add("stage-" + S.stage, (mode === "walk" || mode === "fetch") ? "walking" : mode);
    if (S.stage === 4) pet.classList.add("form-" + (S.form || "arch"));
    else if (S.stage === 3) pet.classList.add("tend-" + topAff());   // 大雲寶：傾向雛形配件
    if (carrying) pet.classList.add("carrying");
    if (mode === "sleeping" && S.items && S.items.bed) pet.classList.add("on-bed");
    if (S.stage > 0) {
      if (S.clean < 22) pet.classList.add("dirty");
      else if (S.clean < 45) pet.classList.add("grimy");
      if (fx.exam) pet.classList.add("exam");
      if (mode !== "sleeping") {
        const now = Date.now();
        if (now < fx.starUntil) pet.classList.add("e-star");
        else if (now < fx.blushUntil) pet.classList.add("blush");
        else if (now < fx.happyUntil) pet.classList.add("e-happy");
        else if (fx.worried) pet.classList.add("worried", "mood-worry");
        else if (S.hunger < 30 || S.mood < 40) pet.classList.add("mood-flat");
      }
      if (mode === "walk") pet.classList.add(dir < 0 ? "tilt-up" : "tilt-down");
    }
  }
  /* set a timed expression and schedule the re-render that clears it */
  function express(flag, ms) {
    fx[flag] = Date.now() + ms;
    refreshLook();
    setTimeout(refreshLook, ms + 60);
  }
  function place(dur) {
    pet.style.transitionDuration = dur + "s";
    pet.style.transform = `translateY(${y}px)`;
  }
  let arriveCb = null;
  /* returns true if a walk actually started; cb (optional) fires on arrival.
     minDist: how close counts as "already there" (default 24 to avoid jitter on tiny wanders;
     item interactions pass a small value so the pet walks right onto the spot before acting). */
  function walkTo(ty, cb, minDist) {
    if (!pet || S.stage === 0) return false;    // eggs don't walk
    if (mode === "drag" || mode === "toss" || mode === "fetch") return false;   // being played with
    ty = clamp(ty, Y_MIN, yMax());
    const dist = Math.abs(ty - y);
    if (dist < (minDist == null ? 24 : minDist)) return false;
    arriveCb = cb || null;
    dir = ty > y ? 1 : -1;                      // 1 = down, -1 = up
    mode = "walk"; refreshLook();
    y = ty;
    const speed = S.hunger < 25 ? 36 : 55;       // 餓了走得慢
    place(dist / speed);
    clearTimeout(walkEndT);
    walkEndT = setTimeout(arrive, dist / speed * 1000 + 300); // fallback if transitionend missed
    return true;
  }
  function arrive() {
    if (mode !== "walk") return;
    mode = "idle"; refreshLook();
    const cb = arriveCb; arriveCb = null;
    if (cb) cb();
  }
  /* live Y of the pet, correct even mid-walk (y already holds the destination) */
  const petY = () => pet ? pet.getBoundingClientRect().top : y;
  /* play a one-off animation: mode becomes "busy" until it ends, so the brain
     (wandering / cursor-chasing) waits for the action to finish before idling */
  function oneShot(cls, ms) {
    if (!pet) return;
    mode = "busy"; refreshLook();
    pet.classList.add(cls);
    setTimeout(() => {
      if (!pet) return;
      pet.classList.remove(cls);
      if (mode === "busy") { mode = "idle"; refreshLook(); }
    }, ms);
  }

  let lastActivity = Date.now();
  function think() {
    applyDecay(); rollDay();
    if (!pet || (mode !== "idle" && mode !== "sleeping")) return;   // walking/busy/drag/toss: let it finish
    if (ballDrag || looseBall || showerDrag || looseShower) return; // playing / bathing — don't wander off
    if (Date.now() - lastActivity > 90000 && mode !== "sleeping") {
      const goSleep = () => {
        mode = "sleeping"; refreshLook();
        if (S.items && S.items.bed) {                     // tuck into the cloud bed
          const bed = layer && layer.querySelector(".item-bed");
          if (bed) bed.classList.add("occupied");
        }
      };
      if (S.items && S.items.bed) {                       // head to the cloud bed first
        if (!walkTo(window.innerHeight * ITEM_SPOTS.bed - 24, goSleep)) goSleep();
      } else goSleep();
      return;
    }
    if (mode === "sleeping") return;
    if (S.stage === 0) return;
    if (fx.exam) {                                 // during a mock exam: stay put, cheer quietly
      if (Math.random() < 0.12) float("💪");
      return;
    }
    if (S.hunger < 25 && Math.random() < 0.15) { say(pick(HUNGRY), 2600); return; }
    if (S.stage === 4 && Math.random() < 0.05) { say(`「${(FORMS[S.form] || FORMS.arch).line}」`, 2600); return; }
    if (!fx.exam && Math.random() < 0.02) { spawnNPC(); return; }
    if (Math.random() < 0.05) { say(chatterLine(), 2800); return; }
    /* personality follows mood: happy = playful, glum = withdrawn */
    const playful = S.mood >= 80, glum = S.mood < 40;
    const walkP = glum ? 0.28 : playful ? 0.55 : 0.45;
    const r = Math.random();
    if (r < walkP) walkTo(y + (Math.random() * 320 - 160));
    else if (r < walkP + 0.08) yawn();
    else if (r < walkP + 0.15) oneShot("squish", 400);     // little stretch
    else if (r < walkP + 0.23) glance();
    else if (r < walkP + 0.31) {
      if (playful) float("♪");                             // humming
      else if (glum) say("……", 1400);                      // needs a pat
    }
    else if (S.items && S.items.ball && r < walkP + 0.38) goToItem("ball", kickBall);
    else if (S.items && S.items.plant && r < walkP + 0.44) goToItem("plant", waterPlant);
  }
  /* walk right onto an item (centre the pet on it), then act on arrival — no early trigger */
  function goToItem(id, action) {
    const el = layer && layer.querySelector(".item-" + id);
    if (!el || mode !== "idle") return;
    const r = el.getBoundingClientRect();
    const target = clamp(r.top + r.height / 2 - petH() / 2, Y_MIN, yMax());  // align centres
    if (!walkTo(target, action, 6)) action();     // walk there (act on arrival), or act if already on it
  }
  function yawn() {
    if (!pet) return;
    mode = "busy"; refreshLook();
    pet.classList.add("yawning");
    setTimeout(() => {
      if (!pet) return;
      pet.classList.remove("yawning");
      if (mode === "busy") { mode = "idle"; refreshLook(); }
    }, 1300);
  }
  function glance() {                              // look left, then right, then back
    const g = pet && pet.querySelector(".eyes");
    if (!g) return;
    g.style.transform = "translate(-1.8px,0)";
    setTimeout(() => g && (g.style.transform = "translate(1.8px,0)"), 500);
    setTimeout(() => g && (g.style.transform = ""), 1000);
  }
  function wake() {
    lastActivity = Date.now();
    if (mode === "sleeping") {
      mode = "idle"; refreshLook();
      const bed = layer && layer.querySelector(".item-bed.occupied");
      if (bed) bed.classList.remove("occupied");
    }
  }

  /* pupils subtly follow the cursor */
  let lookT = 0;
  function onLook(e) {
    const now = Date.now();
    if (now - lookT < 80) return;
    lookT = now;
    if (!pet || S.stage === 0 || mode === "sleeping") return;
    const g = pet.querySelector(".eyes");
    if (!g || g.style.transform.includes("translate(-1.8")) return;  // don't fight glance()
    const r = pet.getBoundingClientRect();
    const dx = clamp((e.clientX - (r.left + r.width / 2)) / 400, -1, 1) * 1.5;
    const dy = clamp((e.clientY - (r.top + r.height / 2)) / 400, -1, 1) * 1.3;
    g.style.transform = `translate(${dx}px,${dy}px)`;
  }
  /* ---------- drag & toss ----------
     Grab the pet and drag it anywhere; release with velocity to throw it.
     Simple projectile physics (gravity + wall/floor bounces), then it floats home. */
  let dragging = false, grabDX = 0, grabDY = 0, baseLeft = 0, petW = 72;
  let tx = 0, tyy = 0, vx = 0, vy = 0, lastMX = 0, lastMY = 0, lastMT = 0, lastPT = 0;
  let physRAF = 0, suppressClick = false, peakSpeed = 0;
  function onGrab(e) {
    if (!pet || e.button !== 0) return;
    e.preventDefault();
    wake();
    cancelAnimationFrame(physRAF);
    const r = pet.getBoundingClientRect();
    petW = r.width;
    baseLeft = r.left - (mode === "toss" ? tx : 0);
    tx = r.left - baseLeft; tyy = r.top;
    grabDX = e.clientX - r.left; grabDY = e.clientY - r.top;
    dragging = true; suppressClick = false; peakSpeed = 0;
    vx = vy = 0; lastMX = e.clientX; lastMY = e.clientY; lastMT = performance.now();
    mode = "drag"; refreshLook();
    pet.style.transitionDuration = "0s";
  }
  function onDragMove(e) {
    if (!dragging || !pet) return;
    const t = performance.now(), dt = Math.max(t - lastMT, 1);
    const ivx = (e.clientX - lastMX) / dt * 1000, ivy = (e.clientY - lastMY) / dt * 1000;
    vx = vx * 0.4 + ivx * 0.6; vy = vy * 0.4 + ivy * 0.6;      // smoothed release velocity
    peakSpeed = Math.max(peakSpeed, Math.hypot(vx, vy));
    lastMX = e.clientX; lastMY = e.clientY; lastMT = t;
    tx = e.clientX - grabDX - baseLeft;
    tyy = e.clientY - grabDY;
    if (Math.abs(tx) > 6 || Math.abs(tyy - y) > 6) suppressClick = true;
    pet.style.transform = `translate(${tx}px, ${tyy}px)`;
  }
  function onRelease() {
    if (!dragging || !pet) return;
    dragging = false;
    if (!suppressClick) { mode = "idle"; refreshLook(); return; }  // it was just a click → pat
    mode = "toss"; refreshLook();
    vx = clamp(vx, -1600, 1600); vy = clamp(vy, -1600, 1600);
    lastPT = performance.now();
    physRAF = requestAnimationFrame(physStep);
  }
  function physStep(ts) {
    if (!pet) return;
    const dt = Math.min((ts - lastPT) / 1000, 0.03); lastPT = ts;
    vy += 2400 * dt;                                            // gravity
    tx += vx * dt; tyy += vy * dt;
    const minX = -baseLeft + 4, maxX = window.innerWidth - baseLeft - petW - 4;
    if (tx < minX) { tx = minX; vx = -vx * 0.55; }
    if (tx > maxX) { tx = maxX; vx = -vx * 0.55; }
    if (tyy < 4) { tyy = 4; vy = -vy * 0.5; }
    const floor = yMax();
    if (tyy > floor) { tyy = floor; vy = -vy * 0.45; vx *= 0.7; }
    pet.style.transform = `translate(${tx}px, ${tyy}px)`;
    if (tyy >= floor - 1 && Math.abs(vy) < 70 && Math.abs(vx) < 50) { endToss(); return; }
    physRAF = requestAnimationFrame(physStep);
  }
  function endToss() {
    mode = "busy"; refreshLook();
    y = clamp(tyy, Y_MIN, yMax());
    pet.style.transitionDuration = ".65s";
    pet.style.transform = `translateY(${y}px)`;                  // float back to the right-edge lane
    tx = 0;
    const wildRide = peakSpeed > 900;
    setTimeout(() => {
      if (!pet) return;
      if (mode === "busy") { mode = "idle"; refreshLook(); }
      if (wildRide) {
        if (S.mood >= 60) { say("好好玩！再來一次 ♪", 2200); float("♪"); S.mood = clamp(S.mood + 1, 0, 100); }
        else { say("嗚……頭好暈 @@", 2400); fx.worried = true; refreshLook(); setTimeout(() => { fx.worried = false; refreshLook(); }, 4000); }
        save();
      }
    }, 700);
  }

  /* ---------- touch support (mobile) — map touch → the existing mouse drag handlers.
     Tap still pats via the click event; we only preventDefault during an active drag so
     the page keeps scrolling everywhere else. */
  let touchKind = null;
  function onPetTouchStart(e) {
    const t = e.touches[0]; if (!t) return;
    onGrab({ button: 0, clientX: t.clientX, clientY: t.clientY, preventDefault() {} });
    touchKind = "pet";
  }
  function onBallTouchStart(e) {
    const t = e.touches[0]; if (!t) return;
    onBallGrab({ button: 0, clientX: t.clientX, clientY: t.clientY, preventDefault() {}, stopPropagation() {} });
    touchKind = "ball";
  }
  function onShowerTouchStart(e) {
    const t = e.touches[0]; if (!t) return;
    onShowerGrab({ button: 0, clientX: t.clientX, clientY: t.clientY, preventDefault() {}, stopPropagation() {} });
    touchKind = "shower";
  }
  function onTouchMove(e) {
    const t = e.touches[0]; if (!t) return;
    if (touchKind === "pet" && dragging) { e.preventDefault(); onDragMove({ clientX: t.clientX, clientY: t.clientY }); }
    else if (touchKind === "ball" && ballDrag) { e.preventDefault(); onBallMove({ clientX: t.clientX, clientY: t.clientY }); }
    else if (touchKind === "shower" && showerDrag) { e.preventDefault(); onShowerMove({ clientX: t.clientX, clientY: t.clientY }); }
  }
  function onTouchEnd() {
    if (touchKind === "pet") onRelease();
    else if (touchKind === "ball") onBallRelease();
    else if (touchKind === "shower") onShowerRelease();
    touchKind = null;
  }

  function spin() {
    wake();
    if (!pet || S.stage === 0) return;
    mode = "busy"; refreshLook();
    pet.classList.add("spinning");
    setTimeout(() => {
      if (!pet) return;
      pet.classList.remove("spinning");
      if (mode === "busy") { mode = "idle"; refreshLook(); }
    }, 650);
    say("咻～ 🌀", 1500);
  }

  let mouseT = 0;
  function onMouse(e) {
    if (ballDrag || looseBall || showerDrag || looseShower) return;   // busy with ball / shower
    const now = Date.now();
    if (now - mouseT < 700) return;
    mouseT = now;
    // cursor near the right edge → chase it (only from idle; walking/busy finish first)
    const chaseP = S.mood >= 80 ? 0.85 : 0.65;   // 心情好更黏人
    if (e.clientX > window.innerWidth - 150 && mode === "idle" && Math.random() < chaseP) {
      wake(); walkTo(e.clientY - 30);
    }
  }

  /* ---------- floaters & bubble ---------- */
  function float(txt, cls) {
    if (!layer) return;
    const f = $make("span", "pet-float " + (cls || ""), txt);
    f.style.top = (petY() + Math.random() * 20 - 6) + "px";
    layer.appendChild(f);
    setTimeout(() => f.remove(), 1400);
  }
  /* throw food from the question-card area in an arc onto the pet, then play the landing anim */
  function throwFood(emoji, landCls) {
    if (!layer || !pet) return;
    if (mode === "drag" || mode === "toss") { float(emoji); return; }  // mid-play: skip the animation
    // if strolling, stop right here to wait for the food (also fixes landing aim)
    if (mode === "walk") { y = petY(); clearTimeout(walkEndT); arriveCb = null; place(0); }
    mode = "busy"; refreshLook();
    const f = $make("span", "pet-food", emoji);
    f.style.left = (window.innerWidth * 0.5) + "px";
    f.style.top = (window.innerHeight * 0.32) + "px";
    document.body.appendChild(f);
    const r = pet.getBoundingClientRect();
    requestAnimationFrame(() => requestAnimationFrame(() => {
      f.style.left = (r.left + r.width / 2 - 11) + "px";
      f.style.top = (r.top + r.height / 2 - 6) + "px";
    }));
    setTimeout(() => {
      f.remove();
      if (!pet) return;
      oneShot(landCls, landCls === "jumping" ? 950 : 400);
      pet.classList.add("mood-o");                       // chomp!
      setTimeout(() => pet && pet.classList.remove("mood-o"), 520);
      float("😋");
    }, 680);
  }
  function say(html, ms) {
    if (!bubble) return;
    bubble.innerHTML = html;
    bubble.classList.add("show");
    // clamp against the bubble's ACTUAL height so tall status panels never overflow the bottom
    const h = bubble.offsetHeight || 60;
    const maxTop = window.innerHeight - h - 12;
    bubble.style.top = clamp(petY() - 30, 10, Math.max(10, maxTop)) + "px";
    clearTimeout(bubbleT);
    bubbleT = setTimeout(() => bubble && bubble.classList.remove("show"), ms || 2600);
  }
  const pick = a => a[Math.floor(Math.random() * a.length)];

  /* ---------- breeding: exam → affinity bucket → final form ---------- */
  const AFF_MAP = { "saa-c03": "arch", "sapc02": "arch", "dop-c02": "gear", "mla_c01": "sage", "scs-c03": "guard" };
  const AFF_NAME = { arch: "建築", guard: "守護", gear: "機關", sage: "賢者" };
  const FORMS = {
    arch:  { name: "蒼穹雲王 👑", line: "這朵雲，撐得起整片天空 ⛅" },
    guard: { name: "守護雲王 🛡️", line: "有我在，沒有漏洞！" },
    gear:  { name: "機關雲王 ⚙️", line: "部署完成，零停機 ⚙️" },
    sage:  { name: "賢者雲王 🎓", line: "知識就是力量 📚" },
    gold:  { name: "金雲王 🌟",   line: "閃閃發光的不是我，是你的努力 🌟" },
    night: { name: "夜雲王 🌙",   line: "夜深了……但我們還醒著 🌙" },
  };
  const DEX_ORDER = ["arch", "guard", "gear", "sage", "gold", "night"];
  const DEX_EMOJI = { arch: "👑", guard: "🛡️", gear: "⚙️", sage: "🎓", gold: "🌟", night: "🌙" };
  function topAff() {
    let top = "arch", best = -1;
    for (const k in (S.aff || {})) if (S.aff[k] > best) { best = S.aff[k]; top = k; }
    return top;
  }
  /* hidden forms take priority over affinity forms */
  function chooseForm() {
    if ((S.bestExamPct || 0) >= 100) return "gold";
    if ((S.nightFeeds || 0) > S.feeds * 0.5) return "night";
    return topAff();
  }
  const DEX_KEY = "app_pet_dex";   // collection survives rebirth
  const loadDex = () => { try { return JSON.parse(localStorage.getItem(DEX_KEY)) || []; } catch { return []; } };
  function addDex(form) {
    const d = loadDex();
    if (!d.some(x => x.form === form)) {
      d.push({ form, date: today() });
      try { localStorage.setItem(DEX_KEY, JSON.stringify(d)); } catch {}
    }
  }
  function doRebirth() {
    if (!confirm("轉生：回到蛋、XP 與屬性歸零重新培育。圖鑑與連續刷題天數會保留。確定嗎？")) return;
    S.stage = 0; S.xp = 0; S.feeds = 0; S.hunger = 70; S.mood = 80;
    S.aff = {}; S.nightFeeds = 0; S.bestExamPct = 0; S.form = "";
    save(); refreshLook(); place(0);
    say("🥚 轉生完成！再答對 3 題就會孵化——這次要養成什麼形態呢？", 3600);
  }

  /* ---------- boss battle (mock exam = 討伐考題魔王) ---------- */
  let bossEl = null, lastAtk = 0;
  function spawnBoss() {
    if (bossEl) return;
    bossEl = $make("div", "", `<span class="boss-body">☁️</span><span class="boss-face">😈</span>`);
    bossEl.id = "petBoss";
    bossEl.title = "考題魔王（點擊趕走）";
    bossEl.onclick = () => despawnBoss(false);
    document.body.appendChild(bossEl);
    requestAnimationFrame(() => requestAnimationFrame(() => bossEl && bossEl.classList.add("in")));
  }
  function despawnBoss(defeated) {
    if (!bossEl) return;
    const b = bossEl; bossEl = null;
    if (defeated) { b.innerHTML = "💥"; b.classList.add("boom"); setTimeout(() => b.remove(), 900); }
    else { b.classList.remove("in"); setTimeout(() => b.remove(), 800); }
  }
  function bossAttack() {                          // pet zaps the boss when you answer
    if (!bossEl || !pet) return;
    const now = Date.now();
    if (now - lastAtk < 2200) return;
    lastAtk = now;
    const z = $make("span", "pet-bolt", "⚡");
    const pr = pet.getBoundingClientRect(), br = bossEl.getBoundingClientRect();
    z.style.left = pr.left + "px"; z.style.top = (pr.top + 8) + "px";
    document.body.appendChild(z);
    requestAnimationFrame(() => requestAnimationFrame(() => { z.style.left = (br.left + 28) + "px"; z.style.top = (br.top + 24) + "px"; }));
    setTimeout(() => {
      z.remove();
      if (bossEl) { bossEl.classList.add("hit"); setTimeout(() => bossEl && bossEl.classList.remove("hit"), 260); }
    }, 420);
  }

  /* ---------- passing NPC clouds (rare gold = jackpot) ---------- */
  function spawnNPC() {
    const gold = Math.random() < 0.08;
    const n = $make("span", "pet-npc" + (gold ? " gold" : ""), gold ? "🌤️" : "☁️");
    n.style.top = (60 + Math.random() * 160) + "px";
    document.body.appendChild(n);
    requestAnimationFrame(() => requestAnimationFrame(() => n.classList.add("go")));
    setTimeout(() => n.remove(), 16000);
    oneShot("squish", 400);
    if (gold) setTimeout(() => { gainXp(5); say("🌤️ 金雲路過丟了個紅包！+5 XP", 3400); }, 2200);
    else if (Math.random() < 0.5) say("有朋友路過～（揮手）", 2000);
  }

  /* ---------- shop: spend 雲朵幣 on furniture & toys ---------- */
  const SHOP = [
    { id: "snack", name: "豪華點心", emoji: "🍱", price: 15, desc: "立刻 +40 飽足", consumable: true },
    { id: "plant", name: "小盆栽", emoji: "🪴", price: 20, desc: "雲寶偶爾幫它澆水" },
    { id: "ball", name: "玩具球", emoji: "⚽", price: 30, desc: "雲寶會自己去踢著玩" },
    { id: "shower", name: "蓮蓬頭", emoji: "🚿", price: 35, desc: "拖到雲寶身上幫牠洗澡" },
    { id: "lantern", name: "小燈籠", emoji: "🏮", price: 40, desc: "深夜會亮起來陪刷題" },
    { id: "bed", name: "雲朵小床", emoji: "🛏️", price: 50, desc: "想睡時會回床上睡" },
    { id: "shrine", name: "文昌神龕", emoji: "⛩️", price: 80, desc: "左下角開啟文昌殿，每日上香求 XP／雲朵幣加成" },
  ];
  let shopEl = null;
  function toggleShop() {
    if (shopEl) { shopEl.remove(); shopEl = null; return; }
    if (wardrobeEl) { wardrobeEl.remove(); wardrobeEl = null; }   // panels share the slot — one at a time
    if (gachaEl) { gachaEl.remove(); gachaEl = null; }
    shopEl = $make("div"); shopEl.id = "petShop";
    shopEl.addEventListener("click", e => {
      if (e.target.id === "shopClose") { toggleShop(); return; }
      const id = e.target.dataset.buy;
      if (id) buyItem(id);
    });
    document.body.appendChild(shopEl);
    renderShop();
  }
  function renderShop() {
    if (!shopEl) return;
    shopEl.innerHTML = `<div class="shop-head">🛍️ 雲寶商城<span class="shop-coin">💰 ${S.coins || 0}</span><button id="shopClose">✕</button></div>` +
      SHOP.map(it => {
        const owned = !it.consumable && S.items && S.items[it.id];
        return `<div class="shop-item"><span class="shop-emoji">${it.emoji}</span>
          <div class="shop-body"><b>${it.name}</b><div class="shop-desc">${it.desc}</div></div>
          ${owned ? `<span class="shop-owned">已擁有</span>` : `<button class="shop-buy" data-buy="${it.id}">💰${it.price}</button>`}</div>`;
      }).join("");
  }
  function buyItem(id) {
    const it = SHOP.find(x => x.id === id);
    if (!it || (!it.consumable && S.items && S.items[id])) return;
    if ((S.coins || 0) < it.price) { say("雲朵幣不夠……再刷幾題吧 💰", 2200); return; }
    S.coins -= it.price;
    if (it.consumable) {
      S.hunger = clamp(S.hunger + 40, 0, 100); S.mood = clamp(S.mood + 2, 0, 100);
      throwFood("🍱", "jumping");
    } else {
      S.items = S.items || {}; S.items[id] = true;
      placeItems(); refreshLook();
      express("happyUntil", 3000);
      say(pick(["謝謝！我會好好珍惜 🥹", "新東西！開心～", `這就是傳說中的……${it.name}！`]), 2600);
      document.dispatchEvent(new CustomEvent("pet:itemBought", { detail: { id } })); // shrine.js hook (no-op if absent)
    }
    save(); renderShop();
  }
  /* owned furniture lives in the pet's lane */
  const ITEM_SPOTS = { lantern: 0.15, ball: 0.32, shower: 0.42, plant: 0.55, bed: 0.86 };
  function placeItems() {
    if (!layer) return;
    layer.querySelectorAll(".pet-item").forEach(n => n.remove());
    for (const id in (S.items || {})) {
      if (!ITEM_SPOTS[id]) continue;
      if (id === "ball" && looseBall) continue;    // ball is currently loose / being fetched
      const el = $make("span", "pet-item item-" + id, SHOP.find(x => x.id === id).emoji);
      el.style.top = Math.round(window.innerHeight * ITEM_SPOTS[id]) + "px";
      if (id === "lantern" && isNight()) el.classList.add("lit");
      if (id === "ball") { el.addEventListener("mousedown", onBallGrab); el.addEventListener("touchstart", onBallTouchStart, { passive: true }); }   // drag to throw
      if (id === "shower") { el.addEventListener("mousedown", onShowerGrab); el.addEventListener("touchstart", onShowerTouchStart, { passive: true }); }  // drag onto pet to wash
      layer.appendChild(el);
    }
  }
  function bounceItem(id) {
    const el = layer && layer.querySelector(".item-" + id);
    if (el) { el.classList.add("bounce"); setTimeout(() => el.classList.remove("bounce"), 950); }
  }
  /* item interactions — each is a busy action with its own animation */
  function kickBall() {
    if (!pet) return;
    mode = "busy"; refreshLook();
    pet.classList.add("kicking");
    setTimeout(() => bounceItem("ball"), 230);            // contact moment: ball takes off
    if (Math.random() < 0.4) say(pick(["嘿咻！", "射門～⚽", "接招！"]), 1400);
    setTimeout(() => {
      if (!pet) return;
      pet.classList.remove("kicking");
      if (mode === "busy") { mode = "idle"; refreshLook(); }
    }, 750);
  }
  function waterPlant() {
    if (!pet) return;
    mode = "busy"; refreshLook();
    pet.classList.add("pouring");
    [0, 260, 520].forEach(t => setTimeout(dropWater, 320 + t));   // three droplets
    setTimeout(() => {                                             // plant reacts
      const el = layer && layer.querySelector(".item-plant");
      if (el) { el.classList.add("watered"); setTimeout(() => el.classList.remove("watered"), 950); }
      float("✨");
      if (Math.random() < 0.5) say("澆澆水～快快長大 🪴", 1800);
    }, 1150);
    setTimeout(() => {
      if (!pet) return;
      pet.classList.remove("pouring");
      if (mode === "busy") { mode = "idle"; refreshLook(); }
    }, 1550);
  }
  function dropWater() {
    if (!layer) return;
    const d = $make("span", "pet-drop", "💧");
    d.style.top = (petY() + 28) + "px";
    layer.appendChild(d);
    setTimeout(() => d.remove(), 550);
  }

  /* ---------- ball fetch: grab the ball, throw it anywhere, pet retrieves it ----------
     Reuses the toss-physics pattern; pet travels in 2D (transform translate) then returns
     to the lane. mode "fetch" is a busy-like state the brain/cursor-chase won't interrupt. */
  const BALL_SZ = 24;
  let ballDrag = false, looseBall = null, carrying = false;
  let ballGX = 0, ballGY = 0, bX = 0, bY = 0, bvx = 0, bvy = 0;
  let blMX = 0, blMY = 0, blMT = 0, ballRAF = 0, ballLT = 0, ballMoved = false, fetchT = 0;
  const petH = () => pet ? pet.offsetHeight : 56;

  function onBallGrab(e) {
    if (!pet || e.button !== 0 || !(S.items && S.items.ball) || looseBall) return;
    e.preventDefault(); e.stopPropagation();
    cancelAnimationFrame(ballRAF);
    const lane = layer && layer.querySelector(".item-ball");
    const r = lane ? lane.getBoundingClientRect() : { left: e.clientX - 11, top: e.clientY - 11 };
    if (lane) lane.remove();
    looseBall = $make("span", "pet-loose-ball", "⚽");
    bX = r.left; bY = r.top;
    looseBall.style.left = bX + "px"; looseBall.style.top = bY + "px";
    document.body.appendChild(looseBall);
    ballGX = e.clientX - bX; ballGY = e.clientY - bY;
    ballDrag = true; ballMoved = false; bvx = bvy = 0;
    blMX = e.clientX; blMY = e.clientY; blMT = performance.now();
    wake();
  }
  function onBallMove(e) {
    if (!ballDrag || !looseBall) return;
    const t = performance.now(), dt = Math.max(t - blMT, 1);
    bvx = bvx * 0.4 + (e.clientX - blMX) / dt * 1000 * 0.6;
    bvy = bvy * 0.4 + (e.clientY - blMY) / dt * 1000 * 0.6;
    blMX = e.clientX; blMY = e.clientY; blMT = t;
    bX = e.clientX - ballGX; bY = e.clientY - ballGY;
    if (Math.abs(bvx) > 30 || Math.abs(bvy) > 30) ballMoved = true;
    looseBall.style.left = bX + "px"; looseBall.style.top = bY + "px";
  }
  function onBallRelease() {
    if (!ballDrag) return;
    ballDrag = false;
    if (!looseBall) return;
    bvx = clamp(bvx, -1800, 1800); bvy = clamp(bvy, -1800, 1800);
    express("happyUntil", 1500);                  // pet watches the throw
    if (ballMoved && Math.random() < 0.5) say(pick(["咦？球飛走了！", "等等我！", "喔喔喔——"]), 1600);
    ballLT = performance.now();
    ballRAF = requestAnimationFrame(ballStep);
  }
  function ballStep(ts) {
    if (!looseBall) return;
    const dt = Math.min((ts - ballLT) / 1000, 0.03); ballLT = ts;
    bvy += 2600 * dt;
    bX += bvx * dt; bY += bvy * dt;
    const maxX = window.innerWidth - BALL_SZ - 4, floor = window.innerHeight - BALL_SZ - 6;
    if (bX < 4) { bX = 4; bvx = -bvx * 0.6; }
    if (bX > maxX) { bX = maxX; bvx = -bvx * 0.6; }
    if (bY < 4) { bY = 4; bvy = -bvy * 0.5; }
    if (bY > floor) { bY = floor; bvy = -bvy * 0.5; bvx *= 0.72; }
    looseBall.style.left = bX + "px"; looseBall.style.top = bY + "px";
    if (bY >= floor - 1 && Math.abs(bvy) < 80 && Math.abs(bvx) < 55) { petFetch(); return; }
    ballRAF = requestAnimationFrame(ballStep);
  }
  function petFetch() {
    if (!pet || !looseBall) return;
    if (S.stage === 0) { looseBall.remove(); looseBall = null; placeItems(); return; }  // egg can't run
    mode = "fetch"; carrying = false; refreshLook(); wake();
    const pw = pet.offsetWidth, ph = petH();
    const goX = clamp(bX - pw * 0.5, 4, window.innerWidth - pw - 4);
    const goY = clamp(bY - ph * 0.5, Y_MIN, window.innerHeight - ph - 4);
    petTravel(goX, goY, () => {                    // reached the ball → pick it up
      if (!pet || !looseBall) return;
      looseBall.remove(); looseBall = null;
      carrying = true; refreshLook();
      float("⚽");
      if (Math.random() < 0.7) say(pick(["撿到了！", "球球我來救你！", "接好囉～"]), 1600);
      const homeY = clamp(Math.round(window.innerHeight * ITEM_SPOTS.ball) - 16, Y_MIN, yMax());
      const laneL = window.innerWidth - pet.offsetWidth - 8;
      setTimeout(() => petTravel(laneL, homeY, () => {   // carry it home
        if (!pet) return;
        carrying = false; y = homeY; mode = "idle"; refreshLook();
        pet.style.transitionDuration = "0s"; pet.style.transform = `translateY(${y}px)`;
        placeItems();                              // ball reappears in its lane spot
        express("happyUntil", 1600);
        if (Math.random() < 0.5) say(pick(["還你～ 😊", "好玩！再丟嘛", "物歸原主！"]), 2000);
        S.mood = clamp(S.mood + 2, 0, 100); save();
      }), 280);
    });
  }
  /* move the pet to a viewport point (2D), running speed, then callback */
  function petTravel(left, top, cb) {
    if (!pet) return;
    const laneL = window.innerWidth - pet.offsetWidth - 8;
    const r = pet.getBoundingClientRect();
    const dist = Math.hypot(left - r.left, top - r.top);
    const dur = clamp(dist / 300, 0.25, 1.5);      // eager fetch trot
    dir = (left < r.left - 2) ? -1 : 1;
    pet.style.transitionDuration = dur + "s";
    pet.style.transform = `translate(${left - laneL}px, ${top}px)`;
    clearTimeout(fetchT);
    fetchT = setTimeout(() => cb && cb(), dur * 1000 + 60);
  }

  /* ---------- shower: drag the showerhead onto the pet to wash it ---------- */
  let showerDrag = false, looseShower = null, shGX = 0, shGY = 0;
  const overPet = (cx, cy) => {
    if (!pet) return false;
    const r = pet.getBoundingClientRect();
    return cx > r.left - 24 && cx < r.right + 24 && cy > r.top - 24 && cy < r.bottom + 40;
  };
  function onShowerGrab(e) {
    if (!pet || e.button !== 0 || !(S.items && S.items.shower) || looseShower) return;
    e.preventDefault(); e.stopPropagation();
    const lane = layer && layer.querySelector(".item-shower");
    const r = lane ? lane.getBoundingClientRect() : { left: e.clientX - 11, top: e.clientY - 11 };
    if (lane) lane.remove();
    looseShower = $make("span", "pet-loose-shower", "🚿");
    looseShower.style.left = r.left + "px"; looseShower.style.top = r.top + "px";
    document.body.appendChild(looseShower);
    shGX = e.clientX - r.left; shGY = e.clientY - r.top;
    showerDrag = true; wake();
  }
  function onShowerMove(e) {
    if (!showerDrag || !looseShower) return;
    looseShower.style.left = (e.clientX - shGX) + "px";
    looseShower.style.top = (e.clientY - shGY) + "px";
    const on = overPet(e.clientX, e.clientY);
    looseShower.classList.toggle("spraying", on);
    if (on && Math.random() < 0.35) sprayDrop(e.clientX + 4, e.clientY + 10);
  }
  function onShowerRelease() {
    if (!showerDrag) return;
    showerDrag = false;
    if (!looseShower) return;
    const r = looseShower.getBoundingClientRect();
    const on = overPet(r.left + 11, r.top + 11);
    looseShower.remove(); looseShower = null;
    if (on) washPet(); else placeItems();          // over the pet → wash; otherwise put it back
  }
  function sprayDrop(cx, cy) {
    const d = $make("span", "pet-spray", "💧");
    d.style.left = cx + "px"; d.style.top = cy + "px";
    document.body.appendChild(d);
    setTimeout(() => d.remove(), 520);
  }
  function washPet() {
    if (!pet) return;
    mode = "busy"; refreshLook();
    pet.classList.add("washing");
    [0, 130, 260, 390, 520, 650, 780].forEach(t => setTimeout(() => float(pick(["🫧", "🫧", "🧼", "✨"])), t));
    S.clean = 100; S.dusty = false; S.mood = clamp(S.mood + 4, 0, 100);
    express("happyUntil", 2600);
    say(pick(["洗香香～ 🫧", "啊……舒服", "亮晶晶了！✨", "搓搓搓 🧼"]), 2600);
    setTimeout(() => {
      if (!pet) return;
      pet.classList.remove("washing");
      if (mode === "busy") { mode = "idle"; refreshLook(); }
      placeItems();                                // showerhead back in its lane spot
      save();
    }, 1800);
  }

  /* ---------- accessories: 50 wearables across 5 slots, worn one-per-slot ---------- */
  const ACCESSORIES = [
    // head
    { id: "tophat", e: "🎩", n: "小禮帽", slot: "head", r: "c" },
    { id: "cap", e: "🧢", n: "棒球帽", slot: "head", r: "c" },
    { id: "sunhat", e: "👒", n: "遮陽帽", slot: "head", r: "c" },
    { id: "grad", e: "🎓", n: "學士帽", slot: "head", r: "r" },
    { id: "crown", e: "👑", n: "小皇冠", slot: "head", r: "e" },
    { id: "helmet", e: "🪖", n: "鋼盔", slot: "head", r: "r" },
    { id: "rescue", e: "⛑️", n: "工程帽", slot: "head", r: "r" },
    { id: "bowhead", e: "🎀", n: "頭上蝴蝶結", slot: "head", r: "c" },
    { id: "sakura", e: "🌸", n: "櫻花", slot: "head", r: "c" },
    { id: "hibiscus", e: "🌺", n: "扶桑花", slot: "head", r: "c" },
    { id: "tulip", e: "🌷", n: "鬱金香", slot: "head", r: "c" },
    { id: "mushroom", e: "🍄", n: "蘑菇", slot: "head", r: "r" },
    { id: "chick", e: "🐣", n: "小雞", slot: "head", r: "r" },
    { id: "pumpkin", e: "🎃", n: "南瓜頭", slot: "head", r: "e" },
    { id: "xmas", e: "🎄", n: "聖誕樹", slot: "head", r: "e" },
    { id: "starhead", e: "⭐", n: "星星", slot: "head", r: "r" },
    { id: "moonhead", e: "🌙", n: "月亮", slot: "head", r: "r" },
    { id: "snow", e: "❄️", n: "雪花", slot: "head", r: "c" },
    { id: "maple", e: "🍁", n: "楓葉", slot: "head", r: "c" },
    { id: "rainbow", e: "🌈", n: "彩虹", slot: "head", r: "e" },
    { id: "flame", e: "🔥", n: "火焰", slot: "head", r: "e" },
    { id: "cloudcap", e: "☁️", n: "小雲帽", slot: "head", r: "r" },
    { id: "phones", e: "🎧", n: "耳機", slot: "head", r: "r" },
    // face
    { id: "glasses", e: "👓", n: "眼鏡", slot: "face", r: "c" },
    { id: "shades", e: "🕶️", n: "墨鏡", slot: "face", r: "r" },
    { id: "goggles", e: "🥽", n: "護目鏡", slot: "face", r: "r" },
    { id: "monocle", e: "🧐", n: "單片眼鏡", slot: "face", r: "e" },
    // neck
    { id: "scarf", e: "🧣", n: "圍巾", slot: "neck", r: "c" },
    { id: "tie", e: "👔", n: "領帶", slot: "neck", r: "c" },
    { id: "beads", e: "📿", n: "念珠", slot: "neck", r: "r" },
    { id: "bell", e: "🔔", n: "鈴鐺", slot: "neck", r: "c" },
    { id: "ribbon", e: "🎗️", n: "緞帶", slot: "neck", r: "r" },
    { id: "medal", e: "🏅", n: "獎牌", slot: "neck", r: "e" },
    // side (held)
    { id: "balloon", e: "🎈", n: "氣球", slot: "side", r: "c" },
    { id: "umbrella", e: "☂️", n: "雨傘", slot: "side", r: "c" },
    { id: "wand", e: "🪄", n: "魔法棒", slot: "side", r: "e" },
    { id: "book", e: "📖", n: "書本", slot: "side", r: "c" },
    { id: "flag", e: "🚩", n: "旗子", slot: "side", r: "c" },
    { id: "lollipop", e: "🍭", n: "棒棒糖", slot: "side", r: "c" },
    { id: "mic", e: "🎤", n: "麥克風", slot: "side", r: "r" },
    { id: "sword", e: "⚔️", n: "劍", slot: "side", r: "e" },
    { id: "shieldh", e: "🛡️", n: "盾牌", slot: "side", r: "r" },
    { id: "torch", e: "🔦", n: "手電筒", slot: "side", r: "c" },
    { id: "rod", e: "🎣", n: "釣竿", slot: "side", r: "r" },
    { id: "guitar", e: "🎸", n: "吉他", slot: "side", r: "e" },
    // aura (floating companion)
    { id: "bee", e: "🐝", n: "小蜜蜂", slot: "aura", r: "r" },
    { id: "bfly", e: "🦋", n: "蝴蝶", slot: "aura", r: "r" },
    { id: "bird", e: "🐤", n: "小鳥", slot: "aura", r: "r" },
    { id: "sparkle", e: "✨", n: "閃光", slot: "aura", r: "c" },
    { id: "note", e: "🎵", n: "音符", slot: "aura", r: "c" },
    { id: "ladybug", e: "🐞", n: "瓢蟲", slot: "aura", r: "r" },
    { id: "ufo", e: "🛸", n: "幽浮", slot: "aura", r: "e" },
  ];
  const ACC_BY_ID = Object.fromEntries(ACCESSORIES.map(a => [a.id, a]));
  const RARITY = { c: { w: 60, name: "普通", coins: 8 }, r: { w: 30, name: "稀有", coins: 18 }, e: { w: 10, name: "史詩", coins: 40 } };
  const SLOT_NAME = { head: "頭部", face: "臉部", neck: "頸部", side: "手持", aura: "夥伴" };

  function renderWorn() {
    if (!pet) return;
    const box = pet.querySelector(".pet-worn");
    if (!box) return;
    box.innerHTML = "";
    for (const slot in (S.worn || {})) {
      const a = ACC_BY_ID[S.worn[slot]];
      if (a) box.appendChild($make("span", "worn wslot-" + a.slot, a.e));
    }
  }
  function equip(id) {
    const a = ACC_BY_ID[id]; if (!a || !S.acc[id]) return;
    if (S.worn[a.slot] === id) delete S.worn[a.slot];   // tap again → take off
    else S.worn[a.slot] = id;
    renderWorn(); save(); renderWardrobe();
  }

  /* ---------- wardrobe panel ---------- */
  let wardrobeEl = null;
  function toggleWardrobe() {
    if (wardrobeEl) { wardrobeEl.remove(); wardrobeEl = null; return; }
    if (shopEl) { shopEl.remove(); shopEl = null; }
    wardrobeEl = $make("div"); wardrobeEl.id = "petShop";   // reuse shop panel styling
    wardrobeEl.addEventListener("click", e => {
      if (e.target.id === "shopClose") { toggleWardrobe(); return; }
      if (e.target.id === "wardrobeStrip") { S.worn = {}; renderWorn(); save(); renderWardrobe(); return; }
      const id = e.target.closest("[data-equip]")?.dataset.equip;
      if (id) equip(id);
    });
    document.body.appendChild(wardrobeEl);
    renderWardrobe();
  }
  function renderWardrobe() {
    if (!wardrobeEl) return;
    const owned = ACCESSORIES.filter(a => S.acc[a.id]);
    const worn = new Set(Object.values(S.worn || {}));
    const body = owned.length
      ? owned.map(a =>
          `<div class="shop-item" data-equip="${a.id}" style="cursor:pointer">
             <span class="shop-emoji">${a.e}</span>
             <div class="shop-body"><b>${a.n}</b><div class="shop-desc">${SLOT_NAME[a.slot]} · ${RARITY[a.r].name}</div></div>
             ${worn.has(a.id) ? `<span class="shop-owned">穿戴中</span>` : `<span class="shop-buy">穿上</span>`}
           </div>`).join("")
      : `<div class="shop-desc" style="padding:10px 2px">還沒有配件～去扭蛋轉幾個吧！</div>`;
    wardrobeEl.innerHTML = `<div class="shop-head">👕 衣櫃 <span class="shop-coin">${owned.length}/${ACCESSORIES.length}</span><button id="shopClose">✕</button></div>`
      + body + (Object.keys(S.worn || {}).length ? `<button id="wardrobeStrip" class="pb-btn" style="margin-top:8px">全部脫下</button>` : "");
  }

  /* ---------- gacha (扭蛋): variable-reward accessory draw, first spin each day free ---------- */
  const GACHA_COST = 25;
  function rollAccessory() {
    const pool = [];
    for (const a of ACCESSORIES) for (let i = 0; i < RARITY[a.r].w; i++) pool.push(a);
    return pool[Math.floor(Math.random() * pool.length)];
  }
  function spinGacha() {
    const free = S.gachaDay !== today();
    if (!free && (S.coins || 0) < GACHA_COST) { say("雲朵幣不夠扭蛋……再刷幾題吧 💰", 2400); return; }
    if (free) S.gachaDay = today(); else S.coins -= GACHA_COST;
    const a = rollAccessory();
    const dup = !!S.acc[a.id];
    if (dup) { const refund = RARITY[a.r].coins; S.coins += refund; }
    else { S.acc[a.id] = true; }
    save();
    oneShot("hatching", 900);
    if (a.r === "e") express("starUntil", 4000);
    [0, 200, 400].forEach(t => setTimeout(() => float(a.e), t));
    say(dup ? `${a.e} ${a.n}（重複，退 ${RARITY[a.r].coins} 幣）`
            : `${a.r === "e" ? "✨史詩✨ " : a.r === "r" ? "稀有！ " : ""}抽到 ${a.e} ${a.n}！${free ? "（今日免費）" : ""}`, 3400);
    if (gachaEl) renderGacha();
    if (wardrobeEl) renderWardrobe();
  }
  let gachaEl = null;
  function toggleGacha() {
    if (gachaEl) { gachaEl.remove(); gachaEl = null; return; }
    if (shopEl) { shopEl.remove(); shopEl = null; }
    if (wardrobeEl) { wardrobeEl.remove(); wardrobeEl = null; }
    gachaEl = $make("div"); gachaEl.id = "petShop";
    gachaEl.addEventListener("click", e => {
      if (e.target.id === "shopClose") { toggleGacha(); return; }
      if (e.target.id === "gachaSpin") spinGacha();
    });
    document.body.appendChild(gachaEl);
    renderGacha();
  }
  function renderGacha() {
    if (!gachaEl) return;
    const free = S.gachaDay !== today();
    const owned = ACCESSORIES.filter(a => S.acc[a.id]).length;
    gachaEl.innerHTML = `<div class="shop-head">🥚 扭蛋機 <span class="shop-coin">💰 ${S.coins || 0}</span><button id="shopClose">✕</button></div>
      <div class="shop-desc" style="padding:4px 2px 10px">轉出隨機配件（普通/稀有/史詩）。已收集 ${owned}/${ACCESSORIES.length}。<br>重複會退還雲朵幣。</div>
      <button id="gachaSpin" class="pb-btn" style="width:100%;padding:10px">${free ? "🎁 今日免費扭蛋！" : `扭一次 💰${GACHA_COST}`}</button>`;
  }

  /* ---------- shareable pet card (canvas → PNG download) ---------- */
  function exportCard() {
    const c = document.createElement("canvas"); c.width = 520; c.height = 320;
    const x = c.getContext("2d");
    const TINT = { gold: ["#fff4d6", "#ffd968"], night: ["#1c2440", "#3a4666"] };
    const [bg1, bg2] = (S.stage === 4 && TINT[S.form]) || ["#eef3fb", "#cfe0f5"];
    const g = x.createLinearGradient(0, 0, 0, 320); g.addColorStop(0, bg1); g.addColorStop(1, bg2);
    x.fillStyle = g; x.fillRect(0, 0, 520, 320);
    const dark = S.form === "night" && S.stage === 4;
    // cloud portrait
    x.fillStyle = dark ? "#4a5878" : "#ffffff";
    x.strokeStyle = "rgba(0,0,0,.08)";
    [[120, 190, 46], [180, 160, 56], [240, 190, 42]].forEach(([cx, cy, r]) => { x.beginPath(); x.arc(cx, cy, r, 0, 7); x.fill(); x.stroke(); });
    x.fillRect(80, 190, 200, 50); x.fillStyle = dark ? "#4a5878" : "#fff"; x.fillRect(80, 185, 200, 55);
    // face
    x.fillStyle = dark ? "#eef2fb" : "#3a4456";
    x.beginPath(); x.arc(150, 185, 7, 0, 7); x.fill();
    x.beginPath(); x.arc(205, 185, 7, 0, 7); x.fill();
    x.strokeStyle = dark ? "#eef2fb" : "#3a4456"; x.lineWidth = 5; x.lineCap = "round";
    x.beginPath(); x.moveTo(163, 205); x.quadraticCurveTo(178, 218, 193, 205); x.stroke();
    x.fillStyle = "#ff9d9d";
    x.beginPath(); x.arc(130, 205, 9, 0, 7); x.fill();
    x.beginPath(); x.arc(225, 205, 9, 0, 7); x.fill();
    if (S.stage === 4) { x.font = "44px serif"; x.fillText(DEX_EMOJI[S.form] || "👑", 155, 130); }
    // text
    const ink = dark ? "#eef2fb" : "#1a2230";
    const { lv } = levelOf(S.xp);
    const stageName = ["雲寶蛋", "幼雲", "小雲寶", "大雲寶", (FORMS[S.form] || FORMS.arch).name][S.stage];
    x.fillStyle = ink; x.font = "bold 30px sans-serif"; x.fillText(stageName, 310, 110);
    x.font = "17px sans-serif";
    x.fillStyle = dark ? "#b8c4de" : "#5b6475";
    x.fillText(`Lv.${lv} · XP ${S.xp}`, 310, 145);
    x.fillText(`累計餵食 ${S.feeds} 份`, 310, 172);
    x.fillText(`連續刷題 ${S.streakDays || 0} 天`, 310, 199);
    const dex = loadDex();
    x.font = "22px serif";
    x.fillText(DEX_ORDER.map(f => dex.some(d => d.form === f) ? DEX_EMOJI[f] : "▫️").join(" "), 308, 236);
    x.font = "13px sans-serif"; x.fillStyle = dark ? "#8b98b8" : "#8a94a8";
    x.fillText(`AWS 刷題 · 雲寶名片 · ${today()}`, 310, 290);
    const a = document.createElement("a");
    a.download = `cloudpet-${today()}.png`;
    a.href = c.toDataURL("image/png");
    a.click();
  }

  /* ---------- actions ---------- */
  const STAGE_XP = { 2: 25, 3: 120, 4: 300 };    // xp gates: 小雲寶 / 大雲寶 / 雲王
  /* level curve: Lv.n → n+1 costs 15·n XP (Lv2@15, Lv3@45, Lv4@90, Lv5@150 …) */
  function levelOf(xp) {
    let lv = 1, need = 15, rem = xp;
    while (rem >= need) { rem -= need; lv++; need = 15 * lv; }
    return { lv, rem, need };
  }
  /* daily 文昌 blessing from the shrine (shrine.js writes it; 1 = no buff) */
  function shrineMult() {
    try { const s = JSON.parse(localStorage.getItem("app_shrine")); return (s && s.day === today() && s.mult) ? s.mult : 1; }
    catch { return 1; }
  }
  function gainXp(n) {
    n = Math.round(n * shrineMult());   // 文昌加持：當日 XP／雲朵幣加成
    const before = levelOf(S.xp).lv;
    S.xp += n;
    S.coins = (S.coins || 0) + n;   // 雲朵幣與 XP 等量入帳
    if (S.todayStats) S.todayStats.xp += n;
    float("+" + n + " XP", "xp");
    const after = levelOf(S.xp).lv;
    if (after > before) { float("⬆️ Lv." + after, "xp"); express("starUntil", 3000); }
    if ((S.stage === 1 || S.stage === 2) && S.xp >= STAGE_XP[S.stage + 1]) {
      S.stage++;
      oneShot("hatching", 900);
      express("starUntil", 4500);
      say(S.stage === 2 ? "✨ 進化成小雲寶！臉頰都圓起來了"
                        : "✨ 進化成大雲寶！開始顯現培育傾向……（點我看看）");
    } else if (S.stage === 3 && S.xp >= STAGE_XP[4]) {
      S.stage = 4;
      S.form = chooseForm();
      addDex(S.form);
      const F = FORMS[S.form];
      oneShot("hatching", 900);
      express("starUntil", 6000);
      const hidden = (S.form === "gold" || S.form === "night") ? "（隱藏形態！）" : "";
      say(`✨ 究極進化——${F.name} 降臨！${hidden}<br>「${F.line}」`, 5000);
      [0, 300, 600].forEach(t => setTimeout(() => float(pick([DEX_EMOJI[S.form], "✨", "🎉"])), t));
    }
  }
  /* first feed of each day: advance the study streak, pay streak bonus (cap +7) */
  function touchStreak() {
    const d = today();
    if (S.lastStudyDay === d) return 0;
    const yest = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    S.streakDays = (S.lastStudyDay === yest) ? (S.streakDays || 0) + 1 : 1;
    S.lastStudyDay = d;
    return Math.min(S.streakDays, 7);
  }
  const MILESTONES = { 50: "第 50 份食物！雲寶吃得又白又胖 ☁️", 100: "100 份！雲寶宣布你是最棒的飼主 🏅", 200: "200 份！！雲寶已經是刷題界的傳說 👑" };
  function feed(amount, foodEmoji, exam) {
    wake();
    const sb = touchStreak();
    if (sb > 1) setTimeout(() => { gainXp(sb); say(`連續第 ${S.streakDays} 天刷題！獎勵 +${sb} XP 🔥`, 3200); }, 1400);
    // breeding trackers: which exam feeds it, and whether it's a night owl
    const bucket = AFF_MAP[exam] || "arch";
    S.aff = S.aff || {}; S.aff[bucket] = (S.aff[bucket] || 0) + 1;
    const h = new Date().getHours();
    if (h >= 23 || h < 4) S.nightFeeds = (S.nightFeeds || 0) + 1;
    if (S.stage === 0) {                         // egg: feeds count toward hatching
      S.feeds++;
      throwFood(foodEmoji, "squish");
      if (S.feeds >= 3) {
        S.stage = 1;
        setTimeout(() => { refreshLook(); oneShot("hatching", 900); say("🐣 孵化了！幼雲誕生～答對題目就能餵牠長大"); }, 750);
      }
      save(); return;
    }
    S.feeds++;
    S.hunger = clamp(S.hunger + amount, 0, 100);
    S.mood = clamp(S.mood + 2, 0, 100);
    if (S.dusty && S.feeds % 3 === 0) S.dusty = false;   // a few feeds shake the dust off
    throwFood(foodEmoji, "jumping");
    if (S.hunger >= 100 && Math.random() < 0.5) setTimeout(() => say(pick(FULL), 2000), 1100);
    if (MILESTONES[S.feeds]) {
      const msg = MILESTONES[S.feeds];
      setTimeout(() => { express("starUntil", 4000); say(msg, 4000); }, 900);
    }
    save();
  }
  function pat() {
    if (suppressClick) { suppressClick = false; return; }   // that click was a drag
    wake();
    const now = Date.now();
    pats = pats.filter(t => now - t < 4000); pats.push(now);
    S.mood = clamp(S.mood + (pats.length <= 3 ? 3 : 1), 0, 100);  // diminishing: spam won't max mood
    oneShot("squish", 400);
    float(pick(["💗", "💕", "❤️"]));
    if (pats.length >= 5) {                        // pat spam → maximum blush
      pats = [];
      express("blushUntil", 5000);
      float("💞"); float("💞");
      say("別、別再摸啦 …//////", 2600);
    } else {
      express("blushUntil", 2200);
      say(`<div style="margin-bottom:4px">${pick(PAT_QUIPS)}</div>` + statusHTML(), 5000);
    }
    quest("pat");
    save();
  }
  function statusHTML() {
    const stageName = ["蛋（答對 " + (3 - S.feeds) + " 題孵化）", "幼雲", "小雲寶", "大雲寶",
      (FORMS[S.form] || FORMS.arch).name][S.stage];
    const { lv, rem, need } = levelOf(S.xp);
    const bar = (label, v, cls) =>
      `<div class="pb-row"><span>${label}</span><span class="pb-track"><span class="pb-fill ${cls}" style="width:${Math.round(v)}%"></span></span></div>`;
    const streak = S.streakDays > 1 ? ` · 🔥 連續 ${S.streakDays} 天` : "";
    const nextStage = (S.stage >= 1 && S.stage <= 3) ? `（${S.xp}/${STAGE_XP[S.stage + 1]} XP 進化）` : "";
    // 小雲寶起顯示培育傾向，讓玩家能操控最終形態
    let tend = "";
    if (S.stage === 2 || S.stage === 3) {
      const total = Object.values(S.aff || {}).reduce((a, b) => a + b, 0);
      if (total >= 5) {
        const top = topAff();
        tend = `<div class="pb-next">培育傾向：${AFF_NAME[top]} ${Math.round(S.aff[top] / total * 100)}%</div>`;
      }
    }
    const dex = loadDex();
    const dexLine = S.stage > 0   // always visible once hatched — six slots to hunt for
      ? `<div class="pb-next">圖鑑：${DEX_ORDER.map(f => dex.some(d => d.form === f) ? DEX_EMOJI[f] : "▫️").join(" ")}</div>`
      : "";
    const t = S.todayStats || {};
    const sm = shrineMult();
    const buffLine = sm > 1 ? `<div class="pb-next">⛩️ 文昌加持中：XP／幣 ×${sm.toFixed(2)}</div>` : "";
    const todayLine = `<div class="pb-next">今日：✓${t.c || 0} ✗${t.w || 0} · +${t.xp || 0} XP</div>` + buffLine;
    const qList = ((S.quests || {}).list || []);
    const questLines = qList.length
      ? `<div class="pb-next pb-quests">📋 今日委託<br>${qList.map(q =>
          `${q.done ? "✅" : "▫️"} ${QUEST_DESC[q.type](q.target)}${q.done ? "" : `（${q.got}/${q.target}）`}`).join("<br>")}</div>`
      : "";
    const btns = `<div>${S.stage === 4 ? `<button id="petRebirth" class="pb-btn">🥚 轉生</button>` : ""}<button id="petGachaBtn" class="pb-btn">🥚 扭蛋</button><button id="petWardrobeBtn" class="pb-btn">👕 衣櫃</button><button id="petShopBtn" class="pb-btn">🛍️ 商城</button><button id="petCard" class="pb-btn">📇 名片</button></div>`;
    return `<b>${stageName}</b> · Lv.${lv}${streak} · 💰${S.coins || 0}
      <div class="pb-bars">${bar("飽足", S.hunger, "")}${bar("心情", S.mood, "mood")}${bar("整潔", S.clean == null ? 90 : S.clean, "clean")}${bar("經驗", rem / need * 100, "xp")}</div>
      ${nextStage ? `<div class="pb-next">${nextStage}</div>` : ""}${tend}${todayLine}${questLines}${dexLine}${btns}`;
  }

  /* ---------- dialogue pools ---------- */
  const FOODS = ["🍙", "🍎", "🍪", "🍡", "🧁"];
  const CHEER = [
    "好耶！答對了！", "太強了吧！", "就是這樣！", "吃到好料了 😋",
    "唰唰唰～手感來了", "這題都會，穩了穩了", "雲寶與有榮焉 ✨",
    "嗯嗯，我也是這麼想的（點頭）", "下一題下一題！", "腦袋轉超快的欸",
  ];
  const COMFORT = [
    "沒關係，看看詳解 💪", "錯了才記得住！", "下一題一定行", "陪你一起看解析～",
    "這題本來就刁鑽，別放心上", "現在錯免費，考場上答對就好",
    "深呼吸～看完詳解它就是你的了", "AWS 文件那麼厚，錯一題很合理啦",
  ];
  const ROUGH = [   // 連錯 3 題以上
    "連錯幾題了……要不要喝口水休息一下？", "換個分類刷刷看？轉換心情",
    "雲寶幫你集氣 (ง •̀_•́)ง", "這區的題目怪怪的，不是你的問題（拍拍）",
  ];
  const HUNGRY = [
    "肚子咕嚕咕嚕……答對題目餵我嘛 🍙", "好餓……一題就好，答對一題就好",
    "（虛弱）飯……", "餓到只剩 12% 飽足了啦",
  ];
  const FULL = ["好飽～～ 😚", "再吃就要變積雨雲了……", "滿足！（拍肚子）"];
  const PAT_QUIPS = ["嘿嘿 😊", "再摸一下也可以喔", "雲寶充電中 🔋", "唔嘿～", "毛茸茸？我是雲耶"];
  const CHATTER = [
    "S3 的持久性有 11 個 9……我數過了", "刷題刷累了可以摸摸我",
    "其實我是 Spot 雲，隨時會被回收（開玩笑的）", "你知道嗎？雲也是有夢想的",
    "IAM 精神：最小權限。摸頭：最大歡迎", "（盯著題目看）這題我好像會",
    "嗯哼～♪", "今天的風是 us-east-1 吹來的", "我算是……全球級服務的雲吧",
  ];
  const CHATTER_NIGHT = ["夜深了……但我們還醒著 🌙", "熬夜刷題，記得補水", "夜貓子……我懂 🌙"];
  const GREETS = [
    [5, 11, ["早安！今天也一起加油 ☀️", "早上的腦袋最清楚，來刷幾題？", "早～（伸懶腰）"]],
    [11, 14, ["午安！吃飽了嗎？我還沒（暗示）", "午休刷個幾題剛剛好"]],
    [14, 18, ["下午好～精神還行嗎？", "來喝杯茶配幾題吧 🍵"]],
    [18, 23, ["晚上好！今天的進度還差多少？", "晚餐後刷題，消化知識也消化飯"]],
    [23, 29, ["這麼晚還在拼，雲寶陪你 🌙", "夜深了，適量就好喔", "熬夜組的，集合！"]],
  ];
  const isNight = () => { const h = new Date().getHours(); return h >= 23 || h < 5; };
  /* stat-aware small talk: half the time reference today's numbers */
  function chatterLine() {
    const t = S.todayStats || {};
    const dyn = [];
    if (t.c >= 20) dyn.push(`今天已經答對 ${t.c} 題了，太猛`);
    else if (t.c >= 5) dyn.push(`今天答對 ${t.c} 題，節奏不錯～`);
    if (streak >= 3) dyn.push(`${streak} 連對進行中，別斷！`);
    if (t.xp >= 30) dyn.push(`今天已經賺了 ${t.xp} XP，雲寶好富有`);
    const base = isNight() ? CHATTER_NIGHT.concat(CHATTER) : CHATTER;
    return (dyn.length && Math.random() < 0.5) ? pick(dyn) : pick(base);
  }
  function greeting() {
    const h = new Date().getHours(), hh = h < 5 ? h + 24 : h;
    for (const [a, b, lines] of GREETS) if (hh >= a && hh < b) return pick(lines);
    return "嗨！";
  }

  document.addEventListener("quiz:answered", e => {
    if (!layer) return;
    wake(); rollDay();
    const { qid, correct } = e.detail || {};
    if (correct) {
      streak++; wrongStreak = 0; fx.worried = false;
      if (S.todayStats) S.todayStats.c++;
      quest("correct");
      const wi = (S.wrongIds || []).indexOf(qid);
      if (wi >= 0) {                                // revenge: a once-missed question, now conquered
        S.wrongIds.splice(wi, 1);
        quest("revenge");
        if (Math.random() < 0.6) setTimeout(() => say("⚔️ 復仇成功！這題再也不是對手", 2600), 300);
      }
      express("happyUntil", 2500);
      let combo = "";
      if (streak === 3) { combo = "三連對！🔥"; float("🔥"); }
      else if (streak === 5) { combo = "五連對！雲寶眼睛都亮了 ✨"; express("starUntil", 4500); S.mood = clamp(S.mood + 5, 0, 100); }
      else if (streak === 10) { combo = "十連對！！你是大神吧 🏆"; express("starUntil", 6000); float("🏆"); S.mood = clamp(S.mood + 5, 0, 100); }
      else if (streak > 10 && streak % 10 === 0) { combo = streak + " 連對……雲寶已經拜服 🙇"; express("starUntil", 6000); }
      if (S.fedIds.includes(qid)) { float("✨"); if (combo) say(combo, 2600); return; }  // same question today: no farm
      S.fedIds.push(qid);
      const wellCared = S.hunger >= 50 && S.mood >= 60;   // 照顧得好 → 消化好 → 多 1 XP
      feed(8, pick(FOODS), (e.detail || {}).exam);
      gainXp(wellCared ? 3 : 2);
      if (combo) say(combo, 2600);
      else if (Math.random() < 0.4) say(pick(CHEER), 2000);
      save();
    } else {
      streak = 0; wrongStreak++;
      if (S.todayStats) S.todayStats.w++;
      S.wrongIds = S.wrongIds || [];
      if (!S.wrongIds.includes(qid)) { S.wrongIds.push(qid); if (S.wrongIds.length > 500) S.wrongIds.shift(); }
      save();
      if (wrongStreak >= 2) {                       // a rough patch: worried face + sweat
        fx.worried = true; refreshLook();
        setTimeout(() => { fx.worried = false; refreshLook(); }, 8000);
      }
      // walk up beside the question card first, and only speak on arrival
      const pool = wrongStreak >= 3 ? ROUGH : COMFORT;
      const comfort = () => say(pick(pool), 3000);
      if (!walkTo(window.innerHeight / 2 - 30, comfort)) comfort();
    }
  });
  document.addEventListener("quiz:examStart", () => {
    if (!layer) return;
    wake();
    fx.exam = true; refreshLook();                  // headband on, quiet support mode
    spawnBoss();
    say(pick(["考題魔王出現了！用答案打倒它 ⚔️", "魔王來襲——深呼吸，你準備好了", "頭帶繫好了，討伐開始！"]), 3000);
  });
  document.addEventListener("quiz:examPick", () => bossAttack());   // each exam answer = a zap
  document.addEventListener("quiz:examDone", e => {
    if (!layer) return;
    wake();
    fx.exam = false; refreshLook();
    const pct = (e.detail || {}).pct || 0;
    despawnBoss(pct >= 75);                                  // 達標 = 魔王爆炸
    S.mood = clamp(S.mood + (pct >= 75 ? 10 : 3), 0, 100);  // 大考完不管結果都開心，達標更嗨
    S.bestExamPct = Math.max(S.bestExamPct || 0, pct);       // 100% unlocks the gold form
    feed(20, "🍱", (e.detail || {}).exam);
    gainXp(10);
    quest("exam");
    if (pct === 100) {
      express("starUntil", 8000);
      say("💯 滿分！！雲寶看見了傳說中的金色光芒……", 4500);
      [0, 250, 500, 750].forEach(t => setTimeout(() => float(pick(["🌟", "💯", "✨"])), t));
    } else if (pct >= 75) {
      express("starUntil", 6000);
      say("🎉 模擬考達標！大餐時間！", 3500);
      [0, 250, 500, 750].forEach(t => setTimeout(() => float(pick(["🎉", "🎊", "✨"])), t));
    } else {
      say("考完了！吃頓好的，錯題再一起看 🍱", 3500);
    }
    save();
  });

  /* ---------- toggle (always present, even when pet is off) ---------- */
  function buildToggle() {
    const b = $make("button", enabled() ? "" : "off", "☁");
    b.id = "petToggle";
    b.title = "雲寶開關";
    b.onclick = () => {
      const on = !enabled();
      try { localStorage.setItem(EN_KEY, on ? "1" : "0"); } catch {}
      b.classList.toggle("off", !on);
      if (on) start(); else destroy();
      document.dispatchEvent(new CustomEvent("pet:toggled", { detail: { on } })); // shrine.js follows suit
    };
    document.body.appendChild(b);
  }

  /* ---------- boot ---------- */
  function start() {
    load(); applyDecay(); rollDay(); save();
    build();
    if (S.dusty) say("好久不見……雲寶有點想你 🥺 刷幾題幫牠打起精神吧", 4000);
    else setTimeout(() => say(greeting(), 2800), 900);   // time-of-day hello
    if (S.quests && !S.quests.announced) {
      S.quests.announced = true; save();
      setTimeout(() => say("📋 今日委託出爐！點我看看有什麼任務", 3200), 4500);
    }
  }
  buildToggle();
  if (enabled()) start();
})();
