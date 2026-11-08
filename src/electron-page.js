import { BrowserError, httpUrl } from './protocol.js';
import { GuestNetwork } from './network-client.js';
import { GuestCap } from './cap-client.js';
export class ElectronPage {
  element = null; reservation = null; listeners = []; released = false;
  consoleMessages = []; consoleDropped = 0;
  state = { initialized: false, ready: false, url: '', title: '', loading: false, canGoBack: false, canGoForward: false, error: '' };
  constructor(bridge, container, origin, update, invalidate, { onInput, onOpen } = {}) { Object.assign(this, { bridge, container, origin, update, invalidate, onInput, onOpen }); }
  status() { return { ...this.state, desktop: true, network: this.networkClient?.status() ?? { available: false, capturing: false, captureId: null } }; }
  readNetwork(args, signal) {
    if (!this.networkClient) throw new BrowserError('PAGE_NOT_INITIALIZED');
    return this.networkClient.request(args, signal);
  }
  stopNetworkCapture() { return this.networkClient?.stopCapture() ?? Promise.resolve(); }
  readCap(args, signal) {
    if (!this.capClient) throw new BrowserError('PAGE_NOT_INITIALIZED');
    return this.capClient.request(args, signal);
  }
  emit(patch) { Object.assign(this.state, patch); if (!this.released) this.update(this.status()); }
  recordConsole(event) {
    if (this.released) return;
    const small = (value, limit) => typeof value === 'string' ? value.slice(0, limit).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '') : '';
    let sourceId = '';
    try {
      const url = new URL(small(event.sourceId, 2048), this.state.url || undefined);
      if (['http:', 'https:'].includes(url.protocol)) { url.username = ''; url['pass' + 'word'] = ''; sourceId = url.href.slice(0, 512); }
    } catch { if (/^VM\d+$/.test(event.sourceId || '')) sourceId = small(event.sourceId, 80); }
    this.consoleMessages.push({ level: Number.isInteger(event.level) && event.level >= 0 && event.level <= 3 ? event.level : 1, message: small(event.message, 2000), line: Number.isSafeInteger(event.line) && event.line >= 0 ? event.line : 0, sourceId });
    if (this.consoleMessages.length > 50) { this.consoleMessages.shift(); this.consoleDropped = Math.min(Number.MAX_SAFE_INTEGER, this.consoleDropped + 1); }
  }
  readConsole({ clear = false } = {}) {
    if (clear !== true && clear !== false) throw new BrowserError('INVALID_CONSOLE_OPTIONS');
    const value = { messages: this.consoleMessages.map(message => ({ ...message })), truncated: this.consoleDropped > 0, dropped: this.consoleDropped, untrusted: true, scope: 'owned-guest' };
    // Escaped messages can exceed the RPC envelope despite the ring count cap.
    while (JSON.stringify(value).length > 60000 && value.messages.length) { value.messages.shift(); value.dropped++; value.truncated = true; }
    if (clear) { this.consoleMessages = []; this.consoleDropped = 0; }
    return value;
  }
  listen(name, callback) {
    this.element.addEventListener(name, callback);
    this.listeners.push(() => this.element?.removeEventListener(name, callback));
  }
  async mount(workspace, signal) {
    const reservation = await this.bridge.acquire(workspace);
    this.reservation = reservation;
    this.networkClient = new GuestNetwork(this.bridge.network, reservation.lease);
    this.capClient = new GuestCap(this.bridge.cap, reservation.lease);
    if (signal.aborted || this.released) { this.networkClient.dispose(); await this.bridge.release(reservation.lease); return; }
    const frame = document.createElement('webview'); this.element = frame;
    frame.style.cssText = 'display:flex;flex:1;width:100%;height:100%;min-height:200px';
    frame.setAttribute('name', reservation.lease);
    frame.setAttribute('partition', reservation.partition);
    frame.setAttribute('data-sidebar-browser-frame', '');
    frame.setAttribute('allowpopups', '');
    frame.setAttribute('src', `about:blank#${reservation.lease}`);
    // Public webview console-message uses numeric level, message, line and
    // sourceId (the webContents main-process event has a different shape).
    this.listen('console-message', event => this.recordConsole(event));
    this.listen('dom-ready', () => this.emit({ initialized: true, ready: true, error: '' }));
    this.listen('did-start-navigation', event => {
      if (event.isMainFrame) {
        if (!event.isInPlace) { this.consoleMessages = []; this.consoleDropped = 0; }
        this.invalidate(); this.emit({ ready: false, loading: true, error: '' });
      }
    });
    const info = () => {
      if (this.released) return;
      this.emit({ url: frame.getURL().startsWith('about:blank') ? '' : frame.getURL(), title: frame.getTitle().slice(0, 500), canGoBack: frame.canGoBack(), canGoForward: frame.canGoForward() });
    };
    this.listen('did-navigate', info); this.listen('did-navigate-in-page', event => { if (event.isMainFrame) { this.invalidate(); info(); this.emit({ ready: true }); } });
    this.listen('page-title-updated', info);
    this.listen('did-start-loading', () => this.emit({ loading: true }));
    this.listen('did-stop-loading', () => { info(); this.emit({ loading: false }); });
    this.listen('did-fail-load', event => {
      if (event.isMainFrame && event.errorCode !== -3) this.emit({ ready: false, loading: false, error: `${event.errorCode}: ${event.errorDescription}`.slice(0, 500) });
    });
    this.listen('render-process-gone', () => { this.invalidate(); this.emit({ ready: false, loading: false, error: 'PAGE_CRASHED' }); });
    this.removeOpen = this.bridge.onOpenRequested(reservation.lease, url => {
      // The host admitted this URL. The panel may open a new owned tab.
      const opened = this.onOpen ? this.onOpen(url) : this.navigate('open', url, signal);
      Promise.resolve(opened).catch(error => this.emit({ error: error.message }));
    });
    await new Promise((resolve, reject) => {
      let timer;
      const clear = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); frame.removeEventListener('dom-ready', ready); frame.removeEventListener('render-process-gone', crashed); };
      const ready = () => { clear(); resolve(); };
      const abort = () => { clear(); reject(signal.reason); };
      const crashed = () => { clear(); reject(new BrowserError('PAGE_CRASHED')); };
      signal.addEventListener('abort', abort, { once: true });
      frame.addEventListener('dom-ready', ready); frame.addEventListener('render-process-gone', crashed);
      timer = setTimeout(() => { clear(); reject(new BrowserError('GUEST_INIT_TIMEOUT')); }, 14000);
      this.container.appendChild(frame);
      if (signal.aborted) abort();
    });
  }
  async navigate(action, url, signal) {
    signal.throwIfAborted();
    const frame = this.element;
    if (!frame || !this.state.initialized) throw new BrowserError('PAGE_NOT_READY');
    if (action === 'back' && !frame.canGoBack() || action === 'forward' && !frame.canGoForward()) throw new BrowserError('NO_HISTORY');
    this.navigation?.abort(new BrowserError('NAVIGATION_REPLACED'));
    const navigation = new AbortController(); this.navigation = navigation;
    signal = AbortSignal.any([signal, navigation.signal]);
    return new Promise((resolve, reject) => {
      let timer;
      const clear = () => {
        clearTimeout(timer); signal.removeEventListener('abort', abort);
        frame.removeEventListener('did-stop-loading', done); frame.removeEventListener('did-fail-load', failed);
        frame.removeEventListener('render-process-gone', crashed); frame.removeEventListener('did-navigate-in-page', sameDocument);
        if (this.navigation === navigation) this.navigation = null;
      };
      const done = () => { clear(); this.state.error ? reject(new BrowserError('NAVIGATION_FAILED', this.state.error)) : resolve(); };
      const sameDocument = event => { if (event.isMainFrame) done(); };
      const failed = event => { if (event.isMainFrame && event.errorCode !== -3) { clear(); reject(new BrowserError('NAVIGATION_FAILED', String(event.errorDescription))); } };
      const crashed = () => { clear(); reject(new BrowserError('PAGE_CRASHED')); };
      const abort = () => { clear(); frame.stop(); reject(signal.reason); };
      signal.addEventListener('abort', abort, { once: true });
      frame.addEventListener('did-stop-loading', done); frame.addEventListener('did-fail-load', failed); frame.addEventListener('render-process-gone', crashed); frame.addEventListener('did-navigate-in-page', sameDocument);
      timer = setTimeout(() => { clear(); frame.stop(); reject(new BrowserError('NAVIGATION_TIMEOUT')); }, 14000);
      try {
        if (action === 'open') frame.loadURL(httpUrl(url, this.origin)).then(done, error => { clear(); reject(error); });
        else if (action === 'back') frame.goBack(); else if (action === 'forward') frame.goForward(); else frame.reload();
      } catch (error) { clear(); reject(error); }
    });
  }
  execute(script) { return this.element.executeJavaScript(script, false); }
  async input(plan, args, check) {
    const frame = this.element;
    check(); frame.focus(); this.onInput?.({ action: plan.action, x: plan.x, y: plan.y });
    if (['click', 'fill', 'press'].includes(plan.action)) {
      check(); await frame.sendInputEvent({ type: 'mouseMove', x: plan.x, y: plan.y });
      check();
      try { await frame.sendInputEvent({ type: 'mouseDown', x: plan.x, y: plan.y, button: 'left', clickCount: 1 }); }
      finally { await frame.sendInputEvent({ type: 'mouseUp', x: plan.x, y: plan.y, button: 'left', clickCount: 1 }); }
    }
    if (plan.action === 'fill') {
      check();
      try { await frame.sendInputEvent({ type: 'keyDown', keyCode: 'A', modifiers: ['meta'] }); }
      finally { await frame.sendInputEvent({ type: 'keyUp', keyCode: 'A', modifiers: ['meta'] }); }
      check(); await frame.insertText(args.value);
    } else if (plan.action === 'press') {
      check();
      try { await frame.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' }); }
      finally { await frame.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' }); }
    } else if (plan.action === 'scroll') { check(); await frame.sendInputEvent({ type: 'mouseWheel', x: plan.x, y: plan.y, deltaY: args.deltaY, deltaX: 0 }); }
  }
  // Electron's capturePage can transiently fail (UnknownVizError) while the guest
  // is compositing or occluded. Retry briefly and never report a blank image.
  // (CDP Page.captureScreenshot hangs on stock Electron, so it is not a fallback.)
  async capture() {
    const frame = this.element;
    if (!frame) throw new BrowserError('PAGE_NOT_INITIALIZED');
    let lastError;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        const image = await frame.capturePage();
        if (image && !image.isEmpty()) return image.toDataURL();
        lastError = new Error('EMPTY_IMAGE');
      } catch (error) { lastError = error; }
      await new Promise(resolve => setTimeout(resolve, 150 * (attempt + 1)));
    }
    throw new BrowserError('SCREENSHOT_UNAVAILABLE', String(lastError?.message || 'Guest did not produce an image').slice(0, 200));
  }
  stop() { this.element?.stop(); }
  async dispose() {
    if (this.released) return; this.released = true;
    this.networkClient?.dispose();
    this.capClient?.dispose();
    this.consoleMessages = []; this.consoleDropped = 0;
    this.navigation?.abort(new BrowserError('PANEL_CLOSED'));
    this.removeOpen?.(); for (const remove of this.listeners.splice(0)) remove();
    this.element?.remove();
    if (this.reservation) await this.bridge.release(this.reservation.lease);
  }
}
export async function workspaceIdentity(source, sessionId, signal) {
  signal.throwIfAborted();
  if (source.getSnapshot().phase !== 'ready') await new Promise((resolve, reject) => {
    const abort = () => { stop(); reject(signal.reason); };
    const stop = source.subscribe(() => {
      if (source.getSnapshot().phase === 'ready') { stop(); signal.removeEventListener('abort', abort); resolve(); }
    });
    signal.addEventListener('abort', abort, { once: true });
  });
  signal.throwIfAborted();
  const workspace = source.getSnapshot().items.find(item => item.sessionIds.includes(sessionId));
  return workspace ? `cwd:${workspace.path}` : `session:${sessionId}`;
}
