const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const M = require('../pet-home-model.js');

function portraitFixture(seed) {
  let raw = JSON.stringify(seed), writes = 0;
  const source = fs.readFileSync(require.resolve('../pet.js'), 'utf8');
  const boot = '  buildToggle();\n  if (enabled()) start();';
  assert.ok(source.includes(boot));
  const context = vm.createContext({ window: {}, document: { addEventListener() {} },
    localStorage: { getItem: () => raw, setItem() { writes++; } } });
  vm.runInContext(source.replace(boot, '  globalThis.testLoad = load;'), context);
  context.testLoad();
  return { view: () => JSON.parse(JSON.stringify(context.window.CloudletPet.appearance())),
    writes: () => writes, reload: seed => { raw = JSON.stringify(seed); context.testLoad(); } };
}
test('home reads all five worn slots without altering pet, coins, or save', () => {
  const worn = { head: 'tophat', face: 'glasses', neck: 'scarf', side: 'book', aura: 'bee' };
  const seed = { ver: 4, stage: 2, coins: 32, worn, acc: Object.fromEntries(Object.values(worn).map(id => [id, true])) };
  const f = portraitFixture(seed), view = f.view();
  assert.equal(view.className, 'stage-2');
  assert.deepEqual(Object.fromEntries(view.worn.map(a => [a.slot, a.id])), worn);
  assert.match(view.html, /class="pet-worn"/); assert.match(view.html, /class="pet-svg"/);
  assert.equal(f.writes(), 0);
  view.worn[0].id = 'other'; assert.equal(f.view().worn[0].id, 'tophat');
  f.reload({ ...seed, worn: { ...worn, side: 'guitar' }, acc: { ...seed.acc, guitar: true } });
  assert.equal(f.view().worn.find(a => a.slot === 'side').id, 'guitar');
  f.reload({ ...seed, worn: {} }); assert.deepEqual(f.view().worn, []);
});
test('unowned, wrong-slot, and unknown accessories do not appear or enable activities', () => {
  const f = portraitFixture({ ver: 4, stage: 2, worn: { head: 'book', side: 'guitar', aura: 'unknown' }, acc: { book: true } });
  assert.deepEqual(f.view().worn, []);
});
test('egg, breeding tendency and final form are preserved in home portrait', () => {
  for (const [seed, expected] of [
    [{ stage: 0 }, 'stage-0'], [{ stage: 3, aff: { sage: 10 } }, 'stage-3 tend-sage'],
    [{ stage: 4, form: 'night' }, 'stage-4 form-night'], [{ stage: 4, form: 'gold' }, 'stage-4 form-gold']
  ]) assert.equal(portraitFixture({ ver: 4, ...seed }).view().className, expected);
});
test('held props add three small actions only at their matching facilities', () => {
  assert.equal(M.activity('tree', 'book', 2).kind, 'read');
  assert.equal(M.activity('tree', 'guitar', 2).kind, 'music');
  assert.equal(M.activity('garden', 'umbrella', 2).kind, 'stroll');
  assert.equal(M.activity('tree', 'umbrella', 2).kind, 'rest');
  assert.equal(M.activity('garden', 'book', 2).kind, 'water');
});
test('no outfit and rebirth still allow the original interactions', () => {
  for (const stage of [0, 1, 2, 3, 4]) for (const place of ['house', 'garden', 'tree']) {
    const action = M.activity(place, '', stage);
    assert.equal(action.line, M.byId(place).line);
    assert.equal(action.kind, place === 'garden' ? 'water' : 'rest');
  }
  assert.equal(M.activity('tree', 'book', 0).kind, 'rest');
});
