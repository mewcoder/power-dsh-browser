import React from 'react';
import { RPC, call } from './rpc.js';
import { id, abortable } from './protocol.js';
import { ElectronPage, workspaceIdentity } from './electron-page.js';
import { SessionTabs } from './session-tabs.js';
import { Icon, shellCss, addressUrl, AnnotationWorkspace } from './browser-shell.js';
import { createAnnotationController } from './annotations.js';
import { SelectionOverlay, AnnotationMarkers } from './annotation-ui.js';
import { createAnnotationStore } from './annotation-store.js';
import { loadSettings, saveSettings } from './settings.js';
import { registerAnnotationReferenceSource, createAnnotationBatchInserter } from './annotation-composer.js';
const noopSubscribe = () => () => {}, noServices = () => null;
const h = React.createElement;
const CODEX_CURSOR = 'data:image/png;base64,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';
const KIND = 'dsh-agent-browser', ID = 'dsh-browser';
export const dictionaries = {
  en: { title: 'DSHX Browser', description: 'Browse and annotate with your Agent', address: 'Search or enter a website', go: 'Go', back: 'Back', forward: 'Forward', reload: 'Reload page', stopLoading: 'Stop loading', stop: 'Stop Agent', close: 'Close tab', closePanel: 'Close browser', newTab: 'New tab', home: 'Home', session: 'Current conversation', unavailable: 'Open DSH Desktop to use the shared browser.', starting: 'Connecting…', connected: 'Connected', offline: 'Agent disconnected', reconnect: 'Reconnect', busy: 'Agent is working', idle: 'Ready', loading: 'Loading…', stopped: 'Agent control stopped', error: 'Something went wrong', dismiss: 'Dismiss', startTitle: 'A page to explore', startDescription: 'Open a website, ask your Agent to help, or leave feedback directly on the page.', shortcuts: 'Quick links', pageTitle: 'New tab', sessionDetail: 'This browser is connected to the current conversation.', details: 'Connection details', tabLimit: 'You can keep up to 12 tabs open.', navigate: 'Opening a page', snapshot: 'Reading the page', act: 'Interacting with the page', screenshot: 'Taking a screenshot', tabs: 'Managing tabs', pick: 'Select an element', comments: 'Page annotations', secure: 'HTTPS connection', insecure: 'HTTP connection', retry: 'Try again' },
  zh: { title: 'DSHX 浏览器', description: '与 Agent 一起浏览、批注网页', address: '搜索或输入网址', go: '前往', back: '后退', forward: '前进', reload: '刷新页面', stopLoading: '停止加载', stop: '停止 Agent', close: '关闭标签页', closePanel: '关闭浏览器', newTab: '新标签页', home: '主页', session: '当前会话', unavailable: '请在 DSH Desktop 中使用共享浏览器。', starting: '正在连接…', connected: '已连接', offline: 'Agent 连接已断开', reconnect: '重新连接', busy: 'Agent 正在操作', idle: '就绪', loading: '加载中…', stopped: '已停止 Agent 控制', error: '暂时无法完成此操作', dismiss: '关闭提示', startTitle: '从这里开始探索', startDescription: '打开一个网页，让 Agent 帮你操作，也可以直接在页面上留下反馈。', shortcuts: '快捷访问', pageTitle: '新标签页', sessionDetail: '此浏览器连接到当前聊天会话。', details: '连接详情', tabLimit: '最多可同时打开 12 个标签页。', navigate: '正在打开网页', snapshot: '正在阅读页面', act: '正在操作页面', screenshot: '正在截图', tabs: '正在管理标签页', pick: '选择页面元素', comments: '页面批注', secure: 'HTTPS 连接', insecure: 'HTTP 连接', retry: '重试' },
};
export const inject = ['slots', 'locale', 'sidebarRight', 'sidebarRightTabs', 'remote'];
export async function apply(ctx) {
  const namespace = 'dshAgentBrowser', t = ctx.locale.bind(namespace);
  ctx.effect(() => ctx.locale.register(namespace, dictionaries));
  const listeners = new Set(), reviewers = new Set(); let availableDraftServices = null, baseDraftServices = null, referenceSource = null;
  const publishDraftServices = () => { availableDraftServices = baseDraftServices ? { ...baseDraftServices, referenceSource } : null; for (const listener of listeners) listener(); };
  const draftSource = { subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); }, getSnapshot: () => availableDraftServices, subscribeReview: listener => { reviewers.add(listener); return () => reviewers.delete(listener); } };
  const localeSource = { subscribe: listener => ctx.locale.subscribe(listener), getSnapshot: () => ctx.locale.getSnapshot().active };
  ctx.inject(['sessions', 'conversation'], optional => {
    const services = { sessions: optional.sessions, conversation: optional.conversation };
    optional.effect(() => {
      baseDraftServices = services; publishDraftServices();
      return () => { if (baseDraftServices === services) { baseDraftServices = null; publishDraftServices(); } };
    });
  });
  ctx.inject(['sessions', 'conversation', 'inputTriggers'], optional => optional.effect(() => {
    let source;
    try { source = registerAnnotationReferenceSource({ sessions: optional.sessions, conversation: optional.conversation, inputTriggers: optional.inputTriggers }, { locale: ctx.locale.getSnapshot().active, onReview: batch => { for (const reviewer of reviewers) reviewer(batch); } }); }
    catch { return () => {}; } // Reference support is optional; readable draft fallback remains available.
    referenceSource = source; publishDraftServices();
    return () => { source.dispose(); if (referenceSource === source) { referenceSource = null; publishDraftServices(); } };
  }));
  await ctx.remote.$mount({ package: ID, descriptors: RPC });
  ctx.inject(['remote.dshBrowser', 'workspaces'], scope => {
    scope.effect(() => scope.sidebarRightTabs.register({ id: ID, kind: KIND, title: () => t('title'), keepMounted: true, guide: [{ id: 'open', title: () => t('title'), description: () => t('description') }] }));
    scope.effect(() => scope.slots.inject('sidebar.right.pane.tab', () => scope.slots.register({ name: 'sidebar.right.pane.tab', key: ID, locale: namespace, inject: sessionId => ({ sessionId, remote: scope.remote, workspaces: scope.workspaces, draftSource, localeSource }) }, BrowserPanel)));
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
export function BrowserPanel({ sessionId, remote, workspaces, useTabInfo, t, draftSource, localeSource }) {
  const { tab } = useTabInfo();
  const draftServices = React.useSyncExternalStore(draftSource?.subscribe ?? noopSubscribe, draftSource?.getSnapshot ?? noServices, noServices);
  const locale = React.useSyncExternalStore(localeSource?.subscribe ?? noopSubscribe, localeSource?.getSnapshot ?? (() => 'en'), () => 'en');
  const [annotationControllers] = React.useState(() => new Map()), [annotationDocuments] = React.useState(() => new Map());
  const annotationStore = React.useMemo(() => createAnnotationStore({ sessionId }), [sessionId]);
  const annotationState = React.useSyncExternalStore(annotationStore.subscribe, annotationStore.getSnapshot, annotationStore.getSnapshot);
  const [annotationListOpen, setAnnotationListOpen] = React.useState(false), [publishing, setPublishing] = React.useState(false), [referenceReview, setReferenceReview] = React.useState(null), [annotationLocked, setAnnotationLocked] = React.useState(false), [markerRevision, setMarkerRevision] = React.useState(0);
  React.useEffect(() => draftSource?.subscribeReview?.(batch => { if (batch.sessionId === sessionId) { setReferenceReview(batch); annotationStore.enter(); setAnnotationListOpen(true); } }), [draftSource, sessionId, annotationStore]);
  const container = React.useRef(null), controls = React.useRef(null), address = React.useRef(null);
  const [view, setView] = React.useState({ activeTabId: null, tabs: [] });
  const [settings, setSettings] = React.useState(() => loadSettings()), [settingsOpen, setSettingsOpen] = React.useState(false);
  const [agentPoint, setAgentPoint] = React.useState(null), [cursorShown, setCursorShown] = React.useState(false);
  const [homeDraft, setHomeDraft] = React.useState(() => settings.homeUrl);
  const settingsLabels = String(locale).startsWith('zh')
    ? { settings: '设置', autoOpen: '需要时自动打开面板', homeUrl: '新标签默认主页', maxTabs: '最大标签数', note: '网络抓包上限在调用工具时按需指定。' }
    : { settings: 'Settings', autoOpen: 'Open panel when needed', homeUrl: 'New-tab home URL', maxTabs: 'Max tabs', note: 'Network capture limits are set per tool call.' };
  const updateSettings = patch => { const next = saveSettings(patch); setSettings(next); return next; };
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
      admitting = false; cancelPending(); void manager?.stopNetworkCaptures(); setMarker(null); for (const controller of annotationControllers.values()) controller.cancel();
      if (panelKey) {
        try { const result = await call(remote, 'stop', panelKey); epoch = result.epoch; admitting = true; }
        catch (error) { if (!closed) setError(error.message); }
      }
    };
    const run = async command => {
      const passive = ['status', 'inspect', 'console', 'network', 'cap'].includes(command.operation) || command.operation === 'tabs' && command.args.action === 'list';
      if (!passive && !closed) setAnnotationLocked(true);
      const control = new AbortController(); requests.set(command.id, control);
      try {
        // Reading connection/tab metadata must not discard the user's annotation.
        if (!passive) {
          for (const controller of annotationControllers.values()) await abortable(controller.unlock(), control.signal);
          annotationStore.setPicking(false);
        }
        control.signal.throwIfAborted();
        if (closed || !admitting || command.epoch !== epoch || command.expires <= Date.now()) return;
        const value = await manager.run({ ...command, signal: control.signal });
        if (!closed && panelKey && command.epoch === epoch) await call(remote, 'reply', panelKey, command.id, command.epoch, { ok: true, value });
      } catch (error) {
        if (!closed && panelKey && command.epoch === epoch) await call(remote, 'reply', panelKey, command.id, command.epoch, { ok: false, error: String(error.message).slice(0, 1000) }).catch(() => {});
      } finally { if (requests.get(command.id) === control) requests.delete(command.id); if (!passive && !closed) { setAnnotationLocked(false); setMarkerRevision(value => value + 1); } }
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
            annotationControllers.set(tabId, createAnnotationController(page, { onSelection: selection => {
              if (closed) return;
              try {
                const current = manager.getPage();
                if (!current || current.tabId !== tabId) return;
                annotationStore.setContext({ tabId, documentId: String(annotationDocuments.get(current.tabId) || 0), ...page.status() });
                annotationStore.capture(selection); setAnnotationListOpen(false);
              } catch (error) { annotationStore.notice(error.message); }
            } }));
            return page;
          },
          onChange: next => { if (!closed) setView(next); }, onActivity: next => { if (!closed) setActivity(next); },
          onSwitch: event => {
            if (event.reason === 'navigate') annotationDocuments.set(event.tabId, (annotationDocuments.get(event.tabId) || 0) + 1);
            for (const controller of annotationControllers.values()) controller.cancel();
            const current = manager?.getPage();
            annotationStore.setContext(current ? { tabId: current.tabId, documentId: String(annotationDocuments.get(current.tabId) || 0), ...current.page.status() } : {});
            if (!closed) setMarker(null);
          },
          onClose: tabId => { annotationControllers.get(tabId)?.dispose(); annotationControllers.delete(tabId); annotationDocuments.delete(tabId); },
        });
        controls.current = { manager, stop, connect, cancel: cancelPending, signal: life.signal,
          publishAnnotations: async batch => {
            if (!panelKey || closed) throw new Error('PANEL_DISCONNECTED');
            return call(remote, 'publishAnnotations', panelKey, batch);
          },
        };
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
  const activeAnnotation = annotationControllers.get(view.activeTabId);
  React.useEffect(() => {
    if (!activeAnnotation || !annotationState.mode || annotationLocked || activity.busy) return;
    const items = annotationStore.markers();
    void activeAnnotation.setMarkers(items, annotationState.markersVisible).catch(error => annotationStore.notice(error.message));
  }, [activeAnnotation, annotationState.items, annotationState.context, annotationState.mode, annotationState.markersVisible, annotationState.picking, annotationLocked, activity.busy, markerRevision]);
  const startPicking = () => perform(async () => {
    controls.current?.manager.cancel(); setReferenceReview(null); annotationStore.enter();
    const current = controls.current?.manager.getPage();
    if (!current) return;
    current.runner.invalidate();
    annotationStore.setContext({ tabId: current.tabId, documentId: String(annotationDocuments.get(current.tabId) || 0), ...current.page.status() });
    if (annotationStore.getSnapshot().items.length >= 20) { annotationStore.notice('ANNOTATION_ITEM_LIMIT'); return; }
    annotationStore.setPicking(true); setAnnotationListOpen(false);
    await activeAnnotation?.start();
  });
  const pausePicking = async () => {
    setAnnotationLocked(true);
    try { annotationStore.setPicking(false); await activeAnnotation?.unlock(); }
    finally { setAnnotationLocked(false); setMarkerRevision(value => value + 1); }
  };
  const saveAnnotation = async () => {
    try { annotationStore.save(); await pausePicking(); await startPicking(); }
    catch (error) { annotationStore.notice(error.message); }
  };
  const exitAnnotations = async () => { setReferenceReview(null); annotationStore.exit(); setAnnotationListOpen(false); try { await activeAnnotation?.unlock(); } catch (error) { annotationStore.notice(error.message); } };
  const editAnnotation = async itemId => { try { await pausePicking(); annotationStore.edit(itemId); setAnnotationListOpen(false); } catch (error) { annotationStore.notice(error.message); } };
  const publishAnnotations = async () => {
    if (publishing) return; setPublishing(true);
    try {
      await pausePicking();
      const batch = annotationStore.confirm();
      const publish = controls.current?.publishAnnotations;
      if (!publish) throw new Error('PANEL_DISCONNECTED');
      await publish(batch);
      annotationStore.notice('ANNOTATIONS_PUBLISHED');
      if (!draftServices) throw new Error('DRAFT_UNAVAILABLE');
      const result = await createAnnotationBatchInserter(draftServices, sessionId, { locale })(batch);
      if (!result?.ok) throw new Error('DRAFT_CHANGED');
      annotationStore.notice(result.mode === 'chip' ? 'ANNOTATIONS_INSERTED' : 'ANNOTATIONS_TEXT_FALLBACK');
      setAnnotationListOpen(true);
    } catch (error) { annotationStore.notice(error.message); }
    finally { setPublishing(false); }
  };
  return h('section', { 'data-dsh-agent-browser': '', 'aria-label': t('title') },
    h('style', null, shellCss),
    h('div', { className: 'ab-tabs' },
      h('div', { className: 'ab-tabscroll', role: 'tablist', 'aria-label': t('title') }, view.tabs.map(entry => h('div', { className: 'ab-tab', key: entry.tabId, 'data-active': String(entry.tabId === view.activeTabId) },
        h('button', { type: 'button', className: 'ab-tab-label', role: 'tab', 'aria-selected': entry.tabId === view.activeTabId, title: entry.url || t('pageTitle'), onClick: () => select(entry.tabId), onKeyDown: event => {
          if (['ArrowLeft', 'ArrowRight'].includes(event.key)) { event.preventDefault(); const index = view.tabs.findIndex(e => e.tabId === entry.tabId); const next = view.tabs[(index + (event.key === 'ArrowLeft' ? -1 : 1) + view.tabs.length) % view.tabs.length]; void select(next.tabId); event.currentTarget.parentElement.parentElement.querySelectorAll('[role=tab]')[(index + (event.key === 'ArrowLeft' ? -1 : 1) + view.tabs.length) % view.tabs.length]?.focus(); }
        } }, h(Icon, { name: entry.loading ? 'reload' : 'globe', size: 13, className: entry.loading ? 'ab-spinner' : undefined }), h('span', null, tabName(entry))),
        h('button', { className: 'ab-close', type: 'button', onClick: () => close(entry.tabId), title: `${t('close')} · ${tabName(entry)}`, 'aria-label': `${t('close')} · ${tabName(entry)}` }, h(Icon, { name: 'close', size: 12 }))))),
      iconButton('newTab', 'plus', newTab, view.tabs.length >= (settings.maxTabs || 12))),
    h('form', { className: 'ab-toolbar', onSubmit: event => { event.preventDefault(); void navigate('open', draft); } },
      iconButton('back', 'back', () => navigate('back'), !active?.canGoBack), iconButton('forward', 'forward', () => navigate('forward'), !active?.canGoForward),
      active?.loading ? iconButton('stopLoading', 'close', () => { controls.current?.manager.current().page.stop(); }) : iconButton('reload', 'reload', () => navigate('reload'), blank),
      h('label', { className: 'ab-address' }, h(Icon, { name: active?.url?.startsWith('https:') ? 'lock' : 'globe', size: 13 }),
        h('input', { ref: address, value: draft, placeholder: t('address'), 'aria-label': t('address'), spellCheck: false, onFocus: event => event.currentTarget.select(), onChange: event => setDraft(event.target.value), onKeyDown: event => { if (event.key === 'Escape') { setDraft(active?.url || ''); event.currentTarget.blur(); } } }),
        h('button', { type: 'submit', className: 'ab-icon ab-go', title: t('go'), 'aria-label': t('go') }, h(Icon, { name: 'arrow', size: 14 }))),
      iconButton('pick', 'cursor', startPicking, !active?.ready || blank || activity.busy),
      iconButton('comments', 'comment', () => { annotationStore.enter(); setAnnotationListOpen(open => !open); }, false, { 'aria-pressed': annotationState.mode }),
      iconButton('settings', 'gear', () => setSettingsOpen(open => !open), false, { 'aria-pressed': settingsOpen }),
      activity.busy && h('div', { className: 'ab-agent-badge', 'aria-live': 'polite' }, String(locale).startsWith('zh') ? 'Agent 操作中' : 'Agent controlling'),
      active?.loading && h('div', { className: 'ab-progress', 'aria-hidden': true })),
    settingsOpen && h('div', { className: 'ab-settings', role: 'group', 'aria-label': settingsLabels.settings, style: { display: 'grid', gap: 8, padding: '10px 12px', borderBottom: '1px solid var(--ab-border)', background: 'var(--ab-layer)' } },
      h('label', { style: { display: 'flex', alignItems: 'center', gap: 8 } }, h('input', { type: 'checkbox', checked: settings.autoOpen, onChange: event => updateSettings({ autoOpen: event.target.checked }) }), settingsLabels.autoOpen),
      h('label', { style: { display: 'grid', gap: 4 } }, settingsLabels.homeUrl, h('input', { type: 'text', value: homeDraft, placeholder: 'https://…', spellCheck: false, onChange: event => setHomeDraft(event.target.value), onBlur: () => { const next = updateSettings({ homeUrl: homeDraft }); setHomeDraft(next.homeUrl); }, style: { padding: '4px 6px', border: '1px solid var(--ab-border)', borderRadius: 6, background: 'var(--ab-bg)', color: 'var(--ab-text)' } })),
      h('label', { style: { display: 'grid', gap: 4 } }, settingsLabels.maxTabs, h('input', { type: 'number', min: 1, max: 12, value: settings.maxTabs, onChange: event => updateSettings({ maxTabs: Number(event.target.value) }), style: { width: 90, padding: '4px 6px', border: '1px solid var(--ab-border)', borderRadius: 6, background: 'var(--ab-bg)', color: 'var(--ab-text)' } })),
      h('span', { style: { color: 'var(--ab-muted)', fontSize: 12 } }, settingsLabels.note)),
    (error || active?.error) && h('div', { className: 'ab-error', role: 'alert' }, h(Icon, { name: 'info', size: 15 }), h('span', null, error || active.error), iconButton('dismiss', 'close', () => { setError(''); controls.current?.manager.current().page.emit({ error: '' }); })),
    h('div', { className: 'ab-viewport' },
      h('div', { ref: container, className: 'ab-pages' }),
      blank && h('div', { className: 'ab-start' }, h('div', { className: 'ab-start-inner' },
        h('div', { className: 'ab-start-mark' }, h(Icon, { name: 'globe', size: 32 })), h('h2', null, t('startTitle')), h('p', null, t('startDescription')),
        h('form', { className: 'ab-start-search', onSubmit: event => { event.preventDefault(); void navigate('open', search); } }, h(Icon, { name: 'search', size: 18 }), h('input', { value: search, placeholder: t('address'), 'aria-label': t('address'), spellCheck: false, onChange: event => setSearch(event.target.value) }), h('button', { type: 'submit', className: 'ab-icon', title: t('go'), 'aria-label': t('go') }, h(Icon, { name: 'arrow' }))),
        h('nav', { className: 'ab-shortcuts', 'aria-label': t('shortcuts') }, [['DSH', 'D', 'https://github.com/deepseek-ai/deepseek-harness'], ['MDN', 'M', 'https://developer.mozilla.org/'], ['Wikipedia', 'W', 'https://www.wikipedia.org/']].map(([label, letter, url]) => h('button', { type: 'button', key: label, className: 'ab-shortcut', onClick: () => navigate('open', url) }, h('b', null, letter), label))))),
      (cursorShown || activity.busy || (marker && marker.tabId === view.activeTabId)) && agentPoint && h('div', { className: 'ab-agent-cursor', style: { left: agentPoint.x, top: agentPoint.y }, 'aria-hidden': true },
        h('img', { src: CODEX_CURSOR, width: 30, height: 31, alt: '', draggable: false })),
      marker && marker.tabId === view.activeTabId && h('div', { key: marker.key, className: 'ab-click-marker', style: { left: marker.x, top: marker.y }, 'aria-hidden': true }),
      h(SelectionOverlay, { controller: activeAnnotation, disabled: activity.busy || annotationLocked, locale }),
      annotationState.mode && h(AnnotationMarkers, { controller: activeAnnotation, disabled: activity.busy || annotationLocked, onMarker: editAnnotation }),
      h(AnnotationWorkspace, { state: referenceReview ? { ...annotationState, items: referenceReview.items, editor: null, picking: false } : annotationState, store: annotationStore, locale, disabled: !!referenceReview || !active?.ready || activity.busy || blank, publishing, listOpen: annotationListOpen,
        onListToggle: () => setAnnotationListOpen(open => !open), onPick: startPicking, onPause: () => { void pausePicking().catch(error => annotationStore.notice(error.message)); }, onSave: saveAnnotation,
        onEdit: editAnnotation, onExit: exitAnnotations, onPublish: publishAnnotations,
        onVisible: () => annotationStore.setMarkersVisible(!annotationState.markersVisible),
        onClear: () => { annotationStore.clear(); void activeAnnotation?.unlock().catch(error => annotationStore.notice(error.message)); },
      })), 
    h('div', { className: 'ab-footer' },
      h('div', { className: 'ab-status', role: 'status', 'aria-live': 'polite' }, activity.busy ? h('span', { className: 'ab-agent' }, h(Icon, { name: 'spark', size: 13 }), t(activity.operation || 'busy')) : h(React.Fragment, null, h('span', { className: 'ab-dot', style: { opacity: connection === 'connected' ? 1 : .3 } }), t(connection)),
        connection === 'offline' && h('button', { className: 'ab-stop', onClick: () => controls.current?.connect() }, t('reconnect'))),
      activity.busy ? h('button', { className: 'ab-stop', onClick: () => controls.current?.stop(), title: t('stop') }, h(Icon, { name: 'stop', size: 10 }), t('stop')) : h('button', { className: 'ab-session', title: t('details'), onClick: () => setDetails(value => !value) }, h(Icon, { name: 'lock', size: 11 }), t('session'))),
    details && h('div', { className: 'ab-info' }, t('sessionDetail'), h('br'), sessionId, h('br'), h('button', { className: 'ab-session', onClick: () => tab.actions.close() }, t('closePanel'))));
}
