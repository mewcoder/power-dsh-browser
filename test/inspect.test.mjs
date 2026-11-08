import test from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { pageScript } from '../src/page-runtime.js';
import { PageRunner } from '../src/runner.js';
import { ElectronPage } from '../src/electron-page.js';
function fixture() {
  const window = new Window({ url: 'https://inspect.test/page' });
  window.document.write('<title>Inspection fixture</title><main id="page" class="layout" style="display:flex;gap:12px;padding:8px;color:rgb(1,2,3)"><button id="go" class="primary" title="Continue" onclick="throw 1">Go now</button><a href="/next">Next</a><input id="input" placeholder="Search" value="INITIAL_CONTROL_CONTENT"><textarea>TEXTAREA_CONTENT</textarea><select><option>OPTION_CONTENT</option></select><div contenteditable="true"><b>EDITABLE_CONTENT</b></div><img src="/logo.png" alt="Logo"><div hidden>HIDDEN_CONTENT</div><script>INTERNAL_SCRIPT_TEXT</script><style>INTERNAL_STYLE_TEXT</style></main>');
  window.Element.prototype.getClientRects = () => [{ left: 8, top: 12, width: 200, height: 40 }];
  window.Element.prototype.getBoundingClientRect = () => ({ x: 8, y: 12, left: 8, top: 12, width: 200, height: 40 });
  Object.defineProperties(window.document.querySelector('img'), { naturalWidth: { value: 320 }, naturalHeight: { value: 90 } });
  window.document.querySelector('input').value = 'LIVE_CONTROL_CONTENT';
  return window;
}
const inspect = (window, args = {}) => window.eval(pageScript('inspect', args));
const flatten = node => node ? [node, ...node.children.flatMap(flatten)] : [];
test('inspect returns bounded real layout/style attributes and image dimensions without markup or control contents', async () => {
  const window = fixture(), result = inspect(window, { selector: 'main', depth: 5 });
  assert.equal(result.matchCount, 1); assert.equal(result.tree.tag, 'main'); assert.equal(result.tree.id, 'page');
  assert.equal(result.tree.styles.display, 'flex'); assert.equal(result.tree.styles.gap, '12px');
  assert.deepEqual({ ...result.tree.rect }, { x: 8, y: 12, width: 200, height: 40 });
  assert.equal(result.viewport.width, window.innerWidth); assert.equal(result.viewport.height, window.innerHeight);
  assert.equal(result.images[0].src, 'https://inspect.test/logo.png'); assert.equal(result.images[0].naturalWidth, 320);
  const text = JSON.stringify(result);
  for (const forbidden of ['INITIAL_CONTROL_CONTENT', 'LIVE_CONTROL_CONTENT', 'TEXTAREA_CONTENT', 'OPTION_CONTENT', 'EDITABLE_CONTENT', 'HIDDEN_CONTENT', 'INTERNAL_SCRIPT_TEXT', 'INTERNAL_STYLE_TEXT', 'onclick', 'outerHTML']) assert(!text.includes(forbidden), forbidden);
  const button = flatten(result.tree).find(node => node.id === 'go'); assert.equal(button.text, 'Go now'); assert.equal(button.attributes.title, 'Continue');
  await window.happyDOM.close();
});
test('fresh selector inspection is non-mutating and does not consume a current snapshot', async () => {
  const window = fixture(), input = window.document.querySelector('input'); input.focus(); input.setSelectionRange(2, 5);
  const snapshot = window.eval(pageScript('snapshot'));
  const button = snapshot.elements.find(element => element.name === 'Continue');
  const reference = { ref: button.ref, documentId: snapshot.documentId, snapshotId: snapshot.snapshotId };
  let mutations = 0; const observer = new window.MutationObserver(records => { mutations += records.length; }); observer.observe(window.document, { subtree: true, attributes: true, childList: true, characterData: true });
  inspect(window); inspect(window, reference); inspect(window, reference);
  await Promise.resolve(); assert.equal(mutations, 0); assert.equal(window.document.activeElement, input); assert.equal(input.selectionStart, 2); assert.equal(input.selectionEnd, 5);
  window.document.querySelector('button').setAttribute('title', 'Changed');
  assert.throws(() => inspect(window, reference), /STALE_SNAPSHOT/);
  assert.throws(() => window.eval(pageScript('act', { ...reference, action: 'click' })), /STALE_SNAPSHOT/);
  observer.disconnect(); await window.happyDOM.close();
});
test('selectors and limits are validated, matches are counted, and depth/node/60k budgets truncate safely', async () => {
  const window = fixture();
  assert.throws(() => inspect(window, { selector: '[' }), /INVALID_SELECTOR/);
  assert.throws(() => inspect(window, { selector: 'x'.repeat(513) }), /INVALID_SELECTOR/);
  assert.throws(() => inspect(window, { depth: 6 }), /INVALID_INSPECT_LIMIT/);
  assert.throws(() => inspect(window, { limit: 81 }), /INVALID_INSPECT_LIMIT/);
  assert.equal(inspect(window, { selector: 'button,a' }).matchCount, 2);
  assert.equal(inspect(window, { selector: '#missing' }).tree, null);
  window.document.body.innerHTML = `<section>${'<div class="sized" style="padding:20px;font-family:monospace;border:1px solid red">Visible text</div>'.repeat(200)}</section>`;
  const limited = inspect(window, { depth: 5, limit: 80 }); assert(limited.nodeCount <= 80); assert(limited.truncated); assert(JSON.stringify(limited).length < 60000);
  const shallow = inspect(window, { depth: 0 }); assert.equal(shallow.tree.children.length, 0); assert.equal(shallow.truncated, true);
  await window.happyDOM.close();
});
test('inspect never invokes outerHTML or live input values and strips URL userinfo', async () => {
  const window = fixture(), image = window.document.querySelector('img'), target = new URL('https://cdn.test/logo.png'); target.username = 'fixture-user';
  image.setAttribute('src', target.href);
  Object.defineProperty(window.Element.prototype, 'outerHTML', { get() { throw Error('outerHTML must not be read'); }, configurable: true });
  Object.defineProperty(window.document.querySelector('input'), 'value', { get() { throw Error('value must not be read'); }, configurable: true });
  const result = inspect(window, { selector: 'main' }); assert(!JSON.stringify(result).includes('fixture-user')); assert.equal(result.images[0].src, 'https://cdn.test/logo.png');
  await window.happyDOM.close();
});
test('runner inspect/console retain cancellation and document fences without busy notifications or stopping navigation', async () => {
  const activity = []; let stopped = 0;
  const adapter = { status: () => ({ ready: true, initialized: true }), execute: async () => ({ tree: null }), readConsole: async () => ({ messages: [] }), stop() { stopped++; } };
  const runner = new PageRunner(adapter, value => activity.push(value));
  const command = (operation, args = {}) => ({ id: crypto.randomUUID(), expires: Date.now() + 1000, operation, args });
  assert.equal((await runner.run(command('inspect', { generation: 0 }))).generation, 0); await runner.run(command('console'));
  await assert.rejects(runner.run(command('inspect', { generation: 100 })), /STALE_DOCUMENT/);
  adapter.status = () => ({ initialized: true, ready: false }); await runner.run(command('console'));
  await assert.rejects(runner.run(command('inspect')), /PAGE_NOT_READY/);
  adapter.status = () => ({ initialized: true, ready: true }); adapter.execute = () => new Promise(() => {});
  const pending = runner.run({ ...command('inspect'), expires: Date.now() + 5 }); await assert.rejects(pending, /TIMEOUT/);
  assert.deepEqual(activity, []); assert.equal(stopped, 0); runner.dispose();
});
test('native console-message ring is capped, sanitized, cleared on full navigation and released on disposal', async () => {
  const window = fixture(), originalDocument = globalThis.document; globalThis.document = window.document;
  let frame, releases = 0;
  const bridge = { acquire: async () => ({ lease: 'owned-lease', partition: 'owned-partition' }), onOpenRequested: () => () => {}, release: async () => { releases++; } };
  const container = { appendChild(element) { frame = element; queueMicrotask(() => frame.dispatchEvent(new window.Event('dom-ready'))); } };
  const page = new ElectronPage(bridge, container, 'https://dsh.test', () => {}, () => {});
  try {
    await page.mount('session:test', new AbortController().signal);
    const event = (name, values) => frame.dispatchEvent(Object.assign(new window.Event(name), values));
    for (let index = 0; index < 55; index++) event('console-message', { level: 2, message: `entry-${index}` + 'x'.repeat(2100), sourceId: 'https://fixture-user@assets.test/main.js', line: index });
    const ring = page.readConsole(); assert.equal(page.consoleMessages.length, 50); assert(JSON.stringify(ring).length <= 60000); assert(ring.messages.length > 0 && ring.messages.length <= 50); assert.equal(ring.dropped + ring.messages.length, 55); assert(ring.truncated); assert.equal(ring.messages[0].message.length, 2000); assert.equal(ring.messages[0].line, ring.dropped); assert.equal(ring.messages.at(-1).line, 54); assert.equal(ring.messages[0].sourceId, 'https://assets.test/main.js');
    event('did-start-navigation', { isMainFrame: false }); assert.deepEqual(page.readConsole(), ring);
    event('did-start-navigation', { isMainFrame: true, isInPlace: true }); assert.deepEqual(page.readConsole(), ring);
    event('did-start-navigation', { isMainFrame: true, isInPlace: false }); assert.equal(page.readConsole().messages.length, 0);
    event('console-message', { level: 3, message: 'Load failed', line: 4, sourceId: 'https://assets.test/main.js' });
    assert.equal(page.readConsole({ clear: true }).messages.length, 1); assert.equal(page.readConsole().messages.length, 0);
    event('console-message', { level: 1, message: 'Before disposal', line: 1, sourceId: 'VM12' });
    await page.dispose(); assert.equal(page.readConsole().messages.length, 0); assert.equal(releases, 1);
  } finally { globalThis.document = originalDocument; await window.happyDOM.close(); }
});
