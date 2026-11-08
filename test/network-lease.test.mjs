import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { createLeaseNetworkService } from '../native/lease-network-service.js';
import { createNetworkRecorder } from '../native/network-recorder.js';

// Service protocol tests with controlled WebContents/recorders, no installed app.
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const guest = () => {
  const page = new EventEmitter();
  page.destroyed = false;
  page.isDestroyed = () => page.destroyed;
  page.destroy = () => { page.destroyed = true; page.emit('destroyed'); };
  return page;
};
function fakeRecorder(name = 'r') {
  return {
    clears: 0, disposals: 0, bodyQueries: [],
    bodyValue: { state: 'available', body: `${name}-body`, base64Encoded: false, bytes: 6, untrusted: true },
    status() { return { state: 'capturing', name, clears: this.clears }; },
    list(query) { return { name, query }; },
    read(query) { return { name, query }; },
    body(query) { this.bodyQueries.push(query); return this.bodyValue; },
    clear() { this.clears++; return this.status(); },
    dispose() { this.disposals++; },
  };
}
function fixture(t, factory) {
  const owner = {}, otherOwner = {}, event = { sender: owner }, otherEvent = { sender: otherOwner };
  const page = guest(), otherPage = guest();
  const leases = new Map([['a', { owner, guest: page }], ['b', { owner: otherOwner, guest: otherPage }]]);
  const calls = [];
  const service = createLeaseNetworkService({
    leases,
    assertProductSender(event) {
      if (!event || (event.sender !== owner && event.sender !== otherOwner)) throw Error('UNTRUSTED_SENDER');
    },
    recorder(page, options) {
      calls.push({ page, options });
      return factory ? factory(page, options, calls.length) : fakeRecorder(String(calls.length));
    },
  });
  t.after(() => service.dispose());
  return { service, owner, otherOwner, event, otherEvent, page, otherPage, leases, calls };
}
const flushFactory = () => Promise.resolve();
const flushCleanup = () => new Promise(resolve => setImmediate(resolve));

test('rejected initialization is removed so the next start retries', async t => {
  const gate = deferred(), instance = fakeRecorder();
  const f = fixture(t, (_page, _options, call) => call === 1 ? gate.promise : instance);
  const first = f.service.start(f.event, 'a');
  const rejected = assert.rejects(first, /enable failed/);
  await flushFactory(); gate.reject(Error('enable failed')); await rejected;
  const result = await f.service.start(f.event, 'a');
  assert.equal(f.calls.length, 2);
  assert.equal(typeof result.captureId, 'string');
  assert.equal(instance.disposals, 0);
});

test('synchronous factory errors are also retryable', async t => {
  const f = fixture(t, (_page, _options, call) => { if (call === 1) throw Error('sync failed'); return fakeRecorder(); });
  await assert.rejects(f.service.start(f.event, 'a'), /sync failed/);
  await f.service.start(f.event, 'a');
  assert.equal(f.calls.length, 2);
});

test('concurrent starts for the same verified guest share one recorder and capture', async t => {
  const gate = deferred(), instance = fakeRecorder();
  const f = fixture(t, () => gate.promise);
  const first = f.service.start(f.event, 'a', { maxRequests: 7 });
  const second = f.service.start(f.event, 'a', { maxRequests: 9 });
  await flushFactory(); assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].page, f.page);
  assert.equal(f.calls[0].options.maxRequests, 7);
  assert.equal(f.calls[0].options.signal instanceof AbortSignal, true);
  assert.equal(f.calls[0].options.signal.aborted, false);
  gate.resolve(instance);
  const [a, b] = await Promise.all([first, second]);
  assert.equal(a.captureId, b.captureId);
  assert.equal((await f.service.start(f.event, 'a')).captureId, a.captureId);
  assert.equal(f.calls.length, 1);
  assert.equal(instance.disposals, 0);
});

test('a pending start for a replaced guest is canceled and cannot overwrite its successor', async t => {
  const oldGate = deferred(), newGate = deferred(), oldRecorder = fakeRecorder('old'), newRecorder = fakeRecorder('new');
  const f = fixture(t, (_page, _options, call) => call === 1 ? oldGate.promise : newGate.promise);
  const oldStart = f.service.start(f.event, 'a');
  const canceled = assert.rejects(oldStart, /NETWORK_START_CANCELED/);
  await flushFactory();
  f.leases.set('a', { owner: f.owner, guest: f.otherPage });
  const newStart = f.service.start(f.event, 'a');
  await flushFactory(); assert.equal(f.calls.length, 2);
  newGate.resolve(newRecorder); const current = await newStart;
  oldGate.resolve(oldRecorder); await canceled; await flushCleanup();
  assert.equal(oldRecorder.disposals, 1);
  assert.equal(newRecorder.disposals, 0);
  assert.equal(f.service.read(f.event, 'a', current.captureId).name, 'new');
  assert.equal((await f.service.start(f.event, 'a')).captureId, current.captureId);
});

