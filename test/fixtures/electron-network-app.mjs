// Controlled stock-Electron fixture only. This does not load or patch DSH.
import { app, BrowserWindow, ipcMain, session } from 'electron';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { installDesktopBrowserBridge } from '../../native/desktop-browser-bridge.js';

const configArgument = process.argv.find(value => value.startsWith('--fixture-config='));
if (!configArgument) throw Error('Missing isolated fixture configuration');
const config = JSON.parse(await readFile(configArgument.slice('--fixture-config='.length), 'utf8'));
assert.equal(config.kind, 'dsh-browser-electron-network-smoke-v1');
await mkdir(config.userData, { recursive: true });
await mkdir(config.sessionData, { recursive: true });
app.setName('DSH Browser Controlled Network Smoke');
app.setPath('userData', config.userData);
app.setPath('sessionData', config.sessionData);
app.commandLine.appendSwitch('disable-background-networking');
app.commandLine.appendSwitch('disable-sync');
app.commandLine.appendSwitch('no-first-run');

const fixtureChannel = 'dsh-browser:electron-network-smoke:v1';
const postText = '请求正文 · café 😀\n{"ok":true}';
const responseText = '响应正文 · 你好 café 😀\nSecond line';
const binary = Buffer.from([0, 255, 1, 128, 65, 10, 13, 127, 254, 42]);
const received = { posts: 0, postExact: false, requestHeaderExact: false, failures: 0 };
const sockets = new Set(), guestStates = new Map(), guestPolicies = [];
const diagnostics = { stages: ['configuration'], routes: [], console: [], preloadErrors: [] };
const policy = contents => {
  const preferences = contents.getLastWebPreferences();
  return Object.fromEntries(['sandbox', 'contextIsolation', 'nodeIntegration', 'nodeIntegrationInWorker', 'nodeIntegrationInSubFrames', 'webviewTag', 'webSecurity', 'devTools'].map(key => [key, preferences[key]]));
};
let window, bridge, origin, finishing = false, serverClosed = false;
const renderer = await readFile(config.renderer);
const server = http.createServer(async (request, response) => {
  const route = new URL(request.url, 'http://fixture.invalid').pathname;
  if (diagnostics.routes.length < 40) diagnostics.routes.push({ path: route, method: request.method });
  response.setHeader('Cache-Control', 'no-store');
  if (route === '/owner') {
    response.writeHead(200, { 'Content-Type': 'text/html;charset=utf-8', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'unsafe-inline'; frame-src about: http://127.0.0.1:*" });
    response.end('<!doctype html><meta charset="utf-8"><title>Controlled Electron network smoke</title><style>body{font:14px system-ui;margin:12px}webview{width:600px;height:240px;display:flex;margin:8px}</style><h1>Controlled Electron network smoke</h1><p>Private test profile and local fixture traffic.</p><div id="guests"></div><script type="module" src="/renderer.js"></script>');
  } else if (route === '/renderer.js') {
    response.writeHead(200, { 'Content-Type': 'text/javascript;charset=utf-8' }); response.end(renderer);
  } else if (route === '/guest') {
    response.writeHead(200, { 'Content-Type': 'text/html;charset=utf-8' });
    response.end(`<!doctype html><meta charset="utf-8"><link rel="icon" href="data:,"><title>Controlled network traffic</title><p>Local traffic fixture</p><script>
      window.fixtureTraffic = Promise.allSettled([
        fetch('/post', {method:'POST',headers:{'Content-Type':'text/plain;charset=UTF-8','X-Fixture-Request':'request-value'},body:${JSON.stringify(postText)}}).then(r=>r.text()),
        fetch('/redirect/start').then(r=>r.text()),
        fetch('/binary').then(r=>r.arrayBuffer()),
        fetch('/failure').catch(()=>null)
      ]);
    </script>`);
  } else if (route === '/post') {
    try {
      let size = 0; const chunks = [];
      for await (const chunk of request) { size += chunk.length; if (size > 65536) throw Error('Fixture POST exceeded bound'); chunks.push(chunk); }
      received.posts++; received.postExact = Buffer.concat(chunks).toString('utf8') === postText;
      received.requestHeaderExact = request.headers['x-fixture-request'] === 'request-value';
      response.writeHead(201, { 'Content-Type': 'text/plain;charset=utf-8', 'X-Fixture-Response': 'response-value' }); response.end(responseText);
    } catch { response.writeHead(413); response.end(); }
  } else if (route === '/redirect/start' || route === '/redirect/middle') {
    const first = route.endsWith('/start');
    response.writeHead(first ? 302 : 307, { Location: first ? '/redirect/middle' : '/redirect/final', 'X-Fixture-Hop': first ? 'start' : 'middle' }); response.end();
  } else if (route === '/redirect/final') {
    response.writeHead(200, { 'Content-Type': 'text/plain;charset=utf-8', 'X-Fixture-Hop': 'final' }); response.end('redirect completed · 完成');
  } else if (route === '/binary') {
    response.writeHead(200, { 'Content-Type': 'application/octet-stream', 'X-Fixture-Binary': 'exact-bytes' }); response.end(binary);
  } else if (route === '/failure') {
    received.failures++; request.socket.destroy();
  } else { response.writeHead(204); response.end(); }
});
server.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
async function closeServer() {
  if (serverClosed) return;
  serverClosed = true;
  for (const socket of sockets) socket.destroy();
  await new Promise(resolve => server.close(resolve));
}
const guests = {
  leases: new Map(),
  async release(owner, lease) {
    const entry = this.leases.get(lease);
    if (!entry) return { released: false };
    if (entry.owner !== owner) throw Error('Fixture lease owner mismatch');
    const attachedBeforeClose = !!entry.guest?.debugger.isAttached();
    this.leases.delete(lease);
    if (entry.guest && !entry.guest.isDestroyed()) {
      const destroyed = new Promise(resolve => entry.guest.once('destroyed', resolve));
      entry.guest.close({ waitForBeforeUnload: false }); await destroyed;
    }
    return { released: true, attachedBeforeClose };
  },
};
const assertProductSender = event => {
  if (!window || window.isDestroyed() || event.sender !== window.webContents
    || !event.senderFrame || event.senderFrame !== window.webContents.mainFrame) throw Error('Fixture rejected non-primary product main frame');
};
async function finish(report, exitCode = 0) {
  if (finishing) return;
  finishing = true; clearTimeout(deadline);
  try {
    bridge?.dispose();
    for (const [lease, entry] of [...guests.leases]) await guests.release(entry.owner, lease);
    await closeServer();
    report.runtime = 'Controlled stock Electron with real sandboxed webview, native bridge and GuestNetwork; not installed DSH acceptance';
    report.versions = { electron: process.versions.electron, chrome: process.versions.chrome, node: process.versions.node };
    report.server = { ...received };
    report.fixtureDiagnostics = diagnostics;
    report.security = { owner: window && !window.isDestroyed() ? policy(window.webContents) : null, guests: guestPolicies };
    report.cleanup = { serverClosed, leasesRemaining: guests.leases.size, bridgeDisposed: true };
    await writeFile(config.report, JSON.stringify(report, null, 2));
  } catch (error) {
    exitCode = 1;
    await writeFile(config.report, JSON.stringify({ failures: [{ name: 'fixture cleanup', error: error.message }], cleanup: { serverClosed, leasesRemaining: guests.leases.size } }, null, 2)).catch(() => {});
  }
  if (window && !window.isDestroyed()) window.destroy();
  app.exit(exitCode);
}
const deadline = setTimeout(() => { void finish({ checks: [], failures: [{ name: 'fixture deadline', error: 'Controlled Electron test exceeded 75 seconds' }] }, 1); }, 75000);
process.on('uncaughtException', error => { void finish({ checks: [], failures: [{ name: 'fixture main error', error: error.message }] }, 1); });
process.on('unhandledRejection', error => { void finish({ checks: [], failures: [{ name: 'fixture main rejection', error: String(error?.message || error) }] }, 1); });
app.on('window-all-closed', () => { if (!finishing) void finish({ checks: [], failures: [{ name: 'fixture window', error: 'Fixture window closed before report' }] }, 1); });
app.on('before-quit', () => { bridge?.dispose(); for (const socket of sockets) socket.destroy(); });

await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
origin = `http://127.0.0.1:${server.address().port}`;
diagnostics.stages.push('server-listening', `before-ready:${app.isReady()}`);
// Do not await app readiness at module top level: Electron waits for its ESM
// entry import to finish before completing application startup.
void app.whenReady().then(async () => {
diagnostics.stages.push('app-ready');
window = new BrowserWindow({ width: 760, height: 680, show: false, title: 'Controlled Electron network smoke',
  webPreferences: { preload: config.preload, sandbox: true, contextIsolation: true, nodeIntegration: false, webviewTag: true, backgroundThrottling: false } });
diagnostics.stages.push('window-created');
window.webContents.on('console-message', (_event, ...args) => {
  const message = args[0] && typeof args[0] === 'object' ? args[0].message : args[1];
  if (diagnostics.console.length < 20) diagnostics.console.push(String(message).slice(0, 1500));
});
window.webContents.on('preload-error', (_event, _preload, error) => { diagnostics.preloadErrors.push(error.message.slice(0, 1500)); });
window.webContents.on('did-fail-load', (_event, code, description) => { diagnostics.stages.push(`load-failed:${code}:${description}`); });
window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
window.webContents.on('will-attach-webview', (event, preferences, params) => {
  const lease = typeof params.src === 'string' && params.src.startsWith('about:blank#') ? params.src.slice(12) : '';
  const entry = guests.leases.get(lease);
  if (!entry || entry.owner !== window.webContents || entry.attached || params.partition !== entry.partition) { event.preventDefault(); return; }
  entry.attached = true;
  for (const key of Object.keys(preferences)) if (key !== 'disablePopups') Reflect.deleteProperty(preferences, key);
  Object.assign(preferences, { partition: entry.partition, sandbox: true, contextIsolation: true, nodeIntegration: false,
    nodeIntegrationInSubFrames: false, nodeIntegrationInWorker: false, webSecurity: true, allowRunningInsecureContent: false,
    webviewTag: false, plugins: false, navigateOnDragDrop: false, disableDialogs: true, devTools: false });
});
window.webContents.on('did-attach-webview', (_event, guest) => {
  const state = { detachEvents: 0 };
  guest.debugger.on('detach', () => { state.detachEvents++; });
  guest.once('dom-ready', () => {
    const lease = guest.getURL().startsWith('about:blank#') ? guest.getURL().slice(12) : '';
    const entry = guests.leases.get(lease);
    if (!entry || entry.owner !== window.webContents || entry.guest) { guest.close({ waitForBeforeUnload: false }); return; }
    const actualPolicy = policy(guest);
    assert.equal(actualPolicy.sandbox, true); assert.equal(actualPolicy.contextIsolation, true);
    assert.equal(actualPolicy.nodeIntegration, false);
    // Electron consumes the devTools creation option and may omit it from
    // getLastWebPreferences(); the attachment preference above is always false.
    guestPolicies.push({ ...actualPolicy, configuredDevTools: false });
    entry.guest = guest; guestStates.set(lease, state);
    guest.once('destroyed', () => { if (guests.leases.get(lease) === entry) guests.leases.delete(lease); });
  });
  guest.setWindowOpenHandler(() => ({ action: 'deny' }));
  guest.on('will-navigate', (event, url) => { if (!url.startsWith(`${origin}/`) && !url.startsWith('about:blank')) event.preventDefault(); });
});
bridge = installDesktopBrowserBridge({ ipcMain, app, browserGuests: guests, assertProductSender });
assert.equal(bridge.ready, true, 'Native bridge installation failed');
diagnostics.stages.push('bridge-installed');
ipcMain.handle(fixtureChannel, async (event, payload) => {
  assertProductSender(event);
  if (!payload || typeof payload !== 'object') throw Error('Invalid fixture request');
  if (payload.operation === 'acquire') {
    const lease = randomUUID(), partition = `dsh-browser-electron-smoke-${randomUUID()}`;
    const storage = session.fromPartition(partition);
    storage.setPermissionRequestHandler((_guest, _permission, callback) => callback(false));
    storage.setPermissionCheckHandler(() => false);
    storage.on('will-download', event => event.preventDefault());
    storage.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !details.url.startsWith(`${origin}/`) && !details.url.startsWith('about:blank') && !details.url.startsWith('data:') }));
    guests.leases.set(lease, { owner: event.sender, partition, attached: false });
    return { lease, partition };
  }
  if (payload.operation === 'release') return guests.release(event.sender, payload.lease);
  if (payload.operation === 'debug-state' || payload.operation === 'occupy-debugger') {
    const entry = guests.leases.get(payload.lease);
    if (!entry || entry.owner !== event.sender || !entry.guest || entry.guest.isDestroyed()) throw Error('Fixture guest unavailable');
    if (payload.operation === 'occupy-debugger') entry.guest.debugger.attach('1.3');
    return { attached: entry.guest.debugger.isAttached(), detachEvents: guestStates.get(payload.lease).detachEvents };
  }
  if (payload.operation === 'finish') {
    const report = payload.report;
    if (!report || !Array.isArray(report.checks) || !Array.isArray(report.failures) || Buffer.byteLength(JSON.stringify(report)) > 200000) throw Error('Invalid fixture report');
    setImmediate(() => { void finish(report, report.failures.length ? 1 : 0); });
    return { finishing: true };
  }
  throw Error('Unsupported fixture operation');
});
window.webContents.on('render-process-gone', (_event, details) => { void finish({ checks: [], failures: [{ name: 'fixture renderer', error: details.reason }] }, 1); });
diagnostics.stages.push('loading-owner');
await window.loadURL(`${origin}/owner`);
diagnostics.stages.push('owner-loaded');
}).catch(error => { void finish({ checks: [], failures: [{ name: 'fixture startup', error: error.message }] }, 1); });
