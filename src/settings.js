// DSHX Browser preferences. Kept client-side for now so the panel works without a
// Host schema; every value is validated before use and stored in localStorage.
export const SETTINGS_KEY = 'dshx-browser.settings.v1';
export const SETTINGS_DEFAULTS = Object.freeze({
  autoOpen: true,
  homeUrl: '',
  maxTabs: 12,
  maxRequests: 200,
  maxBodyBytes: 1048576,
  maxTotalBodyBytes: 8388608,
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
    maxTabs: clampInt(value.maxTabs, SETTINGS_DEFAULTS.maxTabs, 1, 12),
    maxRequests: clampInt(value.maxRequests, SETTINGS_DEFAULTS.maxRequests, 1, 500),
    maxBodyBytes: clampInt(value.maxBodyBytes, SETTINGS_DEFAULTS.maxBodyBytes, 1024, 2 * 1024 * 1024),
    maxTotalBodyBytes: clampInt(value.maxTotalBodyBytes, SETTINGS_DEFAULTS.maxTotalBodyBytes, 1024 * 1024, 16 * 1024 * 1024),
  };
}

export function loadSettings(storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem?.(SETTINGS_KEY);
    return normalizeSettings(raw ? JSON.parse(raw) : {});
  } catch { return { ...SETTINGS_DEFAULTS }; }
}

export function saveSettings(patch, storage = globalThis.localStorage) {
  const next = normalizeSettings({ ...loadSettings(storage), ...(patch && typeof patch === 'object' ? patch : {}) });
  try { storage?.setItem?.(SETTINGS_KEY, JSON.stringify(next)); } catch { /* storage may be unavailable; keep in-memory value */ }
  return next;
}
