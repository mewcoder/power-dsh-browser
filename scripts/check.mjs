import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
assert.equal(pkg.dsh.client.platform, 'web');
assert.equal(pkg.dsh.bundle.patch, './cordis.patch.yml');
assert.equal(await readFile('cordis.patch.yml', 'utf8'), '- insert:\n    - id: dsh-x-browser\n      name: dsh-x-browser\n');
for (const path of ['lib/index.js', 'lib/client.js', 'src/protocol.js', 'src/rpc.js', 'src/runner.js', 'src/page-runtime.js', 'src/electron-page.js', 'src/network-client.js', 'src/client.js', 'native/network-recorder.js', 'native/lease-network-service.js', 'native/preload-network.cjs', 'native/desktop-browser-bridge.js', 'native/preload-cap.cjs', 'src/cap-client.js']) {
  const syntax = spawnSync(process.execPath, ['--check', path], { encoding: 'utf8' });
  assert.equal(syntax.status, 0, syntax.stderr);
}
let declaration;
vm.runInNewContext(await readFile('lib/client.js', 'utf8'), { window: { __ModuleLoader__: { load(value) { declaration = value; } } } });
assert.equal(declaration.id, pkg.name); assert.equal(typeof declaration.factory, 'function');
const requests = [];
const client = declaration.factory(request => { requests.push(request); if (request === 'react') return { createElement() {} }; throw Error(`Unexpected external ${request}`); });
assert(requests.length > 0 && requests.every(request => request === 'react')); assert.deepEqual([...new Set(requests)], ['react']); assert.equal(typeof client.apply, 'function');
const { toolDefinitions } = await import('../lib/index.js');
const tools = toolDefinitions({}, {});
assert.deepEqual(tools.map(t => t.name), ['browser_status', 'browser_tabs', 'browser_navigate', 'browser_snapshot', 'browser_inspect', 'browser_console', 'browser_network', 'browser_cap', 'browser_act', 'browser_screenshot', 'browser_stop']);
for (const t of tools) assert(!('sessionId' in t.parameters.properties));
console.log('Static syntax, lazy Client bundle, external baseline and eleven tool contracts verified.');
