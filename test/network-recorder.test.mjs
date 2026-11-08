import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { createNetworkRecorder } from '../native/network-recorder.js';

// Controlled protocol tests only: no Electron process or installed DSH connection.
class FakeDebugger extends EventEmitter {
  attached = false;
  attachCalls = [];
  detachCalls = 0;
  commands = [];
  handlers = new Map();
  isAttached() { return this.attached; }
  attach(version) { this.attachCalls.push(version); this.attached = true; }
  detach() { this.detachCalls++; this.externalDetach('target closed'); }
  externalDetach(reason) { this.attached = false; this.emit('detach', {}, reason); }
  sendCommand(method, params, sessionId) {
    // Keep the recorded shape identical for root commands (no sessionId key).
    this.commands.push(sessionId === undefined ? { method, params } : { method, params, sessionId });
    try { return Promise.resolve(this.handlers.get(method)?.(params, sessionId) ?? {}); }
    catch (error) { return Promise.reject(error); }
  }
  message(method, params = {}, sessionId) { this.emit('message', {}, method, params, sessionId); }
}
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
async function fixture(t, options) {
  const guest = new EventEmitter();
  guest.debugger = new FakeDebugger();
  const recorder = await createNetworkRecorder(guest, options);
  t.after(() => recorder.dispose());
  return { guest, debug: guest.debugger, recorder };
}
function request(debug, requestId = 'r', extra = {}, params = {}) {
  debug.message('Network.requestWillBeSent', {
    requestId, timestamp: 1, wallTime: 100, type: 'Fetch', frameId: 'f', loaderId: 'l',
    request: { url: 'https://example.test/data', method: 'GET', headers: {}, ...extra }, ...params,
  });
}
function finish(debug, requestId = 'r') {
  debug.message('Network.loadingFinished', { requestId, timestamp: 3, encodedDataLength: 12 });
}
const bodyCommands = debug => debug.commands.filter(({ method }) => method !== 'Network.enable');

test('hanging Network.enable times out, detaches its own debugger, and ignores late success', { timeout: 1000 }, async () => {
  const guest = new EventEmitter(); guest.debugger = new FakeDebugger();
  const pending = deferred();
  guest.debugger.handlers.set('Network.enable', () => pending.promise);
  await assert.rejects(createNetworkRecorder(guest, { commandTimeoutMs: 10 }), /NETWORK_COMMAND_TIMEOUT/);
  assert.equal(guest.debugger.detachCalls, 1);
  assert.equal(guest.debugger.listenerCount('message'), 0);
  assert.equal(guest.listenerCount('destroyed'), 0);
  pending.resolve({}); await Promise.resolve();
  assert.equal(guest.debugger.isAttached(), false);
  assert.equal(guest.debugger.detachCalls, 1);
});

for (const kind of ['request', 'response']) test(`hanging ${kind} body times out and late results stay unavailable`, { timeout: 1000 }, async t => {
  const { debug, recorder } = await fixture(t, { commandTimeoutMs: 10 });
  const pending = deferred();
  debug.handlers.set(kind === 'request' ? 'Network.getRequestPostData' : 'Network.getResponseBody', () => pending.promise);
  request(debug, 'r', kind === 'request' ? { hasPostData: true } : {});
  if (kind === 'response') finish(debug);
  await recorder.settled();
  assert.equal(recorder.body({ requestId: 'r', kind }).reason, 'NETWORK_COMMAND_TIMEOUT');
  pending.resolve(kind === 'request' ? { postData: 'late' } : { body: 'late' });
  await Promise.resolve(); await Promise.resolve();
  assert.equal(recorder.body({ requestId: 'r', kind }).reason, 'NETWORK_COMMAND_TIMEOUT');
  assert.equal(recorder.status().bodyBytes, 0);
});

for (const action of ['clear', 'dispose', 'detach']) test(`${action} settles waits immediately for commands that never resolve`, { timeout: 1000 }, async t => {
  const { debug, recorder } = await fixture(t); // Default deadline is 10s, well beyond this test's timeout.
  debug.handlers.set('Network.getRequestPostData', () => new Promise(() => {}));
  debug.handlers.set('Network.getResponseBody', () => new Promise(() => {}));
  request(debug, 'r', { hasPostData: true }); finish(debug);
  await Promise.resolve();
  assert.equal(bodyCommands(debug).length, 2);
  const waiting = recorder.settled();
  if (action === 'detach') debug.externalDetach('replaced');
  else recorder[action]();
  await waiting;
  assert.equal(recorder.status().bodyBytes, 0);
});

for (const action of ['destroy', 'detach']) test(`${action} cancels a hanging setup without waiting for its deadline`, { timeout: 1000 }, async () => {
  const guest = new EventEmitter(); guest.debugger = new FakeDebugger();
  guest.debugger.handlers.set('Network.enable', () => new Promise(() => {}));
  const starting = createNetworkRecorder(guest);
  const rejected = assert.rejects(starting, /NETWORK_COMMAND_CANCELLED/);
  if (action === 'destroy') guest.emit('destroyed');
  else guest.debugger.externalDetach('replaced');
  await rejected;
  assert.equal(guest.debugger.detachCalls, action === 'destroy' ? 1 : 0);
  assert.equal(guest.debugger.listenerCount('message'), 0);
  assert.equal(guest.listenerCount('destroyed'), 0);
});

test('captures ordered extra headers and response metadata with immutable, untrusted reads', async t => {
  const { debug, recorder } = await fixture(t);
  assert.deepEqual(debug.attachCalls, ['1.3']);
  assert.equal(debug.commands[0].method, 'Network.enable');
  request(debug, 'r', { url: 'https://user:password@example.test/data', headers: { Accept: 'text/plain' } });
  debug.message('Network.requestWillBeSentExtraInfo', { requestId: 'r', headers: { Cookie: 'fake-cookie=value' } });
  debug.message('Network.responseReceived', { requestId: 'r', timestamp: 2, hasExtraInfo: true, response: {
    status: 200, statusText: 'OK', headers: { 'Content-Type': 'text/plain' }, mimeType: 'text/plain',
    protocol: 'h2', fromDiskCache: true, remoteIPAddress: '192.0.2.1', timing: { receiveHeadersEnd: 5, ignored: 'x' },
  } });
  debug.message('Network.responseReceivedExtraInfo', { requestId: 'r', statusCode: 200,
    headers: { 'Set-Cookie': 'fake-cookie=next' }, headersText: 'HTTP/1.1 200 OK\r\n' });
  debug.message('Network.requestServedFromCache', { requestId: 'r' });
  const value = recorder.read({ requestId: 'r' });
  assert.equal(value.url, 'https://example.test/data');
  assert.equal(value.requestHeaders.Accept, 'text/plain');
  assert.equal(value.requestExtra.headers.Cookie, 'fake-cookie=value');
  assert.equal(value.responseExtra.headers['Set-Cookie'], 'fake-cookie=next');
  assert.equal(value.responseHeaders['Content-Type'], 'text/plain');
  assert.deepEqual(value.timing, { receiveHeadersEnd: 5 });
  assert.equal(value.status, 200);
  assert.equal(value.fromCache, true);
  assert.equal(value.fromDiskCache, true);
  assert.equal(value.untrusted, true);
  value.requestExtra.headers.Cookie = 'mutated';
  assert.equal(recorder.read({ requestId: 'r' }).requestExtra.headers.Cookie, 'fake-cookie=value');
});

