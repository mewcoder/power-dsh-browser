import test from 'node:test';
import assert from 'node:assert/strict';
import { SETTINGS_DEFAULTS, SETTINGS_KEY, LEGACY_SETTINGS_KEY, loadSettings, normalizeSettings, saveSettings, subscribeSettings } from '../src/settings.js';

function storage(initial) {
  const map = new Map(initial ? [[SETTINGS_KEY, JSON.stringify(initial)]] : []);
  return { getItem: key => map.get(key) ?? null, setItem: (key, value) => map.set(key, String(value)), map };
}

test('defaults are safe when storage is missing, empty or corrupt', () => {
  assert.deepEqual(loadSettings(undefined), { ...SETTINGS_DEFAULTS });
  assert.deepEqual(loadSettings(storage()), { ...SETTINGS_DEFAULTS });
  const broken = { getItem: () => '{not json', setItem() {} };
  assert.deepEqual(loadSettings(broken), { ...SETTINGS_DEFAULTS });
});

test('rename migrates and validates existing preferences without changing the rollback record', () => {
  const store = storage();
  const legacy = JSON.stringify({ autoOpen: false, maxTabs: 99, homeUrl: 'https://example.test/', takeOverBrowser: true, extra: 'ignored' });
  store.map.set(LEGACY_SETTINGS_KEY, legacy);
  const migrated = loadSettings(store);
  assert.deepEqual(migrated, { autoOpen: false, maxTabs: 12, homeUrl: 'https://example.test/', takeOverBrowser: true });
  assert.equal(store.map.get(LEGACY_SETTINGS_KEY), legacy);
  assert.deepEqual(JSON.parse(store.map.get(SETTINGS_KEY)), migrated);
  saveSettings({ takeOverBrowser: false }, store);
  assert.equal(loadSettings(store).takeOverBrowser, false);
  assert.equal(store.map.get(LEGACY_SETTINGS_KEY), legacy);
});

test('new preferences win over legacy data, including an intentionally empty new record', () => {
  const store = storage({ autoOpen: true, takeOverBrowser: false });
  store.map.set(LEGACY_SETTINGS_KEY, JSON.stringify({ autoOpen: false, takeOverBrowser: true }));
  assert.equal(loadSettings(store).autoOpen, true);
  assert.equal(loadSettings(store).takeOverBrowser, false);
  store.map.set(SETTINGS_KEY, '');
  assert.deepEqual(loadSettings(store), { ...SETTINGS_DEFAULTS });
});

test('legacy migration works with read-only storage and rejects malformed old JSON', () => {
  const readonly = { getItem: key => key === LEGACY_SETTINGS_KEY ? '{"maxTabs":3}' : null, setItem() { throw Error('read only'); } };
  assert.equal(loadSettings(readonly).maxTabs, 3);
  assert.deepEqual(loadSettings({ getItem: key => key === LEGACY_SETTINGS_KEY ? '{broken' : null }), { ...SETTINGS_DEFAULTS });
});

test('values are clamped and URLs normalised; credentials and non-http rejected', () => {
  const value = normalizeSettings({ autoOpen: false, homeUrl: 'https://a.test/x', maxTabs: 99 });
  assert.equal(value.autoOpen, false);
  assert.equal(value.homeUrl, 'https://a.test/x');
  assert.equal(value.maxTabs, 12);
  assert.equal(normalizeSettings({ homeUrl: 'ftp://x' }).homeUrl, '');
  assert.equal(normalizeSettings({ homeUrl: 'https://u:p@x.test/' }).homeUrl, '');
});

test('takeover preference defaults to false and only accepts booleans', () => {
  assert.equal(SETTINGS_DEFAULTS.takeOverBrowser, false);
  assert.equal(normalizeSettings({}).takeOverBrowser, false);
  assert.equal(normalizeSettings({ takeOverBrowser: true }).takeOverBrowser, true);
  assert.equal(normalizeSettings({ takeOverBrowser: 'yes' }).takeOverBrowser, false);
  const store = storage({ takeOverBrowser: true });
  assert.equal(saveSettings({}, store).takeOverBrowser, true);
  assert.equal(saveSettings({ takeOverBrowser: false }, store).takeOverBrowser, false);
});

test('saveSettings notifies subscribers; a throwing listener does not break the rest', () => {
  const seen = [];
  const unsubscribe = subscribeSettings(value => seen.push(value.takeOverBrowser));
  const boom = () => { throw new Error('listener bug'); };
  subscribeSettings(boom);
  try {
    saveSettings({ takeOverBrowser: true }, storage());
    assert.deepEqual(seen, [true]);
    saveSettings({ takeOverBrowser: false }, storage());
    assert.deepEqual(seen, [true, false]);
  } finally { unsubscribe(); }
  saveSettings({ takeOverBrowser: true }, storage());
  assert.deepEqual(seen, [true, false]); // unsubscribed listener sees nothing more
});

test('save merges over defaults and persists normalised values', () => {
  const store = storage({ autoOpen: false, maxTabs: 3 });
  const next = saveSettings({ maxTabs: 5 }, store);
  assert.equal(next.autoOpen, false); assert.equal(next.maxTabs, 5);
  assert.deepEqual(loadSettings(store), next);
  assert.equal(JSON.parse(store.map.get(SETTINGS_KEY)).maxTabs, 5);
});
