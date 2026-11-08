import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { DESKTOP_BROWSER_CHANNEL, DESKTOP_LEGACY_NETWORK_CHANNEL, installDesktopBrowserBridge } from '../native/desktop-browser-bridge.js';

// Controlled fakes only: no Electron, no real WebContents, no real timers.
class FakeDebugger extends EventEmitter {
  attached = false; attaches = 0; detaches = 0; commands = []; responses = {}; handler = null; attachVersion;
  isAttached() { return this.attached; }
  attach(version) { this.attachVersion = version; this.attached = true; this.attaches++; }
  detach() { this.attached = false; this.detaches++; this.emit('detach', {}, 'closed'); }
  sendCommand(method, params) {
    this.commands.push({ method, params });
    if (this.handler) {
      const reply = this.handler(method, params);
      if (reply !== undefined) return Promise.resolve(reply);
    }
    if (method in this.responses) {
      const value = this.responses[method];
      return Promise.resolve(typeof value === 'function' ? value(params) : value);
    }
    return Promise.resolve({});
  }
  message(method, params) { this.emit('message', {}, method, params); }
}
function contents() {
  const value = new EventEmitter(); value.destroyed = false;
  value.isDestroyed = () => value.destroyed;
  value.destroy = () => { value.destroyed = true; value.emit('destroyed'); };
  value.mainFrame = {}; value.debugger = new FakeDebugger();
  // Electron Session stand-in: the bridge attaches will-download lazily here.
  value.session = new EventEmitter();
  return value;
}
// Electron DownloadItem stand-in: live state plus the updated/done events.
class FakeDownloadItem extends EventEmitter {
  constructor(overrides = {}) {
    super();
    this.state = 'progressing'; this.received = 0; this.total = 2048;
    this.savePath = '/tmp/file.bin'; this.url = 'https://example.test/file.bin';
    this.filename = 'file.bin'; this.mimeType = 'application/octet-stream';
    this.cancelled = 0; Object.assign(this, overrides);
  }
  getURL() { return this.url; }
  getFilename() { return this.filename; }
  getMimeType() { return this.mimeType; }
  getState() { return this.state; }
  getReceivedBytes() { return this.received; }
  getTotalBytes() { return this.total; }
  getSavePath() { return this.savePath; }
  cancel() { this.cancelled++; this.state = 'cancelled'; }
}
function fixture(t, { initialized = true } = {}) {
  const handlers = new Map(), owner = contents(), otherOwner = contents(), guest = contents(), otherGuest = contents();
  const app = new EventEmitter(), calls = { auth: 0, releases: [] };
  const ipcMain = {
    handle(channel, handler) { if (handlers.has(channel)) throw Error('handler exists'); handlers.set(channel, handler); },
    removeHandler(channel) { handlers.delete(channel); },
    _invokeHandlers: handlers,
  };
  const browserGuests = {
    leases: new Map([
      ['lease-a', { owner, partition: 'partition-a', attached: initialized, ...(initialized ? { guest } : {}) }],
      ['lease-b', { owner: otherOwner, partition: 'partition-b', attached: true, guest: otherGuest }],
    ]),
    async release(sender, lease) {
      const entry = this.leases.get(lease);
      if (!entry) return;
      if (entry.owner !== sender) throw Error('wrong owner');
      calls.releases.push({ lease, debuggerAttached: entry.guest?.debugger.isAttached() });
      this.leases.delete(lease); entry.guest?.destroy();
    },
  };
  const originalRelease = browserGuests.release;
  const assertProductSender = event => {
    calls.auth++;
    if (![owner, otherOwner].includes(event?.sender) || event.senderFrame !== event.sender.mainFrame) throw Error('private host path must not escape');
  };
  const dependencies = { ipcMain, app, browserGuests, assertProductSender };
  const installation = installDesktopBrowserBridge(dependencies);
  t.after(() => installation.dispose());
  const event = { sender: owner, senderFrame: owner.mainFrame };
  const otherEvent = { sender: otherOwner, senderFrame: otherOwner.mainFrame };
  const invoke = (payload, senderEvent = event) => handlers.get(DESKTOP_BROWSER_CHANNEL)(senderEvent, payload);
  const legacyInvoke = (payload, senderEvent = event) => handlers.get(DESKTOP_LEGACY_NETWORK_CHANNEL)(senderEvent, payload);
  const request = (operation, extra = {}, senderEvent = event) => invoke({ operation, lease: 'lease-a', ...extra }, senderEvent);
  const legacyRequest = (operation, extra = {}, senderEvent = event) => legacyInvoke({ operation, lease: 'lease-a', ...extra }, senderEvent);
  return { handlers, owner, otherOwner, guest, otherGuest, app, calls, ipcMain, browserGuests, originalRelease, dependencies, installation, event, otherEvent, invoke, legacyInvoke, request, legacyRequest };
}
const code = (reply, expected) => assert.deepEqual(reply, { ok: false, error: { code: expected, message: expected } });

