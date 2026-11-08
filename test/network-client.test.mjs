import test from 'node:test';
import assert from 'node:assert/strict';
import { GuestNetwork } from '../src/network-client.js';
import { PageRunner } from '../src/runner.js';
import { SessionTabs } from '../src/session-tabs.js';
const signal = () => new AbortController().signal;
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const success = value => ({ ok: true, value });
const command = (operation, args, timeout = 1000) => ({ id: crypto.randomUUID(), operation, args, expires: Date.now() + timeout });

test('unpatched desktop reports unavailable and never substitutes page JavaScript or external traffic', async () => {
  const client = new GuestNetwork(undefined, 'owned-lease');
  assert.equal((await client.request({ action: 'status' }, signal())).available, false);
  await assert.rejects(client.request({ action: 'start' }, signal()), /NETWORK_BRIDGE_UNAVAILABLE/);
  const missingHandler = new GuestNetwork({ protocolVersion: 1, request: async () => ({ ok: false, error: { code: 'BRIDGE_UNAVAILABLE' } }) }, 'owned');
  await assert.rejects(missingHandler.request({ action: 'start' }, signal()), /NETWORK_BRIDGE_UNAVAILABLE/);
});

test('network payloads use the page lease and exact capture; foreign authority and incomplete selectors fail before IPC', async () => {
  const calls = [], client = new GuestNetwork({ protocolVersion: 1, async request(payload) {
    calls.push(payload); return success(payload.operation === 'start' ? { captureId: 'capture-one' } : { items: [], body: 'completed' });
  } }, 'owned-lease');
  const capture = await client.request({ action: 'start', tabId: 'tab', maxBodyBytes: 2048 }, signal());
  assert.equal(capture.captureId, 'capture-one'); assert.equal(client.status().capturing, true);
  assert.deepEqual(calls[0], { operation: 'start', lease: 'owned-lease', options: { maxBodyBytes: 2048 } });
  const body = await client.request({ action: 'body', captureId: capture.captureId, requestId: 'request-one', kind: 'response', offset: 12, limit: 100 }, signal());
  assert.equal(body.untrusted, true);
  assert.deepEqual(calls[1], { operation: 'body', lease: 'owned-lease', captureId: 'capture-one', query: { requestId: 'request-one', kind: 'response', offset: 12, limit: 100 } });
  assert.throws(() => client.request({ action: 'start', lease: 'foreign' }, signal()), /INVALID_NETWORK_OPTIONS/);
  assert.throws(() => client.request({ action: 'body', captureId: 'capture-one', kind: 'response' }, signal()), /NETWORK_REQUEST_REQUIRED/);
  assert.throws(() => client.request({ action: 'list' }, signal()), /NETWORK_CAPTURE_REQUIRED/);
  assert.equal(calls.length, 2);
});

test('late canceled start is stopped before another start and cannot detach its successor', async () => {
  const first = deferred(), entered = deferred(), calls = [];
  let starts = 0;
  const client = new GuestNetwork({ protocolVersion: 1, async request(payload) {
    calls.push(payload);
    if (payload.operation === 'start' && ++starts === 1) { entered.resolve(); return first.promise; }
    return success(payload.operation === 'start' ? { captureId: 'new-capture' } : { stopped: true });
  } }, 'lease');
  const controller = new AbortController();
  const pending = client.request({ action: 'start' }, controller.signal);
  const rejected = assert.rejects(pending, /cancelled-start/);
  await entered.promise; controller.abort(Error('cancelled-start')); await rejected;
  const next = client.request({ action: 'start' }, signal());
  first.resolve(success({ captureId: 'old-capture' }));
  assert.equal((await next).captureId, 'new-capture');
  assert.deepEqual(calls.map(value => [value.operation, value.captureId]), [['start', undefined], ['stop', 'old-capture'], ['start', undefined]]);
  assert.equal(client.captureId, 'new-capture');
});