test('replacing an active guest disposes its recorder and replaces the capture ID', async t => {
  const instances = [], f = fixture(t, () => { const instance = fakeRecorder(); instances.push(instance); return instance; });
  const old = await f.service.start(f.event, 'a');
  f.leases.set('a', { owner: f.owner, guest: f.otherPage });
  const current = await f.service.start(f.event, 'a');
  assert.notEqual(current.captureId, old.captureId);
  assert.equal(instances[0].disposals, 1);
  assert.throws(() => f.service.read(f.event, 'a', old.captureId), /NETWORK_CAPTURE_UNAVAILABLE/);
});

test('owner reassignment cannot reuse a pending recorder even with the same guest', async t => {
  const gate = deferred(), stale = fakeRecorder('stale'), current = fakeRecorder('current');
  const f = fixture(t, (_page, _options, call) => call === 1 ? gate.promise : current);
  const first = f.service.start(f.event, 'a');
  const rejected = assert.rejects(first, /NETWORK_START_CANCELED/);
  await flushFactory();
  f.leases.set('a', { owner: f.otherOwner, guest: f.page });
  const result = await f.service.start(f.otherEvent, 'a');
  gate.resolve(stale); await rejected; await flushCleanup();
  assert.equal(stale.disposals, 1);
  assert.equal(f.service.read(f.otherEvent, 'a', result.captureId).name, 'current');
  assert.throws(() => f.service.read(f.event, 'a', result.captureId), /NETWORK_LEASE_UNAVAILABLE/);
});

for (const change of ['release', 'delete-lease', 'destroy-guest']) test(`${change} while starting disposes a late recorder exactly once`, async t => {
  const gate = deferred(), instance = fakeRecorder(), f = fixture(t, () => gate.promise);
  const first = f.service.start(f.event, 'a'), second = f.service.start(f.event, 'a');
  const rejected = [assert.rejects(first, /NETWORK_(START_CANCELED|LEASE_UNAVAILABLE)/), assert.rejects(second, /NETWORK_(START_CANCELED|LEASE_UNAVAILABLE)/)];
  await flushFactory();
  if (change === 'release') f.service.release('a');
  else if (change === 'delete-lease') f.leases.delete('a');
  else f.page.destroy();
  gate.resolve(instance); await Promise.all(rejected);
  assert.equal(instance.disposals, 1);
});

test('release before initialization dispatch cancels without creating a recorder', async t => {
  const f = fixture(t);
  const start = f.service.start(f.event, 'a');
  f.service.release('a');
  await assert.rejects(start, /NETWORK_START_CANCELED/);
  assert.equal(f.calls.length, 0);
});

test('old pending rejection cannot remove a new attempt for the same lease', async t => {
  const oldGate = deferred(), newGate = deferred(), f = fixture(t, (_page, _options, call) => call === 1 ? oldGate.promise : newGate.promise);
  const oldStart = f.service.start(f.event, 'a'), rejected = assert.rejects(oldStart, /NETWORK_START_CANCELED/);
  await flushFactory(); f.service.release('a');
  const newStart = f.service.start(f.event, 'a');
  await flushFactory(); oldGate.reject(Error('old failure')); await rejected;
  const concurrent = f.service.start(f.event, 'a');
  newGate.resolve(fakeRecorder());
  const [a, b] = await Promise.all([newStart, concurrent]);
  assert.equal(a.captureId, b.captureId);
  assert.equal(f.calls.length, 2);
});

