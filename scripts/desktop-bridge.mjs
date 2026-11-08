#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { TARGET, MODULES, sha256, parseAsar, entryBytes, verifyHost, verifyPatch, patchArchive, inspectFuses, verifyInfo } from './desktop-bridge-patch.mjs';

const PROJECT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_APP = '/Applications/DeepSeek Harness.app';
const fail = message => { throw new Error(message); };
const json = value => `${JSON.stringify(value, null, 2)}\n`;
const within = (parent, child) => child === parent || child.startsWith(`${parent}${path.sep}`);
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);

/** Reject symlinks at every existing component, including ancestors. No realpath redirection. */
export function guardPath(input, { missing = false, directory = false } = {}) {
  if (!path.isAbsolute(input) || path.resolve(input) !== input) fail('Expected normalized absolute path');
  let current = path.parse(input).root;
  for (const part of input.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    let stat;
    try { stat = fs.lstatSync(current); } catch (error) {
      if (error.code === 'ENOENT' && missing) return input;
      throw error;
    }
    if (stat.isSymbolicLink()) fail(`Symlink path refused: ${current}`);
    if (current !== input && !stat.isDirectory()) fail('Path ancestor is not a directory');
    if (current === input && (directory ? !stat.isDirectory() : !stat.isFile())) fail('Unexpected path type');
  }
  return input;
}
function readRegular(filename) {
  guardPath(filename);
  const fd = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try { if (!fs.fstatSync(fd).isFile()) fail('Expected regular file'); return fs.readFileSync(fd); }
  finally { fs.closeSync(fd); }
}
function newFile(filename, bytes, mode = 0o600) {
  guardPath(filename, { missing: true });
  const fd = fs.openSync(filename, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, mode);
  try { fs.writeFileSync(fd, bytes); fs.fchmodSync(fd, mode); fs.fsyncSync(fd); }
  finally { fs.closeSync(fd); }
}
function syncDirectory(dirname) {
  const fd = fs.openSync(guardPath(dirname, { directory: true }), fs.constants.O_RDONLY);
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
function mkdirSafe(dirname) {
  guardPath(dirname, { missing: true, directory: true });
  fs.mkdirSync(dirname, { recursive: true, mode: 0o700 });
  guardPath(dirname, { directory: true });
}
function paths(app) {
  if (!path.isAbsolute(app) || path.resolve(app) !== app || !app.endsWith('.app')) fail('Use a normalized absolute .app bundle path');
  guardPath(app, { directory: true });
  return {
    app, archive: path.join(app, 'Contents/Resources/app.asar'),
    info: path.join(app, 'Contents/Info.plist'),
    framework: path.join(app, 'Contents/Frameworks/Electron Framework.framework/Versions/A/Electron Framework'),
  };
}
function plist(filename) {
  // plutil only decodes metadata; it never launches the bundle or changes the plist.
  guardPath(filename);
  if (process.platform !== 'darwin') fail('Unsupported platform: bundle metadata inspection requires macOS plutil');
  return JSON.parse(execFileSync('/usr/bin/plutil', ['-convert', 'json', '-o', '-', filename], { encoding: 'utf8', timeout: 10000, maxBuffer: 4 * 1024 * 1024 }));
}
export function runningProcesses(app, output) {
  const rows = output ?? execFileSync('/bin/ps', ['-axo', 'pid=,comm='], { encoding: 'utf8', timeout: 10000, maxBuffer: 16 * 1024 * 1024 });
  if (typeof rows !== 'string' || !rows.trim()) fail('Cannot establish that Desktop is closed: empty process metadata');
  const parsed = rows.trim().split('\n').map(line => /^\s*(\d+)\s+(.+?)\s*$/u.exec(line));
  if (parsed.some(row => !row)) fail('Cannot establish that Desktop is closed: unknown process metadata');
  return parsed.filter(row => within(app, row[2])).map(row => ({ pid: Number(row[1]), executable: row[2] }));
}
function closed(app, services) {
  const processes = (services.processes ?? runningProcesses)(app);
  if (!Array.isArray(processes)) fail('Cannot establish that Desktop is closed');
  if (processes.length) fail(`Desktop is running; close it yourself before apply/restore (PIDs ${processes.map(item => item.pid).join(', ')}). Electron caches ASAR headers; live replacement is refused.`);
}
function inspect(app, services, originalHeaderHash) {
  const p = paths(app);
  const bytes = readRegular(p.archive), archive = parseAsar(bytes);
  const info = (services.plist ?? plist)(p.info);
  const identity = verifyInfo(info, originalHeaderHash ?? archive.headerHash, services.target ?? TARGET);
  const fuses = inspectFuses(readRegular(p.framework));
  return { ...p, bytes, archive, identity, fuses, infoHash: sha256(readRegular(p.info)), frameworkHash: sha256(readRegular(p.framework)), stat: fs.statSync(p.archive) };
}
function stateRoot(app, stateDir) {
  const root = path.resolve(stateDir ?? path.join(PROJECT, 'artifacts/desktop-bridge'));
  if (within(app, root) || within(root, app)) fail('State directory must be outside and independent of the installed application');
  guardPath(root, { missing: true, directory: true });
  return path.join(root, sha256(app).slice(0, 20));
}
function unpackedSnapshot(archive, archiveFilename) {
  const entries = [];
  for (const [name, node] of archive.entries) {
    if (!node.unpacked || node.files || node.link) continue;
    const filename = path.join(`${archiveFilename}.unpacked`, ...name.split('/'));
    const bytes = readRegular(filename);
    if (bytes.length !== node.size) fail(`Unpacked entry size mismatch: ${name}`);
    entries.push({ path: name, sha256: sha256(bytes), mode: fs.statSync(filename).mode & 0o7777 });
  }
  return entries;
}
function sameUnpacked(record, archive, filename) {
  if (JSON.stringify(unpackedSnapshot(archive, filename)) !== JSON.stringify(record)) fail('Unpacked companion files changed since preparation');
}
export function check({ app = DEFAULT_APP, manifest } = {}, services = {}) {
  const loaded = manifest ? loadManifest(manifest, app, services) : undefined;
  const current = inspect(app, services, loaded?.record.original.headerSha256);
  const currentHash = sha256(current.bytes);
  let state = 'original';
  if (loaded) {
    verifyEnvironment(current, loaded.record);
    if (currentHash === loaded.record.patched.sha256) state = 'installed';
    else if (currentHash !== loaded.record.original.sha256) fail('Check refused: current archive is not owned by this manifest');
  } else verifyHost(current.archive, services.target ?? TARGET);
  return { mode: 'check', supported: true, state, app, archive: paths(app).archive, archiveBytes: current.bytes.length,
    version: (services.target ?? TARGET).version, build: (services.target ?? TARGET).build,
    sha256: currentHash, originalSha256: loaded?.record.original.sha256 ?? currentHash, headerSha256: current.archive.headerHash,
    identity: current.identity, fuses: current.fuses, running: (services.processes ?? runningProcesses)(app),
    effect: 'Read only. No application, profile, fuse, signature, plist, updater or CLI changes.' };
}
export function prepare({ app = DEFAULT_APP, stateDir, nativeDir = path.join(PROJECT, 'native') } = {}, services = {}) {
  const current = inspect(app, services), target = services.target ?? TARGET;
  verifyHost(current.archive, target);
  const root = stateRoot(app, stateDir), payload = {};
  nativeDir = path.resolve(nativeDir); guardPath(nativeDir, { directory: true });
  for (const name of MODULES) payload[name] = readRegular(path.join(nativeDir, name));
  const result = patchArchive(current.bytes, payload, target);
  const preparedArchive = parseAsar(result.patched);
  for (const name of ['lib/main.js', 'lib/preload-app.cjs', ...MODULES.map(module => `lib/dsh-browser-bridge/${module}`)]) {
    // Parse only: --check never evaluates host code or loads Electron/modules.
    try {
      execFileSync(process.execPath, ['--check', `--input-type=${name.endsWith('.cjs') ? 'commonjs' : 'module'}`], {
        input: entryBytes(preparedArchive, name), timeout: 10000, maxBuffer: 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch { fail(`Prepared JavaScript syntax check failed: ${name}`); }
  }
  const unpacked = unpackedSnapshot(current.archive, paths(app).archive);
  // All writes begin here, outside the bundle; existing preparations/backups are never overwritten.
  mkdirSafe(root);
  const staging = fs.mkdtempSync(path.join(root, 'prepared-'));
  guardPath(staging, { directory: true });
  const backup = path.join(staging, 'original.asar'), patched = path.join(staging, 'patched.asar');
  newFile(backup, current.bytes); newFile(patched, result.patched);
  if (sha256(readRegular(backup)) !== sha256(current.bytes) || sha256(readRegular(patched)) !== sha256(result.patched)) fail('Staged archive verification failed');
  const manifest = {
    schemaVersion: 1, kind: 'dsh-browser-desktop-bridge', phase: 'prepared', preloadStrategy: 'inline-cjs-factory-v1', createdAt: new Date().toISOString(),
    app, archive: paths(app).archive, version: target.version, build: target.build,
    identity: current.identity, fuses: current.fuses, infoSha256: current.infoHash, frameworkSha256: current.frameworkHash,
    original: { filename: 'original.asar', sha256: sha256(current.bytes), headerSha256: current.archive.headerHash, size: current.bytes.length, mode: current.stat.mode & 0o7777, uid: current.stat.uid, gid: current.stat.gid },
    patched: { filename: 'patched.asar', sha256: sha256(result.patched), headerSha256: parseAsar(result.patched).headerHash, size: result.patched.length },
    payload: MODULES.map(name => ({ source: `native/${name}`, path: `lib/dsh-browser-bridge/${name}`, sha256: sha256(payload[name]), size: payload[name].length })),
    changes: result.changes, unpacked,
    strategy: 'Preserve original packed payload and metadata; append two host replacements and four modules. Unpacked companions remain in place.',
    limitations: ['Requires Desktop fully closed for apply and restore.', 'No signing, fuse or plist edits. Launch acceptance by macOS signing policy is not established by preparation.'],
  };
  const manifestPath = path.join(staging, 'manifest.json'); newFile(manifestPath, json(manifest)); syncDirectory(staging);
  return { mode: 'prepare', manifest: manifestPath, backup, patched, originalSha256: manifest.original.sha256, patchedSha256: manifest.patched.sha256, changes: manifest.changes, applicationModified: false };
}
function loadManifest(filename, app, services) {
  if (!filename || !path.isAbsolute(filename) || path.resolve(filename) !== filename) fail('An explicit normalized absolute --manifest path is required');
  const record = JSON.parse(readRegular(filename).toString('utf8')), target = services.target ?? TARGET;
  const dir = path.dirname(filename);
  if (fs.existsSync(path.join(dir, 'SUPERSEDED.json'))) fail('Preparation is superseded; select a newly reviewed manifest');
  if (within(app, dir) || within(dir, app)) fail('Manifest must be outside the application');
  if (path.basename(filename) !== 'manifest.json' || record.schemaVersion !== 1 || record.kind !== 'dsh-browser-desktop-bridge'
    || record.phase !== 'prepared' || record.preloadStrategy !== 'inline-cjs-factory-v1' || record.app !== app || record.archive !== paths(app).archive
    || record.version !== target.version || record.build !== target.build
    || record.original?.filename !== 'original.asar' || record.patched?.filename !== 'patched.asar'
    || !digest(record.original.sha256) || !digest(record.patched.sha256) || !digest(record.original.headerSha256)
    || !digest(record.patched.headerSha256) || !digest(record.infoSha256) || !digest(record.frameworkSha256)
    || !Number.isInteger(record.original.mode) || record.original.mode < 0 || record.original.mode > 0o7777) fail('Invalid or foreign installation manifest');
  const backupPath = path.join(dir, 'original.asar'), patchedPath = path.join(dir, 'patched.asar');
  const original = readRegular(backupPath), patched = readRegular(patchedPath);
  if (sha256(original) !== record.original.sha256 || original.length !== record.original.size
    || sha256(patched) !== record.patched.sha256 || patched.length !== record.patched.size
    || parseAsar(original).headerHash !== record.original.headerSha256 || parseAsar(patched).headerHash !== record.patched.headerSha256) fail('Backup or staged archive SHA256 mismatch');
  verifyPatch(original, patched, target);
  if (!Array.isArray(record.payload) || record.payload.length !== MODULES.length) fail('Invalid manifest payload');
  const after = parseAsar(patched);
  for (const name of MODULES) {
    const key = `lib/dsh-browser-bridge/${name}`, payload = record.payload.find(item => item.path === key), bytes = entryBytes(after, key);
    if (!payload || payload.sha256 !== sha256(bytes) || payload.size !== bytes.length) fail('Manifest payload SHA256 mismatch');
  }
  return { record, dir, original, patched, backupPath };
}
function verifyEnvironment(current, record) {
  if (current.infoHash !== record.infoSha256 || current.frameworkHash !== record.frameworkSha256
    || JSON.stringify(current.identity) !== JSON.stringify(record.identity) || JSON.stringify(current.fuses) !== JSON.stringify(record.fuses)) fail('Application identity, plist or Electron framework changed since preparation');
  if ((current.stat.mode & 0o7777) !== record.original.mode || current.stat.uid !== record.original.uid || current.stat.gid !== record.original.gid) fail('Application archive permissions/ownership changed since preparation');
  sameUnpacked(record.unpacked, parseAsar(current.bytes), paths(current.app).archive);
}
/** Explicit mutation only. All fixture services are programmatic test seams; CLI exposes none. */
export function install({ app = DEFAULT_APP, manifest, restore = false } = {}, services = {}) {
  const p = paths(app), loaded = loadManifest(manifest, app, services), { record } = loaded;
  closed(app, services);
  const current = inspect(app, services, record.original.headerSha256);
  verifyEnvironment(current, record);
  const expected = restore ? record.patched.sha256 : record.original.sha256;
  if (sha256(current.bytes) !== expected) fail(restore ? 'Restore refused: current archive is not the manifest-owned patched SHA256' : 'Apply refused: target archive changed since preparation');
  const bytes = restore ? loaded.original : loaded.patched;
  // A same-directory temporary regular file enables a single atomic replacement;
  // the .app directory itself is never renamed. Failed temporary files are retained for inspection.
  const temporary = path.join(path.dirname(p.archive), `.app.asar.dsh-browser-${randomUUID()}.tmp`);
  guardPath(temporary, { missing: true });
  newFile(temporary, bytes, record.original.mode);
  const stagedStat = fs.statSync(temporary);
  if (stagedStat.uid !== current.stat.uid || stagedStat.gid !== current.stat.gid) {
    const fd = fs.openSync(guardPath(temporary), fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try { fs.fchownSync(fd, current.stat.uid, current.stat.gid); fs.fchmodSync(fd, record.original.mode); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  }
  if (sha256(readRegular(temporary)) !== sha256(bytes)) fail('Atomic replacement staging hash mismatch');
  // Recheck every destructive-operation operand, backup hash, target hash, process metadata and metadata immediately before rename.
  guardPath(p.archive); guardPath(temporary);
  if (sha256(readRegular(loaded.backupPath)) !== record.original.sha256) fail('Original backup changed before replacement');
  const final = inspect(app, services, record.original.headerSha256); verifyEnvironment(final, record);
  if (sha256(final.bytes) !== expected) fail('Target changed before atomic replacement');
  closed(app, services);
  fs.renameSync(temporary, p.archive);
  syncDirectory(path.dirname(p.archive));
  const wanted = restore ? record.original.sha256 : record.patched.sha256;
  if (sha256(readRegular(p.archive)) !== wanted) fail('Replacement verification failed; preserve manifest and backup for recovery');
  const receipt = path.join(loaded.dir, `${restore ? 'restore' : 'apply'}-${randomUUID()}.json`);
  newFile(receipt, json({ schemaVersion: 1, kind: 'dsh-browser-desktop-bridge-receipt', action: restore ? 'restore' : 'apply', at: new Date().toISOString(), app, manifest, beforeSha256: expected, afterSha256: wanted }));
  syncDirectory(loaded.dir);
  return { mode: restore ? 'restore' : 'apply', app, sha256: wanted, receipt, manifest };
}
export function parseArgs(args) {
  const options = {}; let mode = 'check', selected = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (['--check', '--prepare', '--apply', '--restore'].includes(arg)) {
      if (selected) fail('Choose one of --check, --prepare, --apply or --restore');
      selected = true; mode = arg.slice(2);
    } else if (['--app', '--state-dir', '--manifest'].includes(arg)) {
      const value = args[++i]; if (!value || value.startsWith('--')) fail(`Missing value for ${arg}`);
      const key = { '--app': 'app', '--state-dir': 'stateDir', '--manifest': 'manifest' }[arg];
      if (options[key]) fail(`Duplicate option ${arg}`); options[key] = value;
    } else if (arg === '--help') return { mode: 'help', options: {} };
    else fail(`Unknown option: ${arg}`);
  }
  if (['apply', 'restore'].includes(mode) && !options.manifest) fail('--apply and --restore require --manifest from a reviewed preparation');
  if (mode === 'prepare' && options.manifest) fail('--manifest is only supported with --check, --apply or --restore');
  if (['apply', 'restore', 'check'].includes(mode) && options.stateDir) fail('--state-dir is only supported with --prepare');
  return { mode, options };
}
export function main(args = process.argv.slice(2)) {
  if (Number(process.versions.node.split('.')[0]) < 22) fail('Node.js >=22 is required');
  const { mode, options } = parseArgs(args);
  if (mode === 'help') {
    console.log('Usage: node scripts/desktop-bridge.mjs [--check | --prepare | --apply | --restore] [--app /absolute/DSH.app]\n  --prepare [--state-dir /absolute/state]   Stage backup, patched ASAR and manifest outside app.\n  --apply --manifest /absolute/manifest.json   Requires Desktop fully closed.\n  --restore --manifest /absolute/manifest.json Requires matching owned patched archive and Desktop closed.\nDefault --check is read only. No process stopping, profile, signature, fuse or plist edits.'); return;
  }
  const result = mode === 'check' ? check(options) : mode === 'prepare' ? prepare(options) : install({ ...options, restore: mode === 'restore' });
  console.log(json(result));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(`desktop-bridge: ${error.message}`); process.exitCode = 1; }
}
