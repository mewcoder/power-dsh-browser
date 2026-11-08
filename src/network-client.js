import { BrowserError, abortable } from './protocol.js';

const actions = {
  status: ['captureId'],
  start: ['maxRequests', 'maxBodyBytes', 'maxTotalBodyBytes', 'childTargets', 'websocketFrames'],
  list: ['captureId', 'afterSequence', 'limit', 'filter'],
  read: ['captureId', 'requestId', 'hop', 'targetSessionId', 'targetId'],
  body: ['captureId', 'requestId', 'hop', 'kind', 'offset', 'limit', 'targetSessionId', 'targetId'],
  frames: ['captureId', 'requestId', 'hop', 'targetSessionId', 'targetId'],
  clear: ['captureId'],
  stop: ['captureId'],
};
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const token = (value, limit = 128) => typeof value === 'string' && value.length > 0 && value.length <= limit;

// This adapter never chooses a native page ID. Its only native authority is the
// lease issued to this ElectronPage; Agent session/tab routing stays above it.
export class GuestNetwork {
  captureId = null; closed = false; generation = 0; tail = Promise.resolve();
  constructor(bridge, lease) { this.bridge = bridge; this.lease = lease; }
  available() { return this.bridge?.protocolVersion === 1 && typeof this.bridge.request === 'function'; }
  status() { return { available: this.available(), capturing: !!this.captureId, captureId: this.captureId, scope: 'owned-root-target', childTargets: false }; }
  payload(args) {
    if (!object(args) || !Object.hasOwn(actions, args.action)) throw new BrowserError('INVALID_NETWORK_ACTION');
    const fields = actions[args.action];
    if (Object.keys(args).some(key => !['action', 'tabId', ...fields].includes(key))) throw new BrowserError('INVALID_NETWORK_OPTIONS');
    const payload = { operation: args.action, lease: this.lease };
    if (['list', 'read', 'body', 'clear', 'stop'].includes(args.action) && !token(args.captureId)) throw new BrowserError('NETWORK_CAPTURE_REQUIRED');
    if (args.captureId !== undefined) {
      if (!token(args.captureId)) throw new BrowserError('INVALID_NETWORK_CAPTURE');
      payload.captureId = args.captureId;
    }
    if (['read', 'body', 'frames'].includes(args.action) && !token(args.requestId, 200)) throw new BrowserError('NETWORK_REQUEST_REQUIRED');
    if (args.action === 'frames' && args.kind !== undefined) throw new BrowserError('INVALID_NETWORK_OPTIONS');
    if (args.action === 'body' && !['request', 'response'].includes(args.kind)) throw new BrowserError('INVALID_BODY_KIND');
    if (args.action === 'start') {
      payload.options = Object.fromEntries(fields.filter(key => args[key] !== undefined).map(key => [key, args[key]]));
    } else if (['list', 'read', 'body', 'frames'].includes(args.action)) {
      const query = {};
      for (const key of fields) {
        if (key === 'captureId' || args[key] === undefined) continue;
        // The public arg avoids the reserved Agent `sessionId` name; the wire uses CDP's.
        query[key === 'targetSessionId' ? 'sessionId' : key] = args[key];
      }
      payload.query = query;
    }
    return payload;
  }
  async invoke(payload) {
    if (!this.available()) throw new BrowserError('NETWORK_BRIDGE_UNAVAILABLE', 'Install and load the owned-page Desktop bridge to capture network traffic');
    let reply;
    try { reply = await this.bridge.request(payload); }
    catch { throw new BrowserError('NETWORK_BRIDGE_UNAVAILABLE'); }
    if (!object(reply) || typeof reply.ok !== 'boolean') throw new BrowserError('INVALID_NETWORK_RESPONSE');
    if (!reply.ok) {
      const raw = reply.error?.code;
      const code = typeof raw === 'string' && /^[A-Z0-9_]{1,80}$/.test(raw) ? raw : 'NETWORK_BRIDGE_ERROR';
      throw new BrowserError(code === 'BRIDGE_UNAVAILABLE' ? 'NETWORK_BRIDGE_UNAVAILABLE' : code);
    }
    if (!object(reply.value)) throw new BrowserError('INVALID_NETWORK_RESPONSE');
    return reply.value;
  }
  request(args, signal) {
    signal.throwIfAborted();
    const payload = this.payload(args), generation = this.generation;
    const job = this.tail.then(async () => {
      signal.throwIfAborted();
      if (this.closed) throw new BrowserError('PANEL_CLOSED');
      if (generation !== this.generation) throw new BrowserError('CANCELLED');
      if (args.action === 'status' && !this.available()) return this.status();
      const previous = this.captureId;
      const value = await this.invoke(payload);
      if (this.closed || signal.aborted || generation !== this.generation) {
        // IPC itself cannot be recalled. Finish a late new start by releasing
        // only its returned capture, before a later start can enter this queue.
        if (args.action === 'start' && token(value.captureId) && value.captureId !== previous) {
          await this.invoke({ operation: 'stop', lease: this.lease, captureId: value.captureId }).catch(() => {});
        }
        signal.throwIfAborted();
        throw new BrowserError(this.closed ? 'PANEL_CLOSED' : 'CANCELLED');
      }
      if (args.action === 'start' || args.action === 'status') this.captureId = token(value.captureId) ? value.captureId : null;
      if (args.action === 'stop' && this.captureId === args.captureId) this.captureId = null;
      return { ...value, available: true, untrusted: true };
    });
    this.tail = job.catch(() => {});
    return abortable(job, signal);
  }
  stopCapture() {
    this.generation++;
    const known = this.captureId; this.captureId = null;
    const stopped = known && this.available()
      ? this.invoke({ operation: 'stop', lease: this.lease, captureId: known }).catch(() => {})
      : Promise.resolve();
    this.tail = Promise.allSettled([this.tail, stopped]).then(() => {});
    return this.tail;
  }
  // The host's release(lease) hook owns native cleanup even when no IPC reply
  // can return. Pending starts observe closed and release any late capture.
  dispose() { this.closed = true; this.generation++; this.captureId = null; }
}
