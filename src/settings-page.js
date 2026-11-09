import React from 'react';
import { loadSettings, saveSettings } from './settings.js';
const h = React.createElement;

// Geometry follows the PowerDSH settings reference; all selectors belong to us.
const styles = `
.ab-preferences{width:100%;min-width:0;color:var(--dsw-alias-label-primary);font:inherit;overflow-wrap:anywhere}
.ab-preferences .ab-pref-heading{display:flex;flex-direction:column;gap:12px}
.ab-preferences h2{margin:0;font-size:16px;font-weight:500;line-height:24px}
.ab-preferences .ab-pref-intro{margin:0;font-size:14px;line-height:22px;color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary))}
.ab-preferences .ab-pref-fields{margin-top:14px}
.ab-preferences .ab-pref-row{display:flex;align-items:center;justify-content:space-between;gap:16px 24px;padding:16px 0;border-bottom:.5px solid var(--dsw-alias-border-l2)}
.ab-preferences .ab-pref-row:last-child{border-bottom:0}
.ab-preferences .ab-pref-copy{min-width:0;flex:1}
.ab-preferences .ab-pref-label{display:block;font-size:14px;font-weight:400;line-height:20px}
.ab-preferences .ab-pref-description{margin:4px 0 0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}
.ab-preferences .ab-pref-switch{box-sizing:border-box;flex:none;position:relative;width:36px;height:20px;padding:0;border:0;border-radius:999px;corner-shape:round;background:var(--dsw-alias-border-l3,var(--dsw-alias-border-l2));cursor:pointer;transition:background-color 120ms ease,opacity 120ms ease}
.ab-preferences .ab-pref-switch[aria-checked=true]{background:var(--dsw-alias-brand-primary)}
.ab-preferences .ab-pref-thumb{position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;corner-shape:round;background:var(--dsw-alias-switch-thumb,var(--dsw-alias-label-primary));transition:transform 120ms ease}
.ab-preferences .ab-pref-switch[aria-checked=true] .ab-pref-thumb{transform:translateX(16px);background:var(--dsw-alias-label-primary-foreground,var(--dsw-alias-bg-base))}
.ab-preferences button:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px}
.ab-preferences button:disabled{opacity:.5;cursor:default}
.ab-preferences .ab-pref-switch[aria-busy=true]{opacity:.8}
.ab-preferences .ab-pref-error{margin:4px 0 0;color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:18px}
@media(prefers-reduced-motion:reduce){.ab-preferences .ab-pref-switch,.ab-preferences .ab-pref-thumb{transition:none}}
`;

export function BrowserSettingsPage({ form, configForms, t }) {
  const source = React.useMemo(() => ({ subscribe: listener => form.subscribe(listener), getSnapshot: () => form.getSnapshot() }), [form]);
  const snapshot = React.useSyncExternalStore(source.subscribe, source.getSnapshot, source.getSnapshot);
  // The Host settings document is authoritative while it is served and writable.
  // When it never becomes ready (offline, older Host), the local preference store
  // keeps every switch working — the same contract the panel already follows.
  const formReady = snapshot?.status === 'ready';
  const readOnly = formReady && snapshot?.writable !== true;
  const [localValues, setLocalValues] = React.useState(() => loadSettings());
  const value = formReady ? (snapshot?.value ?? {}) : localValues;
  const [saving, setSaving] = React.useState(null), [error, setError] = React.useState(null);
  const pending = React.useRef(false), mounted = React.useRef(false), prefix = React.useId();
  React.useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const disabled = Boolean(saving) || readOnly;
  async function save(field, next) {
    if (disabled || pending.current || next === value[field]) return;
    pending.current = true; setSaving({ field, value: next }); setError(null);
    try {
      if (formReady) {
        await configForms.describe().load();
        const latest = form.getSnapshot();
        if (latest.status !== 'ready') throw new Error(t('settingsOutdated'));
        if (!latest.writable || !await form.set(field, next)) throw new Error(t('saveFailed'));
      }
      // Mirror to the local store either way: the panel and the sidebar
      // registration fall back to it whenever the Host form is absent.
      setLocalValues(saveSettings({ [field]: next }));
    } catch (failure) {
      if (mounted.current) setError({ field, message: failure?.message || t('saveFailed') });
    } finally {
      pending.current = false;
      if (mounted.current) setSaving(null);
    }
  }
  function row(field, title, description, control) {
    const labelId = `${prefix}-${field}`, descriptionId = `${labelId}-description`, errorId = `${labelId}-error`;
    const failed = error?.field === field;
    return h('div', { className: 'ab-pref-row', key: field },
      h('div', { className: 'ab-pref-copy' },
        h('label', { id: labelId, htmlFor: `${labelId}-control`, className: 'ab-pref-label' }, t(title)),
        h('p', { id: descriptionId, className: 'ab-pref-description' }, t(description)),
        failed && h('p', { id: errorId, className: 'ab-pref-error', role: 'alert' }, error.message)),
      control({ id: `${labelId}-control`, 'aria-labelledby': labelId, 'aria-describedby': `${descriptionId}${failed ? ` ${errorId}` : ''}`, disabled, 'aria-busy': saving?.field === field, ...(failed ? { 'aria-invalid': true } : {}) }));
  }
  const toggle = (field, title, description) => row(field, title, description, props => {
    const checked = saving?.field === field ? saving.value : value[field] === true;
    return h('button', { ...props, className: 'ab-pref-switch', type: 'button', role: 'switch', 'aria-checked': checked, onClick: () => void save(field, !checked) }, h('span', { className: 'ab-pref-thumb', 'aria-hidden': true }));
  });
  return h('section', { className: 'ab-preferences', 'aria-label': t('settingsTitle') },
    h('style', null, styles),
    h('header', { className: 'ab-pref-heading' }, h('h2', null, t('settingsTitle')), h('p', { className: 'ab-pref-intro' }, t('settingsIntro'))),
    h('div', { className: 'ab-pref-fields' },
      toggle('autoOpen', 'autoOpenLabel', 'autoOpenDescription'),
      toggle('takeOverBrowser', 'takeOverLabel', 'takeOverDescription')));
}
