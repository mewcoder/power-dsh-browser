/* Development-only adapter. Real React BrowserPanel, SessionTabs, PageRunner,
 * annotation components and Broker run unchanged; same-origin iframes replace
 * Electron guests solely in this isolated test. Never imported by product builds. */
import { BrowserPanel, dictionaries } from '../../src/client.js';
import { registerAnnotationReferenceSource } from '../../src/annotation-composer.js';
import { createAnnotationStore as productCreateAnnotationStore } from '../../src/annotation-store.js';

const pages = new Set(), annotationStores = new Map();
// Observe the real store through its public factory/API for exact draft/confirmed
// assertions. This wrapper does not alter store behavior or UI state.
export function createAnnotationStore(options) { const store = productCreateAnnotationStore(options); annotationStores.set(options.sessionId, store); return store; }
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

const sessionId = 'ui-fixture-session', retainedScope = {};
const life = new AbortController();
async function transport(route, data) {
  const result = await (await fetch(route, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) })).json();
  if (!result.ok) throw Object.assign(new Error(result.error?.message || 'FIXTURE_TRANSPORT_FAILED'), { code: result.error?.code });
  return result.value;
}
const remote = { dshBrowser: Object.fromEntries(['connect', 'openRequested', 'poll', 'reply', 'stop', 'disconnect', 'publishAnnotations'].map(method => [method, async (...args) => {
  try { return { ok: true, value: await transport('/fixture-rpc', { method, args }) }; }
  catch (error) { return { ok: false, error }; }
}])) };
const originalDraft = [...'已有草稿 ', { kind: 'chip', id: 'preserved-reference', text: '保留引用片' }, ...' 保留末尾'];
const draft = { document: [...originalDraft], rev: 7, insertions: 0, textInsertions: 0, referenceInsertions: 0, sends: 0, focusCount: 0, lastSpan: null };
const input = {
  actions: {
    captureInsertion() { return { start: 0, end: draft.document.length, draftRev: draft.rev, phase: 'editable' }; },
    insertText(text, span) {
      if (span.draftRev !== draft.rev) return false;
      draft.lastSpan = { ...span }; draft.document.splice(span.start, span.end - span.start, ...text);
      draft.rev++; draft.insertions++; draft.textInsertions++; return true;
    },
    persistDraft() {},
  },
  focus() { draft.focusCount++; },
  submit() { draft.sends++; throw Error('FIXTURE_UNEXPECTED_SEND'); },
};
const sources = new Map();
retainedScope.bail = (scope, event, request) => {
  if (scope !== retainedScope || event !== 'slash/input-insert-reference' || request.span.draftRev !== draft.rev) return undefined;
  const { reference, span } = request;
  if (!sources.has(reference.source)) throw Error('FIXTURE_UNREGISTERED_REFERENCE_SOURCE');
  draft.lastSpan = { ...span };
  draft.document.splice(span.start, span.end - span.start, { kind: 'reference', ...reference }, ' ');
  draft.rev++; draft.insertions++; draft.referenceInsertions++; return true;
};
const services = {
  sessions: { scope: id => id === sessionId ? retainedScope : null, scopeOf: scope => scope === retainedScope ? sessionId : null },
  conversation: { input: { for(scope) { if (scope !== retainedScope) throw Error('FIXTURE_WRONG_SCOPE'); return input; } } },
  inputTriggers: { registerSource(source) { if (sources.has(source.name)) throw Error('FIXTURE_DUPLICATE_REFERENCE_SOURCE'); sources.set(source.name, source); return () => { if (sources.get(source.name) === source) sources.delete(source.name); }; } },
};
let referenceSource = registerAnnotationReferenceSource(services);
services.referenceSource = referenceSource;
const tab = { signal: life.signal, actions: { bindCommands: () => () => {}, close: () => life.abort() } };
const useTabInfo = () => ({ tab });
const draftSource = { subscribe: () => () => {}, getSnapshot: () => services };
const localeSource = { subscribe: () => () => {}, getSnapshot: () => 'zh' };
const workspaces = { list: { getSnapshot: () => ({ phase: 'ready', items: [] }), subscribe: () => () => {} } };
const t = key => dictionaries.zh[key] ?? key;
window.dshDesktop = { protocolVersion: 1, browser: {} };
window.UI_SMOKE = {
  runtime: 'React 18 real BrowserPanel with same-origin iframe test adapter; not DSH Desktop',
  request: (operation, args = {}) => transport('/fixture-agent', { operation, args, sessionId }),
  agentForSession: (id, operation, args = {}) => transport('/fixture-agent', { operation, args, sessionId: id }),
  getDraft: () => ({ ...draft, originalDraft }),
  getAnnotationState: () => annotationStores.get(sessionId)?.getSnapshot(),
  getPages: () => [...pages].map(page => ({ status: page.status(), connected: page.element?.isConnected })),
  refreshTranslationProps: () => root.render(window.React.createElement(BrowserPanel, { sessionId, remote, workspaces, useTabInfo, t: key => t(key), draftSource, localeSource })), 
  serializeReferences: () => Promise.all(draft.document.filter(part => part?.kind === 'reference').map(part => sources.get(part.source).codec.serialize(part.ref, life.signal))),
  serializeRawReference: ref => sources.get('dsh-browser-annotations').codec.serialize(ref, life.signal),
  reRegisterReferenceSource: () => { referenceSource.dispose(); referenceSource = registerAnnotationReferenceSource(services); services.referenceSource = referenceSource; },
  close: () => { life.abort(); referenceSource.dispose(); }, 
};
const root = window.ReactDOM.createRoot(document.getElementById('root'));
root.render(window.React.createElement(BrowserPanel, { sessionId, remote, workspaces, useTabInfo, t, draftSource, localeSource }));
window.addEventListener('pagehide', () => { root.unmount(); window.UI_SMOKE.close(); }, { once: true });