test('redirects retain distinct hops, ordered extra headers, and only fetch the final response body', async t => {
  const { debug, recorder } = await fixture(t);
  debug.handlers.set('Network.getResponseBody', () => ({ body: 'final', base64Encoded: false }));
  request(debug, 'r', { method: 'POST', postData: 'first' });
  debug.message('Network.requestWillBeSentExtraInfo', { requestId: 'r', headers: { 'X-Hop': '0' } });
  debug.message('Network.responseReceivedExtraInfo', { requestId: 'r', statusCode: 302, headers: { Location: '/next' } });
  request(debug, 'r', { url: 'https://example.test/next' }, {
    timestamp: 2, redirectHasExtraInfo: true, redirectResponse: { status: 302, url: 'https://example.test/data', headers: { Location: '/next' } },
  });
  debug.message('Network.requestWillBeSentExtraInfo', { requestId: 'r', headers: { 'X-Hop': '1' } });
  debug.message('Network.responseReceived', { requestId: 'r', hasExtraInfo: true, response: { status: 200 } });
  finish(debug);
  await recorder.settled();
  assert.deepEqual(recorder.list().items.map(({ hop, state }) => [hop, state]), [[0, 'redirected'], [1, 'finished']]);
  assert.equal(recorder.read({ requestId: 'r', hop: 0 }).status, 302);
  assert.equal(recorder.read({ requestId: 'r', hop: 0 }).responseExtra.statusCode, 302);
  assert.equal(recorder.read({ requestId: 'r', hop: 1 }).requestExtra.headers['X-Hop'], '1');
  assert.equal(recorder.body({ requestId: 'r', hop: 0, kind: 'request' }).body, 'first');
  assert.equal(recorder.body({ requestId: 'r', hop: 0, kind: 'response' }).reason, 'REDIRECT_BODY_UNAVAILABLE');
  assert.equal(recorder.body({ requestId: 'r', kind: 'response' }).body, 'final');
  assert.equal(bodyCommands(debug).length, 1);
});

test('captures inline and fetched POST data without replaying requests', async t => {
  const { debug, recorder } = await fixture(t);
  debug.handlers.set('Network.getRequestPostData', () => ({ postData: 'name=é' }));
  request(debug, 'inline', { method: 'POST', postData: '' });
  request(debug, 'fetch', { method: 'POST', hasPostData: true });
  await recorder.settled();
  assert.equal(recorder.body({ requestId: 'inline', kind: 'request' }).body, '');
  assert.equal(recorder.body({ requestId: 'fetch', kind: 'request' }).bytes, 7);
  assert.deepEqual(bodyCommands(debug), [{ method: 'Network.getRequestPostData', params: { requestId: 'fetch' } }]);
  assert.equal(Object.hasOwn(recorder.read({ requestId: 'fetch' }).requestBody, 'body'), false);
});

test('preserves binary response base64 and counts decoded bytes', async t => {
  const { debug, recorder } = await fixture(t);
  const bytes = Buffer.from([0, 255, 128, 10]);
  debug.handlers.set('Network.getResponseBody', () => ({ body: bytes.toString('base64'), base64Encoded: true }));
  request(debug); finish(debug); await recorder.settled();
  const value = recorder.body({ requestId: 'r', kind: 'response' });
  assert.deepEqual(Buffer.from(value.body, 'base64'), bytes);
  assert.equal(value.base64Encoded, true);
  assert.equal(value.bytes, 4);
  assert.equal(recorder.status().bodyBytes, 4);
});

test('records transport failures and unavailable body results', async t => {
  const { debug, recorder } = await fixture(t);
  request(debug, 'failed');
  debug.message('Network.loadingFailed', { requestId: 'failed', timestamp: 4, errorText: 'net::ERR_ABORTED', canceled: true, blockedReason: 'inspector' });
  assert.equal(recorder.read({ requestId: 'failed' }).state, 'failed');
  assert.equal(recorder.read({ requestId: 'failed' }).canceled, true);
  assert.equal(recorder.body({ requestId: 'failed', kind: 'response' }).reason, 'REQUEST_FAILED');
  assert.equal(bodyCommands(debug).length, 0);
  debug.handlers.set('Network.getRequestPostData', () => { throw new Error('No post data'); });
  request(debug, 'post', { method: 'POST', hasPostData: true });
  request(debug, 'missing'); finish(debug, 'missing');
  await recorder.settled();
  assert.equal(recorder.body({ requestId: 'post', kind: 'request' }).reason, 'No post data');
  assert.equal(recorder.body({ requestId: 'missing', kind: 'response' }).reason, 'BODY_NOT_RETURNED');
});

test('enforces UTF-8 per-body and aggregate budgets and releases evicted bytes', async t => {
  const { debug, recorder } = await fixture(t, { maxRequests: 2, maxBodyBytes: 4, maxTotalBodyBytes: 5 });
  request(debug, 'a', { postData: 'éé' });
  request(debug, 'b', { postData: 'xx' });
  assert.equal(recorder.body({ requestId: 'a', kind: 'request' }).bytes, 4);
  assert.equal(recorder.body({ requestId: 'b', kind: 'request' }).reason, 'BODY_LIMIT');
  assert.equal(recorder.status().bodyBytes, 4);
  request(debug, 'c', { postData: '12345' });
  assert.throws(() => recorder.read({ requestId: 'a' }), /NETWORK_REQUEST_NOT_FOUND/);
  assert.equal(recorder.body({ requestId: 'c', kind: 'request' }).truncated, true);
  assert.equal(recorder.status().bodyBytes, 0);
  request(debug, 'd', { postData: '1234' });
  assert.equal(recorder.status().bodyBytes, 4);
  assert.equal(recorder.list().truncated, true);
  assert.equal(recorder.status().requests, 2);
});

test('bounds redirect chains and frees discarded hop bodies', async t => {
  const { debug, recorder } = await fixture(t);
  for (let hop = 0; hop < 25; hop++) request(debug, 'r', { postData: 'x' }, hop ? { redirectResponse: { status: 302 } } : {});
  const result = recorder.list();
  assert.equal(result.items.length, 20);
  assert.equal(result.items[0].hop, 5);
  assert.equal(result.items.at(-1).hop, 24);
  assert.equal(result.dropped, 5);
  assert.equal(recorder.status().bodyBytes, 20);
});

for (const action of ['clear', 'dispose', 'destroy', 'detach']) {
  const stop = ({ guest, debug, recorder }) => {
    if (action === 'destroy') guest.emit('destroyed');
    else if (action === 'detach') debug.externalDetach('replaced');
    else recorder[action]();
  };
  test(`${action} cancels queued body commands before dispatch`, async t => {
    const f = await fixture(t);
    request(f.debug, 'r', { hasPostData: true }); finish(f.debug);
    stop(f);
    await f.recorder.settled();
    assert.deepEqual(bodyCommands(f.debug), []);
    assert.equal(f.recorder.status().bodyBytes, 0);
  });
  test(`${action} fences in-flight body results`, async t => {
    const f = await fixture(t);
    const pending = deferred();
    f.debug.handlers.set('Network.getResponseBody', () => pending.promise);
    request(f.debug); finish(f.debug);
    await Promise.resolve();
    assert.equal(bodyCommands(f.debug).length, 1);
    const generation = f.recorder.status().generation;
    stop(f);
    pending.resolve({ body: 'obsolete', base64Encoded: false });
    await f.recorder.settled();
    assert.ok(f.recorder.status().generation > generation);
    assert.equal(f.recorder.status().bodyBytes, 0);
    if (action !== 'detach') assert.deepEqual(f.recorder.list().items, []);
    else assert.notEqual(f.recorder.body({ requestId: 'r', kind: 'response' }).state, 'available');
  });
}

