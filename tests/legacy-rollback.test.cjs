const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Exercise the original script's storage functions, replacing only its DOM boot.
const source = fs.readFileSync(path.join(__dirname, '../pet.js'), 'utf8');
const boot = '  buildToggle();\n  if (enabled()) start();';
assert.ok(source.includes(boot));
const storageScript = source.replace(boot, '  globalThis.petStore = { load, save };');
function fixture(seed, failBackup = false) {
  const data = new Map(Object.entries(seed)), writes = [];
  const storage = {
    failBackup,
    getItem: key => data.get(key) ?? null,
    setItem(key, value) {
      if (this.failBackup && key.endsWith('_before_legacy')) throw Error('quota');
      writes.push(key); data.set(key, value);
    }
  };
  const context = vm.createContext({ localStorage: storage, document: { addEventListener() {} } });
  vm.runInContext(storageScript, context);
  return { data, writes, storage, pet: context.petStore };
}

test('v5/v6 rollback backs up exact save before writing and retains earned progress', () => {
  for (const ver of [5, 6]) {
    const raw = {
      ver, stage: 4, form: 'sage', xp: 345, coins: 78,
      items: { ball: true, shrine: true, snack: true }, acc: { glasses: true },
      worn: { face: 'glasses' }, companion: { memories: [{ title: '一起玩球' }] }
    };
    const text = JSON.stringify(raw, null, 2);
    const untouched = { app_pet_dex: '[{"form":"gold"}]', app_shrine: '{"mult":1.1}',
      app_pet_backup_v4: '{"ver":4,"coins":10}', 'dop-c02_progress': '{"1":["A"]}' };
    const f = fixture({ app_pet: text, ...untouched }), backup = `app_pet_backup_v${ver}_before_legacy`;
    f.pet.load(); f.pet.save();
    assert.deepEqual(f.writes, [backup, 'app_pet']);
    assert.equal(f.data.get(backup), text);
    const saved = JSON.parse(f.data.get('app_pet'));
    for (const [key, value] of Object.entries(raw)) assert.deepEqual(saved[key], key === 'ver' ? 4 : value);
    for (const [key, value] of Object.entries(untouched)) assert.equal(f.data.get(key), value);
    f.pet.load(); f.pet.save();
    assert.equal(f.writes.filter(key => key === backup).length, 1);
    assert.equal(JSON.parse(f.data.get('app_pet')).coins, 78);
  }
});

test('backup failure preserves newer save until a successful retry', () => {
  const text = '{"ver":6,"stage":3,"coins":91}';
  const f = fixture({ app_pet: text }, true);
  f.pet.load(); f.pet.save();
  assert.equal(f.data.get('app_pet'), text);
  assert.deepEqual(f.writes, []);
  f.storage.failBackup = false; f.pet.save();
  assert.deepEqual(f.writes, ['app_pet_backup_v6_before_legacy', 'app_pet']);
  assert.equal(f.data.get('app_pet_backup_v6_before_legacy'), text);
  assert.equal(JSON.parse(f.data.get('app_pet')).coins, 91);
});

test('existing rollback backup is not overwritten by a later newer save', () => {
  const prior = '{"ver":6,"coins":25}';
  const f = fixture({ app_pet: '{"ver":6,"coins":90}', app_pet_backup_v6_before_legacy: prior });
  f.pet.load(); f.pet.save();
  assert.equal(f.data.get('app_pet_backup_v6_before_legacy'), prior);
  assert.equal(JSON.parse(f.data.get('app_pet')).coins, 90);
  assert.deepEqual(f.writes, ['app_pet']);
});

test('original and fresh saves keep original initialization without rollback backups', () => {
  for (const seed of [{}, { app_pet: '{"ver":4,"coins":55,"xp":120,"stage":3}' }]) {
    const f = fixture(seed); f.pet.load(); f.pet.save();
    assert.deepEqual(f.writes, ['app_pet']);
    assert.equal(JSON.parse(f.data.get('app_pet')).coins, seed.app_pet ? 55 : 0);
  }
});