test('every public operation rejects the wrong sender, lease, or capture ID', async t => {
  const f = fixture(t), a = await f.service.start(f.event, 'a'), b = await f.service.start(f.otherEvent, 'b');
  for (const operation of ['list', 'read', 'body', 'clear', 'stop']) {
    assert.throws(() => f.service[operation]({ sender: {} }, 'a', a.captureId), /UNTRUSTED_SENDER/, operation);
    assert.throws(() => f.service[operation](f.otherEvent, 'a', a.captureId), /NETWORK_LEASE_UNAVAILABLE/, operation);
    assert.throws(() => f.service[operation](f.event, 'missing', a.captureId), /NETWORK_LEASE_UNAVAILABLE/, operation);
    assert.throws(() => f.service[operation](f.event, 'a', b.captureId), /NETWORK_CAPTURE_UNAVAILABLE/, operation);
    assert.throws(() => f.service[operation](f.event, 'a', 'wrong'), /NETWORK_CAPTURE_UNAVAILABLE/, operation);
  }
  await assert.rejects(f.service.start({ sender: {} }, 'a'), /UNTRUSTED_SENDER/);
  await assert.rejects(f.service.start(f.otherEvent, 'a'), /NETWORK_LEASE_UNAVAILABLE/);
  await assert.rejects(f.service.start(f.event, 'missing'), /NETWORK_LEASE_UNAVAILABLE/);
  assert.equal(f.calls.length, 2);
});

test('clear and stop affect only the authorized lease', async t => {
  const instances = [], f = fixture(t, () => { const instance = fakeRecorder(String(instances.length)); instances.push(instance); return instance; });
  const a = await f.service.start(f.event, 'a'), b = await f.service.start(f.otherEvent, 'b');
  assert.equal(f.service.clear(f.event, 'a', a.captureId).clears, 1);
  assert.equal(instances[1].clears, 0);
  assert.deepEqual(f.service.stop(f.event, 'a', a.captureId), { stopped: true });
  assert.equal(instances[0].disposals, 1);
  assert.equal(instances[1].disposals, 0);
  assert.equal(f.service.list(f.otherEvent, 'b', b.captureId).name, '1');
  assert.throws(() => f.service.read(f.event, 'a', a.captureId), /NETWORK_CAPTURE_UNAVAILABLE/);
  const restarted = await f.service.start(f.event, 'a');
  assert.notEqual(restarted.captureId, a.captureId);
});

test('dispose cancels every pending lease, disposes active captures, and is idempotent', async t => {
  const gateA = deferred(), gateB = deferred(), active = fakeRecorder('active'), lateA = fakeRecorder('late-a'), lateB = fakeRecorder('late-b');
  const f = fixture(t, (_page, _options, call) => call === 1 ? active : call === 2 ? gateA.promise : gateB.promise);
  f.leases.set('c', { owner: f.owner, guest: guest() });
  const first = await f.service.start(f.event, 'c');
  const a = f.service.start(f.event, 'a'), b = f.service.start(f.otherEvent, 'b');
  const rejected = [assert.rejects(a, /NETWORK_START_CANCELED/), assert.rejects(b, /NETWORK_START_CANCELED/)];
  await flushFactory();
  f.service.dispose(); f.service.dispose();
  gateA.resolve(lateA); gateB.resolve(lateB);
  await Promise.all(rejected);
  assert.equal(active.disposals, 1);
  assert.equal(lateA.disposals, 1);
  assert.equal(lateB.disposals, 1);
  assert.throws(() => f.service.read(f.event, 'c', first.captureId), /NETWORK_LEASE_UNAVAILABLE/);
  await assert.rejects(f.service.start(f.event, 'a'), /NETWORK_LEASE_UNAVAILABLE/);
});

test('invalid start options are rejected before any recorder is created', async t => {
  const f = fixture(t);
  for (const options of [null, [], 'bad', 1, { commandTimeoutMs: 1 }, { extra: true }]) {
    await assert.rejects(f.service.start(f.event, 'a', options), /INVALID_NETWORK_OPTIONS/);
  }
  assert.equal(f.calls.length, 0);
});

async function bodyFixture(t, value) {
  const instance = fakeRecorder(); instance.bodyValue = value;
  const f = fixture(t, () => instance), { captureId } = await f.service.start(f.event, 'a');
  return { ...f, instance, body: query => f.service.body(f.event, 'a', captureId, { requestId: 'request', kind: 'response', ...query }) };
}