test('clear generation prevents an old body from populating a reused request ID', async t => {
  const { debug, recorder } = await fixture(t);
  const pending = deferred();
  debug.handlers.set('Network.getResponseBody', () => pending.promise);
  request(debug); finish(debug); await Promise.resolve();
  recorder.clear();
  request(debug, 'r', { url: 'https://example.test/new' });
  pending.resolve({ body: 'old' }); await recorder.settled();
  assert.equal(recorder.read({ requestId: 'r' }).url, 'https://example.test/new');
  assert.equal(recorder.body({ requestId: 'r', kind: 'response' }).state, 'pending');
});

test('eviction cancels queued commands and redirect POST retrieval never uses a later hop', async t => {
  const { debug, recorder } = await fixture(t, { maxRequests: 1 });
  request(debug, 'evicted', { hasPostData: true });
  request(debug, 'r', { hasPostData: true });
  request(debug, 'r', {}, { redirectResponse: { status: 303 } });
  await recorder.settled();
  assert.deepEqual(bodyCommands(debug), []);
  assert.equal(recorder.body({ requestId: 'r', hop: 0, kind: 'request' }).reason, 'REQUEST_REDIRECTED');
});

for (const outcome of ['resolve', 'reject']) test(`a late body ${outcome} cannot overwrite a recorded loading failure`, async t => {
  const { debug, recorder } = await fixture(t);
  const pending = deferred();
  debug.handlers.set('Network.getResponseBody', () => pending.promise);
  request(debug); finish(debug); await Promise.resolve();
  debug.message('Network.loadingFailed', { requestId: 'r', errorText: 'failed' });
  if (outcome === 'resolve') pending.resolve({ body: 'late' });
  else pending.reject(new Error('late debugger error'));
  await recorder.settled();
  assert.equal(recorder.body({ requestId: 'r', kind: 'response' }).reason, 'REQUEST_FAILED');
});

test('refuses an already attached debugger without taking ownership', async () => {
  const guest = new EventEmitter(); guest.debugger = new FakeDebugger(); guest.debugger.attached = true;
  await assert.rejects(createNetworkRecorder(guest), /NETWORK_DEBUGGER_ALREADY_ATTACHED/);
  assert.equal(guest.debugger.detachCalls, 0);
  assert.equal(guest.debugger.listenerCount('message'), 0);
  assert.deepEqual(guest.debugger.commands, []);
});

test('enable failure releases owned attachment and lifecycle listeners', async () => {
  const guest = new EventEmitter(); guest.debugger = new FakeDebugger();
  guest.debugger.handlers.set('Network.enable', () => { throw new Error('enable rejected'); });
  await assert.rejects(createNetworkRecorder(guest), /enable rejected/);
  assert.equal(guest.debugger.detachCalls, 1);
  assert.equal(guest.debugger.listenerCount('message'), 0);
  assert.equal(guest.debugger.listenerCount('detach'), 0);
  assert.equal(guest.listenerCount('destroyed'), 0);
});

test('external detach does not detach a replacement owner on disposal', async t => {
  const { guest, debug, recorder } = await fixture(t);
  debug.externalDetach('replaced');
  debug.attached = true;
  recorder.dispose(); recorder.dispose();
  assert.equal(debug.detachCalls, 0);
  assert.equal(debug.listenerCount('message'), 0);
  assert.equal(guest.listenerCount('destroyed'), 0);
});

test('ignores child targets and orphan events and exposes bounded query behavior', async t => {
  const { debug, recorder } = await fixture(t);
  debug.message('Network.requestWillBeSent', { requestId: 'child', request: { url: 'https://example.test/child' } }, 'child-session');
  debug.message('Network.responseReceivedExtraInfo', { requestId: 'orphan', statusCode: 200 });
  assert.equal(recorder.status().childTargets, false);
  assert.equal(recorder.status().scope, 'owned-root-target');
  assert.deepEqual(recorder.list().items, []);
  request(debug, 'a'); request(debug, 'b', { url: 'https://example.test/other' });
  const page = recorder.list({ limit: 1 });
  assert.equal(page.hasMore, true);
  assert.equal(recorder.list({ afterSequence: page.cursor }).items[0].requestId, 'b');
  assert.equal(recorder.list({ filter: '/other' }).items.length, 1);
  assert.throws(() => recorder.list({ limit: 101 }), /INVALID_NETWORK_QUERY/);
  assert.throws(() => recorder.body({ requestId: 'a', kind: 'other' }), /INVALID_BODY_KIND/);
});

for (const [name, order] of [
  ['ExtraInfo before any base event', ['q0', 's0', 'b0', 'b1', 'q1', 's1', 'response']],
  ['old ExtraInfo delayed beyond the new response', ['b0', 'b1', 'response', 'q0', 's0', 'q1', 's1']],
  ['independent request and response ExtraInfo order', ['b0', 's0', 'b1', 's1', 'response', 'q0', 'q1']],
]) test(`redirect correlation handles ${name}`, async t => {
  const { debug, recorder } = await fixture(t);
  const actions = {
    b0: () => request(debug),
    b1: () => request(debug, 'r', { url: 'https://example.test/final' }, { redirectResponse: { status: 302 }, redirectHasExtraInfo: true }),
    response: () => debug.message('Network.responseReceived', { requestId: 'r', hasExtraInfo: true, response: { status: 200 } }),
  };
  for (const hop of [0, 1]) {
    actions['q' + hop] = () => debug.message('Network.requestWillBeSentExtraInfo', { requestId: 'r', headers: { 'X-Request-Hop': String(hop) } });
    actions['s' + hop] = () => debug.message('Network.responseReceivedExtraInfo', { requestId: 'r', statusCode: hop ? 200 : 302, headers: { 'X-Response-Hop': String(hop) } });
  }
  for (const action of order) actions[action]();
  for (const hop of [0, 1]) {
    const value = recorder.read({ requestId: 'r', hop });
    assert.equal(value.requestExtra.headers['X-Request-Hop'], String(hop));
    assert.equal(value.responseExtra.headers['X-Response-Hop'], String(hop));
    assert.deepEqual(value.extraInfo, { request: 'captured', response: 'captured' });
  }
});

