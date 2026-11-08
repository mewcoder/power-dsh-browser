#!/usr/bin/env node
// One-command bridge installer with self-healing state detection.
//
//   npm run bridge            # install (or repair) and reopen DSH
//   npm run bridge -- status  # read-only diagnosis
//   npm run bridge -- restore # return to the pristine archive
//
// It never kills DSH: it waits for the app to be closed. Every write is hash
// checked against a reviewed manifest, and the pristine archive is always kept.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TARGET, MODULES, sha256, patchArchive } from './desktop-bridge-patch.mjs';

const PROJECT = fileURLToPath(new URL('../', import.meta.url));
const APP = '/Applications/DeepSeek Harness.app';
const ARCHIVE = path.join(APP, 'Contents/Resources/app.asar');
const EXECUTABLE = path.join(APP, 'Contents/MacOS/DeepSeek Harness');
const PRISTINE = path.join(PROJECT, 'artifacts/desktop-bridge/2f1fa84fbaf392cc42d4/prepared-BgCOCF/original.asar');
const PRISTINE_SHA = 'f21d83abfb33d463822a52c439cc9b15c8245dbce4ae4cf9424c90eae8eba94f';
const STATE = path.join(PROJECT, 'artifacts/desktop-bridge-v2');

const say = (message, code = 0) => { console.log(message); if (code) process.exitCode = code; };
const sha = file => sha256(fs.readFileSync(file));
const exists = file => { try { return fs.statSync(file).isFile(); } catch { return false; } };

function running() {
  try {
    const result = spawnSync('ps', ['-Ao', 'comm='], { encoding: 'utf8' });
    return result.stdout.split('\n').some(line => line.trim() === EXECUTABLE);
  } catch { return false; }
}

// Classify what is currently installed without trusting anything but bytes.
export function diagnose() {
  if (!exists(ARCHIVE)) return { state: 'missing', detail: `archive not found at ${ARCHIVE}` };
  const current = sha(ARCHIVE);
  if (current === PRISTINE_SHA) return { state: 'original', sha256: current, detail: 'pristine DSH archive' };
  if (exists(PRISTINE)) {
    try {
      const modules = Object.fromEntries(MODULES.map(name => [name, fs.readFileSync(path.join(PROJECT, 'native', name))]));
      const expected = sha256(patchArchive(fs.readFileSync(PRISTINE), modules, TARGET).patched);
      if (current === expected) return { state: 'installed', sha256: current, detail: 'current bridge build' };
    } catch { /* fall through to stale */ }
  }
  return { state: 'unknown', sha256: current, detail: 'archive is neither pristine nor the current bridge build' };
}

function waitForExit(timeoutMs = 300000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise(resolve => {
    const tick = () => {
      if (!running()) return resolve(true);
      if (Date.now() > deadline) return resolve(false);
      setTimeout(tick, 400);
    };
    tick();
  });
}

function reopen() {
  const result = spawnSync('open', ['-a', APP], { encoding: 'utf8' });
  if (result.status !== 0) say(`Could not reopen DSH: ${(result.stderr || '').trim()}`, 1);
}

function buildPatched() {
  if (!exists(PRISTINE)) throw new Error(`Pristine backup missing: ${PRISTINE}`);
  if (sha(PRISTINE) !== PRISTINE_SHA) throw new Error('Pristine backup hash mismatch; refusing to patch');
  const modules = Object.fromEntries(MODULES.map(name => [name, fs.readFileSync(path.join(PROJECT, 'native', name))]));
  const { patched } = patchArchive(fs.readFileSync(PRISTINE), modules, TARGET);
  return patched;
}

function writeArchive(bytes) {
  const wanted = sha256(bytes);
  fs.mkdirSync(STATE, { recursive: true });
  const staged = path.join(path.dirname(ARCHIVE), `.app.asar.dsh-x-${Date.now()}.tmp`);
  fs.writeFileSync(staged, bytes, { mode: 0o644 });
  if (sha(staged) !== wanted) { fs.rmSync(staged, { force: true }); throw new Error('Staged archive hash mismatch'); }
  fs.renameSync(staged, ARCHIVE);
  if (sha(ARCHIVE) !== wanted) throw new Error('Replacement verification failed');
  return wanted;
}

async function install() {
  const before = diagnose();
  say(`Current: ${before.state} — ${before.detail}`);
  if (before.state === 'missing') return say('Cannot continue: DSH Desktop is not installed at the expected path.', 1);
  if (before.state === 'installed') {
    if (running()) return say('Already installed and up to date. Nothing to do.');
    say('Already installed; reopening DSH.');
    return reopen();
  }
  if (before.state === 'unknown') {
    say('The archive is not recognised. Refusing to overwrite an unknown build.');
    say('Restore first (npm run bridge -- restore) or reinstall DSH Desktop.');
    return say('', 1);
  }
  if (running()) {
    say('Close DeepSeek Harness now. Waiting for it to exit (up to 5 minutes)…');
    if (!await waitForExit()) return say('Timed out waiting for DSH to close. Nothing was changed.', 1);
    say('DSH closed.');
  }
  const patched = buildPatched();
  say(`Patching… (${MODULES.length} modules, ${patched.length} bytes)`);
  const written = writeArchive(patched);
  say(`Installed: ${written}`);
  say(`Pristine backup kept at: ${PRISTINE}`);
  say('Reopening DSH.');
  reopen();
  return say('Done. The browser panel will be available after DSH finishes starting.');
}

function restore() {
  const current = diagnose();
  say(`Current: ${current.state} — ${current.detail}`);
  if (current.state === 'original') return say('Already pristine. Nothing to do.');
  if (running()) {
    say('Close DeepSeek Harness first, then run: npm run bridge -- restore');
    return say('', 1);
  }
  if (!exists(PRISTINE) || sha(PRISTINE) !== PRISTINE_SHA) return say('Pristine backup is missing or corrupt; cannot restore safely.', 1);
  const backup = path.join(STATE, `app.asar.before-restore.${Date.now()}.bak`);
  fs.mkdirSync(STATE, { recursive: true });
  fs.copyFileSync(ARCHIVE, backup);
  const written = writeArchive(fs.readFileSync(PRISTINE));
  say(`Restored pristine archive: ${written}`);
  say(`Previous archive saved: ${backup}`);
  return reopen();
}

async function main() {
  const action = (process.argv[2] || 'install').toLowerCase();
  if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('Node.js >=22 is required');
  if (action === 'status' || action === 'check') {
    const state = diagnose();
    say(`state: ${state.state}`);
    if (state.sha256) say(`sha256: ${state.sha256}`);
    say(`detail: ${state.detail}`);
    say(`running: ${running() ? 'yes' : 'no'}`);
    return;
  }
  if (action === 'install' || action === 'repair') return install();
  if (action === 'restore' || action === 'uninstall') return restore();
  throw new Error(`Unknown action: ${action} (use install | status | restore)`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(`bridge: ${error.message}`); process.exitCode = 1; });
}
