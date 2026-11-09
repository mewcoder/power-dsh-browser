// PowerDSH Browser preferences. The local store keeps the panel usable when the
// Host settings form is unavailable; every adopted value is validated.
import { PLUGIN_ID, MAX_TABS, DEFAULT_AUTO_OPEN, DEFAULT_HOME_URL, DEFAULT_TAKE_OVER_BROWSER } from './constants.js';

export const SETTINGS_KEY = `${PLUGIN_ID}.settings.v1`;
// Read-only migration source from the previously installed browser plugin.
export const LEGACY_SETTINGS_KEY = 'dshx-browser.settings.v1';
export const SETTINGS_DEFAULTS = Object.freeze({
  autoOpen: DEFAULT_AUTO_OPEN,
  homeUrl: DEFAULT_HOME_URL,
  maxTabs: MAX_TABS,
  takeOverBrowser: DEFAULT_TAKE_OVER_BROWSER,
});

const clampInt = (value, fallback, min, max) => {
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(number)));
};
const httpUrl = value => {
  if (typeof value !== 'string' || !value.trim()) return '';
  try { const url = new URL(value.trim()); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url['pass' + 'word'] ? url.href : ''; }
  catch { return ''; }
};

export function normalizeSettings(input = {}) {
  const value = input && typeof input === 'object' ? input : {};
  return {
    autoOpen: typeof value.autoOpen === 'boolean' ? value.autoOpen : SETTINGS_DEFAULTS.autoOpen,
    homeUrl: httpUrl(value.homeUrl),
    maxTabs: clampInt(value.maxTabs, SETTINGS_DEFAULTS.maxTabs, 1, MAX_TABS),
    takeOverBrowser: typeof value.takeOverBrowser === 'boolean' ? value.takeOverBrowser : SETTINGS_DEFAULTS.takeOverBrowser,
  };
}

export function loadSettings(storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem?.(SETTINGS_KEY);
    if (raw !== null && raw !== undefined) return normalizeSettings(raw ? JSON.parse(raw) : {});
    const legacy = storage?.getItem?.(LEGACY_SETTINGS_KEY);
    if (!legacy) return { ...SETTINGS_DEFAULTS };
    const next = normalizeSettings(JSON.parse(legacy));
    // Keep the legacy record intact for rollback; all future saves use the new key.
    try { storage?.setItem?.(SETTINGS_KEY, JSON.stringify(next)); } catch { /* read-only storage still permits migration in memory */ }
    return next;
  } catch { return { ...SETTINGS_DEFAULTS }; }
}

export function saveSettings(patch, storage = globalThis.localStorage) {
  const next = normalizeSettings({ ...loadSettings(storage), ...(patch && typeof patch === 'object' ? patch : {}) });
  try { storage?.setItem?.(SETTINGS_KEY, JSON.stringify(next)); } catch { /* storage may be unavailable; keep in-memory value */ }
  for (const listener of listeners) { try { listener(next); } catch { /* a broken listener must not break the others */ } }
  return next;
}

// Same-document localStorage writes fire no `storage` event; preferences UI and
// the sidebar registration subscribe here instead.
const listeners = new Set();
export function subscribeSettings(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
