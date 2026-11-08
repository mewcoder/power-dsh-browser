import { Buffer } from 'node:buffer';

// Leave room for the bridge envelope and Host tab metadata below its 60k budget.
const JSON_BYTES = 59000;
const MAX_CHILD_SESSIONS = 20;
const MAX_FRAMES = 50;
const MAX_FRAME_PAYLOAD = 2048;
const jsonBytes = value => Buffer.byteLength(JSON.stringify(value), 'utf8');
const bounded = (v, n = 2048) => typeof v === 'string' ? v.slice(0, n) : '';
const fail = code => { throw new Error(code); };
const clamp = (v, fallback, max) => Number.isSafeInteger(v) && v > 0 ? Math.min(v, max) : fallback;
const number = value => Number.isFinite(value) ? value : undefined;
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const headers = value => {
  const result = Object.create(null); let size = 2, count = 0;
  if (!object(value)) return result;
  // Stop before enumerating/copying an unbounded map. CDP Header values are strings;
  // do not coerce arrays/objects (or invoke their toString implementations).
  for (const key in value) {
    if (!Object.hasOwn(value, key)) continue;
    if (++count > 100) break;
    const raw = value[key]; if (typeof raw !== 'string') continue;
    const name = bounded(key, 160), text = bounded(raw, 4096);
    const bytes = jsonBytes(name) + jsonBytes(text) + 2;
    if (size + bytes > 8000) continue;
    size += bytes; result[name] = text;
  }
  return result;
};
const cleanUrl = value => { try { const url = new URL(value); url.username = ''; url['pass' + 'word'] = ''; return bounded(url.href, 4096); } catch { return bounded(value); } };
const copy = value => JSON.parse(JSON.stringify(value));
const timing = value => {
  const result = Object.create(null); let count = 0;
  if (object(value)) for (const key in value) {
    if (!Object.hasOwn(value, key)) continue;
    if (++count > 32) break;
    if (Number.isFinite(value[key])) result[bounded(key, 80)] = value[key];
  }
  return result;
};

/** MAIN-process recorder for an already authenticated, supplied guest WebContents.
 * No arbitrary WebContents lookup or raw CDP interface is exposed. Attaches only
 * when that guest's debugger is free. Traffic is observed without interception,
 * replay or replacement requests. Root-target capture is the default; child
 * targets (OOPIF/worker/service-worker) are opt-in with options.childTargets and
 * are auto-attached flat under the same recorder. WebSocket frames are opt-in
 * with options.websocketFrames and stay out of list/read budgets.
 */
