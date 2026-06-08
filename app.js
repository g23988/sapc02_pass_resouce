/* Multi-exam AWS quiz — vanilla JS, no backend.
   Data: window.EXAM_DATA[CURRENT_EXAM] (data/<id>.js) · window.EXAMS (manifest.js) */
"use strict";

const EXAM_ID = window.CURRENT_EXAM;
const EXAMS = window.EXAMS || [];
const EXAM_META = EXAMS.find(e => e.id === EXAM_ID) || {};
const Q = (((window.EXAM_DATA || {})[EXAM_ID]) || window.QUESTIONS || []).slice().sort((a, b) => a.id - b.id);
const BY_ID = Object.fromEntries(Q.map(q => [q.id, q]));
const ALL_TAGS = [...new Set(Q.flatMap(q => q.tags))].sort();
const PASS = EXAM_META.pass_pct || 75; // AWS pro passing ≈ 750/1000

/* ---------- persistence (progress/fav per-exam; settings shared) ---------- */
const LS = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(EXAM_ID + "_" + k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(EXAM_ID + "_" + k, JSON.stringify(v)); } catch {} },
};
const GLS = {
  get(k, d) { try { return JSON.parse(localStorage.getItem("app_" + k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem("app_" + k, JSON.stringify(v)); } catch {} },
};
let progress = LS.get("progress", {});      // id -> {choice:[...], correct:bool}
let fav = new Set(LS.get("fav", []));        // ids
const settings = GLS.get("settings", { lang: "both", theme: "light" });

const saveProgress = () => LS.set("progress", progress);
const saveFav = () => LS.set("fav", [...fav]);
const saveSettings = () => GLS.set("settings", settings);

/* ---------- state ---------- */
const state = {
  mode: "practice",
  filtered: [], curIdx: 0,
  scope: "all", tag: null, search: "", minDiff: 0,
  selection: [], graded: false,
  exam: null,
};

/* ---------- helpers ---------- */
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = s => (s || "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const letters = q => Object.keys(q.options_en).sort();
const setEq = (a, b) => a.length === b.length && [...a].sort().join("") === [...b].sort().join("");
function shuffle(arr) { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
let toastT;
function toast(msg) { const t = $("#toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("show"), 1600); }

/* ---------- rendering pieces ---------- */
function qText(q) {
  const en = `<span class="en">${esc(q.question_en)}</span>`;
  const zh = q.question_zh ? `<span class="zh">${esc(q.question_zh)}</span>` : `<span class="zh nozh">（本題無中文翻譯）</span>`;
  if (settings.lang === "en") return en;
  if (settings.lang === "zh") return q.question_zh ? `<span class="en">${esc(q.question_zh)}</span>` : en + zh;
  return en + zh;
}
function optInner(q, L) {
  const en = q.options_en[L] || "";
  const zh = (q.options_zh && q.options_zh[L]) || "";
  const code = (() => {
    const i = en.indexOf("\n{");
    return i >= 0 ? en.slice(i + 1) : "";
  })();
  if (settings.lang === "en") return `<div class="opt-en">${esc(en)}</div>`;
  if (settings.lang === "zh") return `<div class="opt-en">${esc(zh ? (code && !zh.includes("\n{") ? zh + "\n" + code : zh) : en)}</div>`;
  return `<div class="opt-en">${esc(en)}</div>` + (zh ? `<span class="opt-zh">${esc(zh)}</span>` : "");
}
function optionsHTML(q, selected, graded) {
  const ans = q.answer;
  return `<div class="options${graded ? " graded" : ""}">` + letters(q).map((L, i) => {
    const sel = selected.includes(L);
    let cls = "opt", tick = "";
    if (sel) cls += " selected";
    if (graded) {
      if (ans.includes(L)) { cls = "opt correct"; tick = `<span class="tick">✓</span>`; }
      else if (sel) { cls = "opt incorrect"; tick = `<span class="tick">✕</span>`; }
    }
    return `<div class="${cls}" data-letter="${L}">
      <div class="mark">${L}</div>
      <div class="opt-body">${optInner(q, L)}</div>${tick}
    </div>`;
  }).join("") + `</div>`;
}
function voteHTML(q) {
  const entries = Object.entries(q.vote || {});
  if (!entries.length) return "";
  entries.sort((a, b) => b[1] - a[1]);
  const top = entries[0][0];
  const rows = entries.map(([k, p]) =>
    `<div class="vote-row"><span class="vote-key">${esc(k)}</span>
       <span class="vote-bar"><span class="vote-fill${k === top ? " top" : ""}" style="width:${p}%"></span></span>
       <span class="vote-pct">${p}%</span></div>`).join("");
  return `<div class="vote-title">社群投票分布 (Community vote)</div>${rows}`;
}
function biText(en, zh) {
  if (settings.lang === "en") return `<div class="r-en">${esc(en)}</div>`;
  if (settings.lang === "zh") return `<div class="r-en">${esc(zh || en)}</div>`;
  return `<div class="r-en">${esc(en)}</div>` + (zh ? `<div class="r-zh">${esc(zh)}</div>` : "");
}
const CONF_ZH = { high: "高信心", medium: "中等信心", low: "低信心" };
function researchHTML(q) {
  const r = q.research;
  if (!r || !r.verdict || !r.verdict.length) return "";
  const verdict = r.verdict.slice().sort().join(", ");
  const matchMarked = setEq(r.verdict, q.answer);
  const mismatch = matchMarked ? "" :
    `<div class="r-warn">⚠️ 題庫標準答案（${esc(q.answer.join(", "))}）與 AWS 官方文件不符。本題請以 <b>${esc(verdict)}</b> 為準。</div>`;
  const distract = (r.distractors || []).length
    ? `<div class="r-sub">各選項辨析 (Why the others are wrong)</div>` +
      r.distractors.map(d =>
        `<div class="r-distract"><span class="r-dl">${esc(d.letter)}</span><div class="r-dbody">${biText(d.why_en, d.why_zh)}</div></div>`
      ).join("")
    : "";
  const sources = (r.sources || []).length
    ? `<div class="r-sub">AWS 官方文件來源</div><ul class="r-src">` +
      r.sources.map(u => `<li><a href="${esc(u)}" target="_blank" rel="noopener">${esc(u)}</a></li>`).join("") +
      `</ul>`
    : "";
  return `<div class="research">
    <div class="r-title">🔎 AWS 文件查證解析
      <span class="r-conf r-${esc(r.confidence)}">${esc(CONF_ZH[r.confidence] || r.confidence)}</span></div>
    <div class="r-verdict">經 AWS 官方文件查證的正解：<b>${esc(verdict)}</b></div>
    ${mismatch}
    <div class="r-expl">${biText(r.explanation_en, r.explanation_zh)}</div>
    ${distract}
    ${sources}
  </div>`;
}
function feedbackHTML(q, selected) {
  const correct = setEq(selected, q.answer);
  const ans = q.answer.join(", ");
  const voteEntries = Object.entries(q.vote || {}).sort((a, b) => b[1] - a[1]);
  const topVote = voteEntries.length ? voteEntries[0][0] : null;
  const diff = topVote && topVote.split("").sort().join("") !== q.answer.join("");
  return `<div class="feedback">
    <div class="fb-line ${correct ? "ok" : "no"}">${correct ? "✓ 答對！" : "✕ 答錯"}
      <span class="fb-ans">標準答案：${esc(ans)}</span></div>
    ${voteHTML(q)}
    ${diff ? `<div class="note">⚠️ 社群最高票為 <b>${esc(topVote)}</b>，與標準答案 <b>${esc(ans)}</b> 不同。這類題目答案有爭議，建議兩者都理解。</div>` : ""}
    ${researchHTML(q)}
  </div>`;
}
function starsHTML(q) {
  const n = q.difficulty || 0;
  if (!n) return "";
  return `<span class="q-diff d${n}" title="難度 ${n}/5${q.diff_why ? "：" + esc(q.diff_why) : ""}">${"★".repeat(n)}${"☆".repeat(5 - n)}</span>`;
}
function headHTML(q, favOn) {
  const badge = q.multi
    ? `<span class="q-badge multi">複選 · 選 ${q.answer.length} 個</span>`
    : `<span class="q-badge">單選</span>`;
  const tags = q.tags.map(t => `<span class="q-tag">${esc(t)}</span>`).join("");
  return `<div class="q-head">
    <span class="q-num">#${q.id}</span>${badge}${starsHTML(q)}
    <div class="q-tags">${tags}</div>
    <button class="fav-btn ${favOn ? "on" : ""}" id="favBtn" title="收藏 (F)">★</button>
  </div>`;
}

/* ================= PRACTICE ================= */
function applyFilter() {
  const s = state.search.trim().toLowerCase();
  state.filtered = Q.filter(q => {
    if (state.scope === "unanswered" && progress[q.id]) return false;
    if (state.scope === "wrong" && !(progress[q.id] && !progress[q.id].correct)) return false;
    if (state.scope === "fav" && !fav.has(q.id)) return false;
    if (state.minDiff && (q.difficulty || 0) < state.minDiff) return false;
    if (state.tag && !q.tags.includes(state.tag)) return false;
    if (s) {
      const hay = (q.question_en + " " + q.question_zh + " " +
        Object.values(q.options_en).join(" ") + " " + Object.values(q.options_zh || {}).join(" ")).toLowerCase();
      if (!hay.includes(s)) return false;
    }
    return true;
  });
}
function renderPractice(keepId) {
  applyFilter();
  // keep position on the same question if still visible
  if (keepId != null) {
    const i = state.filtered.findIndex(q => q.id === keepId);
    state.curIdx = i >= 0 ? i : 0;
  }
  if (state.curIdx >= state.filtered.length) state.curIdx = 0;
  $("#listCount").textContent = state.filtered.length;
  renderTagChips();
  renderNav();
  renderPracticeCard();
}
function renderTagChips() {
  $("#tagChips").innerHTML =
    `<span class="chip ${!state.tag ? "active" : ""}" data-tag="">全部</span>` +
    ALL_TAGS.map(t => `<span class="chip ${state.tag === t ? "active" : ""}" data-tag="${esc(t)}">${esc(t)}</span>`).join("");
}
function renderNav() {
  const cur = state.filtered[state.curIdx];
  $("#qNav").innerHTML = state.filtered.map((q, i) => {
    let c = "";
    const p = progress[q.id];
    if (p) c = p.correct ? "correct" : "wrong";
    if (cur && q.id === cur.id) c += " current";
    if (fav.has(q.id)) c += " fav";
    return `<button class="${c}" data-idx="${i}">${q.id}</button>`;
  }).join("");
  const cb = $("#qNav .current");
  if (cb && cb.scrollIntoView) cb.scrollIntoView({ block: "nearest" });
}
function renderPracticeCard() {
  const card = $("#practiceCard");
  if (!state.filtered.length) {
    card.innerHTML = `<div class="empty">這個範圍沒有題目 🎉<br><span class="muted">換個篩選條件，或繼續加油刷題。</span></div>`;
    $("#submitBtn").disabled = $("#prevBtn").disabled = $("#nextBtn").disabled = true;
    $("#retryBtn").classList.add("hidden");
    return;
  }
  $("#prevBtn").disabled = state.curIdx === 0;
  $("#nextBtn").disabled = state.curIdx === state.filtered.length - 1;
  const q = state.filtered[state.curIdx];
  // restore prior answer if exists
  const prior = progress[q.id];
  if (!state.graded && prior) { state.selection = prior.choice.slice(); state.graded = true; }
  card.innerHTML = headHTML(q, fav.has(q.id)) +
    `<div class="q-text">${qText(q)}</div>` +
    optionsHTML(q, state.selection, state.graded) +
    (state.graded ? feedbackHTML(q, state.selection) : "");
  const sb = $("#submitBtn");
  sb.disabled = state.graded ? false : state.selection.length === 0;
  sb.textContent = state.graded ? "下一題 (Enter)" : "送出 (Enter)";
  $("#retryBtn").classList.toggle("hidden", !state.graded);
}
function practiceSelect(L) {
  if (state.graded) return;
  const q = state.filtered[state.curIdx];
  if (q.multi) {
    const i = state.selection.indexOf(L);
    if (i >= 0) state.selection.splice(i, 1); else state.selection.push(L);
  } else {
    state.selection = [L];
  }
  renderPracticeCard();
}
function practiceSubmit() {
  if (!state.filtered.length) return;
  if (state.graded) { practiceNav(1); return; }
  if (!state.selection.length) return;
  const q = state.filtered[state.curIdx];
  const correct = setEq(state.selection, q.answer);
  progress[q.id] = { choice: state.selection.slice(), correct };
  saveProgress();
  state.graded = true;
  renderPracticeCard();
  renderNav();
}
function practiceRetry() {
  if (!state.filtered.length) return;
  const q = state.filtered[state.curIdx];
  delete progress[q.id];
  saveProgress();
  state.selection = [];
  state.graded = false;
  renderPracticeCard();
  renderNav();
}
function practiceNav(dir) {
  const ni = state.curIdx + dir;
  if (ni < 0 || ni >= state.filtered.length) return;
  state.curIdx = ni;
  state.selection = []; state.graded = false;
  renderPracticeCard();
  renderNav();
}
function toggleFav() {
  if (!state.filtered.length) return;
  const q = state.filtered[state.curIdx];
  if (fav.has(q.id)) { fav.delete(q.id); toast("已移除收藏"); }
  else { fav.add(q.id); toast("已加入收藏 ★"); }
  saveFav();
  const b = $("#favBtn"); if (b) b.classList.toggle("on", fav.has(q.id));
  renderNav();
}

/* ================= EXAM ================= */
function startExam() {
  const n = +$("#examCountSeg .active").dataset.n;
  const t = +$("#examTimeSeg .active").dataset.t;
  const pool = $("#examPoolSeg .active").dataset.pool;
  let src = Q;
  if (pool === "wrong") src = Q.filter(q => progress[q.id] && !progress[q.id].correct);
  if (!src.length) { toast("錯題本是空的，先去練習吧"); return; }
  const qs = shuffle(src).slice(0, Math.min(n, src.length));
  state.exam = { qs, answers: {}, pos: 0, durationSec: t * 60, endTime: t ? Date.now() + t * 60000 : 0, timerId: null };
  $("#examSetup").classList.add("hidden");
  $("#examResult").classList.add("hidden");
  $("#examRun").classList.remove("hidden");
  $("#examTotal").textContent = qs.length;
  if (t) { state.exam.timerId = setInterval(tickExam, 1000); tickExam(); }
  else { $("#examTimer").textContent = "∞"; }
  renderExamCard();
}
function tickExam() {
  const e = state.exam; if (!e || !e.durationSec) return;
  let left = Math.max(0, Math.round((e.endTime - Date.now()) / 1000));
  const h = Math.floor(left / 3600), m = Math.floor((left % 3600) / 60), s = left % 60;
  const el = $("#examTimer");
  el.textContent = (h ? h + ":" : "") + String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
  el.classList.toggle("danger", left <= 300);
  if (left <= 0) { toast("時間到，自動交卷"); submitExam(); }
}
function renderExamCard() {
  const e = state.exam, q = e.qs[e.pos];
  const sel = e.answers[q.id] || [];
  $("#examPos").textContent = e.pos + 1;
  const done = Object.keys(e.answers).filter(id => e.answers[id].length).length;
  $("#examAnswered").textContent = `· 已作答 ${done}/${e.qs.length}`;
  $("#examCard").innerHTML = headHTML(q, fav.has(q.id)) +
    `<div class="q-text">${qText(q)}</div>` + optionsHTML(q, sel, false);
  $("#examPrevBtn").disabled = e.pos === 0;
  $("#examNextBtn").disabled = e.pos === e.qs.length - 1;
  $("#examDots").innerHTML = e.qs.map((qq, i) =>
    `<button class="${(e.answers[qq.id] && e.answers[qq.id].length) ? "done" : ""}${i === e.pos ? " current" : ""}" data-pos="${i}">${i + 1}</button>`).join("");
}
function examSelect(L) {
  const e = state.exam, q = e.qs[e.pos];
  let sel = e.answers[q.id] || [];
  if (q.multi) { const i = sel.indexOf(L); if (i >= 0) sel.splice(i, 1); else sel.push(L); }
  else sel = [L];
  e.answers[q.id] = sel;
  renderExamCard();
}
function examNav(dir) {
  const e = state.exam, ni = e.pos + dir;
  if (ni < 0 || ni >= e.qs.length) return;
  e.pos = ni; renderExamCard();
}
function submitExam() {
  const e = state.exam; if (!e) return;
  if (e.timerId) clearInterval(e.timerId);
  let correct = 0;
  e.qs.forEach(q => {
    const sel = e.answers[q.id] || [];
    const ok = setEq(sel, q.answer);
    if (ok) correct++;
    if (sel.length) progress[q.id] = { choice: sel.slice(), correct: ok }; // feed mistake book / stats
  });
  saveProgress();
  const pct = Math.round((correct / e.qs.length) * 100);
  renderExamResult(correct, pct);
  state.exam._graded = e; // keep for review
}
function renderExamResult(correct, pct) {
  const e = state.exam, total = e.qs.length, pass = pct >= PASS;
  $("#examRun").classList.add("hidden");
  const res = $("#examResult"); res.classList.remove("hidden");
  res.innerHTML = `<div class="score-card">
      <div class="score-big ${pass ? "pass" : "fail"}">${pct}%</div>
      <div class="score-sub">答對 ${correct} / ${total} 題　·　${pass ? "✓ 達標 (≥75%)" : "未達標 (需 ≥75%)"}</div>
      <div class="card-controls">
        <button class="btn" id="examAgainBtn">再考一次</button>
        <button class="btn ghost" id="reviewAllBtn">看全部詳解</button>
        <button class="btn ghost" id="reviewWrongBtn">只看錯題</button>
      </div>
    </div><div id="reviewList"></div>`;
  $("#examAgainBtn").onclick = () => { $("#examResult").classList.add("hidden"); $("#examSetup").classList.remove("hidden"); };
  $("#reviewAllBtn").onclick = () => renderReview(false);
  $("#reviewWrongBtn").onclick = () => renderReview(true);
  renderReview(true);
}
function renderReview(wrongOnly) {
  const e = state.exam;
  const list = e.qs.filter(q => !wrongOnly || !setEq(e.answers[q.id] || [], q.answer));
  const html = list.length ? list.map(q => {
    const sel = e.answers[q.id] || [];
    return `<div class="card review-item">${headHTML(q, fav.has(q.id))}
      <div class="q-text">${qText(q)}</div>${optionsHTML(q, sel, true)}${feedbackHTML(q, sel)}</div>`;
  }).join("") : `<div class="empty">全對，沒有錯題 🎉</div>`;
  $("#reviewList").innerHTML = `<h3 style="margin:24px 4px 4px">${wrongOnly ? "錯題詳解" : "全部詳解"}（${list.length}）</h3>` + html;
}

/* ================= STATS ================= */
function renderStats() {
  const ids = Object.keys(progress);
  const answered = ids.length;
  const correct = ids.filter(id => progress[id].correct).length;
  const wrong = answered - correct;
  const acc = answered ? Math.round((correct / answered) * 100) : 0;
  const cards = [
    ["已作答", `${answered}<span class="muted" style="font-size:18px"> / ${Q.length}</span>`],
    ["正確率", `${acc}%`],
    ["答對", correct], ["答錯", wrong], ["收藏", fav.size],
  ].map(([l, v]) => `<div class="stat-card"><div class="stat-num">${v}</div><div class="lbl">${l}</div></div>`).join("");

  // per-tag accuracy
  const rows = ALL_TAGS.map(tag => {
    const qs = Q.filter(q => q.tags.includes(tag));
    const done = qs.filter(q => progress[q.id]);
    const ok = done.filter(q => progress[q.id].correct).length;
    const a = done.length ? Math.round((ok / done.length) * 100) : 0;
    return { tag, a, done: done.length, total: qs.length };
  }).sort((x, y) => y.done - x.done);
  const bars = rows.map(r => `<div class="bar-row">
      <span class="bar-name">${esc(r.tag)}</span>
      <span class="bar-track"><span class="bar-acc" style="width:${r.done ? r.a : 0}%"></span></span>
      <span class="bar-meta">${r.done ? r.a + "%" : "—"} (${r.done}/${r.total})</span>
    </div>`).join("");

  $("#statsBody").innerHTML = `
    <div class="stat-cards">${cards}</div>
    <div class="panel"><h3>各分類正確率</h3>${bars}</div>
    <div class="panel"><h3>資料管理</h3>
      <p class="muted">進度與收藏都存在這台瀏覽器（localStorage），不會上傳。</p>
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <button class="btn warn" id="resetBtn">清除所有進度</button>
        <button class="btn ghost" id="resetFavBtn">清除收藏</button>
      </div>
    </div>`;
  $("#resetBtn").onclick = () => { if (confirm("確定清除所有作答進度與錯題本？此動作無法復原。")) { progress = {}; saveProgress(); renderStats(); toast("進度已清除"); } };
  $("#resetFavBtn").onclick = () => { if (confirm("確定清除所有收藏？")) { fav = new Set(); saveFav(); renderStats(); toast("收藏已清除"); } };
}

/* ================= mode / chrome ================= */
function switchMode(m) {
  state.mode = m;
  $$("#tabs .tab").forEach(b => b.classList.toggle("active", b.dataset.mode === m));
  $("#practiceView").classList.toggle("hidden", m !== "practice");
  $("#examView").classList.toggle("hidden", m !== "exam");
  $("#statsView").classList.toggle("hidden", m !== "stats");
  if (m === "practice") renderPractice(state.filtered[state.curIdx]?.id);
  if (m === "stats") renderStats();
  if (m === "exam" && !state.exam) { $("#examSetup").classList.remove("hidden"); $("#examRun").classList.add("hidden"); $("#examResult").classList.add("hidden"); }
}
function setLang(l) {
  settings.lang = l; saveSettings();
  $$("#langSeg button").forEach(b => b.classList.toggle("active", b.dataset.lang === l));
  if (state.mode === "practice") renderPracticeCard();
  else if (state.mode === "exam") {
    if (!$("#examRun").classList.contains("hidden")) renderExamCard();
    else if (!$("#examResult").classList.contains("hidden")) renderReview(false);
  }
}
function cycleLang() { const o = ["both", "en", "zh"]; setLang(o[(o.indexOf(settings.lang) + 1) % 3]); }
function setTheme(t) { settings.theme = t; saveSettings(); document.documentElement.setAttribute("data-theme", t); }
function initExamPicker() {
  const sel = $("#examSel");
  if (sel) {
    sel.innerHTML = EXAMS.map(e =>
      `<option value="${esc(e.id)}">${esc(e.short)}（${e.count} 題${e.researched ? "・查證 " + e.researched : ""}）</option>`).join("");
    sel.value = EXAM_ID;
    sel.onchange = () => { localStorage.setItem("current_exam", sel.value); location.reload(); };
  }
  const m = EXAM_META;
  const title = (m.short || "AWS") + " 刷題";
  const bt = $(".brand-title"); if (bt) bt.textContent = title;
  const bs = $(".brand-sub"); if (bs) bs.textContent = (m.sub_zh ? m.sub_zh + " · " : "") + Q.length + " 題";
  document.title = title + (m.name_en ? " · " + m.name_en : "");
}

/* ================= keyboard ================= */
document.addEventListener("keydown", e => {
  if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") {
    if (e.key === "Escape") e.target.blur();
    return;
  }
  const k = e.key.toLowerCase();
  if (k === "l") { cycleLang(); return; }
  if (state.mode === "practice") {
    const q = state.filtered[state.curIdx];
    if (!q) return;
    if (/^[1-9]$/.test(e.key)) { const L = letters(q)[+e.key - 1]; if (L) practiceSelect(L); }
    else if (e.key === "Enter") { e.preventDefault(); practiceSubmit(); }
    else if (e.key === "ArrowLeft") practiceNav(-1);
    else if (e.key === "ArrowRight") practiceNav(1);
    else if (k === "f") toggleFav();
  } else if (state.mode === "exam" && !$("#examRun").classList.contains("hidden")) {
    const q = state.exam.qs[state.exam.pos];
    if (/^[1-9]$/.test(e.key)) { const L = letters(q)[+e.key - 1]; if (L) examSelect(L); }
    else if (e.key === "ArrowLeft") examNav(-1);
    else if (e.key === "ArrowRight" || e.key === "Enter") examNav(1);
  }
});

/* ================= wiring ================= */
function init() {
  initExamPicker();
  setTheme(settings.theme);
  setLang(settings.lang);

  $("#tabs").addEventListener("click", e => { const b = e.target.closest(".tab"); if (b) switchMode(b.dataset.mode); });
  $("#themeBtn").onclick = () => setTheme(settings.theme === "dark" ? "light" : "dark");
  $("#langSeg").addEventListener("click", e => { const b = e.target.closest("button"); if (b) setLang(b.dataset.lang); });

  // practice controls
  $("#practiceCard").addEventListener("click", e => {
    const fb = e.target.closest("#favBtn"); if (fb) { toggleFav(); return; }
    const op = e.target.closest(".opt"); if (op && !state.graded) practiceSelect(op.dataset.letter);
  });
  $("#submitBtn").onclick = practiceSubmit;
  $("#retryBtn").onclick = practiceRetry;
  $("#prevBtn").onclick = () => practiceNav(-1);
  $("#nextBtn").onclick = () => practiceNav(1);
  $("#scopeSeg").addEventListener("click", e => { const b = e.target.closest("button"); if (!b) return; $$("#scopeSeg button").forEach(x => x.classList.toggle("active", x === b)); state.scope = b.dataset.scope; state.selection = []; state.graded = false; renderPractice(); });
  $("#tagChips").addEventListener("click", e => { const c = e.target.closest(".chip"); if (!c) return; state.tag = c.dataset.tag || null; state.selection = []; state.graded = false; renderPractice(); });
  $("#diffSeg").addEventListener("click", e => { const b = e.target.closest("button"); if (!b) return; $$("#diffSeg button").forEach(x => x.classList.toggle("active", x === b)); state.minDiff = +b.dataset.mindiff; state.selection = []; state.graded = false; renderPractice(); });
  $("#qNav").addEventListener("click", e => { const b = e.target.closest("button"); if (!b) return; state.curIdx = +b.dataset.idx; state.selection = []; state.graded = false; renderPracticeCard(); renderNav(); });
  let st;
  $("#searchBox").addEventListener("input", e => { clearTimeout(st); st = setTimeout(() => { state.search = e.target.value; renderPractice(); }, 180); });

  // exam controls
  ["examCountSeg", "examTimeSeg", "examPoolSeg"].forEach(id =>
    $("#" + id).addEventListener("click", e => { const b = e.target.closest("button"); if (!b) return; $$("#" + id + " button").forEach(x => x.classList.toggle("active", x === b)); }));
  $("#startExamBtn").onclick = startExam;
  $("#submitExamBtn").onclick = () => { if (confirm("確定交卷？")) submitExam(); };
  $("#examPrevBtn").onclick = () => examNav(-1);
  $("#examNextBtn").onclick = () => examNav(1);
  $("#examCard").addEventListener("click", e => { const fb = e.target.closest("#favBtn"); if (fb) { toggleFav(); renderExamCard(); return; } const op = e.target.closest(".opt"); if (op) examSelect(op.dataset.letter); });
  $("#examDots").addEventListener("click", e => { const b = e.target.closest("button"); if (b) { state.exam.pos = +b.dataset.pos; renderExamCard(); } });

  switchMode("practice");
}
if (!Q.length) document.body.innerHTML = '<p style="padding:40px;font-family:sans-serif">⚠️ 找不到題庫資料。請先執行 <code>python3 lib/parse_pdf.py &lt;exam_id&gt;</code>。</p>';
else init();
