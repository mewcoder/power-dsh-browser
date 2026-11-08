import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';
import { TARGET, MODULES, MAIN_IMPORT, GUEST_ANCHOR, ASSERT_ANCHOR, PRELOAD_ANCHOR, FUSE_MARKER, sha256, encodeAsar, parseAsar, entryBytes, patchArchive, transformHost, verifyPatch, inspectFuses, verifyInfo } from '../scripts/desktop-bridge-patch.mjs';
import { check, prepare, install, guardPath, runningProcesses, parseArgs } from '../scripts/desktop-bridge.mjs';

const main = Buffer.from(`${MAIN_IMPORT}\nfunction desktopMain() {\n${GUEST_ANCHOR}\n${ASSERT_ANCHOR}\n}\n`);
const preload = Buffer.from(`function createDesktopBrowserBridge() {\n${PRELOAD_ANCHOR}\n\t};\n}\n`);
const target = { ...TARGET, main: sha256(main), preload: sha256(preload) };
const payload = Object.fromEntries(MODULES.map(name => [name, Buffer.from(`// ${name}\n`)]));
const pkg = { name: TARGET.name, version: TARGET.version, dshDesktopAppId: TARGET.appId, dshBuildCommit: TARGET.build, dshBuildDirty: false, main: 'lib/main.js', type: 'module' };
function archive({ mainBytes = main, preloadBytes = preload, packageJson = pkg } = {}) {
  const files = [['package.json', Buffer.from(JSON.stringify(packageJson))], ['main.js', mainBytes], ['preload-app.cjs', preloadBytes], ['untouched.txt', Buffer.from('original bytes\0\n')]];
  let offset = 0;
  const nodes = files.map(([name, bytes]) => { const node = { size: bytes.length, offset: String(offset) }; offset += bytes.length; return [name, node]; });
  return encodeAsar({ files: { 'package.json': nodes[0][1], lib: { files: { 'main.js': nodes[1][1], 'preload-app.cjs': nodes[2][1] } }, 'untouched.txt': { ...nodes[3][1], executable: true }, alias: { link: 'untouched.txt' }, external: { size: 3, unpacked: true }, empty: { files: {}, unpacked: true } } }, Buffer.concat(files.map(([, bytes]) => bytes)));
}
const fuseBytes = () => Buffer.concat([Buffer.from('framework'), FUSE_MARKER, Buffer.from([1, 9, 49, 48, 49, 49, 48, 48, 48, 49, 49])]);
const info = hash => ({ CFBundleIdentifier: TARGET.appId, CFBundleExecutable: TARGET.executable, CFBundleShortVersionString: TARGET.version, ElectronAsarIntegrity: { 'Resources/app.asar': { algorithm: 'SHA256', hash } } });
function fixture() {
  // realpath resolves macOS /var -> /private/var before the installer guards paths.
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-bridge-test-')));
  const app = path.join(root, 'DeepSeek Harness.app'), resources = path.join(app, 'Contents/Resources');
  const framework = path.join(app, 'Contents/Frameworks/Electron Framework.framework/Versions/A');
  fs.mkdirSync(resources, { recursive: true }); fs.mkdirSync(framework, { recursive: true });
  const original = archive(), filename = path.join(resources, 'app.asar');
  fs.writeFileSync(filename, original, { mode: 0o640 });
  fs.writeFileSync(path.join(app, 'Contents/Info.plist'), 'fixture plist');
  fs.writeFileSync(path.join(framework, 'Electron Framework'), fuseBytes());
  fs.mkdirSync(`${filename}.unpacked`); fs.writeFileSync(path.join(`${filename}.unpacked`, 'external'), 'out');
  const nativeDir = path.join(root, 'native'); fs.mkdirSync(nativeDir);
  for (const [name, bytes] of Object.entries(payload)) fs.writeFileSync(path.join(nativeDir, name), bytes);
  const stateDir = path.join(root, 'state');
  const services = { target, plist: () => info(parseAsar(original).headerHash), processes: () => [] };
  return { root, app, filename, nativeDir, stateDir, services, original };
}
// Fixtures intentionally remain under their unique OS temporary paths: no recursive deletion of computed paths.

