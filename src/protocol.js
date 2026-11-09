export const LIMITS = Object.freeze({ timeout: 15000, image: 4_000_000, wire: 5_500_000 });
export class BrowserError extends Error {
  constructor(code, message = code) { super(`${code}: ${message}`); this.code = code; }
}
function fail(code, message) { throw new BrowserError(code, message); }
// The underlying Electron promise may not support cancellation. Ignore its late
// settlement while releasing our request immediately; do not dispatch follow-up work.
export function abortable(promise, signal) {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => { signal.removeEventListener('abort', abort); reject(signal.reason); };
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve(promise).then(value => { signal.removeEventListener('abort', abort); resolve(value); }, error => { signal.removeEventListener('abort', abort); reject(error); });
    if (signal.aborted) abort();
  });
}
export function id() { return globalThis.crypto.randomUUID(); }
export function validId(value) { return typeof value === 'string' && value.length > 0 && value.length <= 200; }
export function httpUrl(value, applicationOrigin) {
  if (typeof value !== 'string' || value.length > 8192) fail('INVALID_URL');
  let url; try { url = new URL(value); } catch { fail('INVALID_URL'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url['pass' + 'word']) fail('INVALID_URL', 'Use HTTP(S) without credentials');
  if (applicationOrigin && url.origin === applicationOrigin) fail('HOST_URL_BLOCKED');
  return url.href;
}
export function sessionOf(exec) {
  const sessionId = exec?.agent?.session?.id;
  if (!validId(sessionId)) fail('AGENT_CONTEXT_REQUIRED', 'Use a tool from a live Agent session');
  return sessionId;
}
export function ownerOf(invocation) {
  const peer = invocation?.peer;
  if (peer?.principal?.kind !== 'owner' || peer.signal?.aborted) fail('OWNER_REQUIRED');
  return peer;
}
// A panel may only poll/reply with the same live peer and private instance token.
export class Broker {
  panels = new Map(); pending = new Map(); demands = new Map(); disposed = false;
  constructor({ now = Date.now, timeout = LIMITS.timeout } = {}) { this.now = now; this.timeout = timeout; }
  // A browser tool that still needs its panel records a short-lived demand. A
  // loaded Client polls it and opens the tab for the on-screen session; the tool
  // then waits briefly for connect instead of failing the user with PANEL_OFFLINE.
  demand(sessionId) { if (!this.disposed && validId(sessionId)) this.demands.set(sessionId, this.now()); }
  // Consume on read: one demand opens the panel exactly once, so the Client does
  // not re-open/reveal every poll tick (which would make the sidebar border flash).
  takeDemand() {
    if (this.disposed) return false;
    const now = this.now();
    for (const [sessionId, at] of this.demands) {
      this.demands.delete(sessionId);
      if (now - at <= 30000) return true;
    }
    return false;
  }
  connect(sessionId, instance, peer) {
    if (this.disposed) fail('HOST_DISPOSED');
    if (!validId(sessionId) || !validId(instance)) fail('INVALID_ID');
    const key = id();
    const panel = { key, sessionId, instance, peer, lastSeen: this.now(), queue: [], epoch: 0, fences: new Set() };
    panel.abort = () => this.disconnect(key, peer);
    peer.signal.addEventListener('abort', panel.abort, { once: true });
    this.panels.set(key, panel); return { key };
  }
  panel(key, peer) {
    const p = this.panels.get(key);
    if (!p || p.peer !== peer || peer.signal.aborted) fail('PANEL_DISCONNECTED');
    return p;
  }
  sweep() {
    for (const p of [...this.panels.values()]) if (this.now() - p.lastSeen > 3000) this.disconnect(p.key, p.peer);
  }
  select(sessionId) {
    this.sweep();
    const panels = [...this.panels.values()].filter(p => p.sessionId === sessionId);
    if (!panels.length) fail('PANEL_OFFLINE', 'Open the PowerDSH Browser entry in this session');
    if (panels.length !== 1) fail('AMBIGUOUS_PANEL', 'Close additional PowerDSH Browser panels/windows');
    this.demands.delete(sessionId);
    return panels[0];
  }
  poll(key, peer) {
    const p = this.panel(key, peer); p.lastSeen = this.now();
    const commands = p.queue.splice(0).filter(c => c.kind !== 'request' || (this.pending.has(c.id) && c.expires > this.now()));
    return { commands };
  }
  guard(sessionId, signal) {
    const panel = this.select(sessionId), epoch = panel.epoch, expires = this.now() + this.timeout;
    const controller = new AbortController(); panel.fences.add(controller);
    const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
    const timer = setTimeout(() => controller.abort(new BrowserError('TIMEOUT')), this.timeout);
    return {
      signal: combined,
      assert: () => {
        combined.throwIfAborted();
        if (this.panels.get(panel.key) !== panel || panel.epoch !== epoch) fail('STOPPED');
        if (this.now() >= expires) fail('TIMEOUT');
      },
      dispose: () => { clearTimeout(timer); panel.fences.delete(controller); },
    };
  }
  request(sessionId, operation, args, signal) {
    if (this.disposed) return Promise.reject(new BrowserError('HOST_DISPOSED'));
    signal?.throwIfAborted();
    const p = this.select(sessionId);
    if (operation === 'stop') { this.stop(p); return Promise.resolve({ stopped: true }); }
    if ([...this.pending.values()].some(x => x.panel === p)) fail('BUSY', 'One page request may run at a time');
    return new Promise((resolve, reject) => {
      const requestId = id(), expires = this.now() + this.timeout;
      const abortRequest = error => {
        p.queue = p.queue.filter(c => c.id !== requestId);
        p.queue.push({ kind: 'cancel', id: requestId });
        finish(error);
      };
      const cancel = () => abortRequest(new BrowserError('CANCELLED'));
      const timer = setTimeout(() => abortRequest(new BrowserError('TIMEOUT')), this.timeout);
      const finish = (error, value) => {
        if (!this.pending.delete(requestId)) return;
        clearTimeout(timer); signal?.removeEventListener('abort', cancel);
        error ? reject(error) : resolve(value);
      };
      this.pending.set(requestId, { panel: p, epoch: p.epoch, expires, finish });
      signal?.addEventListener('abort', cancel, { once: true });
      p.queue.push({ kind: 'request', id: requestId, epoch: p.epoch, expires, operation, args });
      if (signal?.aborted) cancel();
    });
  }
  reply(key, peer, requestId, epoch, result) {
    const p = this.panel(key, peer), pending = this.pending.get(requestId);
    if (!pending || pending.panel !== p || pending.epoch !== epoch || epoch !== p.epoch || pending.expires <= this.now()) return { accepted: false };
    if (JSON.stringify(result).length > LIMITS.wire) { pending.finish(new BrowserError('RESULT_TOO_LARGE')); return { accepted: false }; }
    result?.ok === true ? pending.finish(null, result.value) : pending.finish(new BrowserError('PAGE_ERROR', String(result?.error).slice(0, 1000)));
    return { accepted: true };
  }
  stop(p) {
    p.epoch++; p.queue = [{ kind: 'stop', epoch: p.epoch }];
    for (const r of [...this.pending.values()]) if (r.panel === p) r.finish(new BrowserError('STOPPED'));
    for (const controller of p.fences) controller.abort(new BrowserError('STOPPED'));
    p.fences.clear();
    return { stopped: true, epoch: p.epoch };
  }
  disconnect(key, peer) {
    const p = this.panels.get(key); if (!p || p.peer !== peer) return { disconnected: false };
    this.stop(p); this.panels.delete(key); peer.signal.removeEventListener('abort', p.abort);
    return { disconnected: true };
  }
  dispose() { this.disposed = true; this.demands.clear(); for (const p of [...this.panels.values()]) this.disconnect(p.key, p.peer); }
}
