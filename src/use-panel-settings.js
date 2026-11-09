import React from 'react';
import { loadSettings } from './settings.js';
import { PLUGIN_ID, MAX_TABS, MIN_TABS } from './constants.js';

// Host settings are authoritative; only known keys are adopted.
const normalizeHostSettings = value => {
  const result = {};
  if (typeof value?.autoOpen === 'boolean') result.autoOpen = value.autoOpen;
  if (typeof value?.homeUrl === 'string') result.homeUrl = value.homeUrl;
  if (Number.isSafeInteger(value?.maxTabs) && value.maxTabs >= MIN_TABS && value.maxTabs <= MAX_TABS) result.maxTabs = value.maxTabs;
  if (typeof value?.takeOverBrowser === 'boolean') result.takeOverBrowser = value.takeOverBrowser;
  return result;
};

/**
 * Panel preferences. The Host settings document wins when the plugin runs with
 * `configForms`; localStorage keeps the panel usable offline or without a Host.
 */
export function usePanelSettings(configForms) {
  const [settings, setSettings] = React.useState(() => loadSettings());
  React.useEffect(() => {
    if (!configForms) return;
    let unsubscribe;
    try {
      const form = configForms.get(PLUGIN_ID);
      const apply = () => {
        const value = form.getSnapshot()?.value;
        if (value) setSettings(current => ({ ...current, ...normalizeHostSettings(value) }));
      };
      apply();
      unsubscribe = form.subscribe(apply);
    } catch { /* Host settings unavailable; local values stand. */ }
    return () => { try { unsubscribe?.(); } catch { /* ignore */ } };
  }, [configForms]);
  return { settings };
}