test('unknown operations, extra keys and malformed requests are rejected before authentication', async t => {
  const f = fixture(t);
  const invalid = [
    null, [], {}, { operation: 'sendCommand', lease: 'lease-a' },
    { operation: 'status', lease: 'lease-a', guestId: 12 },
    { operation: 'screenshot', lease: 'lease-a', extra: true },
    { operation: 'screenshot', lease: 'lease-a', options: { fullPage: 'yes' } },
    { operation: 'screenshot', lease: 'lease-a', options: { nope: 1 } },
    { operation: 'screenshot', lease: 'lease-a', query: {} },
    { operation: 'screenshot', lease: 'lease-a', captureId: 'c' },
    { operation: 'cookies', lease: 'lease-a', options: {} },
    { operation: 'cookies', lease: 'lease-a', options: { action: 'eat' } },
    { operation: 'emulate', lease: 'lease-a', options: { width: 800 } },
    { operation: 'emulate', lease: 'lease-a', options: { width: 0, height: 600 } },
    { operation: 'emulate', lease: 'lease-a', options: { width: 800, height: 600, deviceScaleFactor: 9 } },
    { operation: 'input', lease: 'lease-a', options: { type: 'mouse', x: 1e9, y: 2 } },
    { operation: 'input', lease: 'lease-a', options: { type: 'mouse', mouseType: 'tap', x: 1 } },
    { operation: 'input', lease: 'lease-a', options: { type: 'key', clickCount: 9 } },
    { operation: 'input', lease: 'lease-a', options: { type: 'key', key: 'k'.repeat(65) } },
    { operation: 'start', lease: 'lease-a', options: { commandTimeoutMs: 1 } },
    { operation: 'downloads', lease: 'lease-a', options: { id: 1 } },
    { operation: 'downloads', lease: 'lease-a', query: {} },
    { operation: 'clearDownloads', lease: 'lease-a', options: { id: 1 } },
    { operation: 'downloadCancel', lease: 'lease-a' },
    { operation: 'downloadCancel', lease: 'lease-a', options: { id: -1 } },
    { operation: 'downloadCancel', lease: 'lease-a', options: { id: 1.5 } },
    { operation: 'upload', lease: 'lease-a' },
    { operation: 'upload', lease: 'lease-a', options: { selector: '#f' } },
    { operation: 'upload', lease: 'lease-a', options: { selector: '#f', files: [] } },
    { operation: 'upload', lease: 'lease-a', options: { selector: '#f', files: ['relative.txt'] } },
    { operation: 'upload', lease: 'lease-a', options: { selector: '#f', files: Array.from({ length: 11 }, (_, i) => `/tmp/f${i}`) } },
    { operation: 'upload', lease: 'lease-a', options: { selector: '#f', files: [`/${'x'.repeat(4096)}`] } },
  ];
  const hostile = { lease: 'lease-a' };
  Object.defineProperty(hostile, 'operation', { enumerable: true, get() { throw Error('getter executed'); } });
  invalid.push(hostile);
  for (const [index, payload] of invalid.entries()) assert.equal((await f.invoke(payload)).ok, false, `invalid payload #${index}`);
  assert.equal(f.calls.auth, 0); assert.equal(f.guest.debugger.attaches, 0);
});