test('ExtraInfo flags skip hops without extras even when headers arrive after the last redirect', async t => {
  const { debug, recorder } = await fixture(t);
  request(debug);
  request(debug, 'r', {}, { redirectResponse: { status: 302 }, redirectHasExtraInfo: false });
  request(debug, 'r', {}, { redirectResponse: { status: 302 }, redirectHasExtraInfo: true });
  debug.message('Network.responseReceived', { requestId: 'r', hasExtraInfo: false, response: { status: 200 } });
  debug.message('Network.requestWillBeSentExtraInfo', { requestId: 'r', headers: { 'X-Hop': '1' } });
  debug.message('Network.responseReceivedExtraInfo', { requestId: 'r', statusCode: 302, headers: { 'X-Hop': '1' } });
  for (const hop of [0, 2]) {
    const value = recorder.read({ requestId: 'r', hop });
    assert.equal(value.requestExtra, undefined); assert.equal(value.responseExtra, undefined);
    assert.deepEqual(value.extraInfo, { request: 'not-emitted', response: 'not-emitted' });
  }
  const value = recorder.read({ requestId: 'r', hop: 1 });
  assert.equal(value.requestExtra.headers['X-Hop'], '1');
  assert.equal(value.responseExtra.headers['X-Hop'], '1');
});

test('missing old-hop flags leave correlation unresolved instead of assigning old headers to a new hop', async t => {
  const { debug, recorder } = await fixture(t);
  request(debug);
  request(debug, 'r', {}, { redirectResponse: { status: 302 } });
  debug.message('Network.responseReceived', { requestId: 'r', hasExtraInfo: true, response: { status: 200 } });
  for (const hop of [0, 1]) {
    debug.message('Network.requestWillBeSentExtraInfo', { requestId: 'r', headers: { 'X-Hop': String(hop) } });
    debug.message('Network.responseReceivedExtraInfo', { requestId: 'r', statusCode: hop ? 200 : 302, headers: { 'X-Hop': String(hop) } });
  }
  assert.equal(recorder.read({ requestId: 'r', hop: 0 }).extraInfo.request, 'unresolved');
  const final = recorder.read({ requestId: 'r', hop: 1 });
  assert.equal(final.extraInfo.request, 'expected');
  assert.equal(final.requestExtra, undefined); assert.equal(final.responseExtra, undefined);
});

test('evicted redirect tombstones consume delayed old ExtraInfo without retaining old bodies', async t => {
  const { debug, recorder } = await fixture(t);
  for (let hop = 0; hop < 25; hop++) request(debug, 'r', { postData: 'x' }, hop ? { redirectResponse: { status: 302 }, redirectHasExtraInfo: true } : {});
  debug.message('Network.responseReceived', { requestId: 'r', hasExtraInfo: true, response: { status: 200 } });
  for (let hop = 0; hop < 25; hop++) {
    debug.message('Network.requestWillBeSentExtraInfo', { requestId: 'r', headers: { 'X-Hop': String(hop) } });
    debug.message('Network.responseReceivedExtraInfo', { requestId: 'r', statusCode: hop === 24 ? 200 : 302, headers: { 'X-Hop': String(hop) } });
  }
  assert.equal(recorder.status().bodyBytes, 20);
  assert.equal(recorder.status().dropped, 5);
  for (let hop = 5; hop < 25; hop++) {
    const value = recorder.read({ requestId: 'r', hop });
    assert.equal(value.requestExtra.headers['X-Hop'], String(hop));
    assert.equal(value.responseExtra.headers['X-Hop'], String(hop));
  }
});

for (const source of ['early-extras', 'redirects']) test(`${source} correlation overflow is bounded and reported without guessing`, async t => {
  const { debug, recorder } = await fixture(t);
  if (source === 'early-extras') {
    for (let index = 0; index < 45; index++) debug.message('Network.requestWillBeSentExtraInfo', { requestId: 'r', headers: { 'X-Index': String(index) } });
    assert.deepEqual(recorder.list().items, []);
    request(debug);
  } else {
    for (let hop = 0; hop < 45; hop++) request(debug, 'r', {}, hop ? { redirectResponse: { status: 302 }, redirectHasExtraInfo: true } : {});
  }
  debug.message('Network.responseReceived', { requestId: 'r', hasExtraInfo: true, response: { status: 200 } });
  debug.message('Network.requestWillBeSentExtraInfo', { requestId: 'r', headers: { 'X-Late': 'never guessed' } });
  const value = recorder.read({ requestId: 'r' });
  assert.equal(value.requestExtra, undefined);
  assert.equal(value.extraInfo.request, 'correlation-limit');
  assert.ok(recorder.status().extraInfoDropped > 0);
  assert.ok(recorder.list().items.length <= 20);
});

test('list pages fit the JSON byte budget and advance only past returned records', async t => {
  const { debug, recorder } = await fixture(t);
  const ids = [];
  for (let index = 0; index < 80; index++) {
    const id = `r${index}:` + '\u0000'.repeat(180); ids.push(id);
    request(debug, id, { url: 'https://example.test/' + '漢'.repeat(2000), method: '"'.repeat(24) });
  }
  const collected = []; let cursor = 0, pages = 0;
  while (true) {
    const page = recorder.list({ afterSequence: cursor }); pages++;
    assert.ok(Buffer.byteLength(JSON.stringify(page), 'utf8') < 59000);
    assert.ok(Buffer.byteLength(JSON.stringify({ ok: true, value: page }), 'utf8') < 60000);
    assert.ok(page.items.length > 0);
    assert.equal(page.cursor, page.items.at(-1).sequence);
    assert.ok(page.cursor > cursor);
    collected.push(...page.items.map(item => item.requestId)); cursor = page.cursor;
    if (!page.hasMore) break;
    assert.ok(pages < 80);
  }
  assert.ok(pages > 1);
  assert.deepEqual(collected, ids);
  assert.equal(recorder.list({ afterSequence: cursor }).hasMore, false);
});

test('read bounds complete escaped metadata and explicitly reports omitted sections', async t => {
  const { debug, recorder } = await fixture(t);
  const many = Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`h${i}`, '\u0000'.repeat(1000)]));
  request(debug, 'r', { headers: many });
  debug.message('Network.requestWillBeSentExtraInfo', { requestId: 'r', headers: many });
  debug.message('Network.responseReceivedExtraInfo', { requestId: 'r', statusCode: 200, headers: many, headersText: '\u0000'.repeat(8000) });
  debug.message('Network.responseReceived', { requestId: 'r', hasExtraInfo: true, response: { status: 200, headers: many, timing: Object.fromEntries(Array.from({ length: 32 }, (_, i) => ['\u0000'.repeat(75) + i, 1])) } });
  const value = recorder.read({ requestId: 'r' });
  assert.ok(Buffer.byteLength(JSON.stringify(value), 'utf8') < 59000);
  assert.ok(Buffer.byteLength(JSON.stringify({ ok: true, value }), 'utf8') < 60000);
  assert.equal(value.requestId, 'r'); assert.equal(value.status, 200);
  assert.equal(value.metadataTruncated, true);
  assert.ok(value.truncatedFields.includes('responseExtra.headersText'));
  assert.equal(value.untrusted, true);
});

