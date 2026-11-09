// Optional isolated React/Chromium UI verification. No product/profile mutation.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { Broker } from '../src/protocol.js';
import { BrowserService, toolDefinitions } from '../src/index.js';

const project = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(project, '.reference/ui-verification/batches');
await mkdir(output, { recursive: true });
const report = { runtime: 'Isolated headless Chromium with real React BrowserPanel/SessionTabs UI; real Node BrowserService/Broker/toolDefinitions with fixture identities and HTTP transport; iframe page adapter, not Electron or DSH Desktop', checks: [], failures: [], screenshots: [], resources: [], consoleErrors: [], layouts: [], cleanup: {} };
for (const [name, url] of [
  ['react-18.3.1.development.js', 'https://unpkg.com/react@18.3.1/umd/react.development.js'],
  ['react-dom-18.3.1.development.js', 'https://unpkg.com/react-dom@18.3.1/umd/react-dom.development.js'],
]) {
  const target = path.join(output, name);
  let bytes;
  if (existsSync(target)) bytes = await readFile(target);
  else {
    const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw Error(`Cannot fetch pinned React fixture ${response.status}`);
    bytes = Buffer.from(await response.arrayBuffer()); await writeFile(target, bytes);
  }
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const pins = { 'react-18.3.1.development.js': '28348fef6cb0ed8b2ceeb22deaf824428fd13875d84c73d38f77dd216fc24e7f', 'react-dom-18.3.1.development.js': 'f9044a5e9c39db8bb1a204dff924e526ec0a621e695bb69de1035811be8709e4' };
  assert.equal(sha256, pins[name], `Pinned resource checksum mismatch: ${name}`);
  report.resources.push({ name, url, version: '18.3.1', bytes: bytes.length, sha256 });
}
await writeFile(path.join(output, 'resources.json'), JSON.stringify(report.resources, null, 2));
report.sourceFiles = await Promise.all(['src/client.js', 'src/browser-shell.js', 'src/session-tabs.js', 'src/runner.js', 'src/page-runtime.js', 'src/protocol.js', 'src/index.js', 'src/rpc.js'].map(async name => ({ name, sha256: createHash('sha256').update(await readFile(path.join(project, name))).digest('hex') })));
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
await writeFile(path.join(output, 'ui-bundle.js'), bundle.outputFiles[0].contents);
const themes = {
  light: { '--dsw-alias-bg-base': '#ffffff', '--dsw-alias-bg-layer-1': '#f6f7f9', '--dsw-alias-bg-layer-2': '#eceff4', '--dsw-alias-label-primary': '#20242d', '--dsw-alias-label-secondary': '#677181', '--dsw-alias-border-l2': '#d6dae2', '--dsw-alias-border-l3': '#e4e7ed', '--dsw-alias-state-business-primary': '#4d6bfe' },
  dark: { '--dsw-alias-bg-base': '#181b22', '--dsw-alias-bg-layer-1': '#20242d', '--dsw-alias-bg-layer-2': '#292f3a', '--dsw-alias-label-primary': '#e8ebf2', '--dsw-alias-label-secondary': '#a1aaba', '--dsw-alias-border-l2': '#424b5a', '--dsw-alias-border-l3': '#343c49', '--dsw-alias-state-business-primary': '#91a3ff' },
};
const shell = `<!doctype html><meta charset="utf-8"><title>Isolated React browser panel verification</title><style>html,body,#root{height:100%;width:100%;margin:0;overflow:hidden}body{font-family:system-ui,sans-serif}</style><div id="root"></div><script src="/react.js"></script><script src="/react-dom.js"></script><script src="/bundle.js"></script>`;
const guest = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>验收工作台</title><style>*{box-sizing:border-box}body{margin:0;background:#f4f6fa;color:#202937;font:14px/1.6 system-ui,sans-serif}main{max-width:620px;margin:0 auto;padding:28px 24px}.eyebrow{font-size:11px;letter-spacing:.12em;color:#65778e}h1{font-size:25px;line-height:1.3;margin:10px 0}p{color:#667386;margin:0 0 18px}.card{padding:20px;border:1px solid #e1e6ee;border-radius:15px;background:white;box-shadow:0 4px 18px #23345406}button{border:0;border-radius:9px;background:#4d6bfe;color:white;padding:11px 16px;font:inherit;cursor:pointer}input{display:block;width:100%;border:1px solid #d9e0ea;border-radius:8px;margin:8px 0 15px;padding:10px;font:inherit}output{display:block;margin-top:12px;color:#68788e;font-size:12px}.tag{font-size:11px;background:#edf1ff;color:#5369c2;padding:4px 8px;border-radius:5px;display:inline-block;margin-bottom:10px}</style><main><span class="eyebrow">ISOLATED DEVELOPMENT FIXTURE</span><h1 id="heading">可共享的页面工作台</h1><p>这个页面用于独立验证浏览器外壳和页面交互。</p><section class="card"><span class="tag">页面目标</span><h2 style="font-size:17px;margin:0 0 8px">触发真实的页面行为</h2><p>点击下面的按钮，验证面板输入与页面状态保留。</p><button id="action">调整这张卡片</button><output id="result">按钮尚未触发</output><label for="remember">标签页保留的文字</label><input id="remember" value="页面初始内容"></section></main><script>document.title+=' · '+(new URL(location.href).searchParams.get('page')||'A');window.earlyEvents=0;window.actionCount=0;for(const name of ['pointerdown','mousedown','click','keydown'])window.addEventListener(name,()=>window.earlyEvents++,true);document.querySelector('#action').addEventListener('click',()=>{window.actionCount++;document.querySelector('#result').textContent='按钮已触发 '+window.actionCount+' 次'});</script>`;
const hostLife = new AbortController(), broker = new Broker();
const ownerPeer = { principal: { kind: 'owner' }, signal: hostLife.signal };
const hostService = { ctx: { invocation: { peer: ownerPeer } }, broker };
const hostTools = new Map(toolDefinitions({}, broker).map(tool => [tool.name, tool]));
const rpcMethods = new Set(['connect', 'poll', 'reply', 'stop', 'disconnect']);
const fixtureSessions = new Set(['ui-fixture-session', 'ui-other-session']);
const server = http.createServer(async (req, res) => {
  try {
    const route = new URL(req.url, 'http://fixture.invalid').pathname;
    if (route === '/fixture-rpc' || route === '/fixture-agent') {
      try {
        if (req.method !== 'POST') throw Error('FIXTURE_POST_REQUIRED');
        const chunks = []; let size = 0;
        for await (const chunk of req) { size += chunk.length; if (size > 5_500_000) throw Error('FIXTURE_REQUEST_TOO_LARGE'); chunks.push(chunk); }
        const request = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        let value;
        if (route === '/fixture-rpc') {
          if (!rpcMethods.has(request.method) || !Array.isArray(request.args)) throw Error('FIXTURE_UNKNOWN_RPC');
          value = await BrowserService.prototype[request.method].apply(hostService, request.args);
        } else {
          if (!fixtureSessions.has(request.sessionId)) throw Error('FIXTURE_UNKNOWN_AGENT');
          const tool = hostTools.get(`browser_${request.operation}`); if (!tool) throw Error('FIXTURE_UNKNOWN_TOOL');
          value = await tool.execute(request.args || {}, { agent: { session: { id: request.sessionId } }, signal: hostLife.signal });
        }
        res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: true, value }));
      } catch (error) { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: false, error: { message: error.message, code: error.code } })); }
    }
    else if (route === '/guest') { res.writeHead(200, { 'content-type': 'text/html;charset=utf-8' }); res.end(guest); }
    else if (route === '/react.js' || route === '/react-dom.js') { res.writeHead(200, { 'content-type': 'text/javascript' }); res.end(await readFile(path.join(output, route === '/react.js' ? 'react-18.3.1.development.js' : 'react-dom-18.3.1.development.js'))); }
    else if (route === '/bundle.js') { res.writeHead(200, { 'content-type': 'text/javascript' }); res.end(bundle.outputFiles[0].contents); }
    else if (route === '/' || route === '/favicon.ico') { res.writeHead(200, { 'content-type': 'text/html;charset=utf-8' }); res.end(shell); }
    else { res.writeHead(404); res.end('Not found'); }
  } catch { res.writeHead(500); res.end('Fixture failure'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const executable = process.env.CHROME_PATH || ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium'].find(existsSync);
if (!executable) { await new Promise(resolve => server.close(resolve)); throw Error('Set CHROME_PATH to run isolated UI verification'); }
const profile = await mkdtemp(path.join(tmpdir(), 'power-dsh-browser-ui-smoke-'));
const child = spawn(executable, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-sync', '--disable-background-networking', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
let startupError, stderr = ''; child.once('error', error => { startupError = error; }); child.stderr.on('data', bytes => { stderr = (stderr + bytes).slice(-4000); });
let ws, sequence = 0; const pending = new Map();
const deadline = setTimeout(() => child.kill('SIGKILL'), 90000);
function call(method, params = {}) { return new Promise((resolve, reject) => { const id = ++sequence, timeout = setTimeout(() => { pending.delete(id); reject(Error(`CDP timeout: ${method}`)); }, 10000); pending.set(id, { resolve, reject, timeout }); ws.send(JSON.stringify({ id, method, params })); }); }
async function evaluate(expression) { const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text); return result.result.value; }
async function until(expression, message, timeout = 6000) { const start = Date.now(); while (Date.now() - start < timeout) { if (await evaluate(expression)) return; await delay(35); } throw Error(`Timed out: ${message}`); }
async function check(name, task) { try { await task(); report.checks.push(name); } catch (error) { let state; try { state = await evaluate('({address:document.querySelector(".ab-address input")?.value,pages:UI_SMOKE?.getPages(),alerts:[...document.querySelectorAll("[role=alert]")].map(e=>e.textContent),body:document.body.innerText.slice(0,1200)})'); } catch {} report.failures.push({ name, error: error.message, state }); } }
async function pointClick(x, y) { await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }); await call('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 }); await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 }); }
async function click(selector) { const point = await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('Missing control '+${JSON.stringify(selector)});const r=e.getBoundingClientRect();if(!r.width||!r.height)throw Error('Hidden control');return{x:r.left+r.width/2,y:r.top+r.height/2}})()`); await pointClick(point.x, point.y); }
async function fill(selector, text) { await click(selector); await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', modifiers: 4, windowsVirtualKeyCode: 65, commands: ['selectAll'] }); await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', modifiers: 4, windowsVirtualKeyCode: 65 }); await call('Input.insertText', { text }); }
async function enter() { await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', text: '\r', unmodifiedText: '\r', windowsVirtualKeyCode: 13 }); await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 }); }
async function screenshot(name) { const image = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }); const bytes = Buffer.from(image.data, 'base64'); assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a'); await writeFile(path.join(output, name), bytes); report.screenshots.push(name); }
async function dimensions(width, theme) { await call('Emulation.setDeviceMetricsOverride', { width, height: 840, deviceScaleFactor: 1, mobile: false }); await evaluate(`for(const [key,value] of Object.entries(${JSON.stringify(themes[theme])}))document.documentElement.style.setProperty(key,value);document.documentElement.style.colorScheme=${JSON.stringify(theme)}`); await delay(100); }
async function layout(width, theme, stage) { const metrics = await evaluate(`(()=>{const root=document.querySelector('[data-power-dsh-browser]'),tool=document.querySelector('.ab-toolbar'),view=document.querySelector('.ab-viewport');return {rootWidth:root.clientWidth,rootScroll:root.scrollWidth,bodyScroll:document.body.scrollWidth,toolbarWidth:tool.clientWidth,toolbarScroll:tool.scrollWidth,viewportHeight:view.clientHeight,visibleControls:[...tool.querySelectorAll('button')].filter(e=>e.getBoundingClientRect().width>0).length}})()`); report.layouts.push({ width, theme, stage, ...metrics }); assert.equal(metrics.rootWidth, width); assert.ok(metrics.rootScroll <= width + 1, 'Root horizontal overflow'); assert.ok(metrics.bodyScroll <= width + 1, 'Body horizontal overflow'); assert.ok(metrics.toolbarScroll <= metrics.toolbarWidth + 1, 'Toolbar horizontal overflow'); assert.ok(metrics.viewportHeight > 120); }
const activeGuest = () => evaluate('document.querySelector(".ab-page[aria-hidden=false] iframe")?.contentDocument?.title || ""');
try {
  let port;
  for (let i = 0; i < 200; i++) { try { port = Number((await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]); if (port) break; } catch {} if (startupError) throw startupError; if (child.exitCode !== null) throw Error(`Chrome exited: ${stderr}`); await delay(50); }
  if (!port) throw Error(`Chrome did not start: ${stderr}`);
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  ws = new WebSocket(targets.find(target => target.type === 'page').webSocketDebuggerUrl);
  ws.addEventListener('message', event => { const message = JSON.parse(event.data); if (message.method === 'Runtime.exceptionThrown') report.consoleErrors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text); if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') report.consoleErrors.push(message.params.args.map(arg => arg.value || arg.description).join(' ')); const item = pending.get(message.id); if (!item) return; pending.delete(message.id); clearTimeout(item.timeout); message.error ? item.reject(Error(message.error.message)) : item.resolve(message.result); });
  await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', reject, { once: true }); });
  await call('Runtime.enable'); await call('Page.enable');
  await dimensions(720, 'light'); await call('Page.navigate', { url: origin });
  await until('!!window.UI_SMOKE && document.querySelector(".ab-status")?.textContent.includes("已连接")', 'real React panel connected');
  await check('real React 18 BrowserPanel connects through actual Broker and renders one initial tab', async () => { assert.equal(await evaluate('React.version'), '18.3.1'); assert.equal(await evaluate('document.querySelectorAll("[role=tab]").length'), 1); assert.equal((await evaluate('UI_SMOKE.getPages()')).length, 1); });
  for (const width of [400, 720]) await check(`new-tab controls fit ${width}px`, async () => { await dimensions(width, 'light'); await layout(width, 'light', 'new-tab'); assert.equal(await evaluate('document.querySelector(".ab-start-hint")?.textContent'), '输入 HTTP(S) 地址开始浏览'); });
  await dimensions(720, 'light');
  await check('address field receives native typing and Enter opens the fixture page', async () => { await fill('.ab-address input', `${origin}/guest?page=A`); await enter(); await until('document.querySelector("iframe")?.contentDocument?.querySelector("#action") && !document.querySelector(".ab-start")', 'guest loaded'); assert.match(await activeGuest(), /验收工作台/); });
  await check('fresh translation props never dispose a connected browser or reset its loaded page', async () => {
    const before = await evaluate('UI_SMOKE.request("tabs", {action:"list"})');
    await evaluate('UI_SMOKE.refreshTranslationProps()');
    await delay(100);
    const after = await evaluate('UI_SMOKE.request("tabs", {action:"list"})');
    assert.equal(after.activeTabId, before.activeTabId);
    assert.deepEqual(after.tabs.map(tab => tab.url), before.tabs.map(tab => tab.url));
    assert.ok(await evaluate('document.querySelector("iframe")?.contentDocument?.querySelector("#action")'));
  });
  await check('plus, tab selection and closing preserve independent iframe page state', async () => {
    await evaluate('document.querySelector("iframe").contentDocument.querySelector("#remember").value="页面 A 保留内容"');
    await click('button[aria-label="新标签页"]'); await until('document.querySelectorAll("[role=tab]").length===2 && !!document.querySelector(".ab-start")', 'second tab');
    await fill('.ab-address input', `${origin}/guest?page=B`); await enter(); await until('[...document.querySelectorAll("iframe")].some(e=>e.contentDocument?.title.endsWith("B"))', 'second guest');
    await click('.ab-tab:first-child [role=tab]');
    assert.equal(await evaluate('document.querySelector(".ab-page[aria-hidden=false] iframe").contentDocument.querySelector("#remember").value'), '页面 A 保留内容');
    assert.equal(await evaluate('UI_SMOKE.getPages().length'), 2);
    const tabs = await evaluate('UI_SMOKE.request("tabs",{action:"list"})'); assert.equal(tabs.tabs.length, 2);
    await screenshot('tabs-720-light.png');
    await click('.ab-tab:nth-child(2) .ab-close'); await until('document.querySelectorAll("[role=tab]").length===1', 'tab released'); assert.equal(await evaluate('UI_SMOKE.getPages().length'), 1);
  });
  await check('toolbar back, forward and reload drive real navigation through the panel controls', async () => {
    await fill('.ab-address input', `${origin}/guest?page=B`); await enter(); await until('document.querySelector(".ab-page[aria-hidden=false] iframe")?.contentDocument?.title.endsWith("B")', 'history second entry');
    await evaluate('document.querySelector(".ab-page[aria-hidden=false] iframe").contentDocument.querySelector("#remember").value="页面 B 修改内容"');
    await click('button[aria-label="后退"]'); await until('document.querySelector(".ab-page[aria-hidden=false] iframe")?.contentDocument?.title.endsWith("A")', 'back to page A');
    await click('button[aria-label="前进"]'); await until('document.querySelector(".ab-page[aria-hidden=false] iframe")?.contentDocument?.title.endsWith("B")', 'forward to page B');
    assert.equal(await evaluate('document.querySelector(".ab-page[aria-hidden=false] iframe").contentDocument.querySelector("#remember").value'), '页面初始内容');
    await click('button[aria-label="刷新页面"]'); await until('document.querySelector(".ab-page[aria-hidden=false] iframe")?.contentDocument?.title.endsWith("B") && document.querySelector(".ab-page[aria-hidden=false] iframe").contentDocument.querySelector("#remember").value==="页面初始内容"', 'reloaded page B');
    await screenshot('navigation-720-light.png');
  });
  await check('actual Host tool to Broker to PageRunner returns the active iframe snapshot', async () => { const snap = await evaluate('UI_SMOKE.request("snapshot")'); assert.ok(snap.tabId); assert.ok(snap.elements.some(element => element.name === '调整这张卡片')); assert.equal(snap.untrusted, true); });
  await check('real React run has no uncaught exceptions or console errors', async () => { assert.deepEqual(report.consoleErrors, []); });
} catch (error) { report.failures.push({ name: 'UI verification infrastructure', error: error.message }); }
finally {
  clearTimeout(deadline);
  if (ws?.readyState === WebSocket.OPEN) {
    try { await evaluate('UI_SMOKE?.close()'); } catch {}
    for (const item of pending.values()) { clearTimeout(item.timeout); item.reject(Error('UI test finished')); } pending.clear(); ws.close();
  }
  child.kill('SIGTERM');
  let exited = child.exitCode !== null || await Promise.race([new Promise(resolve => child.once('exit', () => resolve(true))), delay(1500).then(() => false)]);
  if (!exited) { child.kill('SIGKILL'); exited = await Promise.race([new Promise(resolve => child.once('exit', () => resolve(true))), delay(1500).then(() => false)]); }
  report.cleanup.chromeStopped = Boolean(exited);
  hostLife.abort(); broker.dispose(); report.cleanup.hostDisposed = true;
  server.closeAllConnections?.(); await new Promise(resolve => server.close(resolve)); report.cleanup.serverStopped = !server.listening;
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
}
console.log(JSON.stringify(report, null, 2));
if (report.failures.length || !report.cleanup.chromeStopped || !report.cleanup.serverStopped) process.exitCode = 1;