test('new capabilities require the owned product lease and reject other senders', async t => {
  const f = fixture(t);
  code(await f.request('screenshot', {}, { sender: f.owner, senderFrame: {} }), 'NETWORK_FORBIDDEN');
  code(await f.request('screenshot', {}, { sender: contents(), senderFrame: {} }), 'NETWORK_FORBIDDEN');
  code(await f.request('screenshot', {}, f.otherEvent), 'NETWORK_LEASE_UNAVAILABLE');
  code(await f.request('screenshot', { lease: 'missing' }), 'NETWORK_LEASE_UNAVAILABLE');
  code(await f.request('emulate', {}, f.otherEvent), 'NETWORK_LEASE_UNAVAILABLE');
  // Network operations keep the original codes when delegated.
  code(await f.request('status', {}, { sender: f.owner, senderFrame: {} }), 'NETWORK_FORBIDDEN');
  code(await f.request('status', {}, f.otherEvent), 'NETWORK_LEASE_UNAVAILABLE');
  code(await f.request('status', { lease: 'missing' }), 'NETWORK_LEASE_UNAVAILABLE');
  assert.equal(f.guest.debugger.attaches, 0); assert.equal(f.otherGuest.debugger.attaches, 0);
});

test('capabilities describes the versioned surface without a lease', async t => {
  const f = fixture(t);
  const reply = await f.invoke({ operation: 'capabilities' });
  assert.equal(reply.ok, true);
  assert.equal(reply.value.version, 1);
  for (const key of ['network', 'screenshot', 'emulate', 'cookies', 'accessibility', 'input', 'downloads', 'upload']) assert.equal(reply.value[key], true);
  const required = ['status', 'start', 'list', 'read', 'body', 'frames', 'clear', 'stop', 'screenshot', 'emulate', 'clearEmulation', 'cookies', 'accessibility', 'input', 'downloads', 'clearDownloads', 'downloadCancel', 'upload', 'capabilities'];
  assert.deepEqual([...reply.value.operations].sort(), required.sort());
  assert.equal((await f.request('capabilities')).ok, true);
  assert.equal(f.calls.auth, 0); assert.equal(f.guest.debugger.attaches, 0);
});

test('screenshot returns a PNG data URL and fullPage sets captureBeyondViewport', async t => {
  const f = fixture(t);
  f.guest.debugger.responses['Page.captureScreenshot'] = { data: 'iVBORw0K' };
  const full = await f.request('screenshot', { options: { fullPage: true } });
  assert.equal(full.ok, true);
  assert.equal(full.value.format, 'png'); assert.equal(full.value.fullPage, true);
  assert.equal(full.value.dataUrl, 'data:image/png;base64,iVBORw0K');
  assert.deepEqual(f.guest.debugger.commands[0], { method: 'Page.captureScreenshot', params: { format: 'png', captureBeyondViewport: true } });
  f.guest.debugger.commands.length = 0;
  const view = await f.request('screenshot', { options: { selector: '#main' } });
  assert.equal(view.value.fullPage, false);
  assert.deepEqual(f.guest.debugger.commands[0].params, { format: 'png' });
  assert.equal(f.guest.debugger.attaches, 2); assert.equal(f.guest.debugger.detaches, 2);
});

test('an oversized screenshot reply is rejected above the screenshot byte cap', async t => {
  const f = fixture(t);
  f.guest.debugger.responses['Page.captureScreenshot'] = { data: 'A'.repeat(5_500_000) };
  code(await f.request('screenshot'), 'NETWORK_RESPONSE_TOO_LARGE');
  // The debugger was attached for the attempt and is still detached afterwards.
  assert.equal(f.guest.debugger.attaches, 1); assert.equal(f.guest.debugger.detaches, 1);
});

test('CDP_BUSY when the debugger is already attached, and it is never detached by CDP ops', async t => {
  const busy = fixture(t);
  const started = await busy.request('start');
  assert.equal(started.ok, true);
  code(await busy.request('screenshot'), 'CDP_BUSY');
  assert.equal(busy.guest.debugger.attaches, 1); // only the network recorder attached
  const manual = fixture(t);
  manual.guest.debugger.attached = true;
  code(await manual.request('emulate', { options: { width: 10, height: 10 } }), 'CDP_BUSY');
  assert.equal(manual.guest.debugger.attaches, 0); assert.equal(manual.guest.debugger.detaches, 0);
});

