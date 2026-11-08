import { createHash } from 'node:crypto';

export const TARGET = Object.freeze({
  name: '@deepseek-ai/dsh-desktop', appId: 'com.deepseek.dsh', executable: 'DeepSeek Harness',
  version: '0.2.2-rc.1', build: 'c59d10aff167ad7eefead4b3a9082fb57c8fbfe8',
  main: 'f42ed25b0b844a63e515a3aff93dee89b781dae7fcbbbbfc93e04d95ad399ec1',
  preload: 'd6126b3555fcb679f79922c23976025ab260a08f98bc2d20984e112ded397b96',
});
export const MODULES = Object.freeze(['desktop-browser-bridge.js', 'preload-network.cjs', 'preload-cap.cjs', 'lease-network-service.js', 'network-recorder.js']);
export const MAIN_IMPORT = 'import { createRequire } from "node:module";';
export const GUEST_ANCHOR = '\tconst browserGuests = new DesktopBrowserGuests(() => hostUrl);';
export const ASSERT_ANCHOR = '\tconst assertProductSender = (event) => {\n\t\tassertDesktopSender(event, ["app"]);\n\t\tif (mainWindow === void 0 || mainWindow.isDestroyed() || event.sender !== mainWindow.webContents || event.senderFrame === null || event.senderFrame !== mainWindow.webContents.mainFrame) throw new Error("dsh desktop: rejected IPC from an unowned renderer");\n\t\treturn mainWindow;\n\t};';
export const PRELOAD_ANCHOR = '\treturn {\n\t\tacquire: (workspace) => electron.ipcRenderer.invoke(DESKTOP_IPC.browserAcquire, workspace),';
export const sha256 = value => createHash('sha256').update(value).digest('hex');
const fail = message => { throw new Error(message); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const safeInt = value => Number.isSafeInteger(value) && value >= 0;
export function archivePath(value) {
  if (typeof value !== 'string' || !value || value.length > 4096 || value.includes('\\') || /[\u0000-\u001f]/u.test(value)
    || value.split('/').some(part => !part || part === '.' || part === '..')) fail('Unsafe ASAR path');
  return value;
}

/** Read Chromium pickle framing: payload starts at 8 + headerSize, not 16 + JSON length. */
export function parseAsar(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 16 || buffer.readUInt32LE(0) !== 4) fail('Invalid ASAR prefix');
  const headerSize = buffer.readUInt32LE(4), jsonSize = buffer.readUInt32LE(12);
  if (headerSize < 8 || headerSize > 64 * 1024 * 1024 || headerSize % 4 !== 0 || headerSize + 8 > buffer.length
    || buffer.readUInt32LE(8) !== headerSize - 4 || jsonSize > headerSize - 8 || jsonSize < 2
    || headerSize - 8 - jsonSize > 3) fail('Invalid or oversized ASAR header');
  const headerJson = buffer.subarray(16, 16 + jsonSize);
  const header = JSON.parse(headerJson.toString('utf8'));
  if (!object(header) || !object(header.files)) fail('Invalid ASAR root');
  const dataOffset = 8 + headerSize, entries = new Map();
  let count = 0;
  function walk(files, prefix = '', depth = 0) {
    if (depth > 128) fail('ASAR directory depth exceeded');
    for (const [name, node] of Object.entries(files)) {
      if (++count > 500000) fail('ASAR entry limit exceeded');
      archivePath(name); if (name.includes('/')) fail('Invalid ASAR entry name');
      const key = prefix + name; archivePath(key);
      if (!object(node)) fail('Invalid ASAR entry');
      entries.set(key, node);
      if ('files' in node) {
        if (!object(node.files) || 'link' in node || 'offset' in node || 'size' in node) fail('Invalid ASAR directory');
        walk(node.files, `${key}/`, depth + 1);
      } else if ('link' in node) {
        archivePath(node.link);
        if ('size' in node || 'offset' in node) fail('Invalid ASAR link');
      } else {
        if (!safeInt(node.size)) fail('Invalid ASAR entry size');
        if (node.unpacked === true) continue;
        if (typeof node.offset !== 'string' || !/^(0|[1-9][0-9]*)$/u.test(node.offset)) fail('Invalid ASAR offset');
        const offset = Number(node.offset);
        if (!safeInt(offset) || !safeInt(offset + node.size) || offset + node.size > buffer.length - dataOffset) fail('ASAR entry outside payload');
      }
    }
  }
  walk(header.files);
  return { buffer, header, headerJson, headerHash: sha256(headerJson), dataOffset, entries };
}
export function entryBytes(archive, name) {
  const node = archive.entries.get(archivePath(name));
  if (!node || node.files || node.link || node.unpacked) fail(`Expected packed regular ASAR file: ${name}`);
  const start = archive.dataOffset + Number(node.offset);
  return archive.buffer.subarray(start, start + node.size);
}
export function encodeAsar(header, payload) {
  const json = Buffer.from(JSON.stringify(header)), padded = Math.ceil((json.length + 4) / 4) * 4;
  if (padded + 4 > 64 * 1024 * 1024) fail('ASAR header too large');
  const prefix = Buffer.alloc(12 + padded);
  prefix.writeUInt32LE(4, 0); prefix.writeUInt32LE(padded + 4, 4);
  prefix.writeUInt32LE(padded, 8); prefix.writeUInt32LE(json.length, 12); json.copy(prefix, 16);
  return Buffer.concat([prefix, payload]);
}
function integrity(bytes, blockSize = 4194304) {
  if (!safeInt(blockSize) || blockSize < 1 || blockSize > 64 * 1024 * 1024) fail('Unsupported integrity block size');
  const blocks = [];
  for (let i = 0; i < bytes.length; i += blockSize) blocks.push(sha256(bytes.subarray(i, i + blockSize)));
  if (bytes.length === 0) blocks.push(sha256(bytes));
  return { algorithm: 'SHA256', hash: sha256(bytes), blockSize, blocks };
}
function once(source, anchor, replacement) {
  const start = source.indexOf(anchor);
  if (start < 0 || source.indexOf(anchor, start + anchor.length) >= 0) fail('Host patch anchor missing or ambiguous');
  return source.slice(0, start) + replacement + source.slice(start + anchor.length);
}
export function verifyHost(archive, target = TARGET) {
  const pkg = JSON.parse(entryBytes(archive, 'package.json').toString('utf8'));
  if (pkg.name !== target.name || pkg.dshDesktopAppId !== target.appId || pkg.version !== target.version
    || pkg.dshBuildCommit !== target.build || pkg.dshBuildDirty !== false || pkg.type !== 'module' || pkg.main !== 'lib/main.js') fail('Unsupported Desktop identity/version/build');
  const main = entryBytes(archive, 'lib/main.js'), preload = entryBytes(archive, 'lib/preload-app.cjs');
  if (sha256(main) !== target.main || sha256(preload) !== target.preload) fail('Unsupported host source SHA256');
  return { pkg, main, preload };
}
export function transformHost(mainBytes, preloadBytes, preloadNetwork, preloadCap) {
  let main = mainBytes.toString('utf8'), preload = preloadBytes.toString('utf8');
  if (!main.startsWith(`${MAIN_IMPORT}\n`)) fail('Host ESM import anchor changed');
  once(main, GUEST_ANCHOR, GUEST_ANCHOR);
  if (main.indexOf(GUEST_ANCHOR) > main.indexOf(ASSERT_ANCHOR)) fail('Host closure anchor order changed');
  main = once(main, MAIN_IMPORT, `${MAIN_IMPORT}\nimport { installDesktopBrowserBridge } from "./dsh-browser-bridge/desktop-browser-bridge.js";`);
  main = once(main, ASSERT_ANCHOR, `${ASSERT_ANCHOR}\n\ttry {\n\t\tconst browserBridge = installDesktopBrowserBridge({ ipcMain, app, browserGuests, assertProductSender });\n\t\tif (!browserBridge?.ready) console.error("DSH browser bridge installation unavailable");\n\t} catch (error) {\n\t\tconsole.error("DSH browser bridge installation failed", error);\n\t}`);
  const factory = 'function createDesktopBrowserBridge() {';
  once(preload, factory, factory);
  if (preload.indexOf(factory) > preload.indexOf(PRELOAD_ANCHOR)) fail('Preload factory anchor order changed');
  for (const [label, buf] of [['network', preloadNetwork], ['cap', preloadCap]]) {
    if (!Buffer.isBuffer(buf) || !buf.length || /\brequire\s*\(/u.test(buf.toString('utf8'))) fail(`Sandbox preload ${label} factory must be self-contained CJS source`);
  }
  // Electron sandbox preloads cannot require relative modules. Inline the exact
  // trusted CJS payloads in lexical CommonJS wrappers; static code, no eval.
  const networkSource = `// dsh-browser-network-factory:v1:start\nconst __dshBrowserNetworkFactory = (() => {\n\tconst module = { exports: {} };\n\tconst exports = module.exports;\n${preloadNetwork.toString('utf8')}\n\treturn module.exports.createDesktopNetworkBridge;\n})();\n// dsh-browser-network-factory:v1:end\n`;
  const capSource = `// dsh-browser-cap-factory:v1:start\nconst __dshBrowserCapFactory = (() => {\n\tconst module = { exports: {} };\n\tconst exports = module.exports;\n${preloadCap.toString('utf8')}\n\treturn module.exports.createDesktopCapBridge;\n})();\n// dsh-browser-cap-factory:v1:end\n`;
  preload = once(preload, factory, `${networkSource}${capSource}${factory}`);
  preload = once(preload, PRELOAD_ANCHOR, '\treturn {\n\t\tnetwork: __dshBrowserNetworkFactory(electron.ipcRenderer),\n\t\tcap: __dshBrowserCapFactory(electron.ipcRenderer),\n\t\tacquire: (workspace) => electron.ipcRenderer.invoke(DESKTOP_IPC.browserAcquire, workspace),');
  return { main: Buffer.from(main), preload: Buffer.from(preload) };
}
/** Retain every old payload byte/offset and all untouched metadata; append only replacement files. */
export function patchArchive(original, modules, target = TARGET) {
  const archive = parseAsar(original), host = verifyHost(archive, target);
  if (archive.entries.has('lib/dsh-browser-bridge')) fail('Bridge destination already exists');
  if (!archive.entries.get('lib')?.files || archive.entries.get('lib').unpacked) fail('Unsafe bridge parent');
  if (!object(modules) || Object.keys(modules).length !== MODULES.length || MODULES.some(name => !Buffer.isBuffer(modules[name]) || !modules[name].length)) fail('All nonempty bridge modules required');
  const sources = transformHost(host.main, host.preload, modules['preload-network.cjs'], modules['preload-cap.cjs']);
  const changes = new Map([['lib/main.js', sources.main], ['lib/preload-app.cjs', sources.preload], ...MODULES.map(name => [`lib/dsh-browser-bridge/${name}`, modules[name]])]);
  const header = structuredClone(archive.header), chunks = [original.subarray(archive.dataOffset)];
  let offset = chunks[0].length;
  for (const [key, bytes] of changes) {
    archivePath(key);
    const parts = key.split('/'); let dir = header;
    for (const part of parts.slice(0, -1)) {
      const next = dir.files[part];
      if (next && (!next.files || next.link || next.unpacked)) fail('Bridge injection traverses non-directory');
      if (!next) Object.defineProperty(dir.files, part, { value: { files: {} }, enumerable: true, writable: true, configurable: true });
      dir = dir.files[part];
    }
    const name = parts.at(-1), old = dir.files[name];
    if (old?.unpacked || old?.link || old?.files) fail('Cannot replace non-packed host file');
    dir.files[name] = { ...old, size: bytes.length, offset: String(offset), integrity: integrity(bytes, old?.integrity?.blockSize) };
    chunks.push(bytes); offset += bytes.length;
  }
  const patched = encodeAsar(header, Buffer.concat(chunks));
  verifyPatch(original, patched, target);
  return { patched, changes: [...changes].map(([path, bytes]) => ({ path, sha256: sha256(bytes), size: bytes.length })) };
}
export function verifyPatch(original, patched, target = TARGET) {
  const before = parseAsar(original), after = parseAsar(patched), host = verifyHost(before, target);
  const transformed = transformHost(host.main, host.preload, entryBytes(after, 'lib/dsh-browser-bridge/preload-network.cjs'), entryBytes(after, 'lib/dsh-browser-bridge/preload-cap.cjs'));
  const changed = new Set(['lib/main.js', 'lib/preload-app.cjs']);
  for (const [name, node] of before.entries) {
    const next = after.entries.get(name);
    if (!next) fail(`Original ASAR entry removed: ${name}`);
    if (changed.has(name)) {
      if (!entryBytes(after, name).equals(name.endsWith('main.js') ? transformed.main : transformed.preload)) fail('Host transform differs');
      const omit = item => Object.fromEntries(Object.entries(item).filter(([key]) => !['size', 'offset', 'integrity'].includes(key)));
      if (JSON.stringify(omit(node)) !== JSON.stringify(omit(next))) fail('Host metadata changed');
    } else if (!node.files) {
      if (JSON.stringify(node) !== JSON.stringify(next)) fail(`Untouched ASAR metadata changed: ${name}`);
      if (!node.link && !node.unpacked && !entryBytes(before, name).equals(entryBytes(after, name))) fail(`Untouched ASAR bytes changed: ${name}`);
    } else {
      const omit = item => Object.fromEntries(Object.entries(item).filter(([key]) => key !== 'files'));
      if (JSON.stringify(omit(node)) !== JSON.stringify(omit(next))) fail('Directory metadata changed');
    }
  }
  const added = ['lib/dsh-browser-bridge', ...MODULES.map(name => `lib/dsh-browser-bridge/${name}`)];
  for (const name of after.entries.keys()) if (!before.entries.has(name) && !added.includes(name)) fail(`Unexpected ASAR addition: ${name}`);
  for (const name of added) if (before.entries.has(name) || !after.entries.has(name)) fail('Bridge addition mismatch');
  for (const name of [...changed, ...added.slice(1)]) {
    const bytes = entryBytes(after, name), node = after.entries.get(name);
    if (JSON.stringify(node.integrity) !== JSON.stringify(integrity(bytes, node.integrity?.blockSize))) fail('Patched entry integrity mismatch');
  }
  // The original payload includes unreachable old host bytes; preserve these too.
  if (!patched.subarray(after.dataOffset, after.dataOffset + original.length - before.dataOffset).equals(original.subarray(before.dataOffset))) fail('Original payload changed');
  return true;
}

export const FUSE_MARKER = Buffer.from('dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX');
export function inspectFuses(binary) {
  const index = binary.indexOf(FUSE_MARKER), start = index + FUSE_MARKER.length;
  if (index < 0 || binary.indexOf(FUSE_MARKER, index + 1) >= 0 || start + 2 > binary.length) fail('Unsupported Electron fuse marker');
  const version = binary[start], count = binary[start + 1];
  if (version !== 1 || count !== 9 || start + 2 + count > binary.length) fail('Unsupported Electron fuse wire version/count');
  const states = [...binary.subarray(start + 2, start + 2 + count)];
  if (states.some(value => ![48, 49, 114].includes(value)) || states[4] !== 48 || states[5] !== 48) fail('Unsupported Electron integrity/ASAR-only fuse state; no patch supported');
  return { version, states, embeddedAsarIntegrity: false, onlyLoadAppFromAsar: false };
}
export function verifyInfo(info, headerHash, target = TARGET) {
  if (!object(info) || info.CFBundleIdentifier !== target.appId || info.CFBundleExecutable !== target.executable
    || info.CFBundleShortVersionString !== target.version) fail('Unsupported application bundle identity');
  const record = info.ElectronAsarIntegrity?.['Resources/app.asar'];
  if (!object(record) || record.algorithm !== 'SHA256' || record.hash !== headerHash) fail('Unsupported Info.plist ASAR integrity declaration');
  return { bundleId: info.CFBundleIdentifier, executable: info.CFBundleExecutable, version: info.CFBundleShortVersionString, declaredHeaderHash: record.hash };
}
