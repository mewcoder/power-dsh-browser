import test from 'node:test';
import assert from 'node:assert/strict';
import { ElectronPage } from '../src/electron-page.js';
import { PageRunner } from '../src/runner.js';
import { Broker } from '../src/protocol.js';
import { storeScreenshot, toolDefinitions } from '../src/index.js';
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j7mQAAAAASUVORK5CYII=';
function frame() {
  const target = new EventTarget(), listeners = new Map();
  return Object.assign(target, {
    addEventListener(name, fn) { EventTarget.prototype.addEventListener.call(this, name, fn); listeners.set(fn, name); },
    removeEventListener(name, fn) { EventTarget.prototype.removeEventListener.call(this, name, fn); listeners.delete(fn); },
    listeners, canGoBack: () => true, canGoForward: () => true, stop() {},
    fire(name, fields = {}) { this.dispatchEvent(Object.assign(new Event(name), fields)); },
    loadURL() { return Promise.resolve(); }, goBack() { queueMicrotask(() => this.fire('did-navigate-in-page', { isMainFrame: true })); }, reload() {},
  });
}
test('failed document remains navigable; loadURL and same-document history settle and clean listeners', async () => {
  const page = new ElectronPage(null, null, 'https://dsh.test', () => {}, () => {});
  page.element = frame(); page.state.initialized = true; page.state.ready = false;
  await page.navigate('open', 'https://form.test/', new AbortController().signal);
  assert.equal(page.element.listeners.size, 0);
  await page.navigate('back', undefined, new AbortController().signal);
  assert.equal(page.element.listeners.size, 0);
  const controller = new AbortController();
  const reload = page.navigate('reload', undefined, controller.signal), rejected = assert.rejects(reload, /abort/i);
  controller.abort(); await rejected; assert.equal(page.element.listeners.size, 0);
});
test('cancelled nonsettling Electron observation releases runner and ignores late outcome', async () => {
  let resolve, first = true;
  const runner = new PageRunner({ status: () => ({ ready: true }), stop() {}, execute() { if (first) { first = false; return new Promise(r => { resolve = r; }); } return Promise.resolve({ text: 'fresh' }); } });
  const command = { id: 'first', expires: Date.now() + 1000, operation: 'snapshot', args: {} };
  const pending = runner.run(command), rejected = assert.rejects(pending, /CANCELLED/);
  runner.cancel('first'); await rejected;
  assert.equal((await runner.run({ ...command, id: 'next' })).text, 'fresh');
  resolve({ text: 'old' }); await Promise.resolve(); assert.equal(runner.active, null); runner.dispose();
});
test('navigation during native mouse move prevents down; cancellation after down releases button', async () => {
  const events = [], page = new ElectronPage(null, null, '', () => {}, () => {});
  let changed = false;
  page.element = { focus() {}, async sendInputEvent(event) { events.push(event.type); if (event.type === 'mouseMove') changed = true; } };
  await assert.rejects(page.input({ action: 'click', x: 10, y: 10 }, {}, () => { if (changed) throw Error('DOCUMENT_CHANGED'); }), /DOCUMENT_CHANGED/);
  assert.deepEqual(events, ['mouseMove']);
  changed = false; events.length = 0;
  page.element.sendInputEvent = async event => { events.push(event.type); if (event.type === 'mouseDown') throw Error('input failed'); };
  await assert.rejects(page.input({ action: 'click', x: 10, y: 10 }, {}, () => {}), /input failed/);
  assert.deepEqual(events, ['mouseMove', 'mouseDown', 'mouseUp']);
});
test('screenshot validates PNG and renders actual attachment content with image-capable route', async () => {
  const ctx = { get: name => ({ attachments: { saveImages: async images => { assert.equal(images[0].mediaType, 'image/png'); assert.equal(images[0].data[0], 137); return [{ id: 'image-test', mediaType: 'image/png' }]; } }, llm: { resolveModelInfo: async () => ({ inputModalities: ['image'] }) } })[name] };
  const exec = { signal: new AbortController().signal, agent: { options: { provider: 'test', model: 'vision' }, session: { requestHeader() {} } } };
  const result = await storeScreenshot(ctx, exec, { dataUrl: png, generation: 1 });
  const tool = toolDefinitions(ctx, {}).find(t => t.name === 'browser_screenshot');
  assert.deepEqual(tool.output.render({}, result), [{ type: 'image', attachment: result.attachment }]);
  await assert.rejects(storeScreenshot(ctx, exec, { dataUrl: 'data:image/png;base64,AAAA' }), /INVALID_SCREENSHOT/);
});
test('navigation may invalidate its document; observing an old document cancels immediately', async () => {
  let runner;
  const adapter = { origin: 'https://dsh.test', status: () => ({ ready: true }), stop() {}, async navigate() { runner.invalidate(); }, execute: () => new Promise(() => {}) };
  runner = new PageRunner(adapter);
  const command = { id: 'nav', expires: Date.now() + 1000, operation: 'navigate', args: { action: 'open', url: 'https://form.test/' } };
  assert.equal((await runner.run(command)).ready, true);
  const pending = runner.run({ ...command, id: 'observe', operation: 'snapshot', args: {} });
  const rejected = assert.rejects(pending, /DOCUMENT_CHANGED/);
  runner.invalidate(); await rejected; assert.equal(runner.active, null); runner.dispose();
});
test('stop during screenshot model admission prevents storage and rejects immediately', async () => {
  const broker = new Broker(), peer = { principal: { kind: 'owner' }, signal: new AbortController().signal }, { key } = broker.connect('s', 'w', peer);
  let resolveModel, stores = 0;
  const fence = broker.guard('s', new AbortController().signal);
  const ctx = { get: name => name === 'llm' ? { resolveModelInfo: () => new Promise(resolve => { resolveModel = resolve; }) } : { saveImages: async () => { stores++; return []; } } };
  const exec = { signal: fence.signal, agent: { options: { provider: 'test', model: 'vision' }, session: { requestHeader() {} } } };
  const pending = storeScreenshot(ctx, exec, { dataUrl: png }, fence.assert), rejected = assert.rejects(pending, /STOPPED/);
  broker.stop(broker.panel(key, peer)); await rejected;
  resolveModel({ inputModalities: ['image'] }); await Promise.resolve(); assert.equal(stores, 0);
  fence.dispose(); broker.dispose();
});
