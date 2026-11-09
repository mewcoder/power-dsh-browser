import { id, BrowserError, abortable, httpUrl } from './protocol.js';
import { MAX_TABS } from './constants.js';
import { PageRunner } from './runner.js';

// One panel owns every guest below it. Tab switching never transfers a guest
// lease, and references from one tab cannot address another tab's document.
export class SessionTabs {
  entries = new Map(); activeTabId = null; closed = false; request = null;
  constructor({ createPage, createContainer, workspace, signal, maxTabs = MAX_TABS, onChange = () => {}, onActivity = () => {}, onSwitch = () => {}, onClose = () => {} }) {
    Object.assign(this, { createPage, createContainer, workspace, signal, maxTabs, onChange, onActivity, onSwitch, onClose });
  }
  list() { return { activeTabId: this.activeTabId, tabs: [...this.entries.values()].map(entry => ({ tabId: entry.tabId, ...entry.page.status() })) }; }
  emit() { if (!this.closed) this.onChange(this.list()); }
  current() { const entry = this.entries.get(this.activeTabId); if (!entry) throw new BrowserError('NO_ACTIVE_TAB'); return entry; }
  getPage() { if (!this.activeTabId) return null; const { tabId, page, runner } = this.current(); return { tabId, page, runner }; }
  async newTab(url, signal = this.signal) {
    if (this.closed) throw new BrowserError('PANEL_CLOSED');
    if (this.entries.size >= this.maxTabs) throw new BrowserError('TAB_LIMIT', 'Close a tab before opening another');
    if (url) url = httpUrl(url);
    signal.throwIfAborted();
    const previousActive = this.activeTabId;
    const tabId = id(), container = this.createContainer(tabId), lifetime = new AbortController();
    const entry = { tabId, container, lifetime };
    const page = this.createPage(container, () => this.emit(), () => { entry.runner.invalidate(); if (this.activeTabId === tabId) this.onSwitch({ reason: 'navigate', tabId }); }, tabId);
    const runner = new PageRunner(page, busy => this.onActivity({ busy, operation: this.request?.operation, tabId }));
    Object.assign(entry, { page, runner }); this.entries.set(tabId, entry);
    this.select(tabId, 'agent');
    const life = AbortSignal.any([this.signal, lifetime.signal]);
    entry.mounted = page.mount(this.workspace, life);
    // Surface a mount failure without creating an unhandled background rejection.
    entry.mounted.catch(error => { if (!life.aborted && !this.closed) { page.emit?.({ error: error.message }); this.emit(); } });
    this.emit();
    try {
      if (url) {
        await abortable(entry.mounted, signal); signal.throwIfAborted();
        await abortable(page.navigate('open', url, signal), signal);
      }
      signal.throwIfAborted(); return { tabId, ...this.list() };
    } catch (error) {
      if (signal.aborted && this.entries.get(tabId) === entry) {
        lifetime.abort(); runner.dispose(); this.onClose(tabId); this.entries.delete(tabId);
        const wasActive = this.activeTabId === tabId;
        if (wasActive) { this.activeTabId = null; const previous = this.entries.has(previousActive) ? previousActive : [...this.entries.keys()].at(-1); if (previous) this.select(previous, 'agent'); }
        container.remove(); void page.dispose().catch(() => {}); this.emit();
      }
      throw error;
    }
  }
  select(tabId, source = 'user') {
    if (!this.entries.has(tabId)) throw new BrowserError('TAB_NOT_FOUND');
    if (this.activeTabId !== tabId) {
      if (source === 'user') this.cancel();
      const previous = this.entries.get(this.activeTabId);
      previous?.runner.cancel();
      this.activeTabId = tabId;
      this.current().runner.invalidate();
      this.onSwitch({ reason: 'select', tabId });
    }
    for (const entry of this.entries.values()) {
      const selected = entry.tabId === tabId;
      entry.container.style.visibility = selected ? 'visible' : 'hidden';
      entry.container.style.pointerEvents = selected ? 'auto' : 'none';
      entry.container.setAttribute('aria-hidden', String(!selected));
    }
    this.emit(); return this.list();
  }
  async close(tabId, source = 'user', signal = this.signal) {
    signal.throwIfAborted();
    const entry = this.entries.get(tabId); if (!entry) throw new BrowserError('TAB_NOT_FOUND');
    if (source === 'user') this.cancel();
    this.onClose(tabId); entry.lifetime.abort(); entry.runner.dispose(); this.entries.delete(tabId);
    if (this.activeTabId === tabId) {
      this.activeTabId = null;
      const next = [...this.entries.keys()].at(-1);
      if (next) this.select(next, 'agent');
      else this.onSwitch({ reason: 'close', tabId });
    }
    this.emit();
    try { await abortable(entry.page.dispose(), signal); } finally { entry.container.remove(); }
    signal.throwIfAborted();
    if (!this.entries.size && !this.closed) await this.newTab(undefined, signal);
    signal.throwIfAborted(); return this.list();
  }
  cancel(requestId) {
    if (this.request && (!requestId || requestId === this.request.id)) this.request.controller.abort(new BrowserError('CANCELLED'));
    for (const entry of this.entries.values()) entry.runner.cancel(requestId);
  }
  stopNetworkCaptures() {
    return Promise.allSettled([...this.entries.values()].map(entry => entry.page.stopNetworkCapture?.()));
  }
  async navigate(action, url, signal = this.signal) {
    const entry = this.current(); this.cancel();
    await abortable(entry.mounted, signal);
    return entry.page.navigate(action, url, signal);
  }
  async run(command) {
    if (this.closed) throw new BrowserError('PANEL_CLOSED');
    if (this.request) throw new BrowserError('BUSY');
    if (command.expires <= Date.now()) throw new BrowserError('REQUEST_EXPIRED');
    const controller = new AbortController(), request = { id: command.id, operation: command.operation, controller };
    this.request = request;
    const timer = setTimeout(() => controller.abort(new BrowserError('TIMEOUT')), Math.max(1, command.expires - Date.now()));
    const signal = AbortSignal.any([controller.signal, this.signal, ...(command.signal ? [command.signal] : [])]);
    try {
      if (command.operation === 'tabs') {
        const { action, tabId, url } = command.args;
        if (action === 'list') return this.list();
        this.onActivity({ busy: true, operation: 'tabs', tabId: this.activeTabId });
        if (action === 'new') return await abortable(this.newTab(url, signal), signal);
        if (action === 'select') return this.select(tabId, 'agent');
        if (action === 'close') return await abortable(this.close(tabId || this.activeTabId, 'agent', signal), signal);
        throw new BrowserError('INVALID_TAB_ACTION');
      }
      const entry = this.current(), tabId = entry.tabId;
      if (['act', 'inspect', 'console', 'network', 'cap'].includes(command.operation) && command.args.tabId !== tabId) throw new BrowserError('STALE_TAB', 'Select the observed tab and take a fresh snapshot');
      if (command.args.tabId && command.args.tabId !== tabId) throw new BrowserError('TAB_NOT_ACTIVE');
      signal.throwIfAborted();
      if (command.operation === 'status') return { ...entry.page.status(), tabId, connected: true, tabCount: this.entries.size };
      await abortable(entry.mounted, signal);
      signal.throwIfAborted();
      const value = await abortable(entry.runner.run({ ...command, signal }), signal);
      signal.throwIfAborted();
      if (this.activeTabId !== tabId || !this.entries.has(tabId)) throw new BrowserError('TAB_CHANGED');
      return { ...value, tabId };
    } finally {
      clearTimeout(timer);
      if (this.request === request) { this.request = null; this.onActivity({ busy: false, tabId: this.activeTabId }); }
    }
  }
  async dispose() {
    if (this.closed) return; this.closed = true; this.cancel();
    const entries = [...this.entries.values()]; this.entries.clear(); this.activeTabId = null;
    await Promise.all(entries.map(async entry => { this.onClose(entry.tabId); entry.lifetime.abort(); entry.runner.dispose(); try { await entry.page.dispose(); } finally { entry.container.remove(); } }));
  }
}