test('body pages a 1 MiB string with default limit and UTF-16 offsets', async t => {
  const text = 'x'.repeat(1024 * 1024 - 7) + '😀éx', bytes = Buffer.byteLength(text);
  const f = await bodyFixture(t, { state: 'available', body: text, base64Encoded: false, bytes, untrusted: true });
  const first = f.body();
  assert.equal(first.body.length, 12000);
  assert.equal(first.offset, 0); assert.equal(first.nextOffset, 12000); assert.equal(first.hasMore, true);
  assert.equal(first.offsetUnit, 'utf16-code-units'); assert.equal(first.encoding, 'utf8'); assert.equal(first.bytes, bytes);
  const second = f.body({ offset: 12000, limit: 16000, hop: 2 });
  assert.equal(second.body, text.slice(12000, 28000));
  assert.equal(second.nextOffset, 28000);
  assert.deepEqual(f.instance.bodyQueries, [{ requestId: 'request', kind: 'response' }, { requestId: 'request', kind: 'response', hop: 2 }]);
  assert.equal(Buffer.byteLength(JSON.stringify(first)) < 60000, true);
});

test('escaped controls are paged below 60000 JSON bytes and reconstruct exactly', async t => {
  const text = '\u0000\u0001\n\r\t"\\😀\ud800'.repeat(2000);
  const f = await bodyFixture(t, { state: 'available', body: text, base64Encoded: false, bytes: Buffer.byteLength(text), untrusted: true });
  let offset = 0, joined = '', pages = 0;
  do {
    const page = f.body({ offset, limit: 16000 });
    assert.ok(Buffer.byteLength(JSON.stringify(page), 'utf8') < 59000);
    assert.ok(Buffer.byteLength(JSON.stringify({ ok: true, value: page }), 'utf8') < 60000);
    assert.ok(JSON.stringify(page).length < 60000);
    assert.ok(page.body.length > 0 && page.body.length <= 16000);
    assert.equal(page.offset, offset);
    assert.equal(page.nextOffset, offset + page.body.length);
    joined += page.body; offset = page.nextOffset; pages++;
    if (!page.hasMore) break;
  } while (pages < 10);
  assert.equal(joined, text);
  assert.ok(pages > 1);
});

test('all escaped code units force a smaller page even at the default limit', async t => {
  const f = await bodyFixture(t, { state: 'available', body: '\u0000'.repeat(20000), bytes: 20000, base64Encoded: false, untrusted: true });
  const value = f.body();
  assert.ok(value.body.length < 12000);
  assert.ok(value.body.length > 0);
  assert.ok(Buffer.byteLength(JSON.stringify(value)) < 60000);
  assert.equal(value.hasMore, true);
});

test('base64 chunks preserve representation and total decoded byte count', async t => {
  const bytes = Buffer.from(Array.from({ length: 40000 }, (_, i) => i % 256)), text = bytes.toString('base64');
  const f = await bodyFixture(t, { state: 'available', body: text, base64Encoded: true, bytes: bytes.length, untrusted: true });
  const page = f.body({ offset: 1, limit: 7 });
  assert.equal(page.body, text.slice(1, 8));
  assert.equal(page.encoding, 'base64'); assert.equal(page.base64Encoded, true); assert.equal(page.bytes, bytes.length);
  assert.equal(page.nextOffset, 8); assert.equal(page.offsetUnit, 'utf16-code-units');
});

test('offsets count UTF-16 units, including a caller-selected surrogate boundary', async t => {
  const f = await bodyFixture(t, { state: 'available', body: 'A😀B', bytes: 6, base64Encoded: false, untrusted: true });
  assert.equal(f.body({ offset: 1, limit: 1 }).body, '\ud83d');
  assert.equal(f.body({ offset: 2, limit: 1 }).body, '\ude00');
  assert.equal(f.body({ offset: 3, limit: 1 }).body, 'B');
  assert.equal(f.body({ offset: 3, limit: 1 }).hasMore, false);
});

test('empty and beyond-end pages have stable terminal offsets', async t => {
  const f = await bodyFixture(t, { state: 'available', body: '', bytes: 0, base64Encoded: false, untrusted: true });
  for (const offset of [0, 9, Number.MAX_SAFE_INTEGER]) {
    const page = f.body({ offset, limit: 1 });
    assert.equal(page.body, ''); assert.equal(page.offset, offset); assert.equal(page.nextOffset, offset); assert.equal(page.hasMore, false);
  }
});

for (const metadata of [
  { state: 'pending', untrusted: true },
  { state: 'unavailable', reason: 'BODY_LIMIT', bytes: 1048577, truncated: true, untrusted: true },
  { state: 'unavailable', reason: 'REQUEST_FAILED', untrusted: true },
]) test(`body preserves ${metadata.state}/${metadata.reason ?? 'waiting'} metadata`, async t => {
  const f = await bodyFixture(t, metadata), page = f.body({ offset: 20 });
  for (const [key, value] of Object.entries(metadata)) assert.equal(page[key], value);
  assert.equal(page.encoding, null); assert.equal(page.bytes, metadata.bytes ?? null);
  assert.equal(page.body, ''); assert.equal(page.offset, 20); assert.equal(page.nextOffset, 20); assert.equal(page.hasMore, false);
  assert.equal(page.offsetUnit, 'utf16-code-units');
});

