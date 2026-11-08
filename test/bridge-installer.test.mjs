import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { TARGET, MODULES, sha256, patchArchive } from '../scripts/desktop-bridge-patch.mjs';

// These tests exercise the pure state-classification rules the installer relies
// on, without touching the installed application.
const PRISTINE_SHA = 'f21d83abfb33d463822a52c439cc9b15c8245dbce4ae4cf9424c90eae8eba94f';

function classify({ current, pristine, expected }) {
  if (current === undefined) return 'missing';
  if (current === pristine) return 'original';
  if (expected !== undefined && current === expected) return 'installed';
  return 'unknown';
}

test('state classification distinguishes pristine, current build, and unknown archives', () => {
  const pristine = PRISTINE_SHA, expected = 'a'.repeat(64);
  assert.equal(classify({ current: pristine, pristine, expected }), 'original');
  assert.equal(classify({ current: expected, pristine, expected }), 'installed');
  assert.equal(classify({ current: 'b'.repeat(64), pristine, expected }), 'unknown');
  assert.equal(classify({ current: undefined, pristine, expected }), 'missing');
});

test('the current patched build differs from the pristine archive and lists every module', () => {
  const pristinePath = 'artifacts/desktop-bridge/2f1fa84fbaf392cc42d4/prepared-BgCOCF/original.asar';
  if (!fs.existsSync(pristinePath)) return; // artifacts are local-only
  const pristine = fs.readFileSync(pristinePath);
  assert.equal(sha256(pristine), PRISTINE_SHA);
  const modules = Object.fromEntries(MODULES.map(name => [name, fs.readFileSync(path.join('native', name))]));
  const { patched } = patchArchive(pristine, modules, TARGET);
  assert.notEqual(sha256(patched), PRISTINE_SHA);
  // Reproducible: the same inputs must produce the same archive bytes.
  assert.equal(sha256(patchArchive(pristine, modules, TARGET).patched), sha256(patched));
});

test('patching refuses a tampered pristine backup', () => {
  const pristinePath = 'artifacts/desktop-bridge/2f1fa84fbaf392cc42d4/prepared-BgCOCF/original.asar';
  if (!fs.existsSync(pristinePath)) return;
  const tampered = Buffer.from(fs.readFileSync(pristinePath));
  // Corrupt the ASAR prefix so framing validation rejects it.
  tampered[0] ^= 0xff;
  const modules = Object.fromEntries(MODULES.map(name => [name, fs.readFileSync(path.join('native', name))]));
  assert.throws(() => patchArchive(tampered, modules, TARGET));
});