test('ASAR framing uses 8 + header size and rejects unsafe bounded fields', () => {
  const bytes = archive(), parsed = parseAsar(bytes);
  assert.equal(parsed.dataOffset, 8 + bytes.readUInt32LE(4));
  assert.equal(entryBytes(parsed, 'lib/main.js').toString(), main.toString());
  const oversized = Buffer.from(bytes); oversized.writeUInt32LE(0xffffffff, 4);
  assert.throws(() => parseAsar(oversized), /header/);
  assert.throws(() => parseAsar(encodeAsar({ files: { '..': { size: 0, offset: '0' } } }, Buffer.alloc(0))), /Unsafe/);
  assert.throws(() => parseAsar(encodeAsar({ files: { bad: { size: 10, offset: '9007199254740992' } } }, Buffer.alloc(0))), /outside/);
  assert.throws(() => parseAsar(encodeAsar({ files: { bad: { link: '../escape' } } }, Buffer.alloc(0))), /Unsafe/);
});
test('patch preserves every untouched byte, link, empty directory and unpacked entry', () => {
  const original = archive(), before = parseAsar(original), { patched, changes } = patchArchive(original, payload, target), after = parseAsar(patched);
  assert.equal(changes.length, 2 + MODULES.length); assert.equal(after.entries.size, before.entries.size + MODULES.length + 1);
  assert.deepEqual(after.entries.get('alias'), before.entries.get('alias'));
  assert.deepEqual(after.entries.get('external'), before.entries.get('external'));
  assert.deepEqual(after.entries.get('empty'), before.entries.get('empty'));
  assert.deepEqual(after.entries.get('untouched.txt'), before.entries.get('untouched.txt'));
  assert.deepEqual(entryBytes(after, 'untouched.txt'), entryBytes(before, 'untouched.txt'));
  for (const name of MODULES) assert.deepEqual(entryBytes(after, `lib/dsh-browser-bridge/${name}`), payload[name]);
  assert.match(entryBytes(after, 'lib/main.js').toString(), /try \{[\s\S]+installDesktopBrowserBridge\(\{ ipcMain, app, browserGuests, assertProductSender \}\)/);
  assert.match(entryBytes(after, 'lib/preload-app.cjs').toString(), /network: __dshBrowserNetworkFactory\(electron.ipcRenderer\)/);
  assert.match(entryBytes(after, 'lib/preload-app.cjs').toString(), /cap: __dshBrowserCapFactory\(electron.ipcRenderer\)/);
  assert.doesNotMatch(entryBytes(after, 'lib/preload-app.cjs').toString(), /require\s*\(/);
  assert.equal(verifyPatch(original, patched, target), true);
  const tampered = Buffer.from(patched); tampered[after.dataOffset + Number(after.entries.get('untouched.txt').offset)] ^= 1;
  assert.throws(() => verifyPatch(original, tampered, target), /Untouched ASAR bytes/);
});
test('inlined real CJS preload runs in a sandbox that refuses relative require and preserves JSON IPC contract', async () => {
  const cjs = fs.readFileSync(new URL('../native/preload-network.cjs', import.meta.url));
  const capCjs = fs.readFileSync(new URL('../native/preload-cap.cjs', import.meta.url));
  const { patched } = patchArchive(archive(), { ...payload, 'preload-network.cjs': cjs, 'preload-cap.cjs': capCjs }, target);
  const code = entryBytes(parseAsar(patched), 'lib/preload-app.cjs').toString();
  assert.doesNotMatch(code, /require\s*\(/);
  assert.doesNotMatch(code, /\beval\s*\(|new Function\s*\(/);
  assert.equal(code.split('// dsh-browser-network-factory:v1:start').length, 2);
  assert.equal(code.split('// dsh-browser-cap-factory:v1:start').length, 2);
  const requires = [], calls = [], listeners = [];
  const context = vm.createContext({ TextEncoder });
  context.require = name => {
    requires.push(name);
    if (name !== 'electron') throw Error(`Sandbox refuses local module ${name}`);
    return { ipcRenderer: {
      on: (...args) => listeners.push(args),
      invoke: async (channel, request) => {
        calls.push({ channel, request: JSON.parse(JSON.stringify(request)) });
        return vm.runInContext('({ ok: true, value: { protocolVersion: 1, ready: true } })', context);
      },
    } };
  };
  vm.runInContext(`const electron = require('electron'); const DESKTOP_IPC = {browserOpenRequested:'open',browserAcquire:'acquire'};\n${code}\nglobalThis.bridge = createDesktopBrowserBridge();`, context);
  assert.deepEqual(requires, ['electron']); assert.equal(calls.length, 0);
  assert.equal(listeners.length, 0); // Network factory installs no subscriptions.
  assert.equal(vm.runInContext('bridge.network.protocolVersion', context), 1);
  assert.equal(vm.runInContext('bridge.cap.protocolVersion', context), 1);
  assert.deepEqual(JSON.parse(JSON.stringify(await vm.runInContext('bridge.network.request({operation:"status",lease:"owned-test"})', context))), { ok: true, value: { protocolVersion: 1, ready: true } });
  assert.deepEqual(calls, [{ channel: 'dsh-browser:network:v1', request: { operation: 'status', lease: 'owned-test' } }]);
  const invalid = await vm.runInContext('bridge.network.request({operation:"unknown",lease:"owned-test"})', context);
  assert.equal(invalid.ok, false); assert.equal(calls.length, 1);
  assert.throws(() => patchArchive(archive(), { ...payload, 'preload-network.cjs': Buffer.from("require('./local.cjs')") }, target), /self-contained/);
});
test('exact allowlist, host anchors, version/build and unsafe injection fail closed', () => {
  assert.throws(() => patchArchive(archive(), payload), /SHA256/);
  assert.throws(() => patchArchive(archive({ packageJson: { ...pkg, version: '0.2.3' } }), payload, target), /identity/);
  assert.throws(() => patchArchive(archive({ packageJson: { ...pkg, dshBuildDirty: true } }), payload, target), /identity/);
  assert.throws(() => patchArchive(archive({ mainBytes: Buffer.concat([main, Buffer.from('changed')]) }), payload, target), /SHA256/);
  assert.throws(() => transformHost(Buffer.from(main.toString().replace('return mainWindow;', 'return other;')), preload, payload['preload-network.cjs'], payload['preload-cap.cjs']), /anchor/);
  assert.throws(() => transformHost(Buffer.concat([main, Buffer.from(ASSERT_ANCHOR)]), preload, payload['preload-network.cjs'], payload['preload-cap.cjs']), /ambiguous/);
  assert.throws(() => transformHost(main, Buffer.concat([preload, Buffer.from(PRELOAD_ANCHOR)]), payload['preload-network.cjs'], payload['preload-cap.cjs']), /ambiguous/);
  const parsed = parseAsar(archive()); parsed.header.files.lib = { link: 'empty' };
  assert.throws(() => patchArchive(encodeAsar(parsed.header, Buffer.alloc(0)), payload, target));
  assert.throws(() => patchArchive(archive(), { ...payload, '../escape': Buffer.from('bad') }, target), /modules required|four/);
});
test('fuse and Info.plist inspection refuses unknown or enabled integrity', () => {
  assert.equal(inspectFuses(fuseBytes()).embeddedAsarIntegrity, false);
  for (const index of [4, 5]) {
    const enabled = fuseBytes(); enabled[Buffer.byteLength('framework') + FUSE_MARKER.length + 2 + index] = 49;
    assert.throws(() => inspectFuses(enabled), /Unsupported/);
  }
  assert.throws(() => inspectFuses(Buffer.concat([fuseBytes(), FUSE_MARKER])), /marker/);
  const unknown = fuseBytes(); unknown[Buffer.byteLength('framework') + FUSE_MARKER.length] = 2;
  assert.throws(() => inspectFuses(unknown), /version/);
  assert.throws(() => verifyInfo(info('old'), 'new'), /integrity/);
  assert.throws(() => verifyInfo({ ...info('same'), CFBundleIdentifier: 'other' }, 'same'), /identity/);
});
test('check is read only; prepare while running writes only outside app and never overwrites backup', () => {
  const f = fixture(), services = { ...f.services, processes: () => [{ pid: 42 }] };
  const metadata = fs.statSync(f.filename);
  assert.equal(check({ app: f.app }, services).running[0].pid, 42);
  assert.equal(fs.existsSync(f.stateDir), false);
  const first = prepare(f, services), second = prepare(f, services);
  assert.notEqual(first.manifest, second.manifest);
  assert.equal(first.applicationModified, false); assert.deepEqual(fs.readFileSync(f.filename), f.original);
  assert.deepEqual(fs.readFileSync(first.backup), f.original);
  assert.equal(fs.statSync(f.filename).mtimeMs, metadata.mtimeMs);
  assert.equal(fs.readFileSync(`${f.filename}.unpacked/external`, 'utf8'), 'out');
  assert.deepEqual(fs.readdirSync(path.dirname(f.filename)).sort(), ['app.asar', 'app.asar.unpacked']);
});
test('apply refuses running process before any app write; second process check catches launch race', () => {
  const f = fixture(), prepared = prepare(f, f.services);
  assert.throws(() => install({ app: f.app, manifest: prepared.manifest }, { ...f.services, processes: () => [{ pid: 123 }] }), /running/);
  assert.deepEqual(fs.readdirSync(path.dirname(f.filename)).sort(), ['app.asar', 'app.asar.unpacked']);
  let checks = 0;
  assert.throws(() => install({ app: f.app, manifest: prepared.manifest }, { ...f.services, processes: () => ++checks > 1 ? [{ pid: 124 }] : [] }), /running/);
  assert.deepEqual(fs.readFileSync(f.filename), f.original);
});
test('apply and restore atomically preserve mode, backup, unpacked files and receipts', () => {
  const f = fixture(), prepared = prepare(f, f.services), permissions = fs.statSync(f.filename).mode & 0o7777;
  const applied = install({ app: f.app, manifest: prepared.manifest }, f.services);
  assert.equal(applied.mode, 'apply'); assert.equal(sha256(fs.readFileSync(f.filename)), prepared.patchedSha256);
  assert.equal(fs.statSync(f.filename).mode & 0o7777, permissions);
  assert.ok(fs.existsSync(applied.receipt));
  assert.equal(check({ app: f.app, manifest: prepared.manifest }, f.services).state, 'installed');
  assert.throws(() => install({ app: f.app, manifest: prepared.manifest }, f.services), /changed since preparation/);
  const restored = install({ app: f.app, manifest: prepared.manifest, restore: true }, f.services);
  assert.equal(restored.mode, 'restore'); assert.deepEqual(fs.readFileSync(f.filename), f.original);
  assert.deepEqual(fs.readFileSync(prepared.backup), f.original);
  assert.equal(fs.statSync(f.filename).mode & 0o7777, permissions);
  assert.equal(fs.readFileSync(`${f.filename}.unpacked/external`, 'utf8'), 'out');
  assert.throws(() => install({ app: f.app, manifest: prepared.manifest, restore: true }, f.services), /not the manifest-owned/);
});
test('restore refuses externally changed archive; apply refuses changed companion, metadata or backup', () => {
  const f = fixture(), prepared = prepare(f, f.services);
  install({ app: f.app, manifest: prepared.manifest }, f.services);
  const changed = fs.readFileSync(f.filename); changed[changed.length - 1] ^= 1; fs.writeFileSync(f.filename, changed);
  assert.throws(() => install({ app: f.app, manifest: prepared.manifest, restore: true }, f.services), /not the manifest-owned/);
  assert.deepEqual(fs.readFileSync(f.filename), changed);
  const g = fixture(), stage = prepare(g, g.services);
  fs.writeFileSync(`${g.filename}.unpacked/external`, 'new');
  assert.throws(() => install({ app: g.app, manifest: stage.manifest }, g.services), /companion/);
  fs.writeFileSync(`${g.filename}.unpacked/external`, 'out');
  fs.writeFileSync(path.join(g.app, 'Contents/Info.plist'), 'changed plist');
  assert.throws(() => install({ app: g.app, manifest: stage.manifest }, g.services), /plist/);
  fs.writeFileSync(stage.backup, Buffer.from('corrupt'));
  assert.throws(() => install({ app: g.app, manifest: stage.manifest }, g.services), /SHA256/);
  assert.deepEqual(fs.readFileSync(g.filename), g.original);
});
test('symlink app, source, state and target paths are refused', () => {
  const f = fixture(), alias = path.join(f.root, 'Alias.app'); fs.symlinkSync(f.app, alias);
  assert.throws(() => check({ app: alias }, f.services), /Symlink/);
  const state = path.join(f.root, 'state-link'); fs.symlinkSync(f.nativeDir, state);
  assert.throws(() => prepare({ ...f, stateDir: state }, f.services), /Symlink/);
  assert.throws(() => prepare({ ...f, stateDir: path.join(f.app, 'state') }, f.services), /outside/);
  const fileLink = path.join(f.root, 'file-link'); fs.symlinkSync(f.filename, fileLink);
  assert.throws(() => guardPath(fileLink), /Symlink/);
  const nativeLinks = path.join(f.root, 'native-links'); fs.mkdirSync(nativeLinks);
  for (const name of MODULES) fs.symlinkSync(path.join(f.nativeDir, name), path.join(nativeLinks, name));
  assert.throws(() => prepare({ ...f, nativeDir: nativeLinks }, f.services), /Symlink/);
  const otherApp = path.join(f.root, 'Other.app'); fs.mkdirSync(path.join(otherApp, 'Contents/Resources'), { recursive: true });
  fs.symlinkSync(f.filename, path.join(otherApp, 'Contents/Resources/app.asar'));
  assert.throws(() => check({ app: otherApp }, f.services), /Symlink/);
  assert.throws(() => guardPath(`${f.root}/../escape`), /normalized/);
});
test('syntax-invalid payload refuses preparation before any state write', () => {
  const f = fixture(); fs.writeFileSync(path.join(f.nativeDir, MODULES[0]), 'export function broken( {');
  assert.throws(() => prepare(f, f.services), /syntax check failed/);
  assert.equal(fs.existsSync(f.stateDir), false); assert.deepEqual(fs.readFileSync(f.filename), f.original);
});
test('superseded preparation cannot be applied even when hashes still match', () => {
  const f = fixture(), prepared = prepare(f, f.services);
  fs.writeFileSync(path.join(path.dirname(prepared.manifest), 'SUPERSEDED.json'), '{"reason":"replaced"}');
  assert.throws(() => install({ app: f.app, manifest: prepared.manifest }, f.services), /superseded/);
  assert.deepEqual(fs.readFileSync(f.filename), f.original);
});
test('permission drift and unwritable Resources refuse replacement while preserving original bytes', () => {
  const f = fixture(), prepared = prepare(f, f.services);
  fs.chmodSync(f.filename, 0o600);
  assert.throws(() => install({ app: f.app, manifest: prepared.manifest }, f.services), /permissions/);
  assert.deepEqual(fs.readFileSync(f.filename), f.original);
  fs.chmodSync(f.filename, 0o640);
  if (process.getuid?.() !== 0 && process.platform !== 'win32') {
    const resources = path.dirname(f.filename); fs.chmodSync(resources, 0o555);
    try {
      assert.throws(() => install({ app: f.app, manifest: prepared.manifest }, f.services), /EACCES|EPERM/);
      assert.deepEqual(fs.readFileSync(f.filename), f.original);
    } finally { fs.chmodSync(resources, 0o755); }
  }
});
test('CLI defaults read only, validates explicit actions and parses executable metadata without argument matches', () => {
  assert.deepEqual(parseArgs([]), { mode: 'check', options: {} });
  assert.throws(() => parseArgs(['--apply']), /manifest/);
  assert.throws(() => parseArgs(['--prepare', '--restore']), /Choose/);
  assert.throws(() => parseArgs(['--prepare', '--manifest', '/tmp/manifest.json']), /only supported/);
  assert.deepEqual(parseArgs(['--check', '--manifest', '/tmp/manifest.json']), { mode: 'check', options: { manifest: '/tmp/manifest.json' } });
  assert.throws(() => parseArgs(['--prepare', '--app']), /Missing/);
  assert.throws(() => runningProcesses('/Applications/DeepSeek Harness.app', 'bad line'), /metadata/);
  const rows = '12 /Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness\n13 /bin/node\n';
  assert.deepEqual(runningProcesses('/Applications/DeepSeek Harness.app', rows), [{ pid: 12, executable: '/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness' }]);
  const run = spawnSync(process.execPath, ['scripts/desktop-bridge.mjs', '--apply'], { cwd: path.resolve(import.meta.dirname, '..'), encoding: 'utf8' });
  assert.equal(run.status, 1); assert.match(run.stderr, /manifest/);
});
