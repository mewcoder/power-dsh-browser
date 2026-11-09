import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import vm from 'node:vm';
import { PLUGIN_ID, NETWORK_BUDGETS } from '../src/constants.js';
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
assert.equal(pkg.name, 'power-dsh-browser');
assert.equal(PLUGIN_ID, pkg.name);
const lock = JSON.parse(await readFile('package-lock.json', 'utf8'));
assert.equal(lock.name, pkg.name); assert.equal(lock.packages[''].name, pkg.name);
assert.equal(lock.version, pkg.version); assert.equal(lock.packages[''].version, pkg.version);
// Project branding must never rewrite dependency versions in the lockfile.
for (const [entry, dependency] of Object.entries(lock.packages)) {
  if (!dependency.resolved?.startsWith('https://registry.npmjs.org/')) continue;
  const tarball = decodeURIComponent(new URL(dependency.resolved).pathname.split('/').pop());
  assert.equal(tarball, `${path.basename(entry)}-${dependency.version}.tgz`, `${entry}: lock version and tarball disagree`);
}
assert.equal(pkg.dsh.client.platform, 'web');
assert.equal(pkg.dsh.bundle.patch, './cordis.patch.yml');
assert.equal(await readFile('cordis.patch.yml', 'utf8'), `- insert:\n    - id: ${PLUGIN_ID}\n      name: ${PLUGIN_ID}\n`);
for (const path of ['lib/index.js', 'lib/client.js', 'src/protocol.js', 'src/rpc.js', 'src/runner.js', 'src/page-runtime.js', 'src/electron-page.js', 'src/network-client.js', 'src/client.js', 'native/network-recorder.js', 'native/lease-network-service.js', 'native/preload-network.cjs', 'native/desktop-browser-bridge.js', 'native/preload-cap.cjs', 'src/cap-client.js']) {
  const syntax = spawnSync(process.execPath, ['--check', path], { encoding: 'utf8' });
  assert.equal(syntax.status, 0, syntax.stderr);
}
let declaration;
vm.runInNewContext(await readFile('lib/client.js', 'utf8'), { window: { __ModuleLoader__: { load(value) { declaration = value; } } } });
assert.equal(declaration.id, pkg.name); assert.equal(typeof declaration.factory, 'function');
const requests = [];
// The client may only depend on React and the Host UI kit at runtime; both are
// provided by the Host module loader, never bundled.
const externals = { react: { createElement() {} }, '@deepseek-ai/dsh-client-ui-primitives': { GuideArtworkBrowser: () => null } };
const client = declaration.factory(request => { requests.push(request); if (externals[request]) return externals[request]; throw Error(`Unexpected external ${request}`); });
assert(requests.length > 0 && requests.every(request => request in externals));
assert.deepEqual([...new Set(requests)], ['react', '@deepseek-ai/dsh-client-ui-primitives']); assert.equal(typeof client.apply, 'function');
const { toolDefinitions } = await import('../lib/index.js');
const tools = toolDefinitions({}, {});
assert.deepEqual(tools.map(t => t.name), ['browser_status', 'browser_tabs', 'browser_navigate', 'browser_snapshot', 'browser_inspect', 'browser_console', 'browser_network', 'browser_cap', 'browser_act', 'browser_screenshot', 'browser_stop']);
for (const t of tools) assert(!('sessionId' in t.parameters.properties));
// The native bridge carries a self-contained copy of the capture budget caps
// (it is injected into the host ASAR and cannot import src/constants.js, whose
// NETWORK_BUDGETS comment says the two must be updated together). Assert that.
const bridge = await readFile('native/desktop-browser-bridge.js', 'utf8');
for (const [key, budget] of [['maxRequests', 'requests'], ['maxBodyBytes', 'bodyBytes'], ['maxTotalBodyBytes', 'totalBodyBytes']]) {
  const expression = bridge.match(new RegExp(`${key}:\\s*([^,}]+)`))?.[1];
  assert.ok(expression, `native/desktop-browser-bridge.js no longer declares ${key}`);
  assert.equal(vm.runInNewContext(expression), NETWORK_BUDGETS[budget].max, `${key} cap drifts between src/constants.js and the native bridge`);
}
// Dev-side smoke scripts and fixtures must stay loadable: an optional test that
// imports a removed module would otherwise pass every check while never running.
const devFiles = [
  ...readdirSync('scripts').filter(name => name.endsWith('.mjs')).map(name => path.join('scripts', name)),
  ...readdirSync('test/fixtures').filter(name => name.endsWith('.js')).map(name => path.join('test/fixtures', name)),
];
for (const file of devFiles) {
  const syntax = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  assert.equal(syntax.status, 0, `${file}: ${syntax.stderr}`);
  // Strip template literals first: generated host code embeds import-like text
  // inside strings, and only real statement-level imports should be checked.
  const code = (await readFile(file, 'utf8')).replace(/`(?:\\[\s\S]|[^`\\])*`/g, '``');
  for (const match of code.matchAll(/(?:from|import)\s*['"](\.[^'"]+)['"]/g)) {
    const target = path.resolve(path.dirname(file), match[1]);
    assert.ok(existsSync(target), `${file} imports missing module ${match[1]}`);
  }
}
// The Electron driver and its isolated app/preload must agree on their wire labels.
const driver = await readFile('scripts/electron-network-smoke.mjs', 'utf8');
const fixture = await readFile('test/fixtures/electron-network-app.mjs', 'utf8');
const preload = await readFile('test/fixtures/electron-network-preload.cjs', 'utf8');
const sentKind = driver.match(/kind: '([^']+)'/)?.[1];
const acceptedKind = fixture.match(/assert\.equal\(config\.kind, '([^']+)'\)/)?.[1];
const hostChannel = fixture.match(/const fixtureChannel = '([^']+)'/)?.[1];
const preloadChannel = preload.match(/const channel = '([^']+)'/)?.[1];
assert.ok(sentKind && acceptedKind && hostChannel && preloadChannel, 'Electron fixture protocol declarations missing');
assert.equal(sentKind, acceptedKind, 'Electron smoke driver config does not match its app');
assert.equal(hostChannel, preloadChannel, 'Electron smoke app and preload channels disagree');
console.log('Static syntax, lazy Client bundle, eleven tools, bridge budgets, lockfile metadata and dev fixture contracts verified.');
