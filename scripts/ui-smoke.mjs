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
import { AnnotationArchive } from '../src/annotation-archive.js';
import { BrowserService, toolDefinitions } from '../src/index.js';

const project = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(project, '.reference/ui-verification/batches');
await mkdir(output, { recursive: true });
const report = { runtime: 'Isolated headless Chromium with real React BrowserPanel/SessionTabs/batch UI; real Node BrowserService/Broker/AnnotationArchive/toolDefinitions with fixture identities and HTTP transport; iframe page adapter, not Electron or DSH Desktop', checks: [], failures: [], screenshots: [], resources: [], consoleErrors: [], layouts: [], cleanup: {} };
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
report.sourceFiles = await Promise.all(['src/client.js', 'src/browser-shell.js', 'src/session-tabs.js', 'src/runner.js', 'src/page-runtime.js', 'src/annotations.js', 'src/annotation-ui.js', 'src/protocol.js', 'src/annotation-store.js', 'src/annotation-composer.js', 'src/annotation-archive.js', 'src/index.js', 'src/rpc.js'].map(async name => ({ name, sha256: createHash('sha256').update(await readFile(path.join(project, name))).digest('hex') })));
const bundle = await build({
  entryPoints: [path.join(project, 'test/fixtures/ui-preview.js')], bundle: true, format: 'iife', platform: 'browser', write: false,
  plugins: [{ name: 'isolated-ui-fixture', setup(builder) {
    builder.onResolve({ filter: /^react$/ }, () => ({ path: 'react-global', namespace: 'fixture' }));
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: 'export default window.React;', loader: 'js' }));
    builder.onResolve({ filter: /^\.\/electron-page\.js$/ }, args => args.importer === path.join(project, 'src/client.js') ? { path: path.join(project, 'test/fixtures/ui-preview.js') } : undefined);
    builder.onResolve({ filter: /^\.\/annotation-store\.js$/ }, args => args.importer === path.join(project, 'src/client.js') ? { path: path.join(project, 'test/fixtures/ui-preview.js') } : undefined);
  } }],
});
await writeFile(path.join(output, 'ui-bundle.js'), bundle.outputFiles[0].contents);
const themes = {
  light: { '--dsw-alias-bg-base': '#ffffff', '--dsw-alias-bg-layer-1': '#f6f7f9', '--dsw-alias-bg-layer-2': '#eceff4', '--dsw-alias-label-primary': '#20242d', '--dsw-alias-label-secondary': '#677181', '--dsw-alias-border-l2': '#d6dae2', '--dsw-alias-border-l3': '#e4e7ed', '--dsw-alias-state-business-primary': '#4d6bfe' },
  dark: { '--dsw-alias-bg-base': '#181b22', '--dsw-alias-bg-layer-1': '#20242d', '--dsw-alias-bg-layer-2': '#292f3a', '--dsw-alias-label-primary': '#e8ebf2', '--dsw-alias-label-secondary': '#a1aaba', '--dsw-alias-border-l2': '#424b5a', '--dsw-alias-border-l3': '#343c49', '--dsw-alias-state-business-primary': '#91a3ff' },
};
const shell = `<!doctype html><meta charset="utf-8"><title>Isolated React browser panel verification</title><style>html,body,#root{height:100%;width:100%;margin:0;overflow:hidden}body{font-family:system-ui,sans-serif}</style><div id="root"></div><script src="/react.js"></script><script src="/react-dom.js"></script><script src="/bundle.js"></script>`;
const guest = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>验收工作台</title><style>*{box-sizing:border-box}body{margin:0;background:#f4f6fa;color:#202937;font:14px/1.6 system-ui,sans-serif}main{max-width:620px;margin:0 auto;padding:28px 24px}.eyebrow{font-size:11px;letter-spacing:.12em;color:#65778e}h1{font-size:25px;line-height:1.3;margin:10px 0}p{color:#667386;margin:0 0 18px}.card{padding:20px;border:1px solid #e1e6ee;border-radius:15px;background:white;box-shadow:0 4px 18px #23345406}button{border:0;border-radius:9px;background:#4d6bfe;color:white;padding:11px 16px;font:inherit;cursor:pointer}input{display:block;width:100%;border:1px solid #d9e0ea;border-radius:8px;margin:8px 0 15px;padding:10px;font:inherit}output{display:block;margin-top:12px;color:#68788e;font-size:12px}.tag{font-size:11px;background:#edf1ff;color:#5369c2;padding:4px 8px;border-radius:5px;display:inline-block;margin-bottom:10px}</style><main><span class="eyebrow">ISOLATED DEVELOPMENT FIXTURE</span><h1 id="heading">可共享的页面工作台</h1><p>这个页面用于独立验证浏览器外壳和批注交互。</p><section class="card"><span class="tag">页面目标</span><h2 style="font-size:17px;margin:0 0 8px">给具体位置留下反馈</h2><p>选取下面的按钮，填写意见并加入会话草稿。</p><button id="action">调整这张卡片</button><output id="result">按钮尚未触发</output><label for="remember">标签页保留的文字</label><input id="remember" value="页面初始内容"></section></main><script>document.title+=' · '+(new URL(location.href).searchParams.get('page')||'A');window.earlyEvents=0;window.actionCount=0;for(const name of ['pointerdown','mousedown','click','keydown'])window.addEventListener(name,()=>window.earlyEvents++,true);document.querySelector('#action').addEventListener('click',()=>{window.actionCount++;document.querySelector('#result').textContent='按钮已触发 '+window.actionCount+' 次'});</script>`;
const hostLife = new AbortController(), broker = new Broker(), archive = new AnnotationArchive();
const ownerPeer = { principal: { kind: 'owner' }, signal: hostLife.signal };
const hostService = { ctx: { invocation: { peer: ownerPeer } }, broker, annotations: archive };
const hostTools = new Map(toolDefinitions({}, broker, archive).map(tool => [tool.name, tool]));
const rpcMethods = new Set(['connect', 'poll', 'reply', 'stop', 'disconnect', 'publishAnnotations']);
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
const profile = await mkdtemp(path.join(tmpdir(), 'dsh-browser-ui-smoke-'));
const child = spawn(executable, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-sync', '--disable-background-networking', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
let startupError, stderr = ''; child.once('error', error => { startupError = error; }); child.stderr.on('data', bytes => { stderr = (stderr + bytes).slice(-4000); });
let ws, sequence = 0; const pending = new Map();
const deadline = setTimeout(() => child.kill('SIGKILL'), 90000);
function call(method, params = {}) { return new Promise((resolve, reject) => { const id = ++sequence, timeout = setTimeout(() => { pending.delete(id); reject(Error(`CDP timeout: ${method}`)); }, 10000); pending.set(id, { resolve, reject, timeout }); ws.send(JSON.stringify({ id, method, params })); }); }
async function evaluate(expression) { const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text); return result.result.value; }
async function until(expression, message, timeout = 6000) { const start = Date.now(); while (Date.now() - start < timeout) { if (await evaluate(expression)) return; await delay(35); } throw Error(`Timed out: ${message}`); }
async function check(name, task) { try { await task(); report.checks.push(name); } catch (error) { let state; try { state = await evaluate('({address:document.querySelector(".ab-address input")?.value,pages:UI_SMOKE?.getPages(),annotationState:UI_SMOKE?.getAnnotationState(),alerts:[...document.querySelectorAll("[role=alert]")].map(e=>e.textContent),body:document.body.innerText.slice(0,1200)})'); } catch {} report.failures.push({ name, error: error.message, state }); } }
async function pointClick(x, y) { await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }); await call('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 }); await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 }); }
async function click(selector) { const point = await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('Missing control '+${JSON.stringify(selector)});const r=e.getBoundingClientRect();if(!r.width||!r.height)throw Error('Hidden control');return{x:r.left+r.width/2,y:r.top+r.height/2}})()`); await pointClick(point.x, point.y); }
async function fill(selector, text) { await click(selector); await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', modifiers: 4, windowsVirtualKeyCode: 65, commands: ['selectAll'] }); await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', modifiers: 4, windowsVirtualKeyCode: 65 }); await call('Input.insertText', { text }); }
async function enter() { await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', text: '\r', unmodifiedText: '\r', windowsVirtualKeyCode: 13 }); await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 }); }
async function screenshot(name) { const image = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }); const bytes = Buffer.from(image.data, 'base64'); assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a'); await writeFile(path.join(output, name), bytes); report.screenshots.push(name); }
async function dimensions(width, theme) { await call('Emulation.setDeviceMetricsOverride', { width, height: 840, deviceScaleFactor: 1, mobile: false }); await evaluate(`for(const [key,value] of Object.entries(${JSON.stringify(themes[theme])}))document.documentElement.style.setProperty(key,value);document.documentElement.style.colorScheme=${JSON.stringify(theme)}`); await delay(100); }
async function layout(width, theme, stage) { const metrics = await evaluate(`(()=>{const root=document.querySelector('[data-dsh-agent-browser]'),tool=document.querySelector('.ab-toolbar'),view=document.querySelector('.ab-viewport');return {rootWidth:root.clientWidth,rootScroll:root.scrollWidth,bodyScroll:document.body.scrollWidth,toolbarWidth:tool.clientWidth,toolbarScroll:tool.scrollWidth,viewportHeight:view.clientHeight,visibleControls:[...tool.querySelectorAll('button')].filter(e=>e.getBoundingClientRect().width>0).length}})()`); report.layouts.push({ width, theme, stage, ...metrics }); assert.equal(metrics.rootWidth, width); assert.ok(metrics.rootScroll <= width + 1, 'Root horizontal overflow'); assert.ok(metrics.bodyScroll <= width + 1, 'Body horizontal overflow'); assert.ok(metrics.toolbarScroll <= metrics.toolbarWidth + 1, 'Toolbar horizontal overflow'); assert.ok(metrics.viewportHeight > 120); }
async function pickGuest(selector) {
  await until('!!document.querySelector("[data-dsh-browser-selection-overlay]")', 'host picking layer');
  const point = await evaluate(`(()=>{const f=document.querySelector('.ab-page[aria-hidden=false] iframe'),r=f.getBoundingClientRect(),e=f.contentDocument.querySelector(${JSON.stringify(selector)});if(!e)throw Error('Missing guest target');const t=e.getBoundingClientRect();return{x:r.left+t.left+t.width/2,y:r.top+t.top+t.height/2}})()`);
  await pointClick(point.x, point.y); await until('!!document.querySelector(".ab-annotation-comment")', 'batch annotation editor');
}
async function saveAndContinue(comment) {
  await fill('.ab-annotation-comment', comment); await click('.ab-annotation-card button[type=submit]');
  await until('!document.querySelector(".ab-annotation-comment") && !!document.querySelector("[data-dsh-browser-selection-overlay]")', 'saved and ready for next target');
}
async function pausePicking() {
  await until('!!document.querySelector("button[aria-label=暂停选择]")', 'pause picking control');
  await click('button[aria-label="暂停选择"]'); await until('!document.querySelector("[data-dsh-browser-selection-overlay]")', 'picking paused');
}
let publishedBatch;
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
  for (const width of [400, 720]) await check(`new-tab controls fit ${width}px`, async () => { await dimensions(width, 'light'); await layout(width, 'light', 'new-tab'); assert.equal(await evaluate('document.querySelector(".ab-start h2").textContent'), '从这里开始探索'); });
  await dimensions(720, 'light');
  await check('address field receives native typing and Enter opens the fixture page', async () => { await fill('.ab-address input', `${origin}/guest?page=A`); await enter(); await until('document.querySelector("iframe")?.contentDocument?.querySelector("#action") && !document.querySelector(".ab-start")', 'guest loaded'); assert.match(await evaluate('document.querySelector("[role=tab]").textContent'), /验收工作台/); });
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
  await check('native Host overlay selection opens a compact editor without triggering guest handlers', async () => {
    await click('button[aria-label="选择页面元素"]'); await pickGuest('#action');
    assert.equal(await evaluate('document.querySelector("iframe").contentWindow.earlyEvents'), 0);
    assert.equal(await evaluate('document.querySelector("iframe").contentWindow.actionCount'), 0);
    assert.match(await evaluate('document.querySelector(".ab-annotation-excerpt").textContent'), /调整这张卡片/);
    await fill('.ab-annotation-comment', '第一条：增加按钮留白。');
    await screenshot('editor-720-light.png');
  });
  await check('read-only status and tab listing preserve the selected target and unsaved batch comment', async () => {
    const before = await evaluate('document.querySelector(".ab-annotation-comment").value');
    const status = await evaluate('UI_SMOKE.request("status")'); assert.equal(status.connected, true);
    const tabs = await evaluate('UI_SMOKE.request("tabs",{action:"list"})'); assert.equal(tabs.tabs.length, 1);
    assert.equal(await evaluate('document.querySelector(".ab-annotation-comment")?.value'), before);
    assert.equal(await evaluate('!!document.querySelector("[data-dsh-browser-selection-overlay]")'), true);
    assert.equal(await evaluate('UI_SMOKE.getDraft().insertions'), 0); assert.equal(await evaluate('UI_SMOKE.getDraft().sends'), 0);
  });
  await check('two saved comments retain two numbered Host markers and leave all draft content unpublished', async () => {
    await saveAndContinue('第一条：增加按钮留白。');
    await pickGuest('#heading'); await saveAndContinue('第二条：标题字号稍微缩小。'); await pausePicking();
    await until('document.querySelectorAll("[data-dsh-browser-saved-markers] button").length===2', 'two saved Host markers');
    assert.equal(await evaluate('document.querySelector(".ab-annotation-count").textContent'), '正在批注 · 2');
    assert.deepEqual(await evaluate('UI_SMOKE.request("annotations",{action:"list"})'), { batches: [] });
    const unconfirmed = await evaluate('UI_SMOKE.getAnnotationState()');
    await assert.rejects(() => evaluate(`UI_SMOKE.request('annotations',${JSON.stringify({ action: 'read', batchId: unconfirmed.batchId, revision: unconfirmed.revision })})`), /ANNOTATION_BATCH_NOT_FOUND/);
    assert.equal(await evaluate('UI_SMOKE.getDraft().referenceInsertions'), 0);
    assert.equal(await evaluate('document.querySelector("iframe").contentWindow.earlyEvents'), 0);
    await click('.ab-annotation-count'); await until('document.querySelectorAll(".ab-annotation-item").length===2', 'saved comments review');
    for (const width of [400, 720]) { await dimensions(width, 'light'); await layout(width, 'light', 'batch-review'); await screenshot(`batch-review-${width}-light.png`); }
  });
  await dimensions(720, 'light');
  await check('saved comments can be edited and deleted before explicit confirmation', async () => {
    await click('.ab-annotation-item:first-of-type button[aria-label="编辑批注"]');
    await until('!!document.querySelector(".ab-annotation-comment")', 'saved item editor');
    await saveAndContinue('第一条已编辑：按钮需要更宽的留白。'); await pausePicking();
    await click('.ab-annotation-count'); await until('document.querySelectorAll(".ab-annotation-item").length===2', 'edited review');
    assert.match(await evaluate('document.querySelector(".ab-annotation-item").textContent'), /第一条已编辑/);
    await click('.ab-annotation-item:last-of-type button[aria-label="删除批注"]');
    await until('document.querySelectorAll(".ab-annotation-item").length===1', 'saved comment removed');
    await until('document.querySelectorAll("[data-dsh-browser-saved-markers] button").length===1', 'removed marker cleared');
    await click('button[aria-label="继续选择元素"]'); await pickGuest('#heading'); await saveAndContinue('第二条重新保存：标题字号稍微缩小。'); await pausePicking();
    await until('document.querySelectorAll("[data-dsh-browser-saved-markers] button").length===2', 'two markers restored');
    assert.deepEqual(await evaluate('UI_SMOKE.request("annotations",{action:"list"})'), { batches: [] });
  });
  await check('saved marker visibility changes cause no guest DOM mutations or page input', async () => {
    await evaluate(`(()=>{const w=document.querySelector('iframe').contentWindow;w.markerMutations=0;w.markerObserver=new w.MutationObserver(records=>w.markerMutations+=records.length);w.markerObserver.observe(w.document.documentElement,{subtree:true,childList:true,attributes:true,characterData:true})})()`);
    await click('button[aria-label="隐藏标记"]'); await until('!document.querySelector("[data-dsh-browser-saved-markers]")', 'markers hidden');
    await click('button[aria-label="显示标记"]'); await until('document.querySelectorAll("[data-dsh-browser-saved-markers] button").length===2', 'markers visible');
    assert.equal(await evaluate('document.querySelector("iframe").contentWindow.markerMutations'), 0);
    assert.equal(await evaluate('document.querySelector("iframe").contentWindow.earlyEvents'), 0);
    await evaluate('document.querySelector("iframe").contentWindow.markerObserver.disconnect()');
    await screenshot('markers-720-light.png');
  });
  await check('explicit user confirmation publishes a Host batch and inserts a public reference chip preserving text and prior chips', async () => {
    await click('button[aria-label="加入会话"]'); await until('UI_SMOKE.getDraft().referenceInsertions===1', 'batch reference inserted');
    const draft = await evaluate('UI_SMOKE.getDraft()');
    assert.deepEqual(draft.document.slice(0, draft.originalDraft.length), draft.originalDraft);
    assert.equal(draft.document.filter(part => typeof part === 'object' && part.id === 'preserved-reference').length, 1);
    const references = draft.document.filter(part => part?.kind === 'reference'); assert.equal(references.length, 1);
    assert.equal(references[0].source, 'dsh-browser-annotations'); assert.match(references[0].label, /2 条注释/);
    assert.equal(draft.lastSpan.start, draft.lastSpan.end); assert.equal(draft.textInsertions, 0); assert.equal(draft.sends, 0); assert.equal(draft.focusCount, 1);
    const listed = await evaluate('UI_SMOKE.request("annotations",{action:"list"})'); assert.equal(listed.batches.length, 1); assert.equal(listed.batches[0].count, 2);
    const { batchId, revision } = listed.batches[0];
    publishedBatch = await evaluate(`UI_SMOKE.request('annotations',${JSON.stringify({ action: 'read', batchId, revision })})`);
    assert.equal(publishedBatch.items.length, 2); assert.equal(publishedBatch.confirmed, true); assert.equal(publishedBatch.untrustedPageContent, true);
    assert.match(publishedBatch.items[0].comment, /第一条已编辑/); assert.match(publishedBatch.items[1].comment, /第二条重新保存/);
    report.published = { batchId, revision, count: publishedBatch.items.length, draftMode: 'public-reference-chip' };
    await screenshot('published-720-light.png');
  });
  await check('reference serialization carries only bounded batch metadata and survives source re-registration', async () => {
    const before = await evaluate('UI_SMOKE.serializeReferences()'); assert.equal(before.length, 1);
    assert.ok(before[0].includes(`batchId=${publishedBatch.batchId}`)); assert.ok(before[0].includes(`revision=${publishedBatch.revision}`)); assert.ok(before[0].includes('count=2'));
    assert.ok(!before[0].includes('第一条') && !before[0].includes('第二条') && !before[0].includes('/guest') && !before[0].includes('button#action'));
    assert.ok(before[0].length < 800);
    await evaluate('UI_SMOKE.reRegisterReferenceSource()'); assert.deepEqual(await evaluate('UI_SMOKE.serializeReferences()'), before);
    await assert.rejects(() => evaluate('UI_SMOKE.serializeRawReference("ann-v1:malformed")'), /INVALID|UNAVAILABLE/);
  });
  await check('Host tools reject cross-session batch reads and resolves, and cannot publish unconfirmed content', async () => {
    const { batchId, revision } = publishedBatch;
    const args = { action: 'read', batchId, revision };
    assert.deepEqual(await evaluate('UI_SMOKE.agentForSession("ui-other-session","annotations",{action:"list"})'), { batches: [] });
    await assert.rejects(() => evaluate(`UI_SMOKE.agentForSession('ui-other-session','annotations',${JSON.stringify(args)})`), /ANNOTATION_BATCH_NOT_FOUND/);
    await assert.rejects(() => evaluate(`UI_SMOKE.agentForSession('ui-other-session','annotations',${JSON.stringify({ ...args, action: 'resolve' })})`), /ANNOTATION_BATCH_NOT_FOUND/);
    assert.throws(() => archive.publish('ui-fixture-session', { ...publishedBatch, confirmed: false, revision: revision + 10 }), /ANNOTATION_CONFIRMATION_REQUIRED/);
    assert.equal(archive.list('ui-fixture-session').batches.length, 1);
  });
  await check('editing a shared comment leaves its confirmed revision unchanged until explicit republishing', async () => {
    const listOpen = await evaluate('!!document.querySelector(".ab-annotation-item")'); if (!listOpen) await click('.ab-annotation-count');
    await until('document.querySelectorAll(".ab-annotation-item").length===2', 'published review');
    await click('.ab-annotation-item:first-of-type button[aria-label="编辑批注"]'); await until('!!document.querySelector(".ab-annotation-comment")', 'shared comment editor');
    await saveAndContinue('这一修改尚未再次确认，不应进入 Host 归档。'); await pausePicking();
    const { batchId, revision } = publishedBatch;
    const old = await evaluate(`UI_SMOKE.request('annotations',${JSON.stringify({ action: 'read', batchId, revision })})`);
    assert.equal(old.items[0].comment, publishedBatch.items[0].comment);
    const changed = await evaluate('UI_SMOKE.getAnnotationState()');
    await assert.rejects(() => evaluate(`UI_SMOKE.request('annotations',${JSON.stringify({ action: 'read', batchId: changed.batchId, revision: changed.revision })})`), /ANNOTATION_BATCH_NOT_FOUND/);
    assert.equal(archive.list('ui-fixture-session').batches.length, 1);
    assert.equal(await evaluate('UI_SMOKE.getDraft().referenceInsertions'), 1);
  });
  await check('Agent resolves only addressed confirmed items without connecting to or clearing the page', async () => {
    const { batchId, revision } = publishedBatch, annotationIds = [publishedBatch.items[0].id];
    const value = await evaluate(`UI_SMOKE.request('annotations',${JSON.stringify({ action: 'resolve', batchId, revision, annotationIds })})`);
    assert.equal(value.items[0].resolved, true); assert.equal(value.items[1].resolved, false);
    const newest = await evaluate('UI_SMOKE.request("annotations",{action:"list"})'); assert.equal(newest.batches[0].unresolved, 1);
  });
  await check('native guest input resumes after leaving the annotation workspace', async () => {
    await click('button[aria-label="退出批注"]'); await until('!document.querySelector("[data-dsh-browser-selection-overlay]")', 'annotation mode ended');
    const point = await evaluate(`(()=>{const f=document.querySelector('.ab-page[aria-hidden=false] iframe'),r=f.getBoundingClientRect(),t=f.contentDocument.querySelector('#action').getBoundingClientRect();return{x:r.left+t.left+t.width/2,y:r.top+t.top+t.height/2}})()`);
    await pointClick(point.x, point.y); assert.equal(await evaluate('document.querySelector("iframe").contentWindow.actionCount'), 1); assert.ok(await evaluate('document.querySelector("iframe").contentWindow.earlyEvents') > 0);
    await screenshot('completed-720-light.png');
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
  hostLife.abort(); broker.dispose(); archive.dispose(); report.cleanup.hostDisposed = true;
  server.closeAllConnections?.(); await new Promise(resolve => server.close(resolve)); report.cleanup.serverStopped = !server.listening;
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
}
console.log(JSON.stringify(report, null, 2));
if (report.failures.length || !report.cleanup.chromeStopped || !report.cleanup.serverStopped) process.exitCode = 1;
