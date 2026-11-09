import { PLUGIN_ID } from './constants.js';
import { normalizeSettings, SETTINGS_DEFAULTS } from './settings.js';

const LEGACY_FORM_ID = 'dsh-x-browser';
export const HOST_MIGRATION_KEY = `${PLUGIN_ID}.host-settings-migrated.v1`;
const fields = Object.keys(SETTINGS_DEFAULTS);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const noop = () => {};

// Public ConfigForm.mutate(ops, expectedRevision) is atomic. set() cannot provide
// this guarantee: it adopts a newer revision when its queued write starts.
// Keep the old namespace readable until this effect has had a chance to run.
export function startHostSettingsMigration(configForms, options = {}) {
  let storage, target, legacy;
  try {
    storage = options.storage ?? globalThis.localStorage;
    // Without durable completion state, do not risk importing again after reload.
    if (!storage?.getItem || !storage?.setItem || storage.getItem(HOST_MIGRATION_KEY) === '1') return noop;
    target = configForms?.get(PLUGIN_ID);
    legacy = configForms?.get(LEGACY_FORM_ID);
  } catch { return noop; }
  if (!target || !legacy || target === legacy || typeof target.mutate !== 'function') return noop;
  let disposed = false, done = false, inFlight = false, attemptedRevision;
  const releases = [];
  const complete = () => {
    if (disposed) return;
    done = true;
    try { storage.setItem(HOST_MIGRATION_KEY, '1'); } catch { /* no further writes in this instance */ }
  };
  const tick = () => {
    if (disposed || done || inFlight) return;
    let current, previous;
    try { current = target.getSnapshot(); previous = legacy.getSnapshot(); } catch { return; }
    if (current?.status !== 'ready' || current.writable !== true || !object(current.value)) return;
    // An explicit new preference is authoritative even if it equals the default.
    if (fields.some(key => Object.hasOwn(current.user ?? {}, key))
      || fields.some(key => normalizeSettings(current.value)[key] !== SETTINGS_DEFAULTS[key])) {
      complete(); return;
    }
    // An unserved/removed old namespace cannot be safely inferred from defaults.
    if (previous?.status !== 'ready' || !object(previous.value)) return;
    if (current.revision === undefined || current.revision === null || current.revision === attemptedRevision) return;
    const next = normalizeSettings(previous.value);
    if (fields.every(key => next[key] === SETTINGS_DEFAULTS[key])) { complete(); return; }
    attemptedRevision = current.revision;
    inFlight = true;
    void Promise.resolve().then(async () => {
      if (disposed) return;
      // Do not enqueue an import after a user update or a newer old snapshot.
      if (target.getSnapshot().revision !== current.revision || legacy.getSnapshot() !== previous) return;
      const accepted = await target.mutate(fields.map(key => ({ op: 'set', path: [key], value: next[key] })), current.revision);
      // Disposal cannot roll back a dispatched RPC, but blocks follow-up work.
      if (accepted === true) complete();
    }).catch(() => {}).finally(() => { inFlight = false; });
  };
  try {
    releases.push(target.subscribe(tick));
    releases.push(legacy.subscribe(tick));
    tick();
    // describe() owns loading and schema discovery; no private Host access.
    void Promise.resolve(configForms.describe?.().load()).then(tick, noop);
  } catch { /* unavailable public form services leave existing settings intact */ }
  return () => {
    disposed = true;
    for (const release of releases) { try { release?.(); } catch { /* dispose every listener */ } }
  };
}
