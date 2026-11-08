// Read-only verification of the complete, hash-pinned host preload in a fake
// Electron/DOM environment. This is an API exposure audit, not Desktop loading.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { check, guardPath } from './desktop-bridge.mjs';
import { TARGET, parseAsar, entryBytes, sha256, transformHost } from './desktop-bridge-patch.mjs';

const manifest = process.argv[2];
if (!manifest || !path.isAbsolute(manifest)) throw Error('Pass an absolute prepared manifest path.');
const verified = check({ manifest });
assert.equal(verified.supported, true);
const record = JSON.parse(fs.readFileSync(guardPath(manifest), 'utf8'));
const directory = path.dirname(manifest);
assert.equal(record.preloadStrategy, 'inline-cjs-factory-v1');
assert.equal(record.original.filename, 'original.asar');
assert.equal(record.patched.filename, 'patched.asar');
const original = parseAsar(fs.readFileSync(guardPath(path.join(directory, record.original.filename))));
const patched = parseAsar(fs.readFileSync(guardPath(path.join(directory, record.patched.filename))));
const before = entryBytes(original, 'lib/preload-app.cjs');
const after = entryBytes(patched, 'lib/preload-app.cjs');
assert.equal(sha256(before), TARGET.preload);
const root = fileURLToPath(new URL('../', import.meta.url));
const factory = fs.readFileSync(path.join(root, 'native/preload-network.cjs'));
const capFactory = fs.readFileSync(path.join(root, 'native/preload-cap.cjs'));
const expected = transformHost(entryBytes(original, 'lib/main.js'), before, factory, capFactory);
assert.equal(sha256(after), sha256(expected.preload));

function environment(source, protocol, hostname, isMainFrame) {
  const exposed = new Map(), subscriptions = [], calls = [], listeners = [];
  const element = { dataset: {}, getAttribute: () => null };
  const window = { addEventListener: (...args) => listeners.push(args) };
  const document = { documentElement: element, readyState: 'loading' };
  const ipcRenderer = {
    on: (...args) => subscriptions.push(args), off() {}, send() {},
    invoke(channel, payload) { calls.push({ channel, payload }); return Promise.resolve({ ok: true, value: { ready: true } }); },
  };
  const electron = { ipcRenderer, contextBridge: { exposeInMainWorld(name, value) { assert(!exposed.has(name)); exposed.set(name, value); } } };
  const context = vm.createContext({ location: { protocol, hostname }, process: { platform: 'darwin', isMainFrame },
    document, window, TextEncoder, require(name) { assert.equal(name, 'electron'); return electron; } });
  context.recordIpcCall = (channel, payload) => calls.push({ channel, payload });
  ipcRenderer.invoke = vm.runInContext('(channel, payload) => { recordIpcCall(channel, payload); return Promise.resolve({ok:true,value:{ready:true}}); }', context);
  new vm.Script(source.toString('utf8'), { filename: 'verified-preload-app.cjs' }).runInContext(context, { timeout: 1000 });
  return { exposed, subscriptions, calls, listeners, context };
}
const names = value => Object.keys(value).sort();
const scenarios = [
  { name: 'product main frame', protocol: 'dsh-app:', hostname: 'app', isMainFrame: true, network: true },
  { name: 'product subframe', protocol: 'dsh-app:', hostname: 'app', isMainFrame: false, network: false },
  { name: 'untrusted web origin', protocol: 'https:', hostname: 'page.test', isMainFrame: true, network: false },
  { name: 'other desktop host', protocol: 'dsh-app:', hostname: 'platform', isMainFrame: true, network: false },
];
const results = [];
for (const scenario of scenarios) {
  const old = environment(before, scenario.protocol, scenario.hostname, scenario.isMainFrame);
  const next = environment(after, scenario.protocol, scenario.hostname, scenario.isMainFrame);
  const oldApi = old.exposed.get('dshDesktop'), api = next.exposed.get('dshDesktop');
  assert.equal(api.protocolVersion, oldApi.protocolVersion);
  assert.deepEqual([...next.exposed.keys()], [...old.exposed.keys()]);
  assert.deepEqual(names(api), names(oldApi));
  assert.deepEqual(next.subscriptions.map(value => value[0]), old.subscriptions.map(value => value[0]));
  assert.equal(next.calls.length, 0);
  if (scenario.network) {
    assert.deepEqual(names(api.browser).filter(key => key !== 'network'), names(oldApi.browser));
    assert.equal(api.browser.network.protocolVersion, 1);
    assert.equal(typeof api.browser.network.request, 'function');
    await api.browser.acquire('fixture-workspace'); await api.browser.release('fixture-lease');
    assert.deepEqual(next.calls.map(value => value.channel), ['dsh-desktop:browser-acquire', 'dsh-desktop:browser-release']);
    next.context.networkApi = api.browser.network;
    const reply = await vm.runInContext('networkApi.request({operation:"status",lease:"fixture-lease"})', next.context);
    assert.equal(reply.ok, true); assert.equal(reply.value.ready, true);
    assert.equal(next.calls.at(-1).channel, 'dsh-browser:network:v1');
  } else assert.equal(api.browser, undefined);
  results.push({ scenario: scenario.name, originalApiPreserved: true, networkExposed: !!api.browser?.network,
    extraSubscriptions: next.subscriptions.length - old.subscriptions.length, relativeRequireUsed: false });
}
const report = { kind: 'full-preload-api-exposure-audit', scope: 'VM with fake Electron/DOM; not installed Desktop acceptance',
  originalPreloadSha256: sha256(before), patchedPreloadSha256: sha256(after), applicationState: verified.state, scenarios: results };
const output = path.join(directory, 'preload-audit.json');
fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify(report, null, 2));
console.log('Audit report:', output);
