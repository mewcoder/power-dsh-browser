import React from 'react';
import { RPC, call } from './rpc.js';
import { id, abortable } from './protocol.js';
import { ElectronPage, workspaceIdentity } from './electron-page.js';
import { SessionTabs } from './session-tabs.js';
import { Icon, shellCss, addressUrl } from './browser-shell.js';
import { loadSettings } from './settings.js';
import { usePanelSettings } from './use-panel-settings.js';
import { MAX_TABS, MIN_TABS } from './constants.js';
import { AgentCursor, ClickMarker } from './agent-cursor.js';
const noopSubscribe = () => () => {}, noServices = () => null;
const h = React.createElement;
const KIND = 'dsh-agent-browser', ID = 'dsh-browser';
import { dictionaries } from './locale.js';
export { dictionaries };
export const inject = ['slots', 'locale', 'sidebarRight', 'sidebarRightTabs', 'remote', 'configForms'];
export async function apply(ctx) {
  const namespace = 'dshAgentBrowser', t = ctx.locale.bind(namespace);
  ctx.effect(() => ctx.locale.register(namespace, dictionaries));
  const localeSource = { subscribe: listener => ctx.locale.subscribe(listener), getSnapshot: () => ctx.locale.getSnapshot().active };
  await ctx.remote.$mount({ package: ID, descriptors: RPC });
  ctx.inject(['remote.dshBrowser', 'workspaces', 'configForms'], scope => {
    scope.effect(() => scope.sidebarRightTabs.register({ id: ID, kind: KIND, title: () => t('title'), keepMounted: true, guide: [{ id: 'open', title: () => t('title'), description: () => t('description') }] }));
    scope.effect(() => scope.slots.inject('sidebar.right.pane.tab', () => scope.slots.register({ name: 'sidebar.right.pane.tab', key: ID, locale: namespace, inject: sessionId => ({ sessionId, remote: scope.remote, workspaces: scope.workspaces, localeSource }) }, BrowserPanel)));
    // Settings → X Browser. Reads/writes the Host settings document through the
    // shared config form, so preferences follow the account and survive reloads.
    scope.effect(() => {
      if (!scope.configForms) return () => {};
      const form = scope.configForms.get('dsh-x-browser');
      // Expose the shared form to the panel component without prop drilling.
      globalThis.__dshBrowserConfigForms = scope.configForms;
      const clearGlobal = () => { if (globalThis.__dshBrowserConfigForms === scope.configForms) delete globalThis.__dshBrowserConfigForms; };
      const SettingsPage = () => {
        const snapshot = React.useSyncExternalStore(form.subscribe, form.getSnapshot, form.getSnapshot);
        const value = snapshot?.value ?? {};
        const [draftHome, setDraftHome] = React.useState(value.homeUrl ?? '');
        const [notice, setNotice] = React.useState('');
        React.useEffect(() => { setDraftHome(value.homeUrl ?? ''); }, [value.homeUrl]);
        const save = async (field, next) => {
          setNotice('');
          try {
            await scope.configForms.describe().load();
            const latest = form.getSnapshot();
            if (latest.status !== 'ready') throw new Error(t('settingsOutdated'));
            if (!await form.set(field, next)) throw new Error(t('saveFailed'));
            setNotice(t('saved'));
          } catch (error) { setNotice(error?.message || t('saveFailed')); }
        };
        const row = { display: 'flex', alignItems: 'center', gap: 8, padding: '10px 0', borderBottom: '1px solid var(--dsw-alias-border-l3, #e8eaee)' };
        const input = { padding: '4px 8px', border: '1px solid var(--dsw-alias-border-l3, #e8eaee)', borderRadius: 6, background: 'var(--dsw-alias-bg-base, #fff)', color: 'inherit', minWidth: 220 };
        return h('section', { style: { padding: '4px 2px', display: 'grid', gap: 4 } },
          h('h2', { style: { margin: '0 0 4px', fontSize: 16 } }, t('settingsTitle')),
          h('p', { style: { margin: '0 0 8px', opacity: .7, fontSize: 13 } }, t('settingsIntro')),
          h('label', { style: row }, h('input', { type: 'checkbox', checked: value.autoOpen !== false, onChange: event => void save('autoOpen', event.target.checked) }), t('autoOpenLabel')),
          h('label', { style: row }, h('span', { style: { flex: 1 } }, t('homeUrlLabel')), h('input', { type: 'text', value: draftHome, placeholder: 'https://…', spellCheck: false, style: input, onChange: event => setDraftHome(event.target.value), onBlur: () => void save('homeUrl', draftHome) })),
          h('label', { style: row }, h('span', { style: { flex: 1 } }, t('maxTabsLabel')), h('input', { type: 'number', min: MIN_TABS, max: MAX_TABS, value: value.maxTabs ?? MAX_TABS, style: { ...input, minWidth: 90, width: 90 }, onChange: event => void save('maxTabs', Number(event.target.value)) })),
          notice && h('p', { style: { margin: '8px 0 0', fontSize: 13, opacity: .8 } }, notice));
      };
      const releaseSection = scope.slots.register({ name: 'settings.section', id: 'dsh-x-browser', order: 60, locale: namespace, label: () => t('settingsTitle') }, SettingsPage);
      const releaseIcon = scope.slots.register({ name: 'settings.section.icon', id: 'dsh-x-browser' }, ({ size = 16 } = {}) => h(Icon, { name: 'globe', size }));
      return () => { releaseSection(); releaseIcon(); clearGlobal(); };
    });
    // Open the Agent Browser panel only when a browser tool actually needs it: the
    // Host records a short-lived demand, this loaded Client notices it and opens
    // the tab. Closing the panel normally keeps it closed until the next need.
    // `remote.dshBrowser` is only callable inside this injection scope.
    scope.effect(() => {
      let disposed = false, timer, inFlight = false;
      const tick = async () => {
        if (disposed) return;
        if (!inFlight) {
          inFlight = true;
          try {
            if (loadSettings().autoOpen) {
              const result = await scope.remote.dshBrowser.openRequested();
              if (result?.ok && result.value === true) {
                try { ctx.sidebarRight.openTab(KIND); }
                catch { try { ctx.sidebarRight.toggleExpanded?.(); ctx.sidebarRight.openTab(KIND); } catch { /* surface not ready; retry */ } }
              }
            }
          } catch { /* Host not ready; retry */ }
          inFlight = false;
        }
        if (!disposed) timer = setTimeout(tick, 400);
      };
      timer = setTimeout(tick, 300);
      return () => { disposed = true; clearTimeout(timer); };
    });
  });
}
export function BrowserPanel({ sessionId, remote, workspaces, useTabInfo, t, localeSource }) {
  const { tab } = useTabInfo();
  const locale = React.useSyncExternalStore(localeSource?.subscribe ?? noopSubscribe, localeSource?.getSnapshot ?? (() => 'en'), () => 'en');
  const container = React.useRef(null), controls = React.useRef(null), address = React.useRef(null);
  const [view, setView] = React.useState({ activeTabId: null, tabs: [] });
  const { settings, open: settingsOpen, setOpen: setSettingsOpen, update: updateSettings } = usePanelSettings();
  const [agentPoint, setAgentPoint] = React.useState(null), [cursorShown, setCursorShown] = React.useState(false);
  const [homeDraft, setHomeDraft] = React.useState(() => settings.homeUrl);
  const settingsLabels = String(locale).startsWith('zh')
    ? { settings: '设置', autoOpen: '需要时自动打开面板', homeUrl: '新标签默认主页', maxTabs: '最大标签数', note: '网络抓包上限在调用工具时按需指定。' }
    : { settings: 'Settings', autoOpen: 'Open panel when needed', homeUrl: 'New-tab home URL', maxTabs: 'Max tabs', note: 'Network capture limits are set per tool call.' };
  const [draft, setDraft] = React.useState(''), [search, setSearch] = React.useState('');
  const [activity, setActivity] = React.useState({ busy: false }), [connection, setConnection] = React.useState('starting'), [error, setError] = React.useState(''), [details, setDetails] = React.useState(false), [marker, setMarker] = React.useState(null);
  const active = view.tabs.find(entry => entry.tabId === view.activeTabId);
  React.useEffect(() => { setDraft(active?.url || ''); setError(''); setMarker(null); }, [active?.tabId, active?.url]);
  React.useEffect(() => {
    const carrier = globalThis.dshDesktop, bridge = carrier?.protocolVersion === 1 ? carrier.browser : undefined;
    if (!bridge) { setConnection('unavailable'); return; }
    const life = new AbortController();
    let manager, panelKey, timer, markerTimer, cursorTimer, closed = false, epoch = 0, admitting = true;
    const requests = new Map();
    const cancelPending = requestId => {
      for (const [key, controller] of requests) if (!requestId || key === requestId) controller.abort(new Error('CANCELLED'));
      manager?.cancel(requestId);
    };
    const disconnect = async () => { if (panelKey) { const key = panelKey; panelKey = undefined; await call(remote, 'disconnect', key).catch(() => {}); } };
    const feedback = (event, tabId) => {
      if (closed || manager?.activeTabId !== tabId) return;
      if (Number.isFinite(event?.x) && Number.isFinite(event?.y)) setAgentPoint({ x: event.x, y: event.y });
      setCursorShown(true); clearTimeout(cursorTimer);
      cursorTimer = setTimeout(() => { if (!closed) setCursorShown(false); }, 2800);
      setMarker({ ...event, tabId, key: id() }); clearTimeout(markerTimer);
      markerTimer = setTimeout(() => { if (!closed) setMarker(null); }, 1200);
    };
    const stop = async () => {
      admitting = false; cancelPending(); void manager?.stopNetworkCaptures(); setMarker(null);
      if (panelKey) {
        try { const result = await call(remote, 'stop', panelKey); epoch = result.epoch; admitting = true; }
        catch (error) { if (!closed) setError(error.message); }
      }
    };
    const run = async command => {
      const passive = ['status', 'inspect', 'console', 'network', 'cap'].includes(command.operation) || command.operation === 'tabs' && command.args.action === 'list';
      const control = new AbortController(); requests.set(command.id, control);
      try {
        if (!passive) {
        }
        control.signal.throwIfAborted();
        if (closed || !admitting || command.epoch !== epoch || command.expires <= Date.now()) return;
        const value = await manager.run({ ...command, signal: control.signal });
        if (!closed && panelKey && command.epoch === epoch) await call(remote, 'reply', panelKey, command.id, command.epoch, { ok: true, value });
      } catch (error) {
        if (!closed && panelKey && command.epoch === epoch) await call(remote, 'reply', panelKey, command.id, command.epoch, { ok: false, error: String(error.message).slice(0, 1000) }).catch(() => {});
      } finally { if (requests.get(command.id) === control) requests.delete(command.id); if (!passive && !closed) setMarkerRevision(value => value + 1); }
    };
    const poll = async () => {
      if (closed || !panelKey) return;
      try {
        const { commands } = await call(remote, 'poll', panelKey);
        if (closed) return;
        for (const command of commands) {
          if (command.kind === 'stop') { epoch = command.epoch; cancelPending(); void manager?.stopNetworkCaptures(); setMarker(null); }
          else if (command.kind === 'cancel') cancelPending(command.id);
        }
        const cancelled = new Set(commands.filter(c => c.kind === 'cancel').map(c => c.id));
        for (const command of commands) if (command.kind === 'request' && admitting && !cancelled.has(command.id) && command.epoch === epoch) void run(command);
        timer = setTimeout(poll, 250);
      } catch (error) { manager?.cancel(); void manager?.stopNetworkCaptures(); if (!closed) { setConnection('offline'); setError(''); } await disconnect(); }
    };
    const connect = async () => {
      if (panelKey || closed) return;
      try {
        setConnection('starting');
        const result = await call(remote, 'connect', sessionId, id()); panelKey = result.key;
        if (closed) { await disconnect(); return; }
        epoch = 0; setConnection('connected'); void poll();
      } catch (error) { if (!closed) { setConnection('offline'); setError(error.message); } }
    };
    const initialize = async () => {
      try {
        const workspace = await workspaceIdentity(workspaces.list, sessionId, life.signal);
        const prefs = loadSettings();
        manager = new SessionTabs({
          workspace, signal: life.signal, maxTabs: prefs.maxTabs,
          createContainer(tabId) { const node = document.createElement('div'); node.className = 'ab-page'; node.dataset.browserTab = tabId; container.current.appendChild(node); return node; },
          createPage(node, update, invalidate, tabId) {
            const page = new ElectronPage(bridge, node, location.origin, update, invalidate, { onInput: event => feedback(event, tabId), onOpen: url => { manager.cancel(); return manager.newTab(url); } });
            return page;
          },
          onChange: next => { if (!closed) setView(next); }, onActivity: next => { if (!closed) setActivity(next); },
        });
        await manager.newTab(prefs.homeUrl || undefined); life.signal.throwIfAborted(); await connect();
      } catch (error) { if (!closed) { setConnection('offline'); setError(error.message); } }
    };
    void initialize();
    const unbind = tab.actions.bindCommands({ refresh: () => { void manager?.navigate('reload').catch(e => setError(e.message)); } });
    const cleanup = () => {
      if (closed) return; closed = true; clearTimeout(timer); clearTimeout(markerTimer); clearTimeout(cursorTimer); life.abort(); cancelPending(); controls.current = null;
      void disconnect(); void manager?.dispose().catch(() => {}); unbind?.();
    };
    tab.signal.addEventListener('abort', cleanup, { once: true });
    window.addEventListener('pagehide', cleanup);
    return () => { tab.signal.removeEventListener('abort', cleanup); window.removeEventListener('pagehide', cleanup); cleanup(); };
  }, [sessionId, remote, workspaces, tab.signal, tab.actions]);
  const perform = async action => { controls.current?.cancel(); setError(''); try { await action(); } catch (error) { if (error?.name !== 'AbortError') setError(error.message); } };
  const navigate = (action, value) => perform(() => controls.current?.manager.navigate(action, action === 'open' ? addressUrl(value) : undefined));
  const newTab = () => perform(async () => { controls.current?.manager.cancel(); await controls.current?.manager.newTab(loadSettings().homeUrl || undefined); requestAnimationFrame(() => address.current?.focus()); });
  const select = tabId => perform(() => controls.current?.manager.select(tabId));
  const close = tabId => perform(() => controls.current?.manager.close(tabId));
  const iconButton = (key, icon, action, disabled = false, extra = {}) => h('button', { type: 'button', className: 'ab-icon', onClick: action, disabled, title: t(key), 'aria-label': t(key), ...extra }, h(Icon, { name: icon }));
  const tabName = entry => entry.title || (entry.url ? (() => { try { return new URL(entry.url).hostname; } catch { return entry.url; } })() : t('pageTitle'));
  const blank = !active?.url;
  return h('section', { 'data-dsh-agent-browser': '', 'aria-label': t('title') },
    h('style', null, shellCss),
    h('div', { className: 'ab-tabs' },
      h('div', { className: 'ab-tabscroll', role: 'tablist', 'aria-label': t('title') }, view.tabs.map(entry => h('div', { className: 'ab-tab', key: entry.tabId, 'data-active': String(entry.tabId === view.activeTabId) },
        h('button', { type: 'button', className: 'ab-tab-label', role: 'tab', 'aria-selected': entry.tabId === view.activeTabId, title: entry.url || t('pageTitle'), onClick: () => select(entry.tabId), onKeyDown: event => {
          if (['ArrowLeft', 'ArrowRight'].includes(event.key)) { event.preventDefault(); const index = view.tabs.findIndex(e => e.tabId === entry.tabId); const next = view.tabs[(index + (event.key === 'ArrowLeft' ? -1 : 1) + view.tabs.length) % view.tabs.length]; void select(next.tabId); event.currentTarget.parentElement.parentElement.querySelectorAll('[role=tab]')[(index + (event.key === 'ArrowLeft' ? -1 : 1) + view.tabs.length) % view.tabs.length]?.focus(); }
        } }, h(Icon, { name: entry.loading ? 'reload' : 'globe', size: 13, className: entry.loading ? 'ab-spinner' : undefined }), h('span', null, tabName(entry))),
        h('button', { className: 'ab-close', type: 'button', onClick: () => close(entry.tabId), title: `${t('close')} · ${tabName(entry)}`, 'aria-label': `${t('close')} · ${tabName(entry)}` }, h(Icon, { name: 'close', size: 12 }))))),
      iconButton('newTab', 'plus', newTab, view.tabs.length >= (settings.maxTabs || MAX_TABS))),
    h('form', { className: 'ab-toolbar', onSubmit: event => { event.preventDefault(); void navigate('open', draft); } },
      iconButton('back', 'back', () => navigate('back'), !active?.canGoBack), iconButton('forward', 'forward', () => navigate('forward'), !active?.canGoForward),
      active?.loading ? iconButton('stopLoading', 'close', () => { controls.current?.manager.current().page.stop(); }) : iconButton('reload', 'reload', () => navigate('reload'), blank),
      h('label', { className: 'ab-address' }, h(Icon, { name: active?.url?.startsWith('https:') ? 'lock' : 'globe', size: 13 }),
        h('input', { ref: address, value: draft, placeholder: t('address'), 'aria-label': t('address'), spellCheck: false, onFocus: event => event.currentTarget.select(), onChange: event => setDraft(event.target.value), onKeyDown: event => { if (event.key === 'Escape') { setDraft(active?.url || ''); event.currentTarget.blur(); } } }),
        h('button', { type: 'submit', className: 'ab-icon ab-go', title: t('go'), 'aria-label': t('go') }, h(Icon, { name: 'arrow', size: 14 }))),
      iconButton('settings', 'gear', () => setSettingsOpen(open => !open), false, { 'aria-pressed': settingsOpen }),
      activity.busy && h('div', { className: 'ab-agent-badge', 'aria-live': 'polite' }, String(locale).startsWith('zh') ? 'Agent 操作中' : 'Agent controlling'),
      active?.loading && h('div', { className: 'ab-progress', 'aria-hidden': true })),
    settingsOpen && h('div', { className: 'ab-settings', role: 'group', 'aria-label': settingsLabels.settings, style: { display: 'grid', gap: 8, padding: '10px 12px', borderBottom: '1px solid var(--ab-border)', background: 'var(--ab-layer)' } },
      h('label', { style: { display: 'flex', alignItems: 'center', gap: 8 } }, h('input', { type: 'checkbox', checked: settings.autoOpen, onChange: event => updateSettings({ autoOpen: event.target.checked }) }), settingsLabels.autoOpen),
      h('label', { style: { display: 'grid', gap: 4 } }, settingsLabels.homeUrl, h('input', { type: 'text', value: homeDraft, placeholder: 'https://…', spellCheck: false, onChange: event => setHomeDraft(event.target.value), onBlur: () => { const next = updateSettings({ homeUrl: homeDraft }); setHomeDraft(next.homeUrl); }, style: { padding: '4px 6px', border: '1px solid var(--ab-border)', borderRadius: 6, background: 'var(--ab-bg)', color: 'var(--ab-text)' } })),
      h('label', { style: { display: 'grid', gap: 4 } }, settingsLabels.maxTabs, h('input', { type: 'number', min: MIN_TABS, max: MAX_TABS, value: settings.maxTabs, onChange: event => updateSettings({ maxTabs: Number(event.target.value) }), style: { width: 90, padding: '4px 6px', border: '1px solid var(--ab-border)', borderRadius: 6, background: 'var(--ab-bg)', color: 'var(--ab-text)' } })),
      h('span', { style: { color: 'var(--ab-muted)', fontSize: 12 } }, settingsLabels.note)),
    (error || active?.error) && h('div', { className: 'ab-error', role: 'alert' }, h(Icon, { name: 'info', size: 15 }), h('span', null, error || active.error), iconButton('dismiss', 'close', () => { setError(''); controls.current?.manager.current().page.emit({ error: '' }); })),
    h('div', { className: 'ab-viewport' },
      h('div', { ref: container, className: 'ab-pages' }),
      blank && h('div', { className: 'ab-start' }, h('div', { className: 'ab-start-inner' },
        h('div', { className: 'ab-start-mark' }, h(Icon, { name: 'globe', size: 32 })), h('h2', null, t('startTitle')), h('p', null, t('startDescription')),
        h('form', { className: 'ab-start-search', onSubmit: event => { event.preventDefault(); void navigate('open', search); } }, h(Icon, { name: 'search', size: 18 }), h('input', { value: search, placeholder: t('address'), 'aria-label': t('address'), spellCheck: false, onChange: event => setSearch(event.target.value) }), h('button', { type: 'submit', className: 'ab-icon', title: t('go'), 'aria-label': t('go') }, h(Icon, { name: 'arrow' }))),
        h('nav', { className: 'ab-shortcuts', 'aria-label': t('shortcuts') }, [['DSH', 'D', 'https://github.com/deepseek-ai/deepseek-harness'], ['MDN', 'M', 'https://developer.mozilla.org/'], ['Wikipedia', 'W', 'https://www.wikipedia.org/']].map(([label, letter, url]) => h('button', { type: 'button', key: label, className: 'ab-shortcut', onClick: () => navigate('open', url) }, h('b', null, letter), label))))),
      h(AgentCursor, { point: agentPoint, visible: cursorShown || activity.busy || (marker && marker.tabId === view.activeTabId) }),
      h(ClickMarker, { marker: marker && marker.tabId === view.activeTabId ? marker : null })),
    h('div', { className: 'ab-footer' },
      h('div', { className: 'ab-status', role: 'status', 'aria-live': 'polite' }, activity.busy ? h('span', { className: 'ab-agent' }, h(Icon, { name: 'spark', size: 13 }), t(activity.operation || 'busy')) : h(React.Fragment, null, h('span', { className: 'ab-dot', style: { opacity: connection === 'connected' ? 1 : .3 } }), t(connection)),
        connection === 'offline' && h('button', { className: 'ab-stop', onClick: () => controls.current?.connect() }, t('reconnect'))),
      activity.busy ? h('button', { className: 'ab-stop', onClick: () => controls.current?.stop(), title: t('stop') }, h(Icon, { name: 'stop', size: 10 }), t('stop')) : h('button', { className: 'ab-session', title: t('details'), onClick: () => setDetails(value => !value) }, h(Icon, { name: 'lock', size: 11 }), t('session'))),
    details && h('div', { className: 'ab-info' }, t('sessionDetail'), h('br'), sessionId, h('br'), h('button', { className: 'ab-session', onClick: () => tab.actions.close() }, t('closePanel'))));
}