test('emulate applies device metrics, UA, timezone and media overrides', async t => {
  const f = fixture(t);
  const reply = await f.request('emulate', { options: { width: 820, height: 640, deviceScaleFactor: 2, mobile: true, userAgent: 'UA/1', timezone: 'Asia/Shanghai', media: 'print' } });
  assert.equal(reply.ok, true);
  assert.deepEqual(reply.value.applied, ['deviceMetrics', 'userAgent', 'timezone', 'media']);
  const byMethod = Object.fromEntries(f.guest.debugger.commands.map(call => [call.method, call.params]));
  assert.deepEqual(byMethod['Emulation.setDeviceMetricsOverride'], { width: 820, height: 640, deviceScaleFactor: 2, mobile: true });
  assert.deepEqual(byMethod['Emulation.setUserAgentOverride'], { userAgent: 'UA/1' });
  assert.deepEqual(byMethod['Emulation.setTimezoneOverride'], { timezoneId: 'Asia/Shanghai' });
  assert.deepEqual(byMethod['Emulation.setEmulatedMedia'], { media: 'print', features: [] });
  assert.equal(f.guest.debugger.attaches, 1); assert.equal(f.guest.debugger.detaches, 1);
});

test('clearEmulation clears device metrics and best-effort resets overrides', async t => {
  const f = fixture(t);
  assert.deepEqual(await f.request('clearEmulation'), { ok: true, value: { cleared: true } });
  const methods = f.guest.debugger.commands.map(call => call.method);
  assert.equal(methods[0], 'Emulation.clearDeviceMetricsOverride');
  assert.ok(methods.includes('Emulation.setEmulatedMedia'));
  assert.equal(f.guest.debugger.detaches, 1);
});

test('cookies get is capped at 500, truncates, and clear uses Network.clearBrowserCookies', async t => {
  const f = fixture(t);
  f.guest.debugger.responses['Network.getAllCookies'] = { cookies: Array.from({ length: 620 }, (_, i) => ({ name: `c${i}`, value: `v${i}`, domain: 'example.test', path: '/', secure: true })) };
  const reply = await f.request('cookies', { options: { action: 'get' } });
  assert.equal(reply.ok, true);
  assert.equal(reply.value.cookies.length, 500); assert.equal(reply.value.truncated, true);
  assert.ok(Buffer.byteLength(JSON.stringify(reply), 'utf8') < 60000);
  assert.equal(reply.value.cookies[0].name, 'c0');
  f.guest.debugger.commands.length = 0;
  assert.deepEqual(await f.request('cookies', { options: { action: 'clear' } }), { ok: true, value: { cleared: true } });
  assert.equal(f.guest.debugger.commands[0].method, 'Network.clearBrowserCookies');
});

test('accessibility tree is bounded, flattened and truncates oversized input', async t => {
  const f = fixture(t);
  f.guest.debugger.responses['Accessibility.getFullAXTree'] = {
    nodes: Array.from({ length: 350 }, (_, i) => ({ nodeId: `n${i}`, ignored: false, role: { value: 'button' }, name: { value: `name-${i}` }, description: { value: 'd' }, childIds: new Array(100).fill('n0'), extra: 'x'.repeat(200) })),
  };
  const reply = await f.request('accessibility');
  assert.equal(reply.ok, true);
  assert.ok(reply.value.nodes.length > 0 && reply.value.nodes.length <= 200);
  assert.equal(reply.value.truncated, true);
  assert.ok(Buffer.byteLength(JSON.stringify(reply), 'utf8') < 60000);
  assert.deepEqual(Object.keys(reply.value.nodes[0]).sort(), ['childIds', 'description', 'ignored', 'name', 'nodeId', 'role'].sort());
  assert.equal(reply.value.nodes[0].role, 'button'); assert.equal(reply.value.nodes[0].childIds.length, 64);
  assert.equal(f.guest.debugger.commands[0].method, 'Accessibility.enable');
});

