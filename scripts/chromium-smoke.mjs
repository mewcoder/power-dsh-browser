import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { pageScript } from '../src/page-runtime.js';

const executable = process.env.CHROME_PATH || ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium'].find(existsSync);
if (!executable) throw new Error('Set CHROME_PATH to a Chrome/Chromium executable for this optional test.');
const output = new URL('../.reference/verification/', import.meta.url);
await mkdir(output, { recursive: true });
const fixture = await readFile(new URL('../test/fixtures/form.html', import.meta.url));
const profile = await mkdtemp(path.join(tmpdir(), 'power-dsh-browser-smoke-'));
const server = http.createServer((_req, res) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(fixture); });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const child = spawn(executable, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-sync', '--disable-background-networking', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
let startupError; child.once('error', error => { startupError = error; });
let stderr = ''; child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-4000); });
let ws, seq = 0; const pending = new Map();
const report = { runtime: 'isolated Chrome headless, not DSH Desktop', checks: [], failures: [] };
const stop = setTimeout(() => { child.kill('SIGKILL'); }, 45000);
function call(method, params = {}) { return new Promise((resolve, reject) => { const id = ++seq; const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 8000); pending.set(id, { resolve, reject, timer }); ws.send(JSON.stringify({ id, method, params })); }); }
async function evaluate(expression) { const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text); return result.result.value; }
async function check(name, task) { try { await task(); report.checks.push(name); } catch (error) { report.failures.push({ name, error: error.message }); } }
async function act(args) {
  const target = await evaluate(pageScript('act', args));
  if (['click', 'fill', 'press'].includes(args.action)) {
    await call('Input.dispatchMouseEvent', { type: 'mousePressed', x: target.x, y: target.y, button: 'left', clickCount: 1 });
    await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: target.x, y: target.y, button: 'left', clickCount: 1 });
  }
  if (args.action === 'fill') {
    await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', modifiers: 4, windowsVirtualKeyCode: 65, commands: ['selectAll'] });
    await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', modifiers: 4, windowsVirtualKeyCode: 65 });
    await call('Input.insertText', { text: args.value });
  } else if (args.action === 'press') {
    await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  } else if (args.action === 'scroll') {
    await call('Input.dispatchMouseEvent', { type: 'mouseWheel', x: target.x, y: target.y, deltaX: 0, deltaY: args.deltaY });
  }
  return target;
}
try {
  let port;
  for (let i = 0; i < 200; i++) { try { port = Number((await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]); if (port) break; } catch {} if (startupError) throw startupError; if (child.exitCode !== null) throw new Error(`Chrome exited: ${stderr}`); await delay(50); }
  if (!port) throw new Error(`Chrome did not start: ${stderr}`);
  const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const page = pages.find(item => item.type === 'page');
  assert.ok(page?.webSocketDebuggerUrl);
  ws = new WebSocket(page.webSocketDebuggerUrl);
  ws.addEventListener('message', event => { const message = JSON.parse(event.data); const item = pending.get(message.id); if (!item) return; pending.delete(message.id); clearTimeout(item.timer); message.error ? item.reject(new Error(message.error.message)) : item.resolve(message.result); });
  await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', reject, { once: true }); });
  await call('Page.navigate', { url: origin });
  for (let i = 0; i < 100; i++) { if (await evaluate('document.readyState === "complete" && !!document.querySelector("#form")')) break; await delay(30); }
  const snapshot = () => evaluate(pageScript('snapshot'));
  await check('snapshot contains visible labeled form elements', async () => { const s = await snapshot(); assert.equal(s.title, 'DSH Browser 验收表单'); assert.ok(s.elements.some(el => el.name === '姓名')); assert.equal(s.untrusted, true); });
  await check('native fill replaces existing text input', async () => {
    let s = await snapshot(), el = s.elements.find(el => el.name === '姓名');
    await act({ documentId: s.documentId, snapshotId: s.snapshotId, ref: el.ref, action: 'fill', value: '先前内容' });
    assert.equal(await evaluate('document.querySelector("#name").value'), '先前内容');
    s = await snapshot(); el = s.elements.find(el => el.name === '姓名');
    await act({ documentId: s.documentId, snapshotId: s.snapshotId, ref: el.ref, action: 'fill', value: '测试用户' });
    assert.equal(await evaluate('document.querySelector("#name").value'), '测试用户');
  });
  await check('click submits the form and changes rendered state', async () => { const s = await snapshot(); const el = s.elements.find(el => el.name === '提交表单'); await act({ documentId: s.documentId, snapshotId: s.snapshotId, ref: el.ref, action: 'click' }); assert.match(await evaluate('document.querySelector("#result").textContent'), /已提交：测试用户/); });
  await check('old snapshot is rejected after target replacement', async () => { const s = await snapshot(); const el = s.elements.find(el => el.name === '原目标'); await evaluate('document.querySelector("#replace").click()'); await assert.rejects(() => evaluate(pageScript('act', { documentId: s.documentId, snapshotId: s.snapshotId, ref: el.ref, action: 'click' })), /STALE|TARGET/); });
  await check('textarea is fillable', async () => { await evaluate('document.querySelector("#form").prepend(Object.assign(document.createElement("textarea"), { id: "extra", placeholder: "补充说明" }))'); const s = await snapshot(); const el = s.elements.find(el => el.name === '补充说明'); assert.ok(el); await act({ documentId: s.documentId, snapshotId: s.snapshotId, ref: el.ref, action: 'fill', value: '多行内容' }); assert.equal(await evaluate('document.querySelector("#extra").value'), '多行内容'); });
  await check('screenshot is real PNG data', async () => { const image = await call('Page.captureScreenshot', { format: 'png' }); const bytes = Buffer.from(image.data, 'base64'); assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a'); await writeFile(new URL('chromium-form.png', output), bytes); });
  await check('page viewport reference supports native scrolling', async () => {
    await evaluate('document.body.insertAdjacentHTML("beforeend", "<div style=height:2000px></div>")');
    const s = await snapshot(); assert.ok(s.elements.some(el => el.ref === 'page' && el.scrollOnly));
    const before = await evaluate('scrollY');
    await act({ documentId: s.documentId, snapshotId: s.snapshotId, ref: 'page', action: 'scroll', deltaY: 400 });
    for (let i = 0; i < 30 && await evaluate('scrollY') === before; i++) await delay(20);
    assert.ok(await evaluate('scrollY') > before);
  });
  await check('full navigation invalidates the previous document references', async () => {
    const previous = await snapshot();
    await call('Page.navigate', { url: `${origin}/?second` });
    for (let i = 0; i < 100; i++) {
      if (await evaluate('location.search === "?second" && document.readyState === "complete" && !!document.querySelector("#form")')) break;
      await delay(30);
    }
    await assert.rejects(() => evaluate(pageScript('act', { documentId: previous.documentId, snapshotId: previous.snapshotId, ref: 'page', action: 'scroll', deltaY: 100 })), /STALE/);
    assert.notEqual((await snapshot()).documentId, previous.documentId);
  });
} catch (error) { report.failures.push({ name: 'test infrastructure', error: error.message }); }
finally {
  clearTimeout(stop);
  for (const p of pending.values()) { clearTimeout(p.timer); p.reject(new Error('Test finished')); } pending.clear();
  if (ws?.readyState === WebSocket.OPEN) ws.close();
  child.kill('SIGTERM');
  const exited = child.exitCode !== null || await Promise.race([new Promise(resolve => child.once('exit', () => resolve(true))), delay(1500).then(() => false)]);
  if (!exited) child.kill('SIGKILL');
  await new Promise(resolve => server.close(resolve));
  await writeFile(new URL('chromium-report.json', output), JSON.stringify(report, null, 2));
}
console.log(JSON.stringify(report, null, 2));
if (report.failures.length) process.exitCode = 1;
