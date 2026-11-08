import test from 'node:test';
import assert from 'node:assert/strict';
import { SETTINGS_DEFAULTS, SETTINGS_KEY, loadSettings, normalizeSettings, saveSettings } from '../src/settings.js';

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

test('values are clamped and URLs normalised; credentials and non-http rejected', () => {
  const value = normalizeSettings({ autoOpen: false, homeUrl: 'https://a.test/x', maxTabs: 99, maxRequests: 0, maxBodyBytes: 10, maxTotalBodyBytes: 99 * 1024 * 1024 });
  assert.equal(value.autoOpen, false);
  assert.equal(value.homeUrl, 'https://a.test/x');
  assert.equal(value.maxTabs, 12);
  assert.equal(value.maxRequests, 1);
  assert.equal(value.maxBodyBytes, 1024);
  assert.equal(value.maxTotalBodyBytes, 16 * 1024 * 1024);
  assert.equal(normalizeSettings({ homeUrl: 'ftp://x' }).homeUrl, '');
  assert.equal(normalizeSettings({ homeUrl: 'https://u:p@x.test/' }).homeUrl, '');
});

test('save merges over defaults and persists normalised values', () => {
  const store = storage({ autoOpen: false, maxTabs: 3 });
  const next = saveSettings({ maxTabs: 5 }, store);
  assert.equal(next.autoOpen, false); assert.equal(next.maxTabs, 5);
  assert.deepEqual(loadSettings(store), next);
  assert.equal(JSON.parse(store.map.get(SETTINGS_KEY)).maxTabs, 5);
});
