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
    <ellipse cx="75" cy="66" rx="16" ry="18" fill="#f2c9a0" stroke="#d9a878" stroke-width=".9"/>
    <circle cx="59" cy="67" r="3.4" fill="#f2c9a0" stroke="#d9a878" stroke-width=".7"/><circle cx="91" cy="67" r="3.4" fill="#f2c9a0" stroke="#d9a878" stroke-width=".7"/>
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
  function renderCenser(box, frac, burning) {
    box.innerHTML = `<svg viewBox="0 0 120 80"><defs>
        <linearGradient id="shBronze" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#d8a24a"/><stop offset="100%" stop-color="#7a5220"/></linearGradient></defs>
      <ellipse cx="60" cy="72" rx="30" ry="6" fill="rgba(0,0,0,.3)"/>
      <path d="M34 44 L86 44 L80 70 L40 70 Z" fill="url(#shBronze)" stroke="#5a3c17" stroke-width="1.5"/>
      <ellipse cx="60" cy="44" rx="26" ry="7" fill="#3a2a12" stroke="#caa24a" stroke-width="1.5"/>
      <path d="M34 48 q-10 0 -10 10 M86 48 q10 0 10 10" fill="none" stroke="url(#shBronze)" stroke-width="4"/>
    </svg>`;
    if (frac > 0) {
      const h = 14 + 66 * frac, tips = [-8, 0, 8];
      tips.forEach((dx, i) => {
        const st2 = $m("div", "sh-incense" + (burning ? "" : " dim"));
        st2.style.height = h + "px";
        st2.style.left = `calc(50% + ${dx}px)`;
        st2.style.transform = `rotate(${(i - 1) * 5}deg)`;
        box.appendChild(st2);
      });
      if (burning) for (let i = 0; i < 3; i++) {
        const sm = $m("span", "sh-smoke go", "︶");
        sm.style.left = `calc(50% + ${(i - 1) * 8}px)`;
        sm.style.bottom = (34 + h) + "px";
        sm.style.animationDelay = (i * 1.0) + "s";
        box.appendChild(sm);
      }
    }
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

    if (done) {
      inst = "今日已誠心上香 🙏";
      blessing = `<div class="sh-blessing"><div class="bl-main">${s.main || "文昌加持"}</div>
        <div class="bl-poem">${s.poem || ""}</div>
        <div class="sh-tag">今日 XP／雲朵幣 ×${(s.mult || 1.2).toFixed(2)}（明日可再上香）</div></div>`;
      actLabel = "";
    } else if (st === 0) { inst = "點香、參拜、插香——為今日求個好運。"; actLabel = "🙏 開始上香"; }
    else if (st === 1) { inst = "點擊右邊的燭火，點燃手中的線香。"; actLabel = ""; }
    else if (st === 2) { inst = `向文昌帝君誠心參拜（${bows}/3）`; actLabel = `參拜 (${bows}/3)`; }
    else if (st === 3) { inst = "將香插入香爐。"; actLabel = "插香入爐"; }

    panel.innerHTML = `<button class="sh-close" title="關閉">✕</button>
      <div class="sh-title">文昌殿</div>
      <div class="sh-sub">掌文運與科考之神</div>
      <div class="sh-stage">
        <div class="sh-deity">${DEITY}</div>
        <div class="sh-censer"></div>
        ${(st >= 1 && st <= 3) ? `<div class="sh-hand${st >= 2 ? " lit" : ""}">🤲<div class="sticks"><span class="st"></span><span class="st"></span><span class="st"></span></div></div>` : ""}
        ${st === 1 ? `<div class="sh-candle hint" title="點火">🕯️</div>` : ""}
      </div>
      <div class="sh-inst">${inst}</div>
      ${actLabel ? `<button class="sh-act" id="${actId}">${actLabel}</button>` : ""}
      ${blessing}`;

    renderCenser(panel.querySelector(".sh-censer"), frac, burning);

    panel.querySelector(".sh-close").onclick = closeShrine;
    const candle = panel.querySelector(".sh-candle");
    if (candle) candle.onclick = lightIncense;
    const act = panel.querySelector("#shAct");
    if (act) act.onclick = onAct;
  }

  function onAct() {
    if (st === 0) { st = 1; render(); }
    else if (st === 2) bow();
    else if (st === 3) insert();
  }
  function lightIncense() {
    if (st !== 1) return;
    st = 2; render();
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
    save({ day: today(), mult: b.mult, main: b.main, poem: b.poem, insertedAt: Date.now() });
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