test('header capture protects special keys and rejects non-string values without coercion', async t => {
  const { debug, recorder } = await fixture(t);
  const value = JSON.parse('{"__proto__":"captured","constructor":"also captured"}');
  value.Array = ['not a CDP string'];
  value.Object = { toString() { throw Error('must not coerce'); } };
  value.Long = 'x'.repeat(1000000);
  request(debug, 'r', { headers: value });
  const result = recorder.read({ requestId: 'r' });
  assert.equal(Object.hasOwn(result.requestHeaders, '__proto__'), true);
  assert.equal(result.requestHeaders.__proto__, 'captured');
  assert.equal(result.requestHeaders.constructor, 'also captured');
  assert.equal(Object.hasOwn(result.requestHeaders, 'Array'), false);
  assert.equal(Object.hasOwn(result.requestHeaders, 'Object'), false);
  assert.equal(result.requestHeaders.Long.length, 4096);
  request(debug, 'array', { headers: ['not a header map'] });
  assert.deepEqual(recorder.read({ requestId: 'array' }).requestHeaders, {});
  assert.equal({}.polluted, undefined);
});

test('an in-flight POST lookup cannot assign a later redirect hop body to the old hop', async t => {
  const { debug, recorder } = await fixture(t), gate = deferred();
  debug.handlers.set('Network.getRequestPostData', () => gate.promise);
  request(debug, 'r', { method: 'POST', hasPostData: true }); await Promise.resolve();
  request(debug, 'r', { method: 'POST', postData: 'final' }, { redirectResponse: { status: 307 }, redirectHasExtraInfo: false });
  gate.resolve({ postData: 'ambiguous-late-data' }); await recorder.settled();
  assert.equal(recorder.body({ requestId: 'r', hop: 0, kind: 'request' }).reason, 'REQUEST_REDIRECTED');
  assert.equal(recorder.body({ requestId: 'r', hop: 1, kind: 'request' }).body, 'final');
});

test('internal abort cancels a hanging setup and cleans up its owned debugger immediately', { timeout: 1000 }, async () => {
  const guest = new EventEmitter(); guest.debugger = new FakeDebugger();
  const controller = new AbortController();
  guest.debugger.handlers.set('Network.enable', () => new Promise(() => {}));
  const started = createNetworkRecorder(guest, { signal: controller.signal });
  const rejected = assert.rejects(started, /NETWORK_COMMAND_CANCELLED/);
  controller.abort(); await rejected;
  assert.equal(guest.debugger.detachCalls, 1);
  assert.equal(guest.debugger.listenerCount('message'), 0);
  assert.equal(guest.listenerCount('destroyed'), 0);
});

test('pre-aborted setup never attaches and destroyed supplied guests are rejected', async () => {
  const guest = new EventEmitter(); guest.debugger = new FakeDebugger();
  const controller = new AbortController(); controller.abort();
  await assert.rejects(createNetworkRecorder(guest, { signal: controller.signal }), /NETWORK_START_CANCELLED/);
  guest.isDestroyed = () => true;
  await assert.rejects(createNetworkRecorder(guest), /NETWORK_GUEST_DESTROYED/);
  assert.deepEqual(guest.debugger.attachCalls, []);
  assert.equal(guest.debugger.detachCalls, 0);
});

for (const order of ['before-failure', 'after-failure']) test(`failed request captures ExtraInfo ${order} without a responseReceived flag`, async t => {
  const { debug, recorder } = await fixture(t);
  request(debug);
  const extras = () => {
    debug.message('Network.requestWillBeSentExtraInfo', { requestId: 'r', headers: { 'X-Request': 'failed' } });
    debug.message('Network.responseReceivedExtraInfo', { requestId: 'r', statusCode: 403, headers: { 'X-Response': 'denied' } });
  };
  if (order === 'before-failure') extras();
  debug.message('Network.loadingFailed', { requestId: 'r', errorText: 'net::ERR_FAILED', blockedReason: 'origin' });
  if (order === 'after-failure') extras();
  const value = recorder.read({ requestId: 'r' });
  assert.equal(value.state, 'failed');
  assert.equal(value.requestExtra.headers['X-Request'], 'failed');
  assert.equal(value.responseExtra.statusCode, 403);
  assert.equal(value.responseExtra.headers['X-Response'], 'denied');
  assert.equal(recorder.body({ requestId: 'r', kind: 'response' }).reason, 'REQUEST_FAILED');
  assert.deepEqual(bodyCommands(debug), []);
});

test('failure does not bypass an earlier unknown redirect ExtraInfo slot', async t => {
  const { debug, recorder } = await fixture(t);
  request(debug);
  request(debug, 'r', {}, { redirectResponse: { status: 302 } });
  debug.message('Network.loadingFailed', { requestId: 'r', errorText: 'net::ERR_FAILED' });
  debug.message('Network.requestWillBeSentExtraInfo', { requestId: 'r', headers: { 'X-Hop': 'unknown' } });
  assert.equal(recorder.read({ requestId: 'r' }).requestExtra, undefined);
  assert.equal(recorder.read({ requestId: 'r' }).extraInfo.request, 'unresolved');
});

test('external detach marks pending body and ExtraInfo retrieval unavailable in retained records', async t => {
  const { debug, recorder } = await fixture(t);
  request(debug, 'r', { hasPostData: true });
  debug.message('Network.responseReceived', { requestId: 'r', hasExtraInfo: true, response: { status: 200 } });
  debug.externalDetach('replaced'); await recorder.settled();
  for (const kind of ['request', 'response']) assert.equal(recorder.body({ requestId: 'r', kind }).reason, 'NETWORK_DEBUGGER_DETACHED');
  assert.deepEqual(recorder.read({ requestId: 'r' }).extraInfo, { request: 'capture-detached', response: 'capture-detached' });
  assert.equal(recorder.status().state, 'detached:replaced');
  assert.equal(debug.detachCalls, 0);
});

// Child-target capture (opt-in). The fake debugger records the sessionId of every
// command and lets tests emit flat Target.* / child Network events.
function attach(debug, sessionId, type = 'worker', targetId = `target-${sessionId}`, extra = {}) {
  debug.message('Target.attachedToTarget', { sessionId, targetInfo: { targetId, type }, waitingForDebugger: true, ...extra });
}
function detach(debug, sessionId) { debug.message('Target.detachedFromTarget', { sessionId, targetId: `target-${sessionId}` }); }
const sessionCommands = (debug, sessionId) => debug.commands.filter(value => value.sessionId === sessionId);
const childRequest = (debug, sessionId, requestId = 'r', extra = {}, params = {}) => debug.message('Network.requestWillBeSent', {
  requestId, timestamp: 1, wallTime: 100, type: 'Fetch', frameId: 'f', loaderId: 'l',
  request: { url: 'https://example.test/child', method: 'GET', headers: {}, ...extra }, ...params,
}, sessionId);

test('childTargets defaults to false: child events stay ignored and no Target command is sent', async t => {
  const { debug, recorder } = await fixture(t);
  attach(debug, 'child-session');
  childRequest(debug, 'child-session');
  debug.message('Network.loadingFinished', { requestId: 'r', timestamp: 3 }, 'child-session');
  await recorder.settled();
  assert.equal(recorder.status().childTargets, false);
  assert.equal(recorder.status().scope, 'owned-root-target');
  assert.equal(recorder.status().children, 0);
  assert.deepEqual(recorder.list().items, []);
  assert.deepEqual(debug.commands.map(({ method }) => method), ['Network.enable']);
  assert.equal(recorder.status().childAttachError, undefined);
});

