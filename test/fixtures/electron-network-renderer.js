import { GuestNetwork } from '../../src/network-client.js';

const api = window.ELECTRON_NETWORK_SMOKE;
const report = { checks: [], failures: [], observations: {} };
const signal = new AbortController().signal;
const leases = new Set(), clients = new Set(), elements = new Map();
const postText = '请求正文 · café 😀\n{"ok":true}';
const responseText = '响应正文 · 你好 café 😀\nSecond line';
const binary = [0, 255, 1, 128, 65, 10, 13, 127, 254, 42];
const ensure = (condition, message) => { if (!condition) throw Error(message); };
const equal = (actual, expected, message) => ensure(JSON.stringify(actual) === JSON.stringify(expected), message);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };
async function until(task, message, timeout = 10000) {
  const start = performance.now(); let value;
  while (performance.now() - start < timeout) { value = await task(); if (value) return value; await pause(40); }
  throw Error(`Timed out: ${message}`);
}
async function check(name, task) {
  try {
    const details = await task();
    report.checks.push({ name, ...(details ? { details } : {}) });
  } catch (error) { report.failures.push({ name, error: error.message }); throw error; }
}
async function rejects(task, expected) {
  try { await task(); } catch (error) { equal(error.code, expected, `Expected ${expected}, got ${error.code || error.message}`); return; }
  throw Error(`Expected rejection ${expected}`);
}
const newClient = (lease, bridge = api.network) => { const client = new GuestNetwork(bridge, lease); clients.add(client); return client; };
const request = (client, action, extra = {}) => client.request({ action, ...extra }, signal);
const headers = record => Object.fromEntries(Object.entries({ ...record.requestHeaders, ...record.requestExtra?.headers }).map(([key, value]) => [key.toLowerCase(), value]));
const responseHeaders = record => Object.fromEntries(Object.entries({ ...record.responseHeaders, ...record.responseExtra?.headers }).map(([key, value]) => [key.toLowerCase(), value]));
async function mount() {
  const reservation = await api.acquire(); leases.add(reservation.lease);
  const frame = document.createElement('webview');
  frame.setAttribute('name', reservation.lease); frame.setAttribute('partition', reservation.partition);
  frame.setAttribute('src', `about:blank#${reservation.lease}`);
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('Fixture webview initialization timed out')), 10000);
    frame.addEventListener('dom-ready', () => { clearTimeout(timer); resolve(); }, { once: true });
  });
  document.querySelector('#guests').append(frame); elements.set(reservation.lease, frame);
  await ready;
  const client = newClient(reservation.lease);
  await until(async () => (await request(client, 'status')).initialized, 'main-process owned guest initialization');
  return { ...reservation, frame, client };
}
async function readBody(client, captureId, item, kind = 'response') {
  return until(async () => {
    const value = await request(client, 'body', { captureId, requestId: item.requestId, hop: item.hop, kind });
    if (value.state === 'pending') return false;
    ensure(value.state === 'available', `Body unavailable: ${value.reason}`);
    return value;
  }, `${kind} body for ${new URL(item.url).pathname}`);
}
let primary, occupied, captureId, delayedGate;
try {
  await check('sandboxed preload exposes the inlined real factory across context isolation', async () => {
    ensure(api, 'Preload API unavailable');
    equal(api.environment, { sandboxed: true, contextIsolated: true }, 'Actual preload isolation flags differ');
    equal(typeof window.require, 'undefined', 'Node require leaked into renderer');
    equal(typeof window.process, 'undefined', 'Node process leaked into renderer');
    equal(Object.keys(api.network).sort(), ['protocolVersion', 'request'], 'Unexpected network public API');
    equal(api.network.protocolVersion, 1, 'Unexpected bridge version');
  });
  await check('real webviews attach only through fixture-owned leases', async () => {
    primary = await mount(); occupied = await mount();
    const status = await request(primary.client, 'status');
    equal(status.scope, 'owned-root-target', 'Unexpected capture scope'); equal(status.childTargets, false, 'Unexpected child-target support');
    return { initializedGuests: 2, scope: status.scope, childTargets: status.childTargets };
  });
  await check('unknown lease is denied over actual Electron IPC', async () => {
    const unknown = newClient('not-an-issued-fixture-lease');
    await rejects(() => request(unknown, 'status'), 'NETWORK_LEASE_UNAVAILABLE');
  });
  await check('another owned guest with an occupied debugger is left attached', async () => {
    const attached = await api.occupyDebugger(occupied.lease); ensure(attached.attached, 'Fixture debugger did not attach');
    await rejects(() => request(occupied.client, 'start'), 'NETWORK_DEBUGGER_ALREADY_ATTACHED');
    equal(await api.debugState(occupied.lease), { attached: true, detachEvents: 0 }, 'Bridge detached occupied debugger');
  });
  await check('real GuestNetwork starts capture before controlled guest navigation', async () => {
    const started = await request(primary.client, 'start', { maxRequests: 50, maxBodyBytes: 65536, maxTotalBodyBytes: 262144 });
    captureId = started.captureId; ensure(typeof captureId === 'string', 'Missing capture ID');
    equal(started.state, 'capturing', 'Recorder did not start');
    ensure((await api.debugState(primary.lease)).attached, 'Actual guest debugger was not attached');
    await rejects(() => request(primary.client, 'list', { captureId: 'different-capture' }), 'NETWORK_CAPTURE_UNAVAILABLE');
    await primary.frame.loadURL(`${location.origin}/guest`);
  });
  const entries = await until(async () => {
    const value = await request(primary.client, 'list', { captureId, limit: 100 });
    const items = value.items;
    return items.some(item => item.url.endsWith('/post') && item.state === 'finished')
      && items.some(item => item.url.endsWith('/binary') && item.state === 'finished')
      && items.some(item => item.url.endsWith('/failure') && item.state === 'failed')
      && items.filter(item => item.url.includes('/redirect/')).length === 3
      && items.some(item => item.url.endsWith('/redirect/final') && item.state === 'finished') ? items : false;
  }, 'POST, redirects, binary and failed network requests');
  report.observations.requestStates = entries.map(item => ({ path: new URL(item.url).pathname, method: item.method, state: item.state, status: item.status, hop: item.hop }));
  await check('POST metadata, custom headers and exact Unicode request and response bodies cross the public API', async () => {
    const item = entries.find(value => value.url.endsWith('/post'));
    const record = await request(primary.client, 'read', { captureId, requestId: item.requestId, hop: item.hop });
    equal(record.method, 'POST', 'POST method lost'); equal(record.status, 201, 'POST response status lost');
    equal(headers(record)['x-fixture-request'], 'request-value', 'Custom request header lost');
    equal(responseHeaders(record)['x-fixture-response'], 'response-value', 'Custom response header lost');
    const sent = await readBody(primary.client, captureId, item, 'request');
    const received = await readBody(primary.client, captureId, item);
    equal(sent.body, postText, 'Exact Unicode POST body differs'); equal(received.body, responseText, 'Exact Unicode response body differs');
    equal(sent.encoding, 'utf8', 'Request encoding differs'); equal(received.encoding, 'utf8', 'Response encoding differs');
    equal(record.untrusted, true, 'Page data lacks untrusted marker');
    return { requestBytes: sent.bytes, responseBytes: received.bytes, requestEncoding: sent.encoding, responseEncoding: received.encoding, extraInfo: record.extraInfo };
  });
  await check('redirects retain three distinct hops and their own statuses and headers', async () => {
    const redirects = entries.filter(item => item.url.includes('/redirect/')).sort((a, b) => a.hop - b.hop);
    equal(redirects.map(item => item.requestId), Array(3).fill(redirects[0].requestId), 'Redirect chain identity changed');
    equal(redirects.map(item => item.hop), [0, 1, 2], 'Redirect hops differ');
    equal(redirects.map(item => item.state), ['redirected', 'redirected', 'finished'], 'Redirect lifecycle differs');
    for (const [index, hop] of redirects.entries()) {
      const record = await request(primary.client, 'read', { captureId, requestId: hop.requestId, hop: hop.hop });
      equal(record.status, [302, 307, 200][index], 'Redirect status mismatched hop');
      equal(responseHeaders(record)['x-fixture-hop'], ['start', 'middle', 'final'][index], 'Redirect headers mismatched hop');
    }
    const body = await readBody(primary.client, captureId, redirects[2]);
    equal(body.body, 'redirect completed · 完成', 'Final redirect response differs');
    return { statuses: redirects.map(item => item.status), hops: redirects.map(item => item.hop) };
  });
  await check('binary response preserves exact bytes and reports Chromium encoding', async () => {
    const item = entries.find(value => value.url.endsWith('/binary'));
    const body = await readBody(primary.client, captureId, item);
    const decoded = body.encoding === 'base64' ? Array.from(atob(body.body), char => char.charCodeAt(0)) : Array.from(new TextEncoder().encode(body.body));
    equal(decoded, binary, 'Binary bytes changed'); equal(body.bytes, binary.length, 'Decoded binary byte count differs');
    report.observations.binary = { encoding: body.encoding, base64Encoded: body.base64Encoded, bytes: body.bytes };
    return report.observations.binary;
  });
  await check('failed network request remains a failed record with unavailable response body', async () => {
    const item = entries.find(value => value.url.endsWith('/failure') && value.state === 'failed');
    const record = await request(primary.client, 'read', { captureId, requestId: item.requestId, hop: item.hop });
    const body = await request(primary.client, 'body', { captureId, requestId: item.requestId, hop: item.hop, kind: 'response' });
    equal(record.state, 'failed', 'Failure state lost'); ensure(record.errorText, 'Missing Chromium failure text');
    equal(body.state, 'unavailable', 'Failed body incorrectly available'); equal(body.reason, 'REQUEST_FAILED', 'Failure body reason differs');
    return { state: record.state, reason: body.reason, chromiumError: record.errorText };
  });
  await check('clear empties this capture and stop detaches only its own real guest', async () => {
    await request(primary.client, 'clear', { captureId });
    equal((await request(primary.client, 'list', { captureId })).items.length, 0, 'Clear retained records');
    await request(primary.client, 'stop', { captureId });
    equal((await api.debugState(primary.lease)).attached, false, 'Stopped guest debugger remains attached');
    equal(await api.debugState(occupied.lease), { attached: true, detachEvents: 0 }, 'Stopping one guest detached the other debugger');
    equal(primary.client.captureId, null, 'Client retained capture after stop');
  });
  await check('canceled real client start cleans its late native capture before later work', async () => {
    const observed = deferred(); delayedGate = deferred();
    const delayed = newClient(primary.lease, { protocolVersion: api.network.protocolVersion, async request(payload) {
      const reply = await api.network.request(payload);
      if (payload.operation === 'start') { observed.resolve(reply); await delayedGate.promise; }
      return reply;
    } });
    const controller = new AbortController();
    const starting = delayed.request({ action: 'start' }, controller.signal);
    const settled = starting.then(() => ({ rejected: false }), error => ({ rejected: true, message: error.message }));
    const realReply = await observed.promise; ensure(realReply.ok && realReply.value.captureId, 'Real delayed start failed');
    ensure((await api.debugState(primary.lease)).attached, 'No real capture existed before cancellation');
    controller.abort(new Error('controlled fixture cancellation'));
    const result = await settled; ensure(result.rejected, 'Canceled client returned a successful start');
    delayedGate.resolve(); await delayed.stopCapture();
    equal((await api.debugState(primary.lease)).attached, false, 'Late canceled start leaked its debugger');
    equal((await api.network.request({ operation: 'status', lease: primary.lease })).value.captureId, undefined, 'Canceled capture still advertised');
    return { transport: 'actual Electron IPC with fixture-delayed start reply', lateCaptureReleased: true };
  });
  await check('lease release disposes active capture before closing the actual guest', async () => {
    const started = await request(primary.client, 'start');
    primary.client.dispose();
    const released = await api.release(primary.lease); leases.delete(primary.lease);
    equal(released, { released: true, attachedBeforeClose: false }, 'Capture cleanup did not precede guest close');
    const reply = await api.network.request({ operation: 'status', lease: primary.lease, captureId: started.captureId });
    equal(reply.error?.code, 'NETWORK_LEASE_UNAVAILABLE', 'Released lease still authorized');
    equal(await api.debugState(occupied.lease), { attached: true, detachEvents: 0 }, 'Release affected the other guest');
  });
} catch (error) {
  if (!report.failures.length) report.failures.push({ name: 'renderer setup or traffic wait', error: error.message });
} finally {
  delayedGate?.resolve();
  for (const client of clients) client.dispose();
  for (const lease of leases) {
    try { await api.release(lease); } catch (error) { report.failures.push({ name: 'renderer guest cleanup', error: error.message }); }
  }
  if (api) await api.finish(report);
}
