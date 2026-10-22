/* apprentice-rig.js — 2D layer rig for the 雲端學徒 (Canvas 2D, no dependencies). Rig format v2.
   Data: assets/apprentice/rig/rig.json + 1024px WebP copies of the 2048×2048 RGBA layers/masks.
   Every layer keeps the shared top-left origin and is drawn at 2048 rig units; nothing is cropped
   or re-centred per layer. Rules taken from rig.json:
   - drawOrder is the only paint order; depth is used for parallax only.
   - clipMask multiplies alpha (destination-in). face-skin is clipped once at load (static);
     each iris is moved by the gaze first and then clipped by its fixed eye-aperture mask.
   - Exclusive switches: one mouth at the mouth-closed slot; per side, the neutral eye group
     (white, iris, upper/lower lid) is replaced as a whole by closed / sparkle / smile. Brows stay.
   - head-base.png is an alias of face-skin and is never drawn.
   - Outfits: the body slot is exclusive like the mouth. "default" = body.png; any other id loads
     body-<id> from the same folder on first use (rig.json "outfits": [ids] only lists them).
     A whole-body swap: each outfit must keep the neck (y ≤ 800) pixel-identical to body.png and
     the silhouette up to the shoulders (y ≤ 965) unchanged — face, hair-back and side locks overlap there.
   Motion: body breathes (strip lift, see BREATH); the "head" group rotates about neckPivot; side locks and front
   hair add their own root rotation; head layers shift by (depth − 0.5) × look for parallax.
   Used by apprentice.js (companion) and tests/apprentice-harness.html (dev preview). */