test('input dispatches validated mouse and key events', async t => {
  const f = fixture(t);
  assert.deepEqual(await f.request('input', { options: { type: 'mouse', mouseType: 'mousePressed', x: 12, y: 34, button: 'left', clickCount: 1 } }), { ok: true, value: { dispatched: true } });
  assert.deepEqual(f.guest.debugger.commands[0], { method: 'Input.dispatchMouseEvent', params: { type: 'mousePressed', x: 12, y: 34, button: 'left', clickCount: 1 } });
  f.guest.debugger.commands.length = 0;
  assert.deepEqual(await f.request('input', { options: { type: 'key', key: 'a', text: 'a' } }), { ok: true, value: { dispatched: true } });
  assert.equal(f.guest.debugger.commands[0].method, 'Input.dispatchKeyEvent');
  assert.equal(f.guest.debugger.commands[0].params.type, 'char');
  assert.equal(f.guest.debugger.commands[0].params.text, 'a');
});

test('network operations delegate to the leased service and return a captureId', async t => {
  const f = fixture(t);
  const started = await f.request('start');
  assert.equal(started.ok, true); assert.equal(typeof started.value.captureId, 'string');
  assert.equal(f.guest.debugger.attaches, 1);
  const status = await f.request('status');
  assert.equal(status.value.captureId, started.value.captureId); assert.equal(status.value.initialized, true);
  assert.deepEqual(status.value.capabilities, ['status', 'start', 'list', 'read', 'body', 'frames', 'clear', 'stop']);
  assert.equal((await f.request('list', { captureId: started.value.captureId })).ok, true);
  assert.deepEqual(await f.request('stop', { captureId: started.value.captureId }), { ok: true, value: { stopped: true } });
  assert.equal('captureId' in (await f.request('status')).value, false);
});

test('legacy network channel runs only network operations and rejects the new capabilities', async t => {
  const f = fixture(t);
  assert.equal(f.handlers.has(DESKTOP_BROWSER_CHANNEL), true);
  assert.equal(f.handlers.has(DESKTOP_LEGACY_NETWORK_CHANNEL), true);
  const started = await f.legacyRequest('start');
  assert.equal(started.ok, true); assert.equal(typeof started.value.captureId, 'string');
  const status = await f.legacyRequest('status');
  assert.equal(status.value.captureId, started.value.captureId);
  assert.deepEqual(status.value.capabilities, ['status', 'start', 'list', 'read', 'body', 'frames', 'clear', 'stop']);
  assert.equal((await f.legacyRequest('list', { captureId: started.value.captureId })).ok, true);
  // The new capability operations are rejected before authentication/CDP.
  const authBefore = f.calls.auth;
  for (const operation of ['capabilities', 'screenshot', 'emulate', 'clearEmulation', 'cookies', 'accessibility', 'input', 'downloads', 'clearDownloads', 'downloadCancel', 'upload']) {
    code(await f.legacyRequest(operation), 'INVALID_NETWORK_REQUEST');
  }
  code(await f.legacyInvoke({ operation: 'status', lease: 'lease-a', guestId: 1 }), 'INVALID_NETWORK_REQUEST');
  assert.equal(f.calls.auth, authBefore);
  assert.equal(f.guest.debugger.attaches, 1); // only the network recorder attached
  assert.deepEqual(await f.legacyRequest('stop', { captureId: started.value.captureId }), { ok: true, value: { stopped: true } });
});

test('cap channel exposes both CDP and network operations on the same lease', async t => {
  const f = fixture(t);
  f.guest.debugger.responses['Page.captureScreenshot'] = { data: 'AAAA' };
  const shot = await f.request('screenshot');
  assert.equal(shot.ok, true);
  assert.equal(shot.value.dataUrl, 'data:image/png;base64,AAAA');
  const started = await f.request('start');
  assert.equal(started.ok, true);
  assert.equal((await f.request('status')).value.captureId, started.value.captureId);
  assert.equal((await f.request('stop', { captureId: started.value.captureId })).ok, true);
});