test('childTargets enables flat auto-attach and captures a worker request with target identity', async t => {
  const { debug, recorder } = await fixture(t, { childTargets: true });
  assert.deepEqual(debug.commands[0], { method: 'Network.enable', params: { maxTotalBufferSize: 8 * 1024 * 1024, maxResourceBufferSize: 1024 * 1024, maxPostDataSize: 1024 * 1024 } });
  assert.deepEqual(debug.commands[1], { method: 'Target.setAutoAttach', params: { autoAttach: true, waitForDebuggerOnStart: true, flatten: true } });
  const status = recorder.status();
  assert.equal(status.scope, 'owned-tree');
  assert.equal(status.childTargets, true);
  assert.equal(status.children, 0);
  assert.equal(status.childAttachError, undefined);
  attach(debug, 'worker-session', 'worker', 'worker-target');
  await recorder.settled();
  assert.deepEqual(sessionCommands(debug, 'worker-session').map(({ method }) => method), ['Network.enable', 'Runtime.runIfWaitingForDebugger']);
  assert.equal(recorder.status().children, 1);
  childRequest(debug, 'worker-session');
  debug.message('Network.loadingFinished', { requestId: 'r', timestamp: 3 }, 'worker-session');
  const page = recorder.list();
  assert.equal(page.items.length, 1);
  assert.equal(page.items[0].targetType, 'worker');
  assert.equal(page.items[0].sessionId, 'worker-session');
  assert.equal(page.items[0].targetId, 'worker-target');
  const value = recorder.read({ requestId: 'r' });
  assert.equal(value.targetType, 'worker');
  assert.equal(value.sessionId, 'worker-session');
  assert.equal(value.targetId, 'worker-target');
  assert.equal(recorder.status().requests, 1);
});

test('child read and body use the child session and keep root semantics intact', async t => {
  const { debug, recorder } = await fixture(t, { childTargets: true });
  debug.handlers.set('Network.getResponseBody', (params, sessionId) => ({ body: `body:${sessionId}:${params.requestId}`, base64Encoded: false }));
  debug.handlers.set('Network.getRequestPostData', (params, sessionId) => ({ postData: `post:${sessionId}` }));
  attach(debug, 'iframe-session', 'iframe', 'iframe-target');
  request(debug, 'shared-root', { hasPostData: true });
  childRequest(debug, 'iframe-session', 'child-post', { method: 'POST', hasPostData: true });
  debug.message('Network.loadingFinished', { requestId: 'child-post', timestamp: 3 }, 'iframe-session');
  await recorder.settled();
  assert.deepEqual(sessionCommands(debug, 'iframe-session').filter(({ method }) => method !== 'Network.enable' && method !== 'Runtime.runIfWaitingForDebugger'), [
    { method: 'Network.getRequestPostData', params: { requestId: 'child-post' }, sessionId: 'iframe-session' },
    { method: 'Network.getResponseBody', params: { requestId: 'child-post' }, sessionId: 'iframe-session' },
  ]);
  assert.equal(recorder.body({ requestId: 'child-post', kind: 'request', sessionId: 'iframe-session' }).body, 'post:iframe-session');
  assert.equal(recorder.body({ requestId: 'child-post', kind: 'response', sessionId: 'iframe-session' }).body, 'body:iframe-session:child-post');
  assert.equal(recorder.body({ requestId: 'shared-root', kind: 'request' }).body, 'post:undefined');
  // Root records stay byte-compatible: targetType page, no sessionId/targetId.
  const rootValue = recorder.read({ requestId: 'shared-root' });
  assert.equal(rootValue.targetType, 'page');
  assert.equal(Object.hasOwn(rootValue, 'sessionId'), false);
  assert.equal(Object.hasOwn(rootValue, 'targetId'), false);
  const rootItem = recorder.list().items.find(item => item.requestId === 'shared-root');
  assert.equal(rootItem.targetType, 'page');
  assert.equal(Object.hasOwn(rootItem, 'sessionId'), false);
  // Child lookup by targetId works too.
  assert.equal(recorder.read({ requestId: 'child-post', targetId: 'iframe-target' }).sessionId, 'iframe-session');
});

test('list merges root and children in global sequence order with a global request limit', async t => {
  const { debug, recorder } = await fixture(t, { childTargets: true, maxRequests: 3 });
  attach(debug, 'one');
  attach(debug, 'two');
  await recorder.settled();
  request(debug, 'root-1');
  childRequest(debug, 'one', 'child-1');
  request(debug, 'root-2');
  childRequest(debug, 'two', 'child-2');
  const items = recorder.list().items;
  // maxRequests is global: the fourth insert evicts the globally oldest ID
  // (root-1), whichever context owned it.
  assert.deepEqual(items.map(({ requestId, targetType }) => [requestId, targetType]), [
    ['child-1', 'worker'], ['root-2', 'page'], ['child-2', 'worker'],
  ]);
  assert.deepEqual(items.map(({ sequence }) => sequence), [2, 3, 4]);
  assert.equal(recorder.status().requests, 3);
  assert.throws(() => recorder.read({ requestId: 'root-1' }), /NETWORK_REQUEST_NOT_FOUND/);
});

test('bounded child map evicts the oldest session and notes it in status', async t => {
  const { debug, recorder } = await fixture(t, { childTargets: true });
  for (let index = 0; index < 22; index++) attach(debug, `session-${index}`);
  await recorder.settled();
  const status = recorder.status();
  assert.equal(status.children, 20);
  assert.equal(status.childEvicted, 2);
  assert.equal(recorder.list().items.length, 0);
  // Evicted sessions no longer capture; retained ones still do.
  childRequest(debug, 'session-0', 'gone');
  childRequest(debug, 'session-21', 'kept');
  assert.deepEqual(recorder.list().items.map(({ requestId }) => requestId), ['kept']);
  assert.equal(recorder.list().items[0].sessionId, 'session-21');
});

test('detached and cleared children drop their state while root capture continues', async t => {
  const { debug, recorder } = await fixture(t, { childTargets: true });
  debug.handlers.set('Network.getResponseBody', () => ({ body: 'child-body', base64Encoded: false }));
  attach(debug, 'gone');
  childRequest(debug, 'gone', 'child');
  debug.message('Network.loadingFinished', { requestId: 'child', timestamp: 3 }, 'gone');
  await recorder.settled();
  assert.equal(recorder.status().bodyBytes, 10);
  request(debug, 'root');
  detach(debug, 'gone');
  assert.equal(recorder.status().children, 0);
  assert.equal(recorder.status().bodyBytes, 0);
  assert.throws(() => recorder.read({ requestId: 'child', sessionId: 'gone' }), /NETWORK_REQUEST_NOT_FOUND/);
  assert.deepEqual(recorder.list().items.map(({ requestId }) => requestId), ['root']);
  // A detached session's late events are ignored.
  childRequest(debug, 'gone', 'late');
  assert.deepEqual(recorder.list().items.map(({ requestId }) => requestId), ['root']);
  // clear() keeps capturing and drops children too.
  attach(debug, 'again');
  childRequest(debug, 'again', 'child-2');
  recorder.clear();
  assert.equal(recorder.status().children, 0);
  assert.equal(recorder.status().requests, 0);
  assert.deepEqual(recorder.list().items, []);
  request(debug, 'root-after-clear');
  assert.deepEqual(recorder.list().items.map(({ requestId }) => requestId), ['root-after-clear']);
  assert.equal(recorder.status().state, 'capturing');
});

