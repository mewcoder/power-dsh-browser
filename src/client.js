import React from 'react';
import { GuideArtworkBrowser } from '@deepseek-ai/dsh-client-ui-primitives';
import { RPC, call } from './rpc.js';
import { id, abortable } from './protocol.js';
import { ElectronPage, workspaceIdentity } from './electron-page.js';
import { SessionTabs } from './session-tabs.js';
import { Icon, shellCss, addressUrl } from './browser-shell.js';
import { loadSettings, subscribeSettings } from './settings.js';
import { startHostSettingsMigration } from './settings-migration.js';
import { usePanelSettings } from './use-panel-settings.js';
import { MAX_TABS, PLUGIN_ID } from './constants.js';
import { BrowserSettingsPage } from './settings-page.js';
import { AgentCursor, ClickMarker } from './agent-cursor.js';
const noopSubscribe = () => () => {}, noServices = () => null;
const h = React.createElement;
const KIND = PLUGIN_ID, ID = PLUGIN_ID;
import { dictionaries } from './locale.js';
export { dictionaries };
export const inject = ['slots', 'locale', 'sidebarRight', 'sidebarRightTabs', 'remote', 'configForms'];
export async function apply(ctx) {
  const namespace = 'powerDshBrowser', t = ctx.locale.bind(namespace);
  ctx.effect(() => ctx.locale.register(namespace, dictionaries));
  const localeSource = { subscribe: listener => ctx.locale.subscribe(listener), getSnapshot: () => ctx.locale.getSnapshot().active };
  await ctx.remote.$mount({ package: ID, descriptors: RPC });
  ctx.inject(['remote.dshBrowser', 'workspaces', 'configForms'], scope => {
    scope.effect(() => startHostSettingsMigration(scope.configForms));
    // Which kind the sidebar entry currently uses; read by the auto-open demand.
    const takeover = { on: undefined };
    // Sidebar entry: one browser — ours or the Host's built-in. With the takeover
    // preference on, register the built-in "browser" kind: the extension band
    // shadows the builtin type (disposing our registration restores it), and
    // `multiple: false` makes chat links reuse this single panel through
    // navigation params. Off: the plugin keeps its own kind alongside it.
    scope.effect(() => {
      const guide = [{ id: 'open', title: () => t('title'), description: () => t('description') }];
      const readTakeover = () => {
        try {
          const value = scope.configForms?.get(PLUGIN_ID)?.getSnapshot()?.value;
          if (typeof value?.takeOverBrowser === 'boolean') return value.takeOverBrowser;
        } catch { /* Host settings unavailable; local value stands. */ }
        return loadSettings().takeOverBrowser;
      };
      let release;
      const sync = () => {
        const on = readTakeover();
        if (on === takeover.on) return;
        takeover.on = on;
        release?.();
        // A failed registration must not poison the settings stores' notify
        // chains; the next sync retries from the current preference value.
        try {
          release = scope.sidebarRightTabs.register(on
            // Takeover card reads as the plain native browser: native title copy and
            // the host UI kit's browser glyph (registry guide shows only the kind in
            // force, so the builtin card disappears from the "+" menu).
            ? { id: ID, kind: 'browser', multiple: false, keepMounted: true, title: () => t('browserTitle'), guide: [{ id: 'open', icon: GuideArtworkBrowser, title: () => t('browserTitle'), description: () => t('description') }] }
            : { id: ID, kind: KIND, keepMounted: true, title: () => t('title'), guide });
        } catch { release = undefined; takeover.on = undefined; }
      };
      sync();
      // The preference may live in either store: the Host settings document
      // (authoritative) or localStorage when the Host form never becomes ready.
      let unsubscribe, unsubscribeLocal;
      try { unsubscribe = scope.configForms?.get(PLUGIN_ID)?.subscribe?.(sync); } catch { /* form unavailable; local changes still drive sync */ }
      try { unsubscribeLocal = subscribeSettings(() => sync()); } catch { /* ignore */ }
      return () => { try { unsubscribe?.(); unsubscribeLocal?.(); } catch { /* ignore */ } release?.(); };
    });
    scope.effect(() => scope.slots.inject('sidebar.right.pane.tab', () => scope.slots.register({ name: 'sidebar.right.pane.tab', key: ID, locale: namespace, inject: sessionId => ({ sessionId, remote: scope.remote, workspaces: scope.workspaces, localeSource, configForms: scope.configForms }) }, BrowserPanel)));
    // Settings → PowerDSH Browser. Reads/writes the Host settings document through the
    // shared config form, so preferences follow the account and survive reloads.
    scope.effect(() => {
      if (!scope.configForms) return () => {};
      const form = scope.configForms.get(PLUGIN_ID);
      const SettingsPage = () => h(BrowserSettingsPage, { form, configForms: scope.configForms, t });
      const releaseSection = scope.slots.inject('settings.section', () => scope.slots.register({ name: 'settings.section', id: PLUGIN_ID, order: 60, locale: namespace, label: () => t('settingsTitle') }, SettingsPage));
      const releaseIcon = scope.slots.inject('settings.section.icon', () => scope.slots.register({ name: 'settings.section.icon', id: PLUGIN_ID }, ({ size = 16 } = {}) => h(Icon, { name: 'globe', size })));
      return () => { releaseSection(); releaseIcon(); };
    });
    // Open the PowerDSH Browser panel only when a browser tool actually needs it: the
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
                try { ctx.sidebarRight.openTab(takeover.on ? 'browser' : KIND); }
                catch { try { ctx.sidebarRight.toggleExpanded?.(); ctx.sidebarRight.openTab(takeover.on ? 'browser' : KIND); } catch { /* surface not ready; retry */ } }
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
export function BrowserPanel({ sessionId, remote, workspaces, useTabInfo, t, localeSource, configForms }) {
  const { tab } = useTabInfo();
  const locale = React.useSyncExternalStore(localeSource?.subscribe ?? noopSubscribe, localeSource?.getSnapshot ?? (() => 'en'), () => 'en');
  const container = React.useRef(null), controls = React.useRef(null), address = React.useRef(null);
  const [view, setView] = React.useState({ activeTabId: null, tabs: [] });
  const { settings } = usePanelSettings(configForms);
  const [agentPoint, setAgentPoint] = React.useState(null), [cursorShown, setCursorShown] = React.useState(false);
  const [draft, setDraft] = React.useState('');
  const [activity, setActivity] = React.useState({ busy: false }), [connection, setConnection] = React.useState('starting'), [error, setError] = React.useState(''), [details, setDetails] = React.useState(false), [marker, setMarker] = React.useState(null);
  const active = view.tabs.find(entry => entry.tabId === view.activeTabId);
  React.useEffect(() => { setDraft(active?.url || ''); setError(''); setMarker(null); }, [active?.tabId, active?.url]);
  // Takeover mode: chat links arrive as sidebar-tab navigation params and reuse
  // this one panel. The mount-time URL opens with the initial tab; later values
  // open a further internal tab (falling back to navigating when tabs are full).
  const incomingUrl = typeof tab?.navigation?.params?.url === 'string' ? tab.navigation.params.url : '';
  const seenIncoming = React.useRef(incomingUrl);
  React.useEffect(() => {
    if (!incomingUrl || seenIncoming.current === incomingUrl) return;
    seenIncoming.current = incomingUrl;
    const c = controls.current; if (!c) return;
    c.cancel();
    void (async () => {
      try { await c.manager.newTab(addressUrl(incomingUrl)); }
      catch (error) {
        if (!String(error?.message || '').includes('TAB_LIMIT')) return;
        try { await c.manager.navigate('open', addressUrl(incomingUrl)); } catch { /* surfaced in the alert row */ }
      }
    })();
  }, [incomingUrl]);
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
      const control = new AbortController(); requests.set(command.id, control);
      try {
        control.signal.throwIfAborted();
        if (closed || !admitting || command.epoch !== epoch || command.expires <= Date.now()) return;
        const value = await manager.run({ ...command, signal: control.signal });
        if (!closed && panelKey && command.epoch === epoch) await call(remote, 'reply', panelKey, command.id, command.epoch, { ok: true, value });
      } catch (error) {
        if (!closed && panelKey && command.epoch === epoch) await call(remote, 'reply', panelKey, command.id, command.epoch, { ok: false, error: String(error.message).slice(0, 1000) }).catch(() => {});
      } finally { if (requests.get(command.id) === control) requests.delete(command.id); }
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
        // Expose the panel's imperative controls to the toolbar handlers above.
        controls.current = { manager, stop, connect, cancel: cancelPending };
        await manager.newTab(incomingUrl || prefs.homeUrl || undefined); life.signal.throwIfAborted(); await connect();
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
  return h('section', { 'data-power-dsh-browser': '', 'aria-label': t('title') },
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
      iconButton('openExternal', 'external', () => { if (active?.url) window.open(active.url, '_blank', 'noopener,noreferrer'); }, !active?.url),
      activity.busy && h('div', { className: 'ab-agent-badge', 'aria-live': 'polite' }, String(locale).startsWith('zh') ? 'Agent 操作中' : 'Agent controlling'),
      active?.loading && h('div', { className: 'ab-progress', 'aria-hidden': true })),
    (error || active?.error) && h('div', { className: 'ab-error', role: 'alert' }, h(Icon, { name: 'info', size: 15 }), h('span', null, error || active.error), iconButton('dismiss', 'close', () => { setError(''); controls.current?.manager.current().page.emit({ error: '' }); })),
    h('div', { className: 'ab-viewport' },
      h('div', { ref: container, className: 'ab-pages' }),
      blank && h('div', { className: 'ab-start' }, h('div', { className: 'ab-start-inner' },
        h('p', { className: 'ab-start-hint' }, t('startHint')),
        h('nav', { className: 'ab-shortcuts', 'aria-label': t('shortcuts') }, [['DSH', 'D', 'https://github.com/deepseek-ai/deepseek-harness'], ['MDN', 'M', 'https://developer.mozilla.org/'], ['Wikipedia', 'W', 'https://www.wikipedia.org/']].map(([label, letter, url]) => h('button', { type: 'button', key: label, className: 'ab-shortcut', onClick: () => navigate('open', url) }, h('b', null, letter), label))))),
      h(AgentCursor, { point: agentPoint, visible: cursorShown || activity.busy || (marker && marker.tabId === view.activeTabId) }),
      h(ClickMarker, { marker: marker && marker.tabId === view.activeTabId ? marker : null })),
    h('div', { className: 'ab-footer' },
      h('div', { className: 'ab-status', role: 'status', 'aria-live': 'polite' }, activity.busy ? h('span', { className: 'ab-agent' }, h(Icon, { name: 'spark', size: 13 }), t(activity.operation || 'busy')) : h(React.Fragment, null, h('span', { className: 'ab-dot', style: { opacity: connection === 'connected' ? 1 : .3 } }), t(connection)),
        connection === 'offline' && h('button', { className: 'ab-stop', onClick: () => controls.current?.connect() }, t('reconnect'))),
      activity.busy ? h('button', { className: 'ab-stop', onClick: () => controls.current?.stop(), title: t('stop') }, h(Icon, { name: 'stop', size: 10 }), t('stop')) : h('button', { className: 'ab-session', title: t('details'), onClick: () => setDetails(value => !value) }, h(Icon, { name: 'lock', size: 11 }), t('session'))),
    details && h('div', { className: 'ab-info' }, t('sessionDetail'), h('br'), sessionId, h('br'), h('button', { className: 'ab-session', onClick: () => tab.actions.close() }, t('closePanel'))));
}
