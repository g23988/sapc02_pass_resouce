const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const M = require('../pet-home-model.js');
const day = '2026-09-28';
const answer = (qid, exam = 'ca1', correct = true) => ({ qid, exam, correct });

test('one goal, no cost, completion is automatic and cannot be selected twice', () => {
  const s = M.choose(M.fresh(), 'house');
  assert.equal(M.choose(s, 'garden'), s);
  const done = M.credit(s, [1, 2, 3, 4, 5, 6].map(id => answer(id)), day);
  assert.deepEqual(done.built, ['house']); assert.equal(done.active, null);
  assert.equal(done.latest, 'house'); assert.equal(done.credited.length, 5);
  assert.equal(M.choose(done, 'house'), done);
  assert.deepEqual(M.choose(done, 'garden').active, { id: 'garden', progress: 0 });
});
test('daily dedup includes exam; mistakes can be corrected and repeats cannot farm', () => {
  let s = M.choose(M.fresh(), 'tree');
  s = M.credit(s, [answer(1, 'ca1', false), answer(1), answer('1'), answer(1, 'ca2')], day);
  assert.equal(s.active.progress, 2);
  assert.equal(M.credit(s, [answer(1)], day), s);
  s = M.credit(s, [answer(1)], '2026-09-29');
  assert.equal(s.active.progress, 3); assert.equal(s.credited.length, 1);
});
test('progress survives absence and reload; completed homes stay through next goal', () => {
  let s = M.credit(M.choose(M.fresh(), 'house'), [1, 2, 3, 4, 5].map(id => answer(id)), day);
  s = M.choose(M.read(JSON.stringify(s)), 'tree');
  s = M.credit(s, [answer(6)], '2027-01-03');
  assert.deepEqual(s.built, ['house']); assert.equal(s.active.progress, 1);
  assert.equal(s.latest, null);
});
test('bad event payloads never advance construction', () => {
  const s = M.choose(M.fresh(), 'house');
  assert.equal(M.credit(s, [{}, { correct: true, qid: 1 }, { correct: true, exam: 'a' }, answer(1, 'a', 'true')], day), s);
});
test('newer and corrupted home saves fail closed', () => {
  for (const raw of ['broken', '{"ver":2}', JSON.stringify({ ...M.fresh(), active: { id: 'house', progress: 100 } })]) {
    assert.throws(() => M.read(raw));
  }
});
test('day uses local calendar date', () => {
  assert.equal(M.localDay(new Date(2026, 8, 28, 0, 1)), day);
});

function fixture(seed = {}) {
  const data = new Map(Object.entries(seed)), listeners = {}, events = [], writes = [];
  const storage = { fail: false, getItem: k => data.get(k) ?? null, setItem(k, v) {
    if (this.fail) throw Error('quota'); data.set(k, v); writes.push(k);
  } };
  const document = { addEventListener: (name, fn) => { listeners[name] = fn; },
    getElementById: () => null, dispatchEvent: e => events.push(e) };
  const context = { window: { CloudletHomeModel: M, addEventListener() {} }, document,
    localStorage: storage, CustomEvent: function(name, options) { this.type = name; this.detail = options.detail; } };
  vm.runInNewContext(fs.readFileSync(require.resolve('../pet-home.js'), 'utf8'), context);
  return { data, storage, events, writes, send: (name, detail) => listeners[name]({ detail }) };
}
test('practice and mock exam share dedup, emit completion, and leave old saves untouched', () => {
  const old = '{"ver":6,"coins":81,"stage":3}';
  const f = fixture({ app_pet: old, app_pet_home: JSON.stringify(M.choose(M.fresh(), 'house')) });
  f.send('quiz:answered', answer(1));
  f.send('quiz:examDone', { exam: 'ca1', answers: [1, 2, 3, 4, 5].map(qid => ({ qid, correct: true })) });
  assert.deepEqual(JSON.parse(f.data.get('app_pet_home')).built, ['house']);
  assert.equal(f.events.filter(e => e.type === 'pet:homeBuilt').length, 1);
  assert.equal(f.data.get('app_pet'), old);
  assert.ok(f.writes.every(k => k === 'app_pet_home'));
});
test('disabled pet, no goal, older exam payload and corrupt save grant no construction', () => {
  for (const seed of [
    { app_pet_enabled: '0', app_pet_home: JSON.stringify(M.choose(M.fresh(), 'house')) },
    { app_pet_home: JSON.stringify(M.fresh()) }, { app_pet_home: '{"ver":9}' }
  ]) {
    const f = fixture(seed);
    f.send('quiz:answered', answer(1)); f.send('quiz:examDone', { pct: 100, total: 20, exam: 'ca1' });
    assert.equal(f.writes.length, 0); assert.equal(f.events.length, 0);
  }
});
test('failed storage never claims completion and the same answer can retry', () => {
  const seed = JSON.stringify(M.credit(M.choose(M.fresh(), 'house'), [1, 2, 3, 4].map(id => answer(id)), day));
  const f = fixture({ app_pet_home: seed }); f.storage.fail = true;
  f.send('quiz:answered', answer(5));
  assert.equal(f.data.get('app_pet_home'), seed); assert.equal(f.events.length, 0);
  f.storage.fail = false; f.send('quiz:answered', answer(5));
  assert.deepEqual(JSON.parse(f.data.get('app_pet_home')).built, ['house']);
  assert.equal(f.events.length, 1);
});
