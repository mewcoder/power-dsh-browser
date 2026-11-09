/* Development-only adapter. Real React BrowserPanel, SessionTabs, PageRunner
 * and Broker run unchanged; same-origin iframes replace Electron guests solely
 * in this isolated test. Never imported by product builds. */
import { BrowserPanel, dictionaries } from '../../src/client.js';

const pages = new Set();
export class ElectronPage {
  state = { initialized: false, ready: false, url: '', title: '', loading: false, canGoBack: false, canGoForward: false, error: '' };
  history = []; historyIndex = -1; released = false;
  constructor(bridge, container, origin, update, invalidate, options = {}) {
    Object.assign(this, { bridge, container, update, invalidate, options });
    // The fixture deliberately admits its own same-origin guest routes; this is
    // not the DSH Host and does not test or relax Electron admission policies.
    this.origin = 'https://fixture-host.invalid'; pages.add(this);
  }
  status() { return { ...this.state, desktop: false, fixture: true }; }
  emit(patch) { Object.assign(this.state, patch); if (!this.released) this.update(this.status()); }
  async mount(_workspace, signal) {
    signal.throwIfAborted();
    const frame = document.createElement('iframe'); this.element = frame;
    frame.dataset.uiSmokeGuest = ''; frame.title = 'Isolated test guest';
    frame.style.cssText = 'display:block;border:0;width:100%;height:100%;min-height:0;background:white';
    this.container.appendChild(frame);
    this.emit({ initialized: true, ready: true });
  }
  async navigate(action, url, signal) {
    signal.throwIfAborted();
    if (action === 'back') this.historyIndex--;
    else if (action === 'forward') this.historyIndex++;
    else if (action === 'open') { this.history = this.history.slice(0, this.historyIndex + 1); this.history.push(url); this.historyIndex++; }
    url = this.history[this.historyIndex];
    if (!url || new URL(url).origin !== location.origin || new URL(url).pathname !== '/guest') throw Error('FIXTURE_GUEST_URL_ONLY');
    this.invalidate();
    this.element.dispatchEvent(Object.assign(new Event('did-start-navigation'), { isMainFrame: true }));
    this.emit({ ready: false, loading: true, url });
    await new Promise((resolve, reject) => {
      const cleanup = () => { this.element.removeEventListener('load', loaded); signal.removeEventListener('abort', aborted); clearTimeout(timeout); };
      const loaded = () => { cleanup(); resolve(); };
      const aborted = () => { cleanup(); reject(signal.reason); };
      const timeout = setTimeout(() => { cleanup(); reject(Error('FIXTURE_LOAD_TIMEOUT')); }, 5000);
      this.element.addEventListener('load', loaded, { once: true }); signal.addEventListener('abort', aborted, { once: true });
      this.element.src = url;
    });
    signal.throwIfAborted();
    this.emit({ ready: true, loading: false, title: this.element.contentDocument.title, canGoBack: this.historyIndex > 0, canGoForward: this.historyIndex + 1 < this.history.length });
  }
  execute(script) { return this.element.contentWindow.eval(script); }
  async input(plan, args, check) {
    check(); this.options.onInput?.({ action: plan.action, x: plan.x, y: plan.y });
    const guest = this.element.contentWindow, target = guest.document.elementFromPoint(plan.x, plan.y);
    if (!target) throw Error('FIXTURE_TARGET_MISSING');
    // Input adapter is intentionally a simulation. Host-overlay clicks are sent
    // through real Chromium CDP by ui-smoke; guest automatic input is not Electron.
    if (plan.action === 'click') target.click();
    else if (plan.action === 'fill') { target.focus(); target.value = args.value; target.dispatchEvent(new guest.Event('input', { bubbles: true })); }
    else if (plan.action === 'scroll') guest.scrollBy(0, args.deltaY);
  }
  capture() { throw Error('FIXTURE_CAPTURE_NOT_SUPPORTED'); }
  stop() {}
  async dispose() { this.released = true; this.element?.remove(); pages.delete(this); }
}
export async function workspaceIdentity(_source, sessionId, signal) { signal.throwIfAborted(); return `fixture:${sessionId}`; }

const sessionId = 'ui-fixture-session';
const life = new AbortController();
async function transport(route, data) {
  const result = await (await fetch(route, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) })).json();
  if (!result.ok) throw Object.assign(new Error(result.error?.message || 'FIXTURE_TRANSPORT_FAILED'), { code: result.error?.code });
  return result.value;
}
const remote = { dshBrowser: Object.fromEntries(['connect', 'openRequested', 'poll', 'reply', 'stop', 'disconnect'].map(method => [method, async (...args) => {
  try { return { ok: true, value: await transport('/fixture-rpc', { method, args }) }; }
  catch (error) { return { ok: false, error }; }
}])) };
const tab = { signal: life.signal, actions: { bindCommands: () => () => {}, close: () => life.abort() } };
const useTabInfo = () => ({ tab });
const localeSource = { subscribe: () => () => {}, getSnapshot: () => 'zh' };
const workspaces = { list: { getSnapshot: () => ({ phase: 'ready', items: [] }), subscribe: () => () => {} } };
const t = key => dictionaries.zh[key] ?? key;
window.dshDesktop = { protocolVersion: 1, browser: {} };
window.UI_SMOKE = {
  runtime: 'React 18 real BrowserPanel with same-origin iframe test adapter; not DSH Desktop',
  request: (operation, args = {}) => transport('/fixture-agent', { operation, args, sessionId }),
  getPages: () => [...pages].map(page => ({ status: page.status(), connected: page.element?.isConnected })),
  refreshTranslationProps: () => root.render(window.React.createElement(BrowserPanel, { sessionId, remote, workspaces, useTabInfo, t: key => t(key), localeSource })),
  close: () => { life.abort(); },
};
const root = window.ReactDOM.createRoot(document.getElementById('root'));
root.render(window.React.createElement(BrowserPanel, { sessionId, remote, workspaces, useTabInfo, t, localeSource }));
window.addEventListener('pagehide', () => { root.unmount(); window.UI_SMOKE.close(); }, { once: true });