test('body rejects invalid paging parameters before asking the recorder', async t => {
  const f = await bodyFixture(t, { state: 'pending', untrusted: true });
  for (const offset of [-1, 0.1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '0', null]) assert.throws(() => f.body({ offset }), /INVALID_NETWORK_QUERY/);
  for (const limit of [0, -1, 16001, 1.5, NaN, Infinity, '1', null]) assert.throws(() => f.body({ limit }), /INVALID_NETWORK_QUERY/);
  assert.equal(f.instance.bodyQueries.length, 0);
  assert.equal(f.body({ offset: 0, limit: 1 }).body, '');
});

for (const action of ['release', 'dispose', 'destroy']) test(`${action} promptly rejects a start whose factory never settles`, { timeout: 1000 }, async t => {
  const f = fixture(t, () => new Promise(() => {}));
  const starting = f.service.start(f.event, 'a');
  const rejected = assert.rejects(starting, /NETWORK_START_CANCELED/);
  await flushFactory();
  const signal = f.calls[0].options.signal;
  if (action === 'destroy') f.page.destroy();
  else if (action === 'release') f.service.release('a');
  else f.service.dispose();
  await rejected;
  assert.equal(signal.aborted, true);
  assert.equal(f.page.listenerCount('destroyed'), 0);
});

test('destroying an active guest releases its capture without waiting for an RPC or host release', async t => {
  const instance = fakeRecorder(), f = fixture(t, () => instance);
  const { captureId } = await f.service.start(f.event, 'a');
  assert.equal(f.page.listenerCount('destroyed'), 1);
  f.page.destroy();
  assert.equal(instance.disposals, 1);
  assert.equal(f.page.listenerCount('destroyed'), 0);
  assert.throws(() => f.service.list(f.event, 'a', captureId), /NETWORK_LEASE_UNAVAILABLE/);
  f.service.release('a'); f.service.dispose();
  assert.equal(instance.disposals, 1);
});

test('failed starts and replacements remove their exact guest lifecycle listeners', async t => {
  const f = fixture(t, (_page, _options, call) => { if (call === 1) throw Error('setup failed'); return fakeRecorder(); });
  await assert.rejects(f.service.start(f.event, 'a'), /setup failed/);
  assert.equal(f.page.listenerCount('destroyed'), 0);
  await f.service.start(f.event, 'a');
  assert.equal(f.page.listenerCount('destroyed'), 1);
  f.leases.set('a', { owner: f.owner, guest: f.otherPage });
  const { captureId } = await f.service.start(f.event, 'a');
  assert.equal(f.page.listenerCount('destroyed'), 0);
  assert.equal(f.otherPage.listenerCount('destroyed'), 1);
  f.page.destroy();
  assert.equal(f.service.read(f.event, 'a', captureId).name, 'r');
  f.service.release('a');
  assert.equal(f.otherPage.listenerCount('destroyed'), 0);
});

test('lease release aborts real recorder initialization and frees its debugger without a command reply', { timeout: 1000 }, async t => {
  const page = guest(), owner = {}, event = { sender: owner }, debug = new EventEmitter();
  let attached = false, detaches = 0;
  debug.isAttached = () => attached;
  debug.attach = () => { attached = true; };
  debug.detach = () => { attached = false; detaches++; debug.emit('detach', {}, 'closed'); };
  debug.sendCommand = () => new Promise(() => {});
  page.debugger = debug;
  const service = createLeaseNetworkService({ assertProductSender() {}, leases: new Map([['a', { owner, guest: page }]]), recorder: createNetworkRecorder });
  t.after(() => service.dispose());
  const starting = service.start(event, 'a'), rejected = assert.rejects(starting, /NETWORK_START_CANCELED/);
  await flushFactory(); assert.equal(attached, true);
  service.release('a'); await rejected; await flushCleanup();
  assert.equal(attached, false); assert.equal(detaches, 1);
  assert.equal(debug.listenerCount('message'), 0);
  assert.equal(page.listenerCount('destroyed'), 0);
});
