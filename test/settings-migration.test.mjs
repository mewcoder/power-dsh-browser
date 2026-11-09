import test from 'node:test';
import assert from 'node:assert/strict';
import { startHostSettingsMigration, HOST_MIGRATION_KEY } from '../src/settings-migration.js';
import { SETTINGS_DEFAULTS } from '../src/settings.js';

const settled = () => new Promise(resolve => setImmediate(resolve));
function fixture() {
  const values = new Map();
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  class Form {
    listeners = new Set(); writes = []; gate;
    snapshot = { status: 'ready', writable: true, revision: 1, value: { ...SETTINGS_DEFAULTS }, user: {} };
    getSnapshot() { return this.snapshot; }
    subscribe(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
    publish(patch) { this.snapshot = { ...this.snapshot, ...patch }; for (const listener of this.listeners) listener(); }
    async mutate(ops, revision) {
      this.writes.push({ ops, revision });
      if (this.gate) await this.gate;
      if (this.snapshot.revision !== revision) return false;
      const updates = Object.fromEntries(ops.map(op => [op.path[0], op.value]));
      this.publish({ revision: revision + 1, value: { ...this.snapshot.value, ...updates }, user: updates });
      return true;
    }
  }
  const target = new Form(), legacy = new Form();
  legacy.publish({ value: { autoOpen: false, homeUrl: 'https://example.test/', maxTabs: 4, takeOverBrowser: true } });
  const configForms = { get: id => id === 'power-dsh-browser' ? target : id === 'dsh-x-browser' ? legacy : undefined, describe: () => ({ load: async () => {} }) };
  return { target, legacy, configForms, storage, values };
}

test('package rename atomically imports old Host preferences and leaves the source intact', async () => {
  const f = fixture(), old = structuredClone(f.legacy.snapshot);
  const dispose = startHostSettingsMigration(f.configForms, { storage: f.storage });
  await settled();
  assert.equal(f.target.writes.length, 1);
  assert.equal(f.target.writes[0].revision, 1);
  assert.deepEqual(f.target.snapshot.value, f.legacy.snapshot.value);
  assert.deepEqual(f.legacy.snapshot, old);
  assert.equal(f.values.get(HOST_MIGRATION_KEY), '1');
  dispose();
  const again = startHostSettingsMigration(f.configForms, { storage: f.storage });
  await settled(); assert.equal(f.target.writes.length, 1); again();
  assert.equal(f.target.listeners.size + f.legacy.listeners.size, 0);
});

test('explicit new preferences, including explicit defaults, are never replaced', async () => {
  for (const patch of [{ value: { ...SETTINGS_DEFAULTS, maxTabs: 6 } }, { user: { autoOpen: true } }]) {
    const f = fixture(); f.target.publish(patch);
    const before = structuredClone(f.target.snapshot);
    const dispose = startHostSettingsMigration(f.configForms, { storage: f.storage });
    await settled();
    assert.equal(f.target.writes.length, 0); assert.deepEqual(f.target.snapshot, before);
    assert.equal(f.values.get(HOST_MIGRATION_KEY), '1'); dispose();
  }
});

test('CAS import cannot overwrite a user change made after the import was queued', async () => {
  const f = fixture(); let release;
  f.target.gate = new Promise(resolve => { release = resolve; });
  const dispose = startHostSettingsMigration(f.configForms, { storage: f.storage });
  await settled(); assert.equal(f.target.writes.length, 1);
  f.target.publish({ revision: 2, value: { ...SETTINGS_DEFAULTS, maxTabs: 7 }, user: { maxTabs: 7 } });
  release(); await settled();
  assert.equal(f.target.snapshot.value.maxTabs, 7);
  assert.equal(f.target.snapshot.value.autoOpen, true);
  assert.equal(f.values.has(HOST_MIGRATION_KEY), false);
  dispose();
});

test('migration waits for a served old namespace and does not invent old preferences', async () => {
  const f = fixture(); const value = f.legacy.snapshot.value;
  f.legacy.publish({ status: 'loading', value: undefined });
  const dispose = startHostSettingsMigration(f.configForms, { storage: f.storage });
  await settled(); assert.equal(f.target.writes.length, 0); assert.equal(f.values.size, 0);
  f.legacy.publish({ status: 'ready', value });
  await settled(); assert.equal(f.target.snapshot.value.autoOpen, false); dispose();
});

test('unavailable storage, read-only Host and missing CAS support leave settings intact', async () => {
  for (const kind of ['storage', 'readonly', 'noCAS']) {
    const f = fixture();
    if (kind === 'storage') f.storage.getItem = () => { throw Error('unavailable'); };
    if (kind === 'readonly') f.target.publish({ writable: false });
    if (kind === 'noCAS') f.target.mutate = undefined;
    const dispose = startHostSettingsMigration(f.configForms, { storage: f.storage });
    await settled(); assert.equal(f.target.writes.length, 0); assert.equal(f.values.size, 0); dispose();
    assert.equal(f.target.listeners.size + f.legacy.listeners.size, 0);
  }
});

test('disposal blocks queued imports and completion work after an in-flight request', async () => {
  const queued = fixture();
  const cancel = startHostSettingsMigration(queued.configForms, { storage: queued.storage });
  cancel(); await settled(); assert.equal(queued.target.writes.length, 0);
  const f = fixture(); let release;
  f.target.gate = new Promise(resolve => { release = resolve; });
  const dispose = startHostSettingsMigration(f.configForms, { storage: f.storage });
  await settled(); dispose(); release(); await settled();
  assert.equal(f.values.has(HOST_MIGRATION_KEY), false);
  assert.equal(f.target.listeners.size + f.legacy.listeners.size, 0);
});
