import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { Window } from 'happy-dom';
import { build } from 'esbuild';
import { Broker } from '../src/protocol.js';
import { BrowserService, toolDefinitions } from '../src/index.js';

/* Renders the real React BrowserPanel (through the ui-preview fixture adapter)
 * in happy-dom and drives it through the real Node Broker/RPC service. This is
 * the regression net for panel wiring that unit tests and check.mjs cannot see:
 * the 1.1.0 refactor once removed the controls.current assignment (every manual
 * toolbar action silently no-op'd) and left an undefined setMarkerRevision call
 * (an unhandled rejection after every non-passive command) while npm run check
 * stayed green, because test:ui needs Chrome and was itself broken.
 *
 * The pinned React/ReactDOM UMD fixtures are cached by `npm run test:ui` under
 * .reference/ui-verification/batches; this test skips when they are absent. */

const project = fileURLToPath(new URL('../', import.meta.url));
const cache = path.join(project, '.reference/ui-verification/batches');
const reactUmd = path.join(cache, 'react-18.3.1.development.js');
const reactDomUmd = path.join(cache, 'react-dom-18.3.1.development.js');

test('real BrowserPanel drives navigation and host commands without unhandled rejections', async t => {
  if (!existsSync(reactUmd) || !existsSync(reactDomUmd)) return t.skip('Pinned React UMD fixtures not cached; run npm run test:ui once to fetch them');

  const guest = '<!doctype html><meta charset="utf-8"><title>验收工作台</title><button id="action">调整这张卡片</button>';
  const hostLife = new AbortController(), broker = new Broker();
  const ownerPeer = { principal: { kind: 'owner' }, signal: hostLife.signal };
  const hostService = { ctx: { invocation: { peer: ownerPeer } }, broker };
  const hostTools = new Map(toolDefinitions({}, broker).map(tool => [tool.name, tool]));
  const rpcMethods = new Set(['connect', 'openRequested', 'poll', 'reply', 'stop', 'disconnect']);
  const server = http.createServer(async (req, res) => {
    try {
      const route = new URL(req.url, 'http://fixture.invalid').pathname;
      if (route !== '/fixture-rpc' && route !== '/fixture-agent') { res.writeHead(404); res.end('Not found'); return; }
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const request = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      let value;
      if (route === '/fixture-rpc') {
        if (!rpcMethods.has(request.method) || !Array.isArray(request.args)) throw Error('FIXTURE_UNKNOWN_RPC');
        value = await BrowserService.prototype[request.method].apply(hostService, request.args);
      } else {
        const tool = hostTools.get(`browser_${request.operation}`); if (!tool) throw Error('FIXTURE_UNKNOWN_TOOL');
        value = await tool.execute(request.args || {}, { agent: { session: { id: request.sessionId } }, signal: hostLife.signal });
      }
      res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: true, value }));
    } catch (error) { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: false, error: { message: error.message, code: error.code } })); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;

  const unhandled = [];
  const onUnhandled = reason => unhandled.push(String(reason?.message || reason));
  process.on('unhandledRejection', onUnhandled);
  const window = new Window({ url: `${origin}/` });
  const bundle = await build({
    entryPoints: [path.join(project, 'test/fixtures/ui-preview.js')], bundle: true, format: 'iife', platform: 'browser', write: false,
    plugins: [{ name: 'isolated-ui-fixture', setup(builder) {
      builder.onResolve({ filter: /^react$/ }, () => ({ path: 'react-global', namespace: 'fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: 'export default window.React;', loader: 'js' }));
      builder.onResolve({ filter: /^@deepseek-ai\/dsh-client-ui-primitives$/ }, () => ({ path: 'primitives-stub', namespace: 'fixture-primitives' }));
      builder.onLoad({ filter: /.*/, namespace: 'fixture-primitives' }, () => ({ contents: 'export const GuideArtworkBrowser = () => null;', loader: 'js' }));
      builder.onResolve({ filter: /^\.\/electron-page\.js$/ }, args => args.importer === path.join(project, 'src/client.js') ? { path: path.join(project, 'test/fixtures/ui-preview.js') } : undefined);
    } }],
  });
  try {
    globalThis.window = window; globalThis.document = window.document;
    globalThis.location = window.location; globalThis.fetch = window.fetch.bind(window);
    window.eval(String(await readFile(reactUmd)));
    window.eval(String(await readFile(reactDomUmd)));
    window.document.write('<div id="root"></div>');
    // esbuild hands back a Uint8Array; String() on it would silently produce a
    // comma-joined number literal that evals to nothing. Decode it as UTF-8.
    window.eval(new TextDecoder().decode(bundle.outputFiles[0].contents));

    const until = async (probe, message, timeout = 8000) => {
      const start = Date.now();
      while (Date.now() - start < timeout) { const value = await probe(); if (value) return value; await delay(50); }
      throw new Error(`Timed out: ${message}`);
    };

    // The panel connects through the real Broker and renders one initial tab.
    await until(() => window.UI_SMOKE && window.document.querySelector('.ab-status')?.textContent?.includes('已连接'), 'panel connected');
    assert.equal(window.document.querySelectorAll('[role=tab]').length, 1);

    // Address-bar submit must reach the panel's imperative controls: a missing
    // controls.current assignment makes this a silent no-op.
    const address = window.document.querySelector('.ab-address input');
    const valueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    valueSetter.call(address, `${origin}/guest`);
    address.dispatchEvent(new window.Event('input', { bubbles: true }));
    await delay(60);
    window.document.querySelector('.ab-toolbar').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    await until(() => window.document.querySelector('iframe')?.getAttribute('src')?.includes('/guest'), 'address submit navigated the guest');

    // A non-passive host command round trip must reply cleanly: the removed
    // annotation cleanup once left an undefined setMarkerRevision call in the
    // panel's run() finally, producing an unhandled rejection per command.
    const before = (await window.UI_SMOKE.request('tabs', { action: 'list' })).tabs.length;
    const opened = await window.UI_SMOKE.request('tabs', { action: 'new' });
    assert.equal(opened.tabs.length, before + 1);
    await delay(300);
    assert.deepEqual(unhandled, []);

    // The stop command cancels control and still replies without rejections.
    assert.equal((await window.UI_SMOKE.request('stop')).stopped, true);
    await delay(200);
    assert.deepEqual(unhandled, []);
  } finally {
    process.off('unhandledRejection', onUnhandled);
    try { window.UI_SMOKE?.close(); } catch {}
    hostLife.abort(); broker.dispose();
    server.closeAllConnections?.(); await new Promise(resolve => server.close(resolve));
    try { window.happyDOM?.close?.(); } catch {}
    delete globalThis.window; delete globalThis.document; delete globalThis.location; delete globalThis.fetch;
  }
});
