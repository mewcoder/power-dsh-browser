// Public package, sidebar and settings identity for the PowerDSH plugin family.
export const PLUGIN_ID = 'power-dsh-browser';
export const DISPLAY_NAME = 'PowerDSH Browser';

// Shared limits. Kept in one place so the Host schema, the Client UI, and the
// tab manager cannot drift apart.
export const MAX_TABS = 12;
export const MIN_TABS = 1;
export const DEFAULT_HOME_URL = '';
export const DEFAULT_AUTO_OPEN = true;
export const DEFAULT_TAKE_OVER_BROWSER = false;
// Network capture budgets. The native bridge enforces the same bounds from its
// own self-contained copy (it is injected into the host ASAR and cannot import
// this module), so the two must be updated together.
export const NETWORK_BUDGETS = Object.freeze({
  requests: Object.freeze({ default: 200, max: 500 }),
  bodyBytes: Object.freeze({ default: 1048576, max: 2097152 }),
  totalBodyBytes: Object.freeze({ default: 8388608, max: 16777216 }),
});