test('duplicate install reuses one installation and disposal restores its own release wrapper', async t => {
  const f = fixture(t);
  assert.equal(f.handlers.size, 2);
  assert.equal(installDesktopBrowserBridge(f.dependencies), f.installation);
  assert.equal(f.app.listenerCount('will-quit'), 1);
  f.installation.dispose(); f.installation.dispose();
  assert.equal(f.handlers.size, 0);
  assert.equal(f.browserGuests.release, f.originalRelease);
  assert.equal(f.app.listenerCount('will-quit'), 0);
});

test('will-quit disposes the bridge and releases an active network capture debugger', async t => {
  const f = fixture(t);
  await f.request('start');
  assert.equal(f.guest.debugger.isAttached(), true);
  f.app.emit('will-quit');
  assert.equal(f.guest.debugger.isAttached(), false);
  assert.equal(f.handlers.size, 0);
});

test('missing host dependencies make installation inert', () => {
  assert.equal(installDesktopBrowserBridge().ready, false);
});

test('downloads requires the owned lease, then attaches will-download once per session', async t => {
  const f = fixture(t);
  code(await f.request('downloads', {}, { sender: f.owner, senderFrame: {} }), 'NETWORK_FORBIDDEN');
  code(await f.request('downloads', {}, f.otherEvent), 'NETWORK_LEASE_UNAVAILABLE');
  code(await f.request('clearDownloads', {}, f.otherEvent), 'NETWORK_LEASE_UNAVAILABLE');
  code(await f.request('downloadCancel', { options: { id: 1 } }, f.otherEvent), 'NETWORK_LEASE_UNAVAILABLE');
  // No listener is attached before an owned request arrives.
  assert.equal(f.guest.session.listenerCount('will-download'), 0);
  const empty = await f.request('downloads');
  assert.deepEqual(empty, { ok: true, value: { items: [], count: 0 } });
  assert.equal(f.guest.session.listenerCount('will-download'), 1);
  await f.request('downloads');
  assert.equal(f.guest.session.listenerCount('will-download'), 1);
  assert.equal(f.otherGuest.session.listenerCount('will-download'), 0);
});

test('downloads lists captured items, refreshes state on updated/done and bounds strings', async t => {
  const f = fixture(t);
  await f.request('downloads');
  const item = new FakeDownloadItem({ url: `https://example.test/${'u'.repeat(5000)}`, filename: 'f'.repeat(600), mimeType: 'm'.repeat(200) });
  f.guest.session.emit('will-download', {}, item);
  const first = await f.request('downloads');
  assert.equal(first.ok, true);
  assert.equal(first.value.count, 1);
  const listed = first.value.items[0];
  assert.equal(listed.id, 1);
  assert.equal(listed.url.length, 4096);
  assert.equal(listed.filename.length, 512);
  assert.equal(listed.mimeType.length, 128);
  assert.equal(listed.state, 'progressing');
  assert.equal(listed.receivedBytes, 0); assert.equal(listed.totalBytes, 2048);
  assert.equal(listed.savePath, '/tmp/file.bin');
  assert.equal(typeof listed.startedAt, 'string');
  assert.ok(Buffer.byteLength(JSON.stringify(first), 'utf8') < 60000);
  // updated refreshes progress.
  item.received = 1024;
  item.emit('updated', {}, 'progressing');
  assert.equal((await f.request('downloads')).value.items[0].receivedBytes, 1024);
  // done carries the terminal state.
  item.state = 'completed'; item.savePath = '/tmp/done.bin';
  item.emit('done', {}, 'completed');
  const done = (await f.request('downloads')).value.items[0];
  assert.equal(done.state, 'completed'); assert.equal(done.savePath, '/tmp/done.bin');
  // A second download gets the next id.
  f.guest.session.emit('will-download', {}, new FakeDownloadItem());
  const both = await f.request('downloads');
  assert.equal(both.value.count, 2);
  assert.deepEqual(both.value.items.map(value => value.id), [1, 2]);
  assert.equal(f.guest.debugger.attaches, 0);
});

