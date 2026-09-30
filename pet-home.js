/* Home is opened from the original pet. No permanent extra toolbar or currency. */
(() => {
  'use strict';
  const M = window.CloudletHomeModel, KEY = 'app_pet_home';
  let dialog, state, issue = '', writeFailed = false, actorTimer, wanderTimer, bodyOverflow;
  const writeError = '家園進度未能儲存。請確認瀏覽器有可用空間，再試一次。';
  const on = () => { try { return localStorage.getItem('app_pet_enabled') !== '0'; } catch { return false; } };
  function load() {
    issue = writeFailed ? writeError : '';
    try { state = M.read(localStorage.getItem(KEY)); return true; }
    catch { issue = '家園存檔暫時無法讀取，請重新整理後再試。'; state = null; return false; }
  }
  function commit(next) {
    try { localStorage.setItem(KEY, JSON.stringify(next)); state = next; issue = ''; writeFailed = false; return true; }
    catch { issue = writeError; writeFailed = true; return false; }
  }
  const art = {
    house: '<path d="M22 48V88H92V48" fill="#f6ead2"/><path d="M13 49L57 14L102 49" fill="#d6a288"/><path d="M46 88V61H67V88" fill="#bd997b"/><rect x="29" y="57" width="11" height="13" rx="2" fill="#fffdf4"/><path d="M72 57h12v13H72z" fill="#fffdf4"/>',
    garden: '<ellipse cx="57" cy="81" rx="45" ry="13" fill="#cfddb6"/><path d="M32 80V49M57 82V39M81 78V52" stroke="#789770" stroke-width="3"/><path d="M32 66q-16-14-17-4q3 12 17 10M57 65q15-16 19-7q-1 12-19 13M81 66q-14-11-15-3q3 9 15 9" fill="#8bac7d"/><g fill="#dca6a1"><circle cx="32" cy="43" r="10"/><circle cx="57" cy="34" r="11"/><circle cx="81" cy="47" r="9"/></g><g fill="#fff0b4"><circle cx="32" cy="43" r="4"/><circle cx="57" cy="34" r="4"/><circle cx="81" cy="47" r="3"/></g>',
    tree: '<ellipse cx="58" cy="87" rx="38" ry="8" fill="#cbd9b5"/><path d="M54 87V44h9v43" fill="#af9371"/><path d="M58 65L41 50M59 57L75 40" stroke="#af9371" stroke-width="5"/><g fill="#9eb88a"><circle cx="40" cy="37" r="24"/><circle cx="70" cy="32" r="27"/><circle cx="60" cy="18" r="17"/></g>'
  };
  const picture = id => `<svg viewBox="0 0 114 100" aria-hidden="true">${art[id]}</svg>`;
  function label() {
    load();
    return stateLabel();
  }
  function stateLabel() {
    if (!state) return '家園 · 存檔待確認';
    if (issue) return '家園 · 儲存待確認';
    if (state.latest) return `家園 · ${M.byId(state.latest).name}完成了`;
    if (state.active) return `家園 · ${M.byId(state.active.id).name} ${state.active.progress}/${M.byId(state.active.id).need}`;
    return '雲寶家園';
  }
  function updateEntry() {
    const b = document.getElementById('petHomeBtn');
    if (b) b.textContent = issue ? '家園 · 存檔待確認' : stateLabel();
  }
  function close() { if (dialog?.open) dialog.close(); }
  function open() {
    if (!on() || dialog?.open) return;
    load();
    if (!dialog) {
      dialog = document.createElement('dialog'); dialog.id = 'petHome';
      dialog.setAttribute('aria-labelledby', 'homeTitle');
      dialog.innerHTML = '<header class="home-header"><div><h2 id="homeTitle">雲寶家園</h2><p>一起學習，慢慢有個家。</p></div><button type="button" data-close aria-label="收起家園" autofocus>×</button></header><div class="home-content"></div><footer><button type="button" data-close>回去刷題</button></footer>';
      dialog.addEventListener('keydown', e => e.stopPropagation());
      dialog.addEventListener('click', e => {
        if (e.target.closest('[data-close]')) close();
        const choice = e.target.closest('[data-project]');
        if (choice && load()) {
          commit(M.choose(state, choice.dataset.project)); render();
          dialog.querySelector('[data-close]').focus(); updateEntry();
        }
        const visit = e.target.closest('[data-visit]');
        if (visit) interact(visit.dataset.visit);
        if (e.target === dialog) {
          const r = dialog.getBoundingClientRect();
          if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) close();
        }
      });
      dialog.addEventListener('close', () => {
        clearTimeout(actorTimer); clearInterval(wanderTimer);
        document.body.style.overflow = bodyOverflow;
        document.dispatchEvent(new CustomEvent('pet:homeClosed'));
        document.getElementById('pet')?.focus({ preventScroll: true });
      });
      document.body.appendChild(dialog);
    }
    render(); bodyOverflow = document.body.style.overflow; document.body.style.overflow = 'hidden'; dialog.showModal();
    document.dispatchEvent(new CustomEvent('pet:homeOpened'));
    if (state?.latest) {
      interact(state.latest);
      if (!commit({ ...state, latest: null })) render();
      updateEntry();
    }
    wanderTimer = setInterval(() => {
      if (state?.built.length) interact(state.built[Math.floor(Math.random() * state.built.length)]);
    }, 12000);
  }
  function render() {
    if (!dialog) return;
    clearTimeout(actorTimer);
    const content = dialog.querySelector('.home-content');
    if (!state) { content.innerHTML = `<p role="alert">${issue}</p>`; return; }
    const p = state.active && M.byId(state.active.id);
    content.innerHTML = `<div class="home-scene" aria-label="雲寶的小天地">
      <div class="home-ground"></div>
      ${M.projects.map(item => state.built.includes(item.id)
        ? `<button type="button" class="home-building home-${item.id}" data-visit="${item.id}" aria-label="${item.action}">${picture(item.id)}</button>`
        : p?.id === item.id ? `<div class="home-building home-${item.id} home-building-pending" aria-hidden="true">${picture(item.id)}<span>慢慢建造中</span></div>` : '').join('')}
      <div class="home-actor" aria-hidden="true"></div>
      </div><p class="home-story" role="status">${state.latest ? `${M.byId(state.latest).name}完成了，陪雲寶看看新地方。` : state.built.length ? '點點家裡的設施，陪雲寶待一會兒。' : '這塊小小的草地，從你選的第一個地方開始。'}</p>
      ${issue ? `<p class="home-error" role="alert">${issue}</p>` : ''}
      ${p ? `<section class="home-progress"><div><strong>正在準備${p.name}</strong><span>${state.active.progress} / ${p.need} 題</span></div><progress value="${state.active.progress}" max="${p.need}" aria-label="${p.name}建設進度"></progress><p>再答對 ${p.need - state.active.progress} 題，就能${p.id === 'house' ? '住進小屋' : p.id === 'garden' ? '一起澆花' : '在樹下乘涼'}。</p></section>`
      : state.built.length === M.projects.length ? '<p class="home-finished">小屋、花園、樹蔭，都在這裡了。<br>今天也可以只是回家坐坐。</p>'
      : `<section class="home-choices"><h3>${state.built.length ? '接下來，想替家裡添什麼？' : '先替雲寶準備什麼？'}</h3>${M.projects.filter(item => !state.built.includes(item.id)).map(item => `<button type="button" data-project="${item.id}">${picture(item.id)}<span><strong>${item.name}</strong><small>${item.description}</small></span><span class="home-cost">${item.need} 題</span></button>`).join('')}</section>`}
      ${state.built.length < M.projects.length ? '<p class="home-note">選好後，練習與模擬考答對都會自動累積。<br>同一科同一題，每天計入一次；進度會一直保留。</p>' : ''}`;
    syncCompanion();
  }
  function syncCompanion() {
    const actor = dialog?.querySelector('.home-actor');
    if (!actor) return;
    const view = window.CloudletPet?.appearance();
    actor.innerHTML = view ? `<div class="home-companion ${view.className}">${view.html}</div><span class="home-action-mark"></span>` : '☁';
    if (!view) return;
    const worn = actor.querySelector('.pet-worn');
    for (const a of view.worn) {
      const span = document.createElement('span');
      span.className = `worn wslot-${a.slot}`; span.dataset.accessory = a.id; span.textContent = a.e;
      worn.appendChild(span);
    }
    actor.dataset.stage = view.stage;
    actor.dataset.side = view.worn.find(a => a.slot === 'side')?.id || '';
    if (dialog.open && actor.dataset.place) interact(actor.dataset.place);
  }
  function interact(id) {
    if (!dialog?.open || !state?.built.includes(id)) return;
    const actor = dialog.querySelector('.home-actor');
    const action = M.activity(id, actor.dataset.side, Number(actor.dataset.stage));
    clearTimeout(actorTimer);
    actor.dataset.place = id; actor.classList.remove('home-acting');
    actor.dataset.activity = action.kind;
    dialog.querySelector('.home-story').textContent = action.line;
    actorTimer = setTimeout(() => {
      if (!dialog.open) return;
      actor.classList.add('home-acting');
      const mark = actor.querySelector('.home-action-mark');
      if (mark) mark.textContent = action.mark;
    }, 700);
  }
  function study(answers) {
    if (!on()) return;
    if (!load()) { updateEntry(); if (dialog?.open) render(); return; }
    const next = M.credit(state, answers, M.localDay());
    if (next === state) return;
    const completed = next.latest && next.latest !== state.latest;
    const stored = commit(next);
    updateEntry();
    if (dialog?.open) render();
    if (stored && completed) document.dispatchEvent(new CustomEvent('pet:homeBuilt', { detail: { name: M.byId(next.latest).name } }));
  }
  document.addEventListener('quiz:answered', e => study([e.detail || {}]));
  document.addEventListener('quiz:examDone', e => study((e.detail?.answers || []).map(a => ({ ...a, exam: e.detail.exam }))));
  document.addEventListener('pet:toggled', e => { if (!e.detail?.on) close(); });
  document.addEventListener('quiz:examStart', close);
  document.addEventListener('pet:appearanceChanged', () => { if (dialog?.open) syncCompanion(); });
  window.addEventListener('storage', e => {
    if (e.key === KEY) { load(); updateEntry(); if (dialog?.open) render(); }
    if (e.key === 'app_pet_enabled' && !on()) close();
  });
  window.CloudletHome = { open, label };
})();