test('dispose cancels pending child commands and drops every child session', async t => {
  const { guest, debug, recorder } = await fixture(t, { childTargets: true });
  const pending = deferred();
  debug.handlers.set('Network.getResponseBody', () => pending.promise);
  attach(debug, 'slow');
  childRequest(debug, 'slow');
  debug.message('Network.loadingFinished', { requestId: 'r', timestamp: 3 }, 'slow');
  await Promise.resolve();
  assert.equal(sessionCommands(debug, 'slow').some(({ method }) => method === 'Network.getResponseBody'), true);
  recorder.dispose();
  pending.resolve({ body: 'late', base64Encoded: false });
  await recorder.settled();
  assert.equal(recorder.status().children, 0);
  assert.equal(recorder.status().bodyBytes, 0);
  assert.deepEqual(recorder.list().items, []);
  assert.equal(guest.listenerCount('destroyed'), 0);
  assert.equal(debug.listenerCount('message'), 0);
});

test('a throwing Target.setAutoAttach is reported and never fails root capture', async t => {
  const { debug, recorder } = await fixture(t, { childTargets: true });
  // fixture already started; rebuild with a handler that throws for auto-attach.
  recorder.dispose();
  const guest = new EventEmitter(); guest.debugger = new FakeDebugger();
  guest.debugger.handlers.set('Target.setAutoAttach', () => { throw new Error('auto-attach unsupported'); });
  const limited = await createNetworkRecorder(guest, { childTargets: true });
  t.after(() => limited.dispose());
  const status = limited.status();
  assert.equal(status.state, 'capturing');
  assert.equal(status.scope, 'owned-tree');
  assert.equal(status.childTargets, true);
  assert.equal(status.children, 0);
  assert.equal(status.childAttachError, 'auto-attach unsupported');
  request(guest.debugger, 'root');
  assert.deepEqual(limited.list().items.map(({ requestId }) => requestId), ['root']);
  assert.equal(limited.read({ requestId: 'root' }).targetType, 'page');
});

test('a child whose Network.enable fails still gets resumed and is dropped from the map', async t => {
  const guest = new EventEmitter(); guest.debugger = new FakeDebugger();
  guest.debugger.handlers.set('Network.enable', (params, sessionId) => {
    if (sessionId) throw new Error('child enable rejected');
    return {};
  });
  const recorder = await createNetworkRecorder(guest, { childTargets: true });
  t.after(() => recorder.dispose());
  attach(guest.debugger, 'bad');
  await recorder.settled();
  const commands = sessionCommands(guest.debugger, 'bad').map(({ method }) => method);
  assert.deepEqual(commands, ['Network.enable', 'Runtime.runIfWaitingForDebugger']);
  assert.equal(recorder.status().children, 0);
  childRequest(guest.debugger, 'bad', 'ignored');
  assert.deepEqual(recorder.list().items, []);
  // Root capture is unaffected.
  request(guest.debugger, 'root');
  assert.deepEqual(recorder.list().items.map(({ requestId }) => requestId), ['root']);
});

test('a hanging Target.setAutoAttach keeps root capture and reports a timeout note', { timeout: 1000 }, async t => {
  const guest = new EventEmitter(); guest.debugger = new FakeDebugger();
  guest.debugger.handlers.set('Target.setAutoAttach', () => new Promise(() => {}));
  const recorder = await createNetworkRecorder(guest, { childTargets: true, commandTimeoutMs: 10 });
  t.after(() => recorder.dispose());
  assert.equal(recorder.status().childAttachError, 'NETWORK_COMMAND_TIMEOUT');
  request(guest.debugger, 'root');
  assert.equal(recorder.list().items.length, 1);
});

test('destroying during a hanging setAutoAttach still cancels setup', { timeout: 1000 }, async () => {
  const guest = new EventEmitter(); guest.debugger = new FakeDebugger();
  guest.debugger.handlers.set('Target.setAutoAttach', () => new Promise(() => {}));
  const starting = createNetworkRecorder(guest, { childTargets: true });
  const rejected = assert.rejects(starting, /NETWORK_COMMAND_CANCELLED/);
  await Promise.resolve(); await Promise.resolve();
  guest.emit('destroyed');
  await rejected;
  assert.equal(guest.debugger.detachCalls, 1);
  assert.equal(guest.debugger.listenerCount('message'), 0);
});

test('same requestId in two child sessions is ambiguous unless a session is selected', async t => {
  const { debug, recorder } = await fixture(t, { childTargets: true });
  attach(debug, 'a');
  attach(debug, 'b');
  await recorder.settled();
  childRequest(debug, 'a', 'dup', { url: 'https://example.test/a' });
  childRequest(debug, 'b', 'dup', { url: 'https://example.test/b' });
  assert.throws(() => recorder.read({ requestId: 'dup' }), /NETWORK_REQUEST_NOT_FOUND/);
  assert.throws(() => recorder.body({ requestId: 'dup', kind: 'response' }), /NETWORK_REQUEST_NOT_FOUND/);
  assert.equal(recorder.read({ requestId: 'dup', sessionId: 'a' }).url, 'https://example.test/a');
  assert.equal(recorder.read({ requestId: 'dup', sessionId: 'b' }).url, 'https://example.test/b');
  assert.equal(recorder.read({ requestId: 'dup', targetId: 'target-a' }).url, 'https://example.test/a');
  // Root always wins when it has the ID; children are only searched otherwise.
  request(debug, 'dup', { url: 'https://example.test/root' });
  assert.equal(recorder.read({ requestId: 'dup' }).url, 'https://example.test/root');
  assert.equal(recorder.read({ requestId: 'dup', sessionId: 'a' }).url, 'https://example.test/a');
  for (const query of [{ requestId: 'dup', sessionId: 5 }, { requestId: 'dup', sessionId: 'x'.repeat(201) }, { requestId: 'dup', targetId: 7 }]) {
    assert.throws(() => recorder.read(query), /INVALID_NETWORK_QUERY/);
  }
  assert.throws(() => recorder.read({ requestId: 'dup', sessionId: 'missing' }), /NETWORK_REQUEST_NOT_FOUND/);
});

test('child extra headers correlate per session and are reported in the aggregate status', async t => {
  const { debug, recorder } = await fixture(t, { childTargets: true });
  attach(debug, 'frames');
  childRequest(debug, 'frames');
  debug.message('Network.requestWillBeSentExtraInfo', { requestId: 'r', headers: { 'X-Child': 'yes' } }, 'frames');
  debug.message('Network.responseReceived', { requestId: 'r', timestamp: 2, hasExtraInfo: true, response: { status: 201, headers: { 'X-Res': 'yes' } } }, 'frames');
  debug.message('Network.responseReceivedExtraInfo', { requestId: 'r', statusCode: 201, headers: { 'X-Res-Extra': 'yes' } }, 'frames');
  const value = recorder.read({ requestId: 'r', sessionId: 'frames' });
  assert.equal(value.requestExtra.headers['X-Child'], 'yes');
  assert.equal(value.responseExtra.headers['X-Res-Extra'], 'yes');
  assert.equal(value.status, 201);
  for (let index = 0; index < 45; index++) debug.message('Network.requestWillBeSentExtraInfo', { requestId: 'overflow', headers: {} }, 'frames');
  assert.ok(recorder.status().extraInfoDropped > 0);
  assert.equal(recorder.status().childTargets, true);
  assert.equal(recorder.status().children, 1);
});

