import React from 'react';
import { loadSettings, saveSettings } from './settings.js';
import { MAX_TABS, MIN_TABS } from './constants.js';

// Host settings are authoritative; only known keys are adopted.
export const normalizeHostSettings = value => {
  const result = {};
  if (typeof value?.autoOpen === 'boolean') result.autoOpen = value.autoOpen;
  if (typeof value?.homeUrl === 'string') result.homeUrl = value.homeUrl;
  if (Number.isSafeInteger(value?.maxTabs) && value.maxTabs >= MIN_TABS && value.maxTabs <= MAX_TABS) result.maxTabs = value.maxTabs;
  return result;
};

/**
 * Panel preferences. The Host settings document wins when the plugin runs with
 * `configForms`; localStorage keeps the panel usable offline or without a Host.
 */
export function usePanelSettings() {
  const [settings, setSettings] = React.useState(() => loadSettings());
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => {
    const forms = globalThis.__dshBrowserConfigForms;
    if (!forms) return;
    let unsubscribe;
    try {
      const form = forms.get('dsh-x-browser');
      const apply = () => {
        const value = form.getSnapshot()?.value;
        if (value) setSettings(current => ({ ...current, ...normalizeHostSettings(value) }));
      };
      apply();
      unsubscribe = form.subscribe(apply);
    } catch { /* Host settings unavailable; local values stand. */ }
    return () => { try { unsubscribe?.(); } catch { /* ignore */ } };
  }, []);
  const update = patch => { const next = saveSettings(patch); setSettings(next); return next; };
  return { settings, setSettings, open, setOpen, update };
}
