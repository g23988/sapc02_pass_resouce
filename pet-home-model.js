/* Small, independent home save. Never modifies app_pet or quiz progress. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CloudletHomeModel = api;
})(typeof window === 'object' ? window : this, function () {
  'use strict';
  const projects = [
    { id: 'house', name: '小屋', need: 5, description: '有個安心睡覺的地方。', action: '回小屋休息', line: '窩進小屋，打個舒服的哈欠。' },
    { id: 'garden', name: '小花園', need: 8, description: '每天來看看，一起照顧花。', action: '陪雲寶澆花', line: '一點水、一點陽光，花兒慢慢長大。' },
    { id: 'tree', name: '樹蔭', need: 12, description: '刷題累了，在樹下待一會兒。', action: '陪雲寶乘涼', line: '風吹過葉子，今天就在這裡歇一會兒。' }
  ];
  const byId = id => projects.find(p => p.id === id);
  const fresh = () => ({ ver: 1, active: null, built: [], day: '', credited: [], latest: null });
  function read(raw) {
    if (!raw) return fresh();
    const s = JSON.parse(raw);
    // Fail closed: unreadable or newer saves must not be silently replaced.
    if (!s || s.ver !== 1 || !Array.isArray(s.built) || !Array.isArray(s.credited) ||
        s.built.some(id => !byId(id)) || s.credited.some(id => typeof id !== 'string') ||
        typeof s.day !== 'string' || (s.latest !== null && !s.built.includes(s.latest))) throw Error('home save');
    if (s.active && (!byId(s.active.id) || s.built.includes(s.active.id) ||
        !Number.isInteger(s.active.progress) || s.active.progress < 0 ||
        s.active.progress >= byId(s.active.id).need)) throw Error('home project');
    return s;
  }
  function choose(s, id) {
    if (s.active || s.built.includes(id) || !byId(id)) return s;
    return { ...s, active: { id, progress: 0 }, latest: null };
  }
  function credit(s, answers, day) {
    if (!s.active) return s;
    const seen = new Set(s.day === day ? s.credited : []);
    let progress = s.active.progress;
    for (const a of answers) {
      if (a.correct !== true || typeof a.exam !== 'string' || !a.exam ||
          !['number', 'string'].includes(typeof a.qid) || String(a.qid) === '') continue;
      const key = JSON.stringify([a.exam, String(a.qid)]);
      if (seen.has(key)) continue;
      seen.add(key); progress++;
      if (progress === byId(s.active.id).need) break;
    }
    if (progress === s.active.progress) return s;
    const next = { ...s, day, credited: [...seen], active: { ...s.active, progress } };
    if (progress === byId(s.active.id).need) {
      next.built = [...s.built, s.active.id]; next.latest = s.active.id; next.active = null;
    }
    return next;
  }
  function localDay(date = new Date()) {
    return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
  }
  function activity(place, side, stage) {
    if (stage > 0) {
      if (place === 'tree' && side === 'book') return { kind: 'read', mark: '…', line: '帶著書坐到樹下，一頁一頁，慢慢讀。' };
      if (place === 'tree' && side === 'guitar') return { kind: 'music', mark: '♪', line: '抱著吉他，在樹下輕輕撥弦。' };
      if (place === 'garden' && side === 'umbrella') return { kind: 'stroll', mark: '· ·', line: '撐著小傘，陪你在花園裡慢慢散步。' };
    }
    return { kind: place === 'garden' ? 'water' : 'rest', mark: { house: 'z z', garden: '💧', tree: '♪' }[place], line: byId(place)?.line || '' };
  }
  return { projects, byId, fresh, read, choose, credit, localDay, activity };
});