test('a root detach drops child sessions and cancels their pending body commands', { timeout: 1000 }, async t => {
  const { debug, recorder } = await fixture(t, { childTargets: true }); // 10s deadline: detach must cancel.
  debug.handlers.set('Network.getRequestPostData', () => new Promise(() => {}));
  attach(debug, 'child');
  childRequest(debug, 'child', 'pending', { hasPostData: true });
  request(debug, 'root');
  await Promise.resolve(); await Promise.resolve();
  assert.equal(sessionCommands(debug, 'child').some(({ method }) => method === 'Network.getRequestPostData'), true);
  debug.externalDetach('replaced');
  await recorder.settled();
  assert.equal(recorder.status().state, 'detached:replaced');
  assert.equal(recorder.status().children, 0);
  assert.equal(recorder.body({ requestId: 'root', kind: 'response' }).reason, 'NETWORK_DEBUGGER_DETACHED');
  assert.equal(recorder.read({ requestId: 'root' }).targetType, 'page');
});

test('websocketFrames stays opt-in, bounded, and out of list/read', async t => {
  const { debug, recorder } = await fixture(t, { childTargets: true, websocketFrames: true });
  attach(debug, 'ws-session');
  childRequest(debug, 'ws-session', 'ws');
  // Ring: at most 50 frames, oldest dropped, payload bounded to 2048 chars.
  for (let index = 0; index < 60; index++) {
    debug.message('Network.webSocketFrameSent', { requestId: 'ws', timestamp: index, response: { opcode: 1, payloadData: `sent-${index}` } }, 'ws-session');
  }
  debug.message('Network.webSocketFrameReceived', { requestId: 'ws', timestamp: 99, response: { opcode: 1, payloadData: 'received' } }, 'ws-session');
  const result = recorder.frames({ requestId: 'ws', sessionId: 'ws-session' });
  assert.equal(result.truncated, true);
  assert.equal(result.untrusted, true);
  assert.equal(result.frames.length, 50);
  assert.equal(result.frames[0].payload, 'sent-11');
  assert.equal(result.frames.at(-1).direction, 'received');
  assert.equal(result.frames.at(-1).payload, 'received');
  assert.ok(Buffer.byteLength(JSON.stringify(result), 'utf8') < 59000);
  // Oversized payloads are clipped per frame and the response stays under budget.
  childRequest(debug, 'ws-session', 'big-ws');
  for (let index = 0; index < 50; index++) {
    debug.message('Network.webSocketFrameSent', { requestId: 'big-ws', timestamp: index, response: { opcode: 1, payloadData: 'y'.repeat(3000) } }, 'ws-session');
  }
  const big = recorder.frames({ requestId: 'big-ws', sessionId: 'ws-session' });
  assert.equal(big.truncated, true);
  assert.equal(big.frames[0].payload.length, 2048);
  assert.equal(big.frames[0].payloadTruncated, true);
  assert.ok(Buffer.byteLength(JSON.stringify(big), 'utf8') < 59000);
  // Frames never enter list/read payloads.
  assert.equal(JSON.stringify(recorder.list()).includes('sent-'), false);
  assert.equal(JSON.stringify(recorder.read({ requestId: 'ws', sessionId: 'ws-session' })).includes('sent-'), false);
  assert.throws(() => recorder.frames({ requestId: 'missing' }), /NETWORK_REQUEST_NOT_FOUND/);
  assert.deepEqual(recorder.frames({ requestId: 'ws', sessionId: 'ws-session', hop: 0 }).frames.length, 50);
  // Root frames work too.
  request(debug, 'root-ws');
  debug.message('Network.webSocketFrameReceived', { requestId: 'root-ws', timestamp: 1, response: { opcode: 1, payloadData: 'root' } });
  assert.deepEqual(recorder.frames({ requestId: 'root-ws' }).frames.map(({ payload }) => payload), ['root']);
});

test('websocket frames are ignored unless explicitly enabled', async t => {
  const { debug, recorder } = await fixture(t);
  request(debug, 'ws');
  debug.message('Network.webSocketFrameSent', { requestId: 'ws', timestamp: 1, response: { opcode: 1, payloadData: 'x' } });
  assert.deepEqual(recorder.frames({ requestId: 'ws' }), { frames: [], truncated: false, untrusted: true });
});

test('clear resumes a still-waiting child instead of leaving it paused', async t => {
  const guest = new EventEmitter(); guest.debugger = new FakeDebugger();
  // Child Network.enable never resolves, so the child stays waitingForDebugger.
  guest.debugger.handlers.set('Network.enable', (params, sessionId) => sessionId ? new Promise(() => {}) : {});
  const recorder = await createNetworkRecorder(guest, { childTargets: true });
  t.after(() => recorder.dispose());
  attach(guest.debugger, 'waiting');
  await Promise.resolve(); await Promise.resolve();
  assert.equal(recorder.status().children, 1);
  assert.equal(sessionCommands(guest.debugger, 'waiting').some(({ method }) => method === 'Runtime.runIfWaitingForDebugger'), false);
  recorder.clear();
  assert.equal(sessionCommands(guest.debugger, 'waiting').filter(({ method }) => method === 'Runtime.runIfWaitingForDebugger').length, 1);
  assert.equal(recorder.status().children, 0);
  assert.equal(recorder.status().state, 'capturing');
});

test('websocket handshake creates a record so frames are not dropped', async t => {
  const guest = new EventEmitter(); guest.debugger = new FakeDebugger();
  const recorder = await createNetworkRecorder(guest, { websocketFrames: true });
  t.after(() => recorder.dispose());
  const debug = guest.debugger;
  debug.message('Network.webSocketCreated', { requestId: 'ws1', url: 'ws://x.test/socket' });
  debug.message('Network.webSocketWillSendHandshakeRequest', { requestId: 'ws1', request: { headers: { Upgrade: 'websocket' } } });
  debug.message('Network.webSocketHandshakeResponseReceived', { requestId: 'ws1', response: { status: 101, statusText: 'Switching Protocols', headers: { Upgrade: 'websocket' } } });
  debug.message('Network.webSocketFrameSent', { requestId: 'ws1', timestamp: 1, response: { opcode: 1, payloadData: 'hello' } });
  debug.message('Network.webSocketFrameReceived', { requestId: 'ws1', timestamp: 2, response: { opcode: 1, payloadData: 'world' } });
  const listed = recorder.list({ limit: 10 });
  const ws = listed.items.find(item => item.url === 'ws://x.test/socket');
  assert(ws, 'websocket appears in list');
  assert.equal(ws.type, 'WebSocket');
  const read = recorder.read({ requestId: 'ws1' });
  assert.equal(read.status, 101);
  const { frames } = recorder.frames({ requestId: 'ws1' });
  assert.deepEqual(frames.map(f => [f.direction, f.payload]), [['sent', 'hello'], ['received', 'world']]);
  debug.message('Network.webSocketClosed', { requestId: 'ws1', timestamp: 3 });
  assert.equal(recorder.read({ requestId: 'ws1' }).state, 'closed');
});