"use strict";
(function () {
  const SCRIPT = document.currentScript ? document.currentScript.src : location.href;
  const DEFAULT_ROOT = new URL("assets/apprentice/rig/", SCRIPT).href;
  const EYES = ["neutral", "closed", "sparkle", "smile"];
  const MOUTHS = ["closed", "smile", "a", "i", "u", "e", "o", "open-smile", "frown"];
  const NEUTRAL_EYE = ["eye-white", "iris", "eyelid-upper", "eyelid-lower"];
  const ALT_EYE = { closed: "eyelid-closed", sparkle: "eye-sparkle", smile: "eye-smile" };
  const DEG = Math.PI / 180;
  // rig px of relative shift between depth 0 and 1 at full look. 20 exposed the ear-layer cut edge at
  // the jaw (face-core vs ear vs hair-back sliding apart); 10 keeps it hidden at full gaze.
  const PARALLAX = 10;
  const FRAMING = {              // visible box in rig units: [x, y, width] (height follows the canvas)
    card: { x: 316, y: 47, w: 1412 },
    mini: { x: 628, y: 165, w: 788 },
    full: { x: 0, y: 0, w: 2048 },
  };
  // Breathing touches the body layer only, and only vertically: rows above rigidTo (neck, collar,
  // shoulders) rise as one piece with the head riding along, so nothing slides at the neck; the lift
  // fades out by the belt, and the shoulders widen a touch. No 2D warping of face or hair.
  const BREATH = { px: 10, rigidTo: 1050, fadeTo: 1900, widen: 0.004, strip: 24 };
  const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const lift = y => 1 - ss(BREATH.rigidTo, BREATH.fadeTo, y);
  const shoulder = y => ss(800, 1100, y) * (1 - ss(1100, 1600, y));
  const ease = x => 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, Math.max(0, x)));
  const base = f => f.replace(/\.png$/, "");
  const side = n => (/-L$/.test(n) ? "L" : /-R$/.test(n) ? "R" : null);
  const group = n => n.replace(/-[LR]$/, "");

  const spring = (k, d) => ({ x: 0, v: 0, target: 0, k, d });
  const stepSpring = (s, dt) => { s.v += (s.k * (s.target - s.x) - s.d * s.v) * dt; s.x += s.v * dt; };

  function create(canvas, opts = {}) {
    const root = opts.root ? new URL(opts.root, location.href).href : DEFAULT_ROOT;
    const ext = opts.ext || ".webp", ver = opts.root ? "" : "?v=rig3";
    const parallax = opts.parallax != null ? +opts.parallax : PARALLAX;   // harness override for asset QA
    const url = f => root + base(f) + ext + ver;
    const ctx = canvas.getContext("2d");
    const reduced = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : { matches: false };
    const st = {
      framing: opts.framing || "card", paused: false, hidden: {},
      eyes: "neutral", mouth: "closed", brows: { dy: 0, rot: 0 }, blinking: false,
      manualHead: null, manualHair: null, manualGaze: null, gazeTarget: [0, 0],
      tilt: spring(55, 11), hop: spring(170, 14), nod: spring(70, 12),
      hairL: spring(26, 3.4), hairR: spring(24, 3.0), hairF: spring(40, 6),
      gx: spring(90, 16), gy: spring(90, 16), browY: spring(120, 16), browR: spring(120, 16),
      lx: spring(22, 8), ly: spring(22, 8),        // head "look" lags the eyes, so both turn as one
      br: { on: true, phase: 0, period: 4.2, rate: 1, rateT: 1, depth: 1, depthT: 1, sigh: 0 }, breathV: 0,
    };
    let rig, info, img = {}, faceSkin = null, eyeBuf = {}, raf = 0, last = 0, t = 0, alive = true, blinkT = 0;
    let outfit = { id: "default", im: null }, outfitTok = 0;
    const wardrobe = {};                        // id → Promise<Image|null>, loaded on first use
    const OUTFIT_BB = { y: 0 };                 // unknown extent: breathe strips from the top

    function load(f, tries = 3) {
      return new Promise(res => {
        const im = new Image();
        im.onload = () => (im.decode ? im.decode().catch(() => {}) : Promise.resolve()).then(() => res(im));
        im.onerror = () => (tries > 1 ? setTimeout(() => load(f, tries - 1).then(res), 300) : res(null));
        im.src = url(f);
      });
    }
    function clipOnce(im, mask) {               // static clip: straight RGB kept, alpha × mask alpha
      const c = document.createElement("canvas");
      c.width = im.naturalWidth; c.height = im.naturalHeight;
      const x = c.getContext("2d");
      x.drawImage(im, 0, 0);
      x.globalCompositeOperation = "destination-in";
      x.drawImage(mask, 0, 0, c.width, c.height);
      return c;
    }
    const ready = (async () => {
      rig = await (await fetch(root + "rig.json" + ver)).json();
      const aliases = rig.aliases || {};
      info = {};
      rig.layers.forEach(l => { if (!aliases[l.file]) info[base(l.file)] = l; });
      const files = Object.keys(info).map(n => n + ".png");
      const masks = [...new Set(rig.layers.map(l => l.clipMask).filter(Boolean))];
      const loaded = await Promise.all(files.concat(masks).map(load));
      files.concat(masks).forEach((f, i) => (img[base(f)] = loaded[i]));
      // fail closed: a half-loaded rig (e.g. no front hair) must never be shown
      const missing = files.concat(masks).filter((f, i) => !loaded[i]);
      if (missing.length) { alive = false; throw new Error("apprentice rig: missing " + missing.join(", ")); }
      const fs = info["face-skin"];
      if (fs && fs.clipMask && img["face-skin"] && img[base(fs.clipMask)]) faceSkin = clipOnce(img["face-skin"], img[base(fs.clipMask)]);
      ["L", "R"].forEach(s => {                 // offscreen region for gaze-moved, aperture-clipped iris
        const boxes = ["eye-white-" + s, "iris-" + s].map(n => info[n] && info[n].boundingBox).filter(Boolean);
        const e = rig.eyes[s].irisMovementEllipse, pad = Math.max(e.radiusX, e.radiusY) + 8;
        const x0 = Math.min(...boxes.map(b => b.x)) - pad, y0 = Math.min(...boxes.map(b => b.y)) - pad;
        const x1 = Math.max(...boxes.map(b => b.x + b.width)) + pad, y1 = Math.max(...boxes.map(b => b.y + b.height)) + pad;
        eyeBuf[s] = { x: x0, y: y0, w: x1 - x0, h: y1 - y0, c: document.createElement("canvas"), s: 0 };
      });
      resize(); start();
    })();

    function resize() {
      const r = canvas.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
      draw();
    }
    const still = () => st.paused || reduced.matches;

    /* ---------- simulation ---------- */
    function update(dt) {
      t += dt;
      const s = still();
      const sway = s ? 0 : 1.1 * Math.sin(t * 0.55) + 0.4 * Math.sin(t * 1.31 + 1.2);   // ≈ ±1.5°
      [st.tilt, st.hop, st.nod].forEach(sp => stepSpring(sp, dt));
      // gaze: the irises (gx/gy) react fast; the head (lx/ly) follows the same target more slowly
      const g = st.manualGaze || (s ? [0, 0] : st.gazeTarget);
      st.gx.target = st.lx.target = g[0]; st.gy.target = st.ly.target = g[1];
      [st.gx, st.gy, st.lx, st.ly].forEach(sp => stepSpring(sp, dt));
      if (st.manualGaze || s) { st.gx.x = st.lx.x = g[0]; st.gy.x = st.ly.x = g[1]; }
      const roll = 1.2 * st.lx.x;                                  // lean toward where she looks
      const head = st.manualHead != null ? st.manualHead
        : (s ? 0 : Math.max(-3, Math.min(3, sway + st.tilt.x + roll)));
      // Lock swing stays ≈ ±1.2° relative to the head: part of the jaw/ear outline lives on the
      // hair-side layers, so larger relative angles double or break that contour (asset ownership).
      st.hairL.target = s ? 0 : -0.4 * head + 0.6 * Math.sin(t * 0.83 + 0.4);
      st.hairR.target = s ? 0 : -0.4 * head + 0.6 * Math.sin(t * 0.77 + 2.1);
      st.hairF.target = s ? 0 : -0.15 * head + 0.2 * Math.sin(t * 0.9 + 1.0);
      [st.hairL, st.hairR, st.hairF].forEach(sp => stepSpring(sp, dt));
      if (st.manualHair) { st.hairL.x = st.manualHair[0]; st.hairR.x = st.manualHair[1]; }
      st.browY.target = st.brows.dy; st.browR.target = st.brows.rot;
      [st.browY, st.browR].forEach(sp => stepSpring(sp, dt));
      if (s) { st.browY.x = st.brows.dy; st.browR.x = st.brows.rot; }
      st.headDeg = head;
      // breath: short inhale (40%), longer exhale, period varies a little per cycle; a sigh overrides
      const B = st.br, a = Math.min(1, dt * 1.5);
      B.rate += (B.rateT - B.rate) * a; B.depth += (B.depthT - B.depth) * a;
      if (!s) {
        B.phase += dt * B.rate / B.period;
        if (B.phase >= 1) { B.phase -= 1; B.period = 3.6 + Math.random(); }
      }
      let v = (B.phase < 0.4 ? ease(B.phase / 0.4) : 1 - ease((B.phase - 0.4) / 0.6)) * B.depth;
      if (B.sigh > 0) {
        B.sigh = Math.max(0, B.sigh - dt);
        const p = 1 - B.sigh / 2.6;
        v = Math.max(v, 2.2 * (p < 0.35 ? ease(p / 0.35) : 1 - ease((p - 0.35) / 0.65)));
      }
      st.breathV = st.manualBreath != null ? st.manualBreath : s || !B.on ? 0 : v;
      // natural blinking: only while the neutral eye group is showing
      if (opts.autoBlink !== false && !st.paused) {
        blinkT -= dt;
        if (blinkT <= 0) {
          if (st.eyes === "neutral" && !st.blinking) blink(Math.random() < 0.15);
          blinkT = 2.6 + Math.random() * 3.8;
        }
      }
    }
    function blink(double) {
      st.blinking = true;
      setTimeout(() => {
        st.blinking = false;
        if (double) setTimeout(() => { st.blinking = true; setTimeout(() => (st.blinking = false), 110); }, 140);
      }, 120);
    }

    /* ---------- drawing ---------- */
    function draw() {
      if (!rig) return;
      const W = canvas.width, H = canvas.height, f = FRAMING[st.framing] || FRAMING.card, k = W / f.w;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, W, H);
      ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
      const s = still(), hop = s ? 0 : st.hop.x, nod = s ? 0 : st.nod.x, pv = rig.neckPivot;
      const amp = BREATH.px * (st.breathV || 0);
      const neckDy = -amp * lift(pv.y);                            // neck rides the breathing chest
      const snap = y => Math.round((y + hop - f.y) * k) / k - hop + f.y;   // rig y → whole device row
      const lookX = st.lx.x, lookY = st.ly.x;                      // head turn, lagging the irises
      const world = () => { ctx.setTransform(k, 0, 0, k, -f.x * k, -f.y * k); ctx.translate(0, hop); };
      const around = (p, deg) => { ctx.translate(p.x, p.y); ctx.rotate(deg * DEG); ctx.translate(-p.x, -p.y); };
      const headSpace = depth => {
        world(); ctx.translate(0, neckDy + nod);
        around(pv, st.headDeg || 0);
        ctx.translate(lookX * 6 + (depth - 0.5) * parallax * lookX, lookY * 4 + (depth - 0.5) * parallax * lookY);
      };
      const eyeState = st.blinking && st.eyes === "neutral" ? "closed" : st.eyes;

      for (const file of rig.drawOrder) {
        const n = base(file), sd = side(n), grp = group(n);
        if (st.hidden[n]) continue;
        let name = n;
        if (NEUTRAL_EYE.includes(grp) && eyeState !== "neutral") {          // whole eye group swap
          if (grp !== "eye-white") continue;                               // alternate drawn once, in the white's slot
          name = ALT_EYE[eyeState] + "-" + sd;
          if (st.hidden[name]) continue;
        }
        if (n === "mouth-closed") name = "mouth-" + st.mouth;              // exclusive mouth slot
        const worn = n === "body" && outfit.im;                             // exclusive outfit slot
        const im = worn ? outfit.im : name === "face-skin" && faceSkin ? faceSkin : img[name];
        const li = info[name] || info[n];
        if (!im || !li) continue;
        if (li.parent !== "head") {
          world();
          drawBody(im, amp, worn ? OUTFIT_BB : li.boundingBox, snap);
          continue;
        }
        headSpace(li.depth || 0);
        if (n === "hair-side-L" || n === "hair-side-R") around(rig.hairRoots[n], n.endsWith("L") ? st.hairL.x : st.hairR.x);
        else if (n === "hair-front") around(rig.hairRoots[n], st.hairF.x);
        else if (grp === "brow") {
          const b = li.boundingBox, c = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
          ctx.translate(0, st.browY.x); around(c, sd === "L" ? st.browR.x : -st.browR.x);
        }
        if (name.startsWith("iris-") && li.clipMask) { drawIris(sd, im, img[base(li.clipMask)], k); continue; }
        ctx.drawImage(im, 0, 0, 2048, 2048);
      }
    }
    function drawBody(im, amp, bb, snap) {
      if (!amp) { ctx.drawImage(im, 0, 0, 2048, 2048); return; }
      // horizontal strips, each lifted by lift(y); strip edges land on whole device rows so
      // neighbours meet exactly (no overlap, no anti-aliased seam lines)
      const sc = im.naturalWidth / 2048, step = BREATH.strip;
      for (let y0 = Math.floor(bb.y / step) * step; y0 < 2048; y0 += step) {
        const y1 = Math.min(2048, y0 + step);
        const d0 = snap(y0 - amp * lift(y0)), d1 = snap(y1 - amp * lift(y1));
        if (d1 <= d0) continue;
        const sx = 1 + BREATH.widen * (amp / BREATH.px) * shoulder((y0 + y1) / 2);
        ctx.drawImage(im, 0, y0 * sc, im.naturalWidth, (y1 - y0) * sc, 1024 - 1024 * sx, d0, 2048 * sx, d1 - d0);
      }
    }
    function drawIris(sd, im, mask, k) {
      const e = rig.eyes[sd].irisMovementEllipse, b = eyeBuf[sd];
      let ux = st.gx.x, uy = st.gy.x; const m = Math.hypot(ux, uy); if (m > 1) { ux /= m; uy /= m; }
      const ox = ux * e.radiusX, oy = uy * e.radiusY;
      const sc = Math.min(2, k);                           // buffer at device resolution
      const w = Math.ceil(b.w * sc), h = Math.ceil(b.h * sc);
      if (b.c.width !== w || b.c.height !== h) { b.c.width = w; b.c.height = h; }
      const o = b.c.getContext("2d");
      o.setTransform(1, 0, 0, 1, 0, 0); o.clearRect(0, 0, w, h);
      o.imageSmoothingEnabled = true; o.imageSmoothingQuality = "high";
      o.setTransform(sc, 0, 0, sc, -b.x * sc, -b.y * sc);
      o.globalCompositeOperation = "source-over";
      o.drawImage(im, ox, oy, 2048, 2048);                 // 1) move the iris (highlight moves with it)
      if (mask) {
        o.globalCompositeOperation = "destination-in";     // 2) clip by the fixed aperture
        o.drawImage(mask, 0, 0, 2048, 2048);
        o.globalCompositeOperation = "source-over";
      }
      ctx.drawImage(b.c, b.x, b.y, b.w, b.h);
    }

    function frame(now) {
      raf = 0;
      if (!alive) return;
      const dt = Math.min(0.05, last ? (now - last) / 1000 : 0); last = now;
      if (!document.hidden) { update(dt); draw(); }
      raf = requestAnimationFrame(frame);
    }
    function start() { if (!raf && alive) { last = 0; raf = requestAnimationFrame(frame); } }
    const redraw = () => { update(0); draw(); };

    return {
      ready, EYES, MOUTHS,
      setEyes(e) { if (EYES.includes(e)) { st.eyes = e; redraw(); } },
      setMouth(m) { if (MOUTHS.includes(m)) { st.mouth = m; redraw(); } },
      setBrows(dy = 0, rot = 0) { st.brows = { dy, rot }; redraw(); },
      setGaze(x, y) { st.gazeTarget = [Math.max(-1, Math.min(1, x)), Math.max(-1, Math.min(1, y))]; },
      blink: () => blink(false),
      // breathing: rate/depth multipliers ease in (1 = calm); sigh = one deep breath out
      setBreath({ rate, depth, on } = {}) {
        if (rate != null) st.br.rateT = rate;
        if (depth != null) st.br.depthT = depth;
        if (on != null) st.br.on = !!on;
      },
      sigh() { st.br.sigh = 2.6; },
      hop(v = -480) { st.hop.v += v; },
      nod(px = 12) { st.nod.target = px; },
      tilt(deg = 0) { st.tilt.target = deg; },
      // whole-body outfit swap; resolves true once shown, false (keeping the current one) if it fails to load
      setOutfit(id = "default") {
        const tok = ++outfitTok;
        if (id === "default") { outfit = { id, im: null }; draw(); return Promise.resolve(true); }
        if (!/^[a-z0-9-]+$/.test(id)) return Promise.resolve(false);
        if (!wardrobe[id]) wardrobe[id] = ready.then(() => load("body-" + id + ".png"));
        return wardrobe[id].then(im => {
          if (!im) { delete wardrobe[id]; return false; }    // a later call may retry
          if (tok !== outfitTok || !alive) return false;     // superseded by a newer call
          outfit = { id, im }; draw(); return true;
        }, () => false);
      },
      outfits: () => ["default"].concat(rig && Array.isArray(rig.outfits) ? rig.outfits : []),
      setFraming(m) { st.framing = m; resize(); },
      pause(p) { st.paused = !!p; redraw(); },
      // dev overrides (null = automatic)
      setHeadAngle(deg) { st.manualHead = deg; redraw(); },
      setHairAngles(l, r) { st.manualHair = l == null ? null : [l, r]; redraw(); },
      setGazeManual(x, y) { st.manualGaze = x == null ? null : [x, y]; redraw(); },
      setBreathManual(v) { st.manualBreath = v; redraw(); },   // 0 = rest, 1 = full inhale, 2.2 = sigh peak
      setLayerVisible(name, on) { st.hidden[name] = !on; draw(); },
      reset() {
        Object.assign(st, { eyes: "neutral", mouth: "closed", brows: { dy: 0, rot: 0 }, blinking: false,
          manualHead: null, manualHair: null, manualGaze: null, manualBreath: null, gazeTarget: [0, 0] });
        [st.tilt, st.hop, st.nod, st.hairL, st.hairR, st.hairF, st.gx, st.gy, st.lx, st.ly, st.browY, st.browR]
          .forEach(sp => { sp.x = sp.v = sp.target = 0; });
        Object.assign(st.br, { phase: 0, rate: 1, rateT: 1, depth: 1, depthT: 1, sigh: 0 });
        st.breathV = 0; redraw();
      },
      resize, draw,
      layers: () => (rig ? rig.drawOrder.map(base) : []),
      state: () => ({ eyes: st.blinking && st.eyes === "neutral" ? "closed" : st.eyes, mouth: st.mouth, outfit: outfit.id,
        headDeg: st.headDeg || 0, hairL: st.hairL.x, hairR: st.hairR.x, breath: st.breathV, gaze: [st.gx.x, st.gy.x], look: [st.lx.x, st.ly.x], brows: { ...st.brows } }),
      destroy() { alive = false; if (raf) cancelAnimationFrame(raf); raf = 0; },
    };
  }

  window.ApprenticeRig = { create, FRAMING, EYES, MOUTHS };
})();
