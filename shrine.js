/* shrine.js — 文昌殿 (Wenchang shrine). Unlocked by buying 文昌神龕 in the pet shop.
   Fully decoupled from the quiz app (app.js): it only reads pet ownership from localStorage
   "app_pet" and writes a daily luck buff to "app_shrine". pet.js reads that buff when it
   awards XP / 雲朵幣. Delete shrine.js/shrine.css + the shop entry to uninstall. */
"use strict";
(function () {
  const KEY = "app_shrine";
  const today = () => new Date().toISOString().slice(0, 10);
  const petOn = () => { try { return localStorage.getItem("app_pet_enabled") !== "0"; } catch { return true; } };
  const owned = () => {
    if (!petOn()) return false;
    try { const p = JSON.parse(localStorage.getItem("app_pet")) || {}; return !!(p.items && p.items.shrine); }
    catch { return false; }
  };
  const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } };
  const save = s => { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch {} };
  const offeredToday = () => load().day === today();

  const BLESSINGS = [
    { mult: 1.10, main: "心誠則靈", poem: "一分耕耘，一分收穫。" },
    { mult: 1.15, main: "文思泉湧", poem: "筆下生花，題題順心。" },
    { mult: 1.20, main: "文昌加持", poem: "星拱北極，福運隨行。" },
    { mult: 1.30, main: "金榜題名", poem: "十年寒窗，一舉登科！", rare: true },
  ];
  function rollBlessing() {
    if (Math.random() < 0.08) return BLESSINGS[3];              // rare 30% buff
    const pool = [BLESSINGS[0], BLESSINGS[0], BLESSINGS[1], BLESSINGS[1], BLESSINGS[2]];
    return pool[Math.floor(Math.random() * pool.length)];
  }

  const $m = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  const BURN_MS = 3 * 3600 * 1000;                              // incense burns to a nub over ~3h

  /* compact 文昌帝君 for the shrine */
  const DEITY = `<svg viewBox="0 0 150 175" aria-hidden="true">
    <defs>
      <radialGradient id="shHalo" cx="50%" cy="42%" r="52%">
        <stop offset="0%" stop-color="#ffe9a8" stop-opacity=".9"/><stop offset="55%" stop-color="#f0c65e" stop-opacity=".4"/><stop offset="100%" stop-color="#f0c65e" stop-opacity="0"/></radialGradient>
      <linearGradient id="shRobe" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#1f3c60"/><stop offset="100%" stop-color="#0d1c31"/></linearGradient>
      <linearGradient id="shGold" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#f6da8a"/><stop offset="100%" stop-color="#c8962f"/></linearGradient>
      <linearGradient id="shCrown" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#4b3670"/><stop offset="100%" stop-color="#2c1e46"/></linearGradient></defs>
    <circle cx="75" cy="66" r="60" fill="url(#shHalo)"/>
    <path d="M75 88 L52 96 C40 106 33 150 31 172 L119 172 C117 150 110 106 98 96 Z" fill="url(#shRobe)" stroke="url(#shGold)" stroke-width="2"/>
    <path d="M75 84 L61 96 L69 120 L75 105 Z" fill="#f4efe0" stroke="url(#shGold)" stroke-width="1.4"/>
    <path d="M75 84 L89 96 L81 120 L75 105 Z" fill="#f4efe0" stroke="url(#shGold)" stroke-width="1.4"/>
    <circle cx="59" cy="68" r="4" fill="#e6bd93" stroke="#d9a878" stroke-width=".7"/><circle cx="91" cy="68" r="4" fill="#e6bd93" stroke="#d9a878" stroke-width=".7"/>
    <ellipse cx="75" cy="66" rx="16" ry="18" fill="#f2c9a0" stroke="#d9a878" stroke-width=".9"/>
    <path d="M63 63 q4 -2 8 -1 M79 62 q4 -1 8 1" fill="none" stroke="#2a2320" stroke-width="1.4" stroke-linecap="round"/>
    <path d="M64 68 q3.5 2 7 .6 M79 68 q4 1.4 7 -.6" fill="none" stroke="#2a2320" stroke-width="1.4" stroke-linecap="round"/>
    <path d="M75 70 l-2 7 q2 1.6 4 0" fill="none" stroke="#cf9f70" stroke-width="1.3" stroke-linecap="round"/>
    <path d="M74 78 C70 80 66 82 64 85 M76 78 C80 80 84 82 86 85" fill="none" stroke="#1c1c1c" stroke-width="1.8" stroke-linecap="round"/>
    <path d="M61 76 C57 104 68 125 75 131 C82 125 93 104 89 76 C82 84 68 84 61 76 Z" fill="#1d1c1c"/>
    <path d="M60 45 L62 30 C66 22 84 22 88 30 L90 45 Z" fill="url(#shCrown)" stroke="url(#shGold)" stroke-width="1.6"/>
    <rect x="60" y="44" width="30" height="9" rx="3" fill="url(#shCrown)" stroke="url(#shGold)" stroke-width="1.6"/>
    <circle cx="75" cy="30" r="3" fill="#d13b3b" stroke="url(#shGold)" stroke-width="1"/>
    <path d="M60 47 C50 45 45 47 43 52 C49 55 57 53 60 51 Z" fill="url(#shGold)"/>
    <path d="M90 47 C100 45 105 47 107 52 C101 55 93 53 90 51 Z" fill="url(#shGold)"/>
  </svg>`;

  /* 火爐 — fire brazier used to light the incense */
  const BRAZIER = `<svg viewBox="0 0 60 62" aria-hidden="true">
    <defs><linearGradient id="shBronze2" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#d8a24a"/><stop offset="100%" stop-color="#7a5220"/></linearGradient></defs>
    <ellipse cx="30" cy="58" rx="16" ry="3.5" fill="rgba(0,0,0,.3)"/>
    <line x1="22" y1="52" x2="18" y2="60" stroke="#5a3c17" stroke-width="2.4"/><line x1="38" y1="52" x2="42" y2="60" stroke="#5a3c17" stroke-width="2.4"/>
    <path d="M18 40 L42 40 L38 54 L22 54 Z" fill="url(#shBronze2)" stroke="#5a3c17" stroke-width="1.4"/>
    <ellipse cx="30" cy="40" rx="13" ry="3.6" fill="#3a2a12" stroke="#caa24a" stroke-width="1.2"/>
    <path class="fl fl2" d="M24 40 C21 34 23 30 25 25 C28 30 27 36 24 40 Z" fill="#ff7a1e"/>
    <path class="fl fl3" d="M36 40 C39 34 37 30 35 25 C32 30 33 36 36 40 Z" fill="#ff7a1e"/>
    <path class="fl fl1" d="M30 40 C24 31 27 24 30 18 C33 24 36 31 30 40 Z" fill="#ffb02e"/>
  </svg>`;

  /* ---------- state ---------- */
  let btn, overlay, panel, st = 0, bows = 0, burnT = 0;
  // st: 0 idle · 1 have-incense(unlit) · 2 lit · 3 done-bowing · 4 inserted/done

  function build() {
    if (btn) return;
    btn = $m("button", "", "⛩️"); btn.id = "shrineBtn"; btn.title = "文昌殿 · 上香祈福";
    btn.onclick = open;
    document.body.appendChild(btn);
    refreshBadge();
  }
  function teardown() { if (btn) { btn.remove(); btn = null; } closeShrine(); }
  function refreshBadge() {
    if (!btn) return;
    btn.innerHTML = "⛩️" + (offeredToday() ? "" : `<span class="dot"></span>`);
  }

  /* ---------- censer render ---------- */
  function burnFrac() {
    const s = load();
    if (s.day !== today() || !s.insertedAt) return 0;
    return Math.max(0, 1 - (Date.now() - s.insertedAt) / BURN_MS);
  }
  const SLOTS = { 3: [-8, 0, 8], 2: [-6, 6], 1: [0], 0: [] };
  function renderCenser(box, frac, burning, n, pullable) {
    box.innerHTML = `<svg viewBox="0 0 120 80"><defs>
        <linearGradient id="shBronze" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#d8a24a"/><stop offset="100%" stop-color="#7a5220"/></linearGradient></defs>
      <ellipse cx="60" cy="72" rx="30" ry="6" fill="rgba(0,0,0,.3)"/>
      <path d="M34 44 L86 44 L80 70 L40 70 Z" fill="url(#shBronze)" stroke="#5a3c17" stroke-width="1.5"/>
      <ellipse cx="60" cy="44" rx="26" ry="7" fill="#3a2a12" stroke="#caa24a" stroke-width="1.5"/>
      <path d="M34 48 q-10 0 -10 10 M86 48 q10 0 10 10" fill="none" stroke="url(#shBronze)" stroke-width="4"/>
    </svg>`;
    if (frac <= 0 || !n) return;
    const h = 14 + 66 * frac, slots = SLOTS[n] || [];
    slots.forEach((dx, i) => {
      const st2 = $m("div", "sh-incense" + (burning ? "" : " dim") + (pullable ? " pull" : ""));
      st2.style.height = h + "px";
      st2.style.left = `calc(50% + ${dx}px)`;
      st2.style.transform = `rotate(${dx * 0.6}deg)`;
      if (pullable) st2.title = "按住拖出即可丟棄";
      box.appendChild(st2);
      if (burning) {
        const sm = $m("span", "sh-smoke go", "︶");
        sm.style.left = `calc(50% + ${dx}px)`;
        sm.style.bottom = (34 + h) + "px";
        sm.style.animationDelay = (i * 1.0) + "s";
        box.appendChild(sm);
      }
    });
  }

  /* ---------- open / render ---------- */
  function open() {
    if (overlay) return;
    overlay = $m("div"); overlay.id = "shrineOverlay";
    overlay.addEventListener("click", e => { if (e.target === overlay) closeShrine(); });
    panel = $m("div"); panel.id = "shrinePanel";
    overlay.appendChild(panel);
    document.body.appendChild(overlay);
    st = 0; bows = 0;
    render();
    burnT = setInterval(() => { if (panel && offeredToday()) render(); }, 30000);
  }
  function closeShrine() {
    clearInterval(burnT);
    if (overlay) overlay.remove();
    overlay = panel = null;
    refreshBadge();
  }

  function render() {
    if (!panel) return;
    const done = offeredToday();
    const s = load();
    const frac = burnFrac(), burning = frac > 0.02;
    let inst = "", actLabel = "", actId = "shAct", blessing = "";

    const sticksN = done ? (s.sticks == null ? 3 : s.sticks) : 0;
    if (done) {
      inst = "今日已誠心上香 🙏　按住香拖出即可丟棄，全部拔起可重新上香。";
      blessing = `<div class="sh-blessing"><div class="bl-main">${s.main || "文昌加持"}</div>
        <div class="bl-poem">${s.poem || ""}</div>
        <div class="sh-tag">今日 XP／雲朵幣 ×${(s.mult || 1.2).toFixed(2)}（明日可再上香）</div></div>`;
      actLabel = "";
    } else if (st === 0) { inst = "點香、參拜、插香——為今日求個好運。"; actLabel = "🙏 開始上香"; }
    else if (st === 1) { inst = "拿起香，把香頭湊到火爐點燃 🔥"; actLabel = ""; }
    else if (st === 2) { inst = `向文昌帝君誠心參拜（${bows}/3）`; actLabel = `參拜 (${bows}/3)`; }
    else if (st === 3) { inst = "將香插入香爐。"; actLabel = "插香入爐"; }

    panel.innerHTML = `<button class="sh-close" title="關閉">✕</button>
      <div class="sh-title">文昌殿</div>
      <div class="sh-sub">掌文運與科考之神</div>
      <div class="sh-stage">
        <div class="sh-deity">${DEITY}</div>
        <div class="sh-censer"></div>
        ${(st >= 1 && st <= 3) ? `<div class="sh-hand${st >= 2 ? " lit" : ""}${st === 1 ? " grab" : ""}">🤲<div class="sticks"><span class="st"></span><span class="st"></span><span class="st"></span></div></div>` : ""}
        ${st === 1 ? `<div class="sh-brazier" title="火爐">${BRAZIER}</div>` : ""}
      </div>
      <div class="sh-inst">${inst}</div>
      ${actLabel ? `<button class="sh-act" id="${actId}">${actLabel}</button>` : ""}
      ${blessing}`;

    const cbox = panel.querySelector(".sh-censer");
    renderCenser(cbox, frac, burning, sticksN, done);
    if (done) {
      cbox.addEventListener("mousedown", e => { const s = e.target.closest(".sh-incense.pull"); if (s) startPull(e, s); });
      cbox.addEventListener("touchstart", e => { const s = e.target.closest(".sh-incense.pull"); if (s) startPull(e, s); }, { passive: false });
    }

    panel.querySelector(".sh-close").onclick = closeShrine;
    if (st === 1) {
      const hand = panel.querySelector(".sh-hand");
      if (hand) { hand.addEventListener("mousedown", startHandDrag); hand.addEventListener("touchstart", startHandDrag, { passive: false }); }
    }
    const act = panel.querySelector("#shAct");
    if (act) act.onclick = onAct;
  }

  /* light the incense: grab the hand, bring the tips to the fire brazier */
  let handDrag = false;
  function startHandDrag(e) {
    if (st !== 1 || handDrag) return;
    e.preventDefault();
    handDrag = true;
    window.addEventListener("mousemove", moveHand);
    window.addEventListener("mouseup", endHandDrag);
    window.addEventListener("touchmove", moveHand, { passive: false });
    window.addEventListener("touchend", endHandDrag);
  }
  function moveHand(e) {
    if (!handDrag || !panel) return;
    if (e.cancelable) e.preventDefault();
    const p = touchPt(e), hand = panel.querySelector(".sh-hand"), stage = panel.querySelector(".sh-stage");
    if (!hand || !stage) return;
    const r = stage.getBoundingClientRect();
    hand.style.left = (p.x - r.left) + "px"; hand.style.top = (p.y - r.top) + "px";
    hand.style.bottom = "auto"; hand.style.transform = "translate(-50%,-50%)";
    const br = panel.querySelector(".sh-brazier");
    if (br) {
      const b = br.getBoundingClientRect(), cx = b.left + b.width / 2, cy = b.top + b.height / 2;
      if (Math.hypot(p.x - cx, (p.y - 44) - cy) < 34) igniteFromFire();   // incense tips ~44px above the hand
    }
  }
  function endHandDrag() {
    handDrag = false;
    window.removeEventListener("mousemove", moveHand);
    window.removeEventListener("mouseup", endHandDrag);
    window.removeEventListener("touchmove", moveHand);
    window.removeEventListener("touchend", endHandDrag);
  }
  function igniteFromFire() {
    if (st !== 1) return;
    endHandDrag();
    const hand = panel && panel.querySelector(".sh-hand");
    if (hand) hand.classList.add("lit", "flash");
    st = 2;
    setTimeout(render, 300);
  }

  /* drag an incense stick out; releasing the button discards it */
  let dragInc = null;
  const touchPt = e => { const t = e.touches && e.touches[0]; return t ? { x: t.clientX, y: t.clientY } : { x: e.clientX, y: e.clientY }; };
  function startPull(e, stickEl) {
    if (dragInc) return;
    e.preventDefault();
    stickEl.style.visibility = "hidden";              // it's now "in hand"
    const p = touchPt(e);
    dragInc = $m("div", "sh-loose-incense");
    dragInc.style.left = p.x + "px"; dragInc.style.top = p.y + "px";
    document.body.appendChild(dragInc);
    window.addEventListener("mousemove", movePull);
    window.addEventListener("mouseup", endPull);
    window.addEventListener("touchmove", movePull, { passive: false });
    window.addEventListener("touchend", endPull);
  }
  function movePull(e) {
    if (!dragInc) return;
    if (e.cancelable) e.preventDefault();
    const p = touchPt(e);
    dragInc.style.left = p.x + "px"; dragInc.style.top = p.y + "px";
  }
  function endPull() {
    window.removeEventListener("mousemove", movePull);
    window.removeEventListener("mouseup", endPull);
    window.removeEventListener("touchmove", movePull);
    window.removeEventListener("touchend", endPull);
    if (dragInc) { dragInc.remove(); dragInc = null; }
    pullStick();                                       // discard on release
  }

  /* remove one incense stick — the god is not amused; all pulled → re-offer */
  function pullStick() {
    const s = load();
    s.sticks = Math.max(0, (s.sticks == null ? 3 : s.sticks) - 1);
    reactPull();
    if (s.sticks <= 0) {                 // censer empty → clear today's offering, ritual re-opens
      save({});
      st = 0; bows = 0;
      setTimeout(render, 320);
    } else {
      save(s);
      setTimeout(render, 220);
    }
    refreshBadge();
  }
  function reactPull() {
    const d = panel && panel.querySelector(".sh-deity");
    if (d) { d.classList.remove("react"); void d.offsetWidth; d.classList.add("react"); setTimeout(() => d && d.classList.remove("react"), 460); }
    const stage = panel && panel.querySelector(".sh-stage");
    if (stage) { const f = $m("span", "sh-react", pick(["⁉️", "😯", "…", "🙁", "😾"])); stage.appendChild(f); setTimeout(() => f.remove(), 950); }
  }
  const pick = a => a[Math.floor(Math.random() * a.length)];

  function onAct() {
    if (st === 0) { st = 1; render(); }
    else if (st === 2) bow();
    else if (st === 3) insert();
  }
  function bow() {
    const d = panel && panel.querySelector(".sh-deity");
    if (d) { d.classList.add("bowing"); setTimeout(() => d.classList.remove("bowing"), 500); }
    bows++;
    if (bows >= 3) { st = 3; setTimeout(render, 520); }
    else { const a = panel.querySelector("#shAct"); if (a) a.textContent = `參拜 (${bows}/3)`; const i = panel.querySelector(".sh-inst"); if (i) i.textContent = `向文昌帝君誠心參拜（${bows}/3）`; }
  }
  function insert() {
    const b = rollBlessing();
    save({ day: today(), mult: b.mult, main: b.main, poem: b.poem, insertedAt: Date.now(), sticks: 3 });
    st = 4;
    render();
    // little celebratory smoke burst already via censer; nudge the pet if present
    document.dispatchEvent(new CustomEvent("shrine:offered", { detail: { mult: b.mult } }));
  }

  /* ---------- wiring: show only when the shrine item is owned ---------- */
  function sync() { if (owned()) build(); else teardown(); }
  document.addEventListener("pet:itemBought", e => { if ((e.detail || {}).id === "shrine") { sync(); if (btn) setTimeout(open, 300); } });
  document.addEventListener("pet:toggled", sync);   // pet turned on/off
  sync();
})();