export async function createNetworkRecorder(webContents, options = {}) {
  const debug = webContents.debugger;
  const signal = options.signal;
  if (signal?.aborted) fail('NETWORK_START_CANCELLED');
  if (!debug || debug.isAttached()) fail('NETWORK_DEBUGGER_ALREADY_ATTACHED');
  if (webContents.isDestroyed?.()) fail('NETWORK_GUEST_DESTROYED');
  const childTargets = options.childTargets === true;
  const websocketFrames = options.websocketFrames === true;
  const limits = {
    requests: clamp(options.maxRequests, 200, 500),
    body: clamp(options.maxBodyBytes, 1024 * 1024, 2 * 1024 * 1024),
    total: clamp(options.maxTotalBodyBytes, 8 * 1024 * 1024, 16 * 1024 * 1024),
  };
  let closed = false, attached = false, generation = 0, sequence = 0, dropped = 0, bodyBytes = 0, state = 'starting', childAttachError = '', childEvicted = 0;
  // Root target context. Each child session owns its records/streams maps, but all
  // contexts share the global sequence counter and body budget so list() merges
  // root and children in one event order and limits stay global.
  const root = { sessionId: null, targetId: null, targetType: 'page', records: new Map(), streams: new Map(), extraInfoDropped: 0 };
  const children = new Map();
  // Live request IDs in insertion order, across root and children, for global
  // maxRequests eviction. Root-only operation keeps the original eviction order.
  let recordOrder = [];
  const framesByRecord = new WeakMap();
  const pending = new Set(), commands = new Set(), commandSessions = new Map();
  // Internal fixture override may shorten, but never extend, the 10s deadline.
  const commandTimeoutMs = clamp(options.commandTimeoutMs, 10000, 10000);
  const command = (method, params, sessionId) => new Promise((resolve, reject) => {
    let done = false;
    const finish = (callback, value) => {
      if (done) return;
      done = true; clearTimeout(timer); commands.delete(cancel); commandSessions.delete(cancel); callback(value);
    };
    const cancel = () => finish(reject, new Error('NETWORK_COMMAND_CANCELLED'));
    const timer = setTimeout(() => finish(reject, new Error('NETWORK_COMMAND_TIMEOUT')), commandTimeoutMs);
    commands.add(cancel);
    if (sessionId) commandSessions.set(cancel, sessionId);
    // Observe rejection even after cancellation/timeout; late replies cannot win.
    try {
      const sent = sessionId ? debug.sendCommand(method, params, sessionId) : debug.sendCommand(method, params);
      Promise.resolve(sent).then(value => finish(resolve, value), error => finish(reject, error));
    } catch (error) { finish(reject, error); }
  });
  const cancelCommands = sessionId => {
    for (const cancel of [...commands]) if (sessionId === undefined || commandSessions.get(cancel) === sessionId) cancel();
  };
  const alive = epoch => !closed && attached && generation === epoch;
  const active = context => context === root || children.get(context.sessionId) === context;
  const current = (context, id) => context.records.get(id)?.at(-1);
  const touch = record => { record.sequence = ++sequence; };
  const releaseBody = slot => { if (slot?.state === 'available') bodyBytes -= slot.bytes; };
  const discard = hops => { for (const record of hops) { releaseBody(record.requestBody); releaseBody(record.responseBody); } };
  const retained = (context, record) => record && context.records.get(record.requestId)?.includes(record);
  const putBody = (context, record, kind, value, encoded, epoch) => {
    if (!alive(epoch) || !retained(context, record)) return;
    const bytes = Buffer.byteLength(value, encoded ? 'base64' : 'utf8');
    releaseBody(record[kind]);
    if (bytes > limits.body || bodyBytes + bytes > limits.total) record[kind] = { state: 'unavailable', reason: 'BODY_LIMIT', bytes, truncated: true };
    else { record[kind] = { state: 'available', body: value, base64Encoded: encoded, bytes }; bodyBytes += bytes; }
    touch(record);
  };
  const unavailable = (context, record, kind, reason, epoch) => {
    if (!alive(epoch) || !retained(context, record)) return;
    releaseBody(record[kind]); record[kind] = { state: 'unavailable', reason }; touch(record);
  };
  const task = fn => { const promise = Promise.resolve().then(fn).catch(() => {}).finally(() => pending.delete(promise)); pending.add(promise); };
  const commandBody = (context, record, kind, method, epoch) => task(async () => {
    // Scheduling must not outlive clear/dispose/detach or request eviction.
    if (!alive(epoch) || !retained(context, record)) return;
    if (current(context, record.requestId) !== record) {
      unavailable(context, record, kind, 'REQUEST_REDIRECTED', epoch); return;
    }
    if (kind === 'responseBody' && record.state === 'failed') return;
    try {
      const result = await command(method, { requestId: record.requestId }, context.sessionId || undefined);
      if (kind === 'responseBody' && record.state === 'failed') return;
      if (current(context, record.requestId) !== record) { unavailable(context, record, kind, 'REQUEST_REDIRECTED', epoch); return; }
      const value = kind === 'requestBody' ? result.postData : result.body;
      if (typeof value !== 'string') unavailable(context, record, kind, 'BODY_NOT_RETURNED', epoch);
      else putBody(context, record, kind, value, kind === 'responseBody' && result.base64Encoded === true, epoch);
    } catch (error) {
      if (kind === 'responseBody' && record.state === 'failed') return;
      unavailable(context, record, kind, bounded(error?.message, 400) || 'BODY_UNAVAILABLE', epoch);
    }
  });
  const response = (record, value = {}) => {
    Object.assign(record, {
      url: cleanUrl(value.url || record.url), status: number(value.status), statusText: bounded(value.statusText, 200),
      responseHeaders: headers(value.headers), mimeType: bounded(value.mimeType, 160), protocol: bounded(value.protocol, 80),
      fromDiskCache: !!value.fromDiskCache, fromServiceWorker: !!value.fromServiceWorker,
      remoteIPAddress: bounded(value.remoteIPAddress, 80), timing: timing(value.timing),
    });
  };
  const disableExtra = (context, stream) => {
    if (!stream.disabled) context.extraInfoDropped++;
    stream.disabled = true; stream.request.length = 0; stream.response.length = 0;
    for (const slot of stream.hops) if (retained(context, slot.record)) {
      for (const kind of ['request', 'response']) if (!slot[kind]) slot.record.extraInfo[kind] = 'correlation-limit';
      touch(slot.record);
    }
    stream.hops.length = 0;
  };
  const streamFor = (context, id) => {
    let stream = context.streams.get(id);
    if (!stream) {
      // Early ExtraInfo may precede requestWillBeSent. Keep a bounded orphan area
      // in addition to streams for retained requests; orphan traffic is not listed.
      while (context.streams.size >= limits.requests * 2) {
        const orphan = [...context.streams.keys()].find(key => !context.records.has(key));
        if (orphan === undefined) break;
        context.streams.delete(orphan); context.extraInfoDropped++;
      }
      stream = { hops: [], request: [], response: [], disabled: false };
      context.streams.set(id, stream);
    }
    return stream;
  };
  const drainExtra = (context, stream) => {
    if (stream.disabled) return;
    // CDP guarantees the order within each ExtraInfo stream, but not its order
    // relative to base events. Only explicit hasExtraInfo flags let us skip a
    // hop. An unknown flag blocks matching instead of guessing at a newer hop.
    for (const kind of ['request', 'response']) for (const slot of stream.hops) {
      if (slot[kind]) continue;
      if (slot.expected === null && !slot.failed) break;
      if (slot.expected === false) { slot[kind] = true; continue; }
      // loadingFailed can omit responseReceived (for example a CORS failure).
      // Once this terminal slot is reached in order, any queued ExtraInfo can
      // only belong to it; an earlier unknown slot still blocks this inference.
      if (!stream[kind].length) break;
      const extra = stream[kind].shift(); slot[kind] = true;
      if (retained(context, slot.record)) {
        slot.record[kind + 'Extra'] = extra;
        slot.record.extraInfo[kind] = 'captured'; touch(slot.record);
      }
    }
    // Keep unresolved tombstones when the visible redirect hop was evicted, so
    // late old headers are consumed without being assigned to a retained hop.
    while (stream.hops[0]?.request && stream.hops[0]?.response) stream.hops.shift();
  };
  const expectExtra = (context, stream, record, flag, failed = false) => {
    if (stream.disabled) return;
    const slot = stream.hops.find(value => value.record === record);
    if (!slot) return;
    if (failed) slot.failed = true;
    if (typeof flag === 'boolean') slot.expected = flag;
    for (const kind of ['request', 'response']) if (!slot[kind]) record.extraInfo[kind] = slot.expected === null ? 'unresolved' : slot.expected ? 'expected' : 'not-emitted';
    drainExtra(context, stream);
  };
  const captureFrame = (context, id, direction, params) => {
    const record = current(context, id);
    if (!record) return;
    let ring = framesByRecord.get(record);
    if (!ring) { ring = { frames: [], dropped: 0 }; framesByRecord.set(record, ring); }
    const payloadData = params.response?.payloadData;
    const frame = { direction, timestamp: number(params.timestamp), opcode: number(params.response?.opcode), payload: bounded(payloadData, MAX_FRAME_PAYLOAD) };
    if (typeof payloadData === 'string' && payloadData.length > MAX_FRAME_PAYLOAD) frame.payloadTruncated = true;
    if (ring.frames.length >= MAX_FRAMES) { ring.frames.shift(); ring.dropped++; }
    ring.frames.push(frame);
  };
  const handle = (context, method, params, epoch) => {
    const id = bounded(params.requestId, 200); if (!id) return;
    if (websocketFrames) {
      if (method === 'Network.webSocketFrameSent') { captureFrame(context, id, 'sent', params); return; }
      if (method === 'Network.webSocketFrameReceived') { captureFrame(context, id, 'received', params); return; }
    }
    let record = current(context, id);
    if (method === 'Network.requestWillBeSentExtraInfo' || method === 'Network.responseReceivedExtraInfo') {
      const stream = streamFor(context, id), kind = method === 'Network.requestWillBeSentExtraInfo' ? 'request' : 'response';
      if (stream.disabled) return;
      if (stream[kind].length >= 40) { disableExtra(context, stream); return; }
      stream[kind].push(kind === 'request' ? { headers: headers(params.headers) } : { statusCode: number(params.statusCode), headers: headers(params.headers), headersText: bounded(params.headersText, 8000) });
      drainExtra(context, stream); return;
    }
    // WebSocket handshakes never emit requestWillBeSent, so create a record here;
    // otherwise frames have no record to attach to and are silently dropped.
    if (method === 'Network.webSocketCreated' && !record) {
      const stream = streamFor(context, id);
      const hops = context.records.get(id) || [];
      const fresh = hops.length === 0;
      record = { requestId: id, hop: 0, url: cleanUrl(params.url), method: 'GET', type: 'WebSocket', frameId: '', loaderId: '', startedAt: number(params.timestamp), requestHeaders: Object.create(null), state: 'pending', extraInfo: { request: 'not-emitted', response: 'not-emitted' }, requestBody: { state: 'unavailable', reason: 'NO_REQUEST_BODY' }, responseBody: { state: 'unavailable', reason: 'WEBSOCKET' }, targetType: context.targetType, websocket: true };
      if (context.sessionId) { record.sessionId = context.sessionId; record.targetId = context.targetId; }
      hops.push(record); context.records.set(id, hops); touch(record);
      if (fresh) recordOrder.push({ context, id });
      while (context.records.size > limits.requests) {
        const oldest = context.records.keys().next().value; discard(context.records.get(oldest)); context.records.delete(oldest); dropped++;
      }
      return;
    }
    if (method === 'Network.webSocketWillSendHandshakeRequest' && record) {
      record.requestHeaders = headers(params.request?.headers); touch(record); return;
    }
    if (method === 'Network.webSocketHandshakeResponseReceived' && record) {
      record.state = 'finished'; record.status = number(params.response?.status); record.statusText = bounded(params.response?.statusText, 200);
      record.responseHeaders = headers(params.response?.headers); record.finishedAt = number(params.timestamp); touch(record); return;
    }
    if (method === 'Network.webSocketClosed' && record) { record.state = 'closed'; record.finishedAt = number(params.timestamp); touch(record); return; }
    if (method === 'Network.webSocketFrameError' && record) { record.websocketError = bounded(params.errorMessage, 300); touch(record); return; }
    if (method === 'Network.requestWillBeSent') {
      const stream = streamFor(context, id);
      if (record && params.redirectResponse) {
        response(record, params.redirectResponse); record.state = 'redirected'; record.finishedAt = number(params.timestamp);
        releaseBody(record.responseBody); record.responseBody = { state: 'unavailable', reason: 'REDIRECT_BODY_UNAVAILABLE' };
        expectExtra(context, stream, record, params.redirectHasExtraInfo); touch(record);
      }
      const hops = context.records.get(id) || [];
      // Bound every hop, including malicious infinite redirect chains.
      if (hops.length >= 20) {
        const old = hops.shift(); discard([old]); dropped++;
        const slot = stream.hops.find(value => value.record === old); if (slot) slot.record = null;
      }
      const fresh = hops.length === 0;
      const request = params.request || {};
      record = { requestId: id, hop: hops.length ? hops.at(-1).hop + 1 : 0, url: cleanUrl(request.url), method: bounded(request.method, 24), type: bounded(params.type, 80), frameId: bounded(params.frameId, 200), loaderId: bounded(params.loaderId, 200), startedAt: number(params.timestamp), wallTime: number(params.wallTime), requestHeaders: headers(request.headers), state: 'pending', extraInfo: { request: stream.disabled ? 'correlation-limit' : 'pending', response: stream.disabled ? 'correlation-limit' : 'pending' }, requestBody: { state: request.hasPostData || request.postData !== undefined ? 'pending' : 'unavailable', reason: request.hasPostData ? undefined : 'NO_REQUEST_BODY' }, responseBody: { state: 'pending' }, targetType: context.targetType };
      // Root records stay compatible: targetType:'page' and no session/target IDs.
      if (context.sessionId) { record.sessionId = context.sessionId; record.targetId = context.targetId; }
      hops.push(record); context.records.set(id, hops); touch(record);
      if (fresh) recordOrder.push({ context, id });
      if (!stream.disabled) {
        stream.hops.push({ record, expected: null, request: false, response: false });
        if (stream.hops.length > 40) disableExtra(context, stream);
        else drainExtra(context, stream);
      }
      // Global maxRequests applies across root and children; root-only behavior
      // is identical to the previous per-root-map eviction.
      while (recordOrder.length > limits.requests) {
        const oldest = recordOrder.shift();
        if (!active(oldest.context)) continue;
        const oldHops = oldest.context.records.get(oldest.id);
        if (!oldHops) continue;
        discard(oldHops); oldest.context.records.delete(oldest.id); dropped++;
        const oldStream = oldest.context.streams.get(oldest.id);
        if (oldStream) { disableExtra(oldest.context, oldStream); } // Retain a bounded tombstone for late events.
      }
      if (typeof request.postData === 'string') putBody(context, record, 'requestBody', request.postData, false, epoch);
      else if (request.hasPostData) commandBody(context, record, 'requestBody', 'Network.getRequestPostData', epoch);
      return;
    }
    if (!record) return; // No fabricated traffic from late/orphan events.
    if (method === 'Network.responseReceived') { response(record, params.response); record.responseAt = number(params.timestamp); expectExtra(context, streamFor(context, id), record, params.hasExtraInfo); }
    else if (method === 'Network.loadingFinished') { record.state = 'finished'; record.finishedAt = number(params.timestamp); record.encodedDataLength = number(params.encodedDataLength); commandBody(context, record, 'responseBody', 'Network.getResponseBody', epoch); }
    else if (method === 'Network.loadingFailed') { record.state = 'failed'; record.finishedAt = number(params.timestamp); record.errorText = bounded(params.errorText, 400); record.canceled = !!params.canceled; record.blockedReason = bounded(params.blockedReason, 160); unavailable(context, record, 'responseBody', 'REQUEST_FAILED', epoch); expectExtra(context, streamFor(context, id), record, undefined, true); }
    else if (method === 'Network.requestServedFromCache') record.fromCache = true;
    else return;
    touch(record);
  };
  const finalize = context => {
    for (const hops of context.records.values()) for (const record of hops) {
      for (const kind of ['requestBody', 'responseBody']) if (record[kind].state === 'pending') record[kind] = { state: 'unavailable', reason: 'NETWORK_DEBUGGER_DETACHED' };
      for (const kind of ['request', 'response']) if (['pending', 'expected'].includes(record.extraInfo[kind])) record.extraInfo[kind] = 'capture-detached';
      touch(record);
    }
    context.streams.clear();
  };
  const resumeChild = context => {
    // Best effort: never leave a waitForDebuggerOnStart child paused when we drop
    // or evict its session, or when its own enable/resume command was cancelled.
    if (!context?.waiting || closed || !attached) return;
    const sessionId = context.sessionId;
    context.waiting = false;
    try { Promise.resolve(debug.sendCommand('Runtime.runIfWaitingForDebugger', {}, sessionId)).catch(() => {}); } catch {}
  };
  const dropChild = context => {
    // Remove the session first so late command results are fenced by retained().
    children.delete(context.sessionId);
    finalize(context);
    cancelCommands(context.sessionId);
    // Dropping state must return retained bodies to the shared budget and fence
    // body tasks that were queued but not dispatched.
    for (const hops of context.records.values()) discard(hops);
    context.records.clear(); context.streams.clear();
    recordOrder = recordOrder.filter(entry => entry.context !== context);
  };
  const attachChild = params => {
    if (!childTargets || closed || !attached) return;
    const sessionId = bounded(params.sessionId, 200); if (!sessionId || children.has(sessionId)) return;
    const info = object(params.targetInfo) ? params.targetInfo : {};
    const targetId = bounded(info.targetId, 200), targetType = bounded(info.type, 40) || 'unknown';
    const waiting = params.waitingForDebugger !== false;
    if (children.size >= MAX_CHILD_SESSIONS) {
      // Bounded map: evict the oldest child and note it in status.childEvicted.
      const oldestId = children.keys().next().value, evicted = children.get(oldestId);
      if (evicted) { resumeChild(evicted); dropChild(evicted); childEvicted++; }
    }
    const context = { sessionId, targetId, targetType, waiting, records: new Map(), streams: new Map(), extraInfoDropped: 0 };
    children.set(sessionId, context);
    task(async () => {
      // The session may be evicted/cleared/detached before this task runs.
      if (children.get(sessionId) !== context || closed || !attached) return;
      try { await command('Network.enable', { maxTotalBufferSize: limits.total, maxResourceBufferSize: limits.body, maxPostDataSize: limits.body }, sessionId); }
      catch {
        // A child that cannot enable Network cannot contribute records. Resume it
        // so it is not stuck paused, then drop the session state.
        if (children.get(sessionId) === context) { resumeChild(context); dropChild(context); }
        return;
      }
      if (children.get(sessionId) !== context || closed || !attached) return;
      if (!context.waiting) return;
      try { await command('Runtime.runIfWaitingForDebugger', {}, sessionId); context.waiting = false; } catch {}
    });
  };
  const detachChild = params => {
    const sessionId = bounded(params.sessionId, 200);
    let context = children.get(sessionId);
    if (!context && typeof params.targetId === 'string') {
      const targetId = bounded(params.targetId, 200);
      context = [...children.values()].find(value => value.targetId === targetId);
    }
    if (context) dropChild(context);
  };
  const message = (_event, method, params = {}, sessionId) => {
    if (closed || !attached) return;
    if (method === 'Target.attachedToTarget') { attachChild(params); return; }
    if (method === 'Target.detachedFromTarget') { detachChild(params); return; }
    if (!sessionId) { handle(root, method, params, generation); return; } // Root target.
    const context = children.get(bounded(sessionId, 200));
    if (context) handle(context, method, params, generation);
  };
  const detached = (_event, reason) => {
    attached = false; generation++; cancelCommands(); state = closed ? 'stopped' : `detached:${bounded(reason, 160)}`;
    finalize(root);
    for (const context of children.values()) {
      finalize(context);
      // Child state is dropped entirely on detach, so release its retained bodies
      // from the shared budget. Root records stay visible as before.
      for (const hops of context.records.values()) discard(hops);
    }
    children.clear();
    recordOrder = recordOrder.filter(entry => entry.context === root);
  };
  const destroyed = () => api.dispose();
  const select = (query = {}) => {
    if (!object(query) || typeof query.requestId !== 'string' || (query.hop !== undefined && (!Number.isSafeInteger(query.hop) || query.hop < 0))) fail('INVALID_NETWORK_QUERY');
    const { requestId, hop } = query;
    const pick = context => {
      const hops = context.records.get(requestId);
      return hop === undefined ? hops?.at(-1) : hops?.find(value => value.hop === hop);
    };
    let context;
    // Explicit session/target selection always wins; otherwise search root first,
    // then children, and refuse to guess when two child sessions collide.
    if (query.sessionId !== undefined) {
      if (typeof query.sessionId !== 'string' || query.sessionId.length > 200) fail('INVALID_NETWORK_QUERY');
      context = children.get(bounded(query.sessionId, 200));
      if (!context) fail('NETWORK_REQUEST_NOT_FOUND');
    } else if (query.targetId !== undefined) {
      if (typeof query.targetId !== 'string' || query.targetId.length > 200) fail('INVALID_NETWORK_QUERY');
      const targetId = bounded(query.targetId, 200);
      const matches = [...children.values()].filter(value => value.targetId === targetId);
      if (matches.length !== 1) fail('NETWORK_REQUEST_NOT_FOUND');
      context = matches[0];
    }
    if (context) {
      const record = pick(context);
      if (!record) fail('NETWORK_REQUEST_NOT_FOUND');
      return record;
    }
    const rootRecord = pick(root);
    if (rootRecord) return rootRecord;
    let found;
    for (const child of children.values()) {
      const record = pick(child);
      if (!record) continue;
      if (found) fail('NETWORK_REQUEST_NOT_FOUND'); // Ambiguous across sessions.
      found = record;
    }
    if (!found) fail('NETWORK_REQUEST_NOT_FOUND');
    return found;
  };
  const withoutBody = record => ({ ...record, requestBody: { ...record.requestBody, body: undefined }, responseBody: { ...record.responseBody, body: undefined } });
  const api = {
    status() {
      const result = { state, generation, cursor: sequence, requests: recordOrder.length, dropped, bodyBytes, extraInfoDropped: root.extraInfoDropped, limits: { ...limits }, scope: childTargets ? 'owned-tree' : 'owned-root-target', childTargets, children: children.size };
      for (const context of children.values()) result.extraInfoDropped += context.extraInfoDropped;
      if (childEvicted) result.childEvicted = childEvicted;
      if (childAttachError) result.childAttachError = childAttachError;
      return result;
    },
    list(query = {}) {
      if (!object(query)) fail('INVALID_NETWORK_QUERY');
      const { afterSequence = 0, limit = 100, filter = '' } = query;
      if (!Number.isSafeInteger(afterSequence) || afterSequence < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100 || typeof filter !== 'string' || filter.length > 200) fail('INVALID_NETWORK_QUERY');
      const all = [];
      for (const context of [root, ...children.values()]) for (const hops of context.records.values()) for (const record of hops) all.push(record);
      const selected = all.filter(record => record.sequence > afterSequence && record.url.includes(filter)).sort((a, b) => a.sequence - b.sequence);
      const items = [];
      const page = () => ({ items, cursor: items.at(-1)?.sequence ?? Math.max(sequence, afterSequence), hasMore: selected.length > items.length, truncated: dropped > 0, dropped, untrusted: true });
      for (const record of selected.slice(0, limit)) {
        const item = { requestId: record.requestId, hop: record.hop, sequence: record.sequence, url: record.url, method: record.method, type: record.type, status: record.status, state: record.state, startedAt: record.startedAt, finishedAt: record.finishedAt, targetType: record.targetType };
        if (record.sessionId) { item.sessionId = record.sessionId; item.targetId = record.targetId; }
        items.push(item);
        if (jsonBytes(page()) >= JSON_BYTES) { items.pop(); break; }
      }
      // Each individually bounded summary fits. The cursor is the last returned
      // sequence, never the end of the rejected candidate or the current stream.
      return page();
    },
    read(query) {
      const result = { ...copy(withoutBody(select(query))), untrusted: true };
      if (jsonBytes(result) < JSON_BYTES) return result;
      result.metadataTruncated = true; result.truncatedFields = [];
      // Large escaped header text and header maps are lower priority than request
      // identity/lifecycle. Mark every omitted section explicitly.
      for (const [parent, key, path] of [[result.responseExtra, 'headersText', 'responseExtra.headersText'], [result, 'timing', 'timing'], [result, 'responseHeaders', 'responseHeaders'], [result.responseExtra, 'headers', 'responseExtra.headers'], [result, 'requestHeaders', 'requestHeaders'], [result.requestExtra, 'headers', 'requestExtra.headers']]) {
        if (!parent || !Object.hasOwn(parent, key)) continue;
        delete parent[key]; result.truncatedFields.push(path);
        if (jsonBytes(result) < JSON_BYTES) return result;
      }
      fail('NETWORK_METADATA_RESPONSE_TOO_LARGE');
    },
    body(query = {}) { if (!object(query) || !['request', 'response'].includes(query.kind)) fail('INVALID_BODY_KIND'); return { ...copy(select(query)[query.kind + 'Body']), untrusted: true }; },
    frames(query = {}) {
      const ring = framesByRecord.get(select(query)), frames = ring ? copy(ring.frames) : [];
      let truncated = !!(ring && ring.dropped);
      const page = () => ({ frames, truncated: truncated || !!(ring && ring.dropped), untrusted: true });
      // Frames never enter list/read; their own response is also kept under the
      // same JSON budget, with the oldest retained frames dropped first.
      while (frames.length && jsonBytes(page()) >= JSON_BYTES) { frames.shift(); truncated = true; }
      return page();
    },
    clear() {
      // Resume still-paused children before dropping state: clear() keeps
      // capturing, so a waitForDebuggerOnStart child must not stay frozen.
      for (const context of children.values()) resumeChild(context);
      generation++; cancelCommands();
      for (const context of [root, ...children.values()]) { context.records.clear(); context.streams.clear(); context.extraInfoDropped = 0; }
      children.clear(); recordOrder = []; bodyBytes = 0; dropped = 0; childEvicted = 0;
      return api.status();
    },
    async settled() { await Promise.allSettled([...pending]); },
    dispose() {
      if (closed) return; closed = true; generation++; cancelCommands(); state = 'stopped';
      debug.removeListener('message', message); debug.removeListener('detach', detached); webContents.removeListener('destroyed', destroyed);
      signal?.removeEventListener('abort', destroyed);
      if (attached) { attached = false; try { debug.detach(); } catch {} }
      for (const context of [root, ...children.values()]) { context.records.clear(); context.streams.clear(); }
      children.clear(); recordOrder = []; bodyBytes = 0;
    },
  };
  try {
    debug.attach('1.3'); attached = true;
    debug.on('message', message); debug.on('detach', detached); webContents.once('destroyed', destroyed);
    signal?.addEventListener('abort', destroyed, { once: true });
    if (signal?.aborted) { api.dispose(); fail('NETWORK_START_CANCELLED'); }
    await command('Network.enable', { maxTotalBufferSize: limits.total, maxResourceBufferSize: limits.body, maxPostDataSize: limits.body });
    if (closed || !attached) fail('NETWORK_START_CANCELLED');
    if (childTargets) {
      // Auto-attach failures are capability notes, never recorder failures. A
      // local cancellation (dispose/detach/abort) still cancels the whole start.
      try { await command('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true }); }
      catch (error) {
        if (closed || !attached) throw error;
        childAttachError = bounded(error?.message, 400) || 'CHILD_TARGET_ATTACH_FAILED';
      }
    }
    if (closed || !attached) fail('NETWORK_START_CANCELLED'); state = 'capturing'; return api;
  } catch (error) { api.dispose(); throw error; }
}