test('stop invalidates queued reads and releases only its own active capture', async () => {
  const entered = deferred(), reply = deferred(), calls = [];
  const client = new GuestNetwork({ protocolVersion: 1, async request(payload) {
    calls.push(payload);
    if (payload.operation === 'start') return success({ captureId: 'own-capture' });
    if (payload.operation === 'read') { entered.resolve(); return reply.promise; }
    return success({ stopped: true });
  } }, 'own-lease');
  await client.request({ action: 'start' }, signal());
  const active = client.request({ action: 'read', captureId: 'own-capture', requestId: 'r1' }, signal());
  const activeRejected = assert.rejects(active, /CANCELLED/);
  await entered.promise;
  const queued = client.request({ action: 'list', captureId: 'own-capture' }, signal());
  const queuedRejected = assert.rejects(queued, /CANCELLED/);
  const stopped = client.stopCapture(); reply.resolve(success({ state: 'finished' }));
  await Promise.all([activeRejected, queuedRejected, stopped]);
  assert.deepEqual(calls.map(value => value.operation), ['start', 'read', 'stop']);
  assert.equal(calls.at(-1).captureId, 'own-capture'); assert.equal(client.captureId, null);
});

test('dispose fences a pending capture and native errors never expose host paths', async () => {
  const entered = deferred(), reply = deferred(), calls = [];
  const client = new GuestNetwork({ protocolVersion: 1, async request(payload) {
    calls.push(payload);
    if (payload.operation === 'start') { entered.resolve(); return reply.promise; }
    return success({ stopped: true });
  } }, 'lease');
  const pending = client.request({ action: 'start' }, signal());
  const rejected = assert.rejects(pending, /PANEL_CLOSED/);
  await entered.promise; client.dispose(); reply.resolve(success({ captureId: 'late' })); await rejected;
  assert.equal(calls.at(-1).operation, 'stop'); assert.equal(calls.at(-1).captureId, 'late');
  const bad = new GuestNetwork({ protocolVersion: 1, request: async () => ({ ok: false, error: { code: 'NETWORK_LEASE_UNAVAILABLE', message: '/private/host/path' } }) }, 'lease');
  await assert.rejects(bad.request({ action: 'start' }, signal()), error => error.code === 'NETWORK_LEASE_UNAVAILABLE' && !error.message.includes('/private/host/path'));
});

test('network reads survive main-frame navigation, work after load failure and never stop guest input on timeout', async () => {
  let stopped = 0, finish;
  const activity = [], adapter = { status: () => ({ initialized: true, ready: false }), readNetwork: () => new Promise(resolve => { finish = resolve; }), stop() { stopped++; } };
  const runner = new PageRunner(adapter, value => activity.push(value));
  const pending = runner.run(command('network', { action: 'read' }));
  runner.invalidate(); finish({ state: 'finished', responseHeaders: { 'content-type': 'application/json' } });
  assert.equal((await pending).state, 'finished');
  await assert.rejects(runner.run(command('network', { action: 'list' }, 5)), /TIMEOUT/);
  assert.equal(stopped, 0); assert.deepEqual(activity, []); runner.dispose();
});

test('active-tab fencing protects network results and explicit control stop reaches every owned capture', async () => {
  const pages = [], lifetime = new AbortController();
  const manager = new SessionTabs({ signal: lifetime.signal, workspace: 'test', createContainer: () => ({ style: {}, setAttribute() {}, remove() {} }), createPage() {
    const page = { stops: 0, calls: 0, async mount() {}, status: () => ({ initialized: true, ready: true }), async readNetwork() { this.calls++; return { items: [] }; }, stopNetworkCapture() { this.stops++; }, stop() {}, async dispose() {} };
    pages.push(page); return page;
  } });
  const first = await manager.newTab(), second = await manager.newTab();
  await assert.rejects(manager.run(command('network', { action: 'status', tabId: first.tabId })), /STALE_TAB/);
  assert.equal(pages[0].calls + pages[1].calls, 0);
  const value = await manager.run(command('network', { action: 'status', tabId: second.tabId }));
  assert.equal(value.tabId, second.tabId); assert.equal(pages[1].calls, 1);
  await manager.stopNetworkCaptures(); assert.deepEqual(pages.map(page => page.stops), [1, 1]); await manager.dispose();
});
