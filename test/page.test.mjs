import test from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { pageScript } from '../src/page-runtime.js';
import { PageRunner } from '../src/runner.js';
import { Broker } from '../src/protocol.js';
import { ElectronPage } from '../src/electron-page.js';
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j7mQAAAAASUVORK5CYII=';
function fixture() {
  const window = new Window({ url: 'https://form.test/' });
  window.document.write('<title>Controlled form</title><form><label>Name <input id="name"></label><label>Notes<textarea id="notes"></textarea></label><button>Save</button><div id="result"></div></form><button hidden>Hidden</button>');
  // DOM emulator has no layout. Only geometry is stubbed; actual runtime code and events execute.
  window.Element.prototype.getClientRects = function () { return [{ x: 5, y: 5, width: 50, height: 20 }]; };
  window.Element.prototype.getBoundingClientRect = function () { window.target = this; return { left: 5, top: 5, width: 50, height: 20 }; };
  window.document.elementFromPoint = () => window.target;
  window.document.querySelector('form').addEventListener('submit', event => { event.preventDefault(); window.document.querySelector('#result').textContent = `Saved ${window.document.querySelector('input').value}`; });
  return window;
}
const command = (operation, args = {}) => ({ id: crypto.randomUUID(), expires: Date.now() + 5000, operation, args });
const reference = (snapshot, name) => ({ generation: snapshot.generation, documentId: snapshot.documentId, snapshotId: snapshot.snapshotId, ref: snapshot.elements.find(e => e.name === name).ref });
test('controlled protocol → open → snapshot → native plan → fill → click → observe → PNG', async () => {
  const window = fixture();
  const adapter = {
    origin: 'https://dsh.test', state: { ready: true },
    status() { return { ...this.state }; },
    async navigate(action, url) { this.state.url = url; },
    execute(script) { return window.eval(script); }, stop() {}, capture: async () => png,
    async input(plan, args, check) {
      check(); const target = window.target;
      if (plan.action === 'fill') { target.value = args.value; target.dispatchEvent(new window.Event('input', { bubbles: true })); }
      else if (plan.action === 'click') target.click();
    },
  };
  const runner = new PageRunner(adapter), broker = new Broker();
  const peer = { principal: { kind: 'owner' }, signal: new AbortController().signal }, { key } = broker.connect('s', 'w', peer);
  async function tool(operation, args = {}) {
    const pending = broker.request('s', operation, args, new AbortController().signal);
    const request = broker.poll(key, peer).commands.find(c => c.kind === 'request');
    try { const value = await runner.run(request); broker.reply(key, peer, request.id, request.epoch, { ok: true, value }); }
    catch (error) { broker.reply(key, peer, request.id, request.epoch, { ok: false, error: error.message }); }
    return pending;
  }
  assert.equal((await tool('navigate', { action: 'open', url: 'https://form.test/' })).url, 'https://form.test/');
  let snapshot = await tool('snapshot');
  assert(snapshot.elements.some(e => e.name === 'Name')); assert(!snapshot.elements.some(e => e.name === 'Hidden'));
  await tool('act', { ...reference(snapshot, 'Name'), action: 'fill', value: 'Ada' });
  await assert.rejects(tool('act', { ...reference(snapshot, 'Name'), action: 'fill', value: 'Wrong' }), /STALE_SNAPSHOT/);
  snapshot = await tool('snapshot');
  await tool('act', { ...reference(snapshot, 'Save'), action: 'click' });
  snapshot = await tool('snapshot'); assert.match(snapshot.text, /Saved Ada/);
  const shot = await tool('screenshot'); assert.equal(shot.dataUrl, png);
  runner.dispose(); broker.dispose(); await window.happyDOM.close();
});
test('DOM replacement, ambiguous names, obscured targets and navigation invalidate refs', async () => {
  const w = fixture();
  let snap = w.eval(pageScript('snapshot'));
  w.document.querySelector('input').replaceWith(w.document.createElement('input'));
  assert.throws(() => w.eval(pageScript('act', { ...reference({ ...snap, generation: 0 }, 'Name'), action: 'click' })), /STALE_SNAPSHOT/);
  w.document.body.innerHTML = '<button>Same</button><button>Same</button>';
  snap = w.eval(pageScript('snapshot'));
  assert.throws(() => w.eval(pageScript('act', { ...snap, role: 'button', name: 'Same', action: 'click' })), /AMBIGUOUS_TARGET/);
  snap = w.eval(pageScript('snapshot')); w.document.elementFromPoint = () => w.document.body;
  assert.throws(() => w.eval(pageScript('act', { ...snap, ref: snap.elements.find(e => e.name === 'Same').ref, action: 'click' })), /TARGET_OBSCURED/);
  const runner = new PageRunner({ status: () => ({ ready: true }), stop() {}, execute: script => w.eval(script) });
  snap = await runner.run(command('snapshot')); runner.invalidate();
  await assert.rejects(runner.run(command('act', { ...reference(snap, 'Same'), action: 'click' })), /STALE_DOCUMENT/);
  runner.dispose(); await w.happyDOM.close();
});
test('textarea plan works and file controls never become actionable', async () => {
  const w = fixture(); w.document.body.insertAdjacentHTML('beforeend', '<input type="file" aria-label="Upload">');
  const snap = w.eval(pageScript('snapshot'));
  assert(!snap.elements.some(e => e.name === 'Upload'));
  const plan = w.eval(pageScript('act', { ...reference({ ...snap, generation: 0 }, 'Notes'), action: 'fill', value: 'Text' }));
  assert.equal(plan.action, 'fill'); assert.notEqual(w.document.activeElement.tagName, 'TEXTAREA');
  await w.happyDOM.close();
});
test('cancelled observation never proceeds to a native action; expired requests never execute', async () => {
  let resolve, inputs = 0;
  const adapter = { status: () => ({ ready: true }), stop() {}, execute: () => new Promise(r => { resolve = r; }), input: () => { inputs++; } };
  const runner = new PageRunner(adapter), c = command('act', { generation: 0, action: 'click' });
  const pending = runner.run(c), rejection = assert.rejects(pending, /CANCELLED/);
  runner.cancel(c.id); resolve({ x: 10, y: 10, action: 'click' }); await rejection; assert.equal(inputs, 0);
  await assert.rejects(runner.run({ ...command('snapshot'), expires: 0 }), /REQUEST_EXPIRED/); runner.dispose();
});
test('Electron input adapter emits exact public event pairs and uses insertText', async () => {
  const calls = [], page = new ElectronPage(null, null, '', () => {}, () => {});
  page.element = { focus() { calls.push('focus'); }, sendInputEvent(event) { calls.push(event); }, async insertText(value) { calls.push(['insertText', value]); } };
  await page.input({ action: 'click', x: 10, y: 20 }, {}, () => {});
  assert.deepEqual(calls.filter(c => c.type).map(c => c.type), ['mouseMove', 'mouseDown', 'mouseUp']);
  calls.length = 0; await page.input({ action: 'fill' }, { value: 'Ada' }, () => {});
  assert.deepEqual(calls.filter(c => c.type).map(c => c.type), ['mouseMove', 'mouseDown', 'mouseUp', 'keyDown', 'keyUp']);
  assert.deepEqual(calls.at(-1), ['insertText', 'Ada']);
});