test('downloads keeps a bounded ring of 50 and clearDownloads empties it', async t => {
  const f = fixture(t);
  await f.request('downloads');
  for (let index = 0; index < 60; index++) f.guest.session.emit('will-download', {}, new FakeDownloadItem());
  const capped = await f.request('downloads');
  assert.equal(capped.value.count, 50);
  assert.equal(capped.value.items[0].id, 11); assert.equal(capped.value.items.at(-1).id, 60);
  assert.ok(Buffer.byteLength(JSON.stringify(capped), 'utf8') < 60000);
  assert.deepEqual(await f.request('clearDownloads'), { ok: true, value: { cleared: true } });
  assert.deepEqual(await f.request('downloads'), { ok: true, value: { items: [], count: 0 } });
});

test('downloads trims the oldest summaries to stay inside the 60k JSON budget', async t => {
  const f = fixture(t);
  await f.request('downloads');
  for (let index = 0; index < 50; index++) {
    f.guest.session.emit('will-download', {}, new FakeDownloadItem({
      url: `https://example.test/${'u'.repeat(5000)}`,
      filename: 'f'.repeat(600), savePath: `/tmp/${'p'.repeat(5000)}`,
    }));
  }
  const reply = await f.request('downloads');
  assert.equal(reply.ok, true);
  assert.ok(reply.value.items.length > 0 && reply.value.items.length < 50);
  assert.equal(reply.value.truncated, true);
  assert.ok(Buffer.byteLength(JSON.stringify(reply), 'utf8') < 60000);
  // Newest summaries survive; the oldest are dropped first.
  assert.equal(reply.value.items.at(-1).id, 50);
});

test('downloadCancel cancels only a tracked progressing download', async t => {
  const f = fixture(t);
  await f.request('downloads');
  const item = new FakeDownloadItem();
  f.guest.session.emit('will-download', {}, item);
  code(await f.request('downloadCancel', { options: { id: 99 } }), 'DOWNLOAD_NOT_FOUND');
  assert.deepEqual(await f.request('downloadCancel', { options: { id: 1 } }), { ok: true, value: { cancelled: true } });
  assert.equal(item.cancelled, 1);
  assert.equal((await f.request('downloads')).value.items[0].state, 'cancelled');
  // Already cancelled downloads are not cancelled twice.
  assert.deepEqual(await f.request('downloadCancel', { options: { id: 1 } }), { ok: true, value: { cancelled: false } });
  assert.equal(item.cancelled, 1);
});

test('upload sets files on the matched file input through DOM.setFileInputFiles', async t => {
  const f = fixture(t);
  f.guest.debugger.handler = method => {
    if (method === 'DOM.getDocument') return { root: { nodeId: 7 } };
    if (method === 'DOM.querySelector') return { nodeId: 42 };
    return {};
  };
  const reply = await f.request('upload', { options: { selector: '#file', files: ['/tmp/a.txt', 'C:\\tmp\\b.txt'] } });
  assert.deepEqual(reply, { ok: true, value: { uploaded: 2 } });
  assert.deepEqual(f.guest.debugger.commands.map(call => call.method), ['DOM.enable', 'DOM.getDocument', 'DOM.querySelector', 'DOM.setFileInputFiles']);
  assert.deepEqual(f.guest.debugger.commands[1].params, { depth: 0 });
  assert.deepEqual(f.guest.debugger.commands[2].params, { nodeId: 7, selector: '#file' });
  assert.deepEqual(f.guest.debugger.commands[3].params, { files: ['/tmp/a.txt', 'C:\\tmp\\b.txt'], nodeId: 42 });
  assert.equal(f.guest.debugger.attaches, 1); assert.equal(f.guest.debugger.detaches, 1);
});

test('upload reports UPLOAD_TARGET_NOT_FOUND when no node matches', async t => {
  const f = fixture(t);
  f.guest.debugger.handler = method => {
    if (method === 'DOM.getDocument') return { root: { nodeId: 7 } };
    if (method === 'DOM.querySelector') return { nodeId: 0 };
    return {};
  };
  code(await f.request('upload', { options: { selector: '#missing', files: ['/tmp/a.txt'] } }), 'UPLOAD_TARGET_NOT_FOUND');
  assert.equal(f.guest.debugger.commands.some(call => call.method === 'DOM.setFileInputFiles'), false);
  assert.equal(f.guest.debugger.detaches, 1);
});
