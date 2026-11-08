import test from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { ANNOTATION_LIMITS, annotationScript, annotationMarkerScript, createAnnotationController, formatAnnotationCard, sanitizeSelection } from '../src/annotations.js';
import { createAnnotationDraftInserter } from '../src/annotation-ui.js';
import { registerAnnotationReferenceSource, createAnnotationBatchInserter, formatAnnotationBatchText } from '../src/annotation-composer.js';

function fixture(markup = '<a id="target" href="https://target.test/">Open target</a><form><button>Submit</button></form>') {
  const window = new Window({ url: 'https://page.test/demo' });
  window.document.write(`<title>Demo page</title>${markup}`);
  const element = new window.EventTarget();
  let target = window.document.querySelector('#target');
  window.document.elementFromPoint = () => target;
  window.Element.prototype.getBoundingClientRect = function () { return { left: 10, top: 20, width: 80, height: 30 }; };
  const page = { element, status: () => ({ ready: true }), execute: script => Promise.resolve(window.eval(script)) };
  const event = (name, node = layer(), init = {}) => {
    const e = new window.MouseEvent(name, { bubbles: true, cancelable: true, clientX: 20, clientY: 30, button: 0, ...init });
    node.dispatchEvent(e); return e;
  };
  const layer = () => window.document.querySelector('[data-dsh-browser-annotation="capture"]');
  return { window, page, element, event, layer, setTarget: next => { target = next; } };
}
const turn = () => new Promise(resolve => setTimeout(resolve, 0));
test('picker catches the complete selection gesture, locks the target, and keeps its marker', async () => {
  const f = fixture(), { window: w } = f;
  let linkClicks = 0, submissions = 0;
  w.document.querySelector('a').addEventListener('click', () => linkClicks++);
  w.document.querySelector('form').addEventListener('submit', e => { e.preventDefault(); submissions++; });
  w.eval(annotationScript('start', 'test_pick'));
  assert.equal(f.event('pointermove').defaultPrevented, true);
  const outline = w.document.querySelector('[data-dsh-browser-annotation="outline"]');
  assert.equal(outline.style.left, '10px');
  for (const name of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click', 'dblclick', 'auxclick', 'contextmenu']) assert.equal(f.event(name).defaultPrevented, true, name);
  const selected = w.eval(annotationScript('poll', 'test_pick'));
  assert.equal(selected.phase, 'selected'); assert.equal(selected.selection.text, 'Open target');
  assert.match(selected.selection.selector, /#target/); assert.equal(outline.firstChild.style.display, 'block');
  f.setTarget(w.document.querySelector('button')); f.event('pointerdown'); f.event('click');
  assert.equal(w.eval(annotationScript('poll', 'test_pick')).selection.tag, 'a');
  assert.equal(linkClicks, 0); assert.equal(submissions, 0); assert.equal(w.location.href, 'https://page.test/demo');
  w.eval(annotationScript('cancel', 'test_pick')); assert.equal(f.layer(), null);
  w.document.querySelector('a').addEventListener('click', e => e.preventDefault());
  f.event('click', w.document.querySelector('a')); assert.equal(linkClicks, 1);
  await w.happyDOM.close();
});
test('Escape, pointer cancellation and pagehide remove guest capture and event listeners', async () => {
  for (const name of ['Escape', 'pointercancel', 'pagehide']) {
    const f = fixture(), w = f.window;
    w.eval(annotationScript('start', 'cancel_me'));
    if (name === 'Escape') w.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
    else f.event(name, name === 'pagehide' ? w : f.layer());
    assert.equal(f.layer(), null, name); assert.equal(w.eval(annotationScript('poll', 'cancel_me')).phase, 'idle');
    assert.equal(f.event('pointerdown', w.document.body).defaultPrevented, false);
    await w.happyDOM.close();
  }
});
test('bounded capture never reads outerHTML, controls, editable contents or the whole document', async () => {
  const f = fixture('<div id="target">Visible <input value="private-input"><textarea>private-textarea</textarea><div contenteditable="true">private-edit</div><script>private-script</script><span>' + 'x'.repeat(6000) + '</span></div>');
  const w = f.window, target = w.document.querySelector('#target');
  Object.defineProperty(target, 'outerHTML', { get() { throw new Error('must not serialize DOM'); } });
  w.eval(annotationScript('start', 'bounded')); f.event('pointerdown');
  const selection = w.eval(annotationScript('poll', 'bounded')).selection;
  assert(selection.outerHTML.length <= ANNOTATION_LIMITS.html); assert(selection.text.length <= ANNOTATION_LIMITS.text);
  assert(selection.truncated); assert(!selection.outerHTML.includes('private-')); assert(!selection.text.includes('private-'));
  w.eval(annotationScript('start', 'root')); f.setTarget(w.document.body); f.event('pointerdown');
  assert.equal(w.eval(annotationScript('poll', 'root')).phase, 'selecting');
  w.eval(annotationScript('cancel', 'root')); await w.happyDOM.close();
});
test('restarting replaces the previous picker and tokens prevent stale cleanup from deleting the new one', async () => {
  const f = fixture(), w = f.window;
  w.eval(annotationScript('start', 'old')); w.eval(annotationScript('start', 'new'));
  assert.equal(w.document.querySelectorAll('[data-dsh-browser-annotation="capture"]').length, 1);
  w.eval(annotationScript('cancel', 'old')); assert(f.layer());
  f.event('pointerdown'); assert.equal(w.eval(annotationScript('poll', 'new')).phase, 'selected');
  w.eval(annotationScript('cancel', 'new')); await w.happyDOM.close();
});
test('page-bound controller emits sanitized selection and cancels on main-frame navigation and dispose', async () => {
  const f = fixture(); let selected;
  const selection = new Promise(resolve => { selected = resolve; });
  const controller = createAnnotationController(f.page, { onSelection: selected, pollInterval: 80 });
  await controller.start(); f.event('pointerdown');
  const value = await selection; assert.equal(value.tag, 'a'); assert(Object.isFrozen(value));
  assert.equal(controller.getSnapshot().phase, 'selected');
  const subframe = new f.window.Event('did-start-navigation'); subframe.isMainFrame = false;
  f.element.dispatchEvent(subframe); assert.equal(controller.getSnapshot().phase, 'selected');
  const navigation = new f.window.Event('did-start-navigation'); navigation.isMainFrame = true;
  f.element.dispatchEvent(navigation); assert.equal(controller.getSnapshot().phase, 'idle'); await turn(); assert.equal(f.layer(), null);
  await controller.start(); controller.dispose(); await turn(); assert.equal(f.layer(), null);
  await controller.start(); assert.equal(f.layer(), null);
  await f.window.happyDOM.close();
});
test('late guest installation after cancellation is cleaned and cannot publish a selection', async () => {
  const f = fixture(); let startScript, finish, callbacks = 0;
  const page = { ...f.page, execute(script) {
    if (!startScript) { startScript = script; return new Promise(resolve => { finish = resolve; }); }
    return f.page.execute(script);
  } };
  const controller = createAnnotationController(page, { onSelection: () => callbacks++ });
  const pending = controller.start(); await turn(); controller.cancel();
  finish(f.window.eval(startScript)); await pending; await turn();
  assert.equal(f.layer(), null); assert.equal(callbacks, 0); assert.equal(controller.getSnapshot().phase, 'idle');
  controller.dispose(); await f.window.happyDOM.close();
});
test('host-side coordinate picking never reaches earlier guest window input listeners', async () => {
  const f = fixture(); let earlyEvents = 0, selected;
  for (const name of ['pointerdown', 'mousedown', 'click', 'keydown']) f.window.addEventListener(name, () => earlyEvents++, true);
  const selection = new Promise(resolve => { selected = resolve; });
  const controller = createAnnotationController(f.page, { pollInterval: 80, onSelection: selected });
  await controller.start(); await controller.hoverAt(20, 30); await controller.pickAt(20, 30);
  assert.equal((await selection).tag, 'a'); assert.equal(earlyEvents, 0);
  assert.equal(controller.getSnapshot().phase, 'selected');
  await controller.unlock(); assert.equal(f.layer(), null); assert.equal(controller.getSnapshot().phase, 'idle');
  controller.dispose(); await f.window.happyDOM.close();
});
test('unlock awaits guest cleanup acknowledgement and rejects failures instead of allowing input', async () => {
  const f = fixture(); let stopNow, first = true;
  const page = { ...f.page, execute(script) {
    if (first) { first = false; return f.page.execute(script); }
    // Hold poll and cleanup replies independently of the actual guest runtime.
    return new Promise(resolve => { if (script.includes(')("cancel"')) stopNow = () => resolve(f.window.eval(script)); });
  } };
  const controller = createAnnotationController(page); await controller.start();
  let unlocked = false; const pending = controller.unlock().then(() => { unlocked = true; });
  await turn(); assert.equal(unlocked, false); assert(f.layer()); stopNow(); await pending;
  assert.equal(f.layer(), null); assert.equal(unlocked, true); controller.dispose();
  const failed = createAnnotationController({ ...f.page, execute: () => Promise.reject(new Error('guest gone')) });
  await failed.start(); await assert.rejects(failed.unlock(), /guest gone/); failed.dispose();
  await f.window.happyDOM.close();
});
test('a failed cleanup remains fail-closed until a later unlock retries and receives acknowledgement', async () => {
  const f = fixture(); let attempts = 0, acknowledge;
  const controller = createAnnotationController({ ...f.page, execute(script) {
    if (!script.includes(')("cancel"')) return f.page.execute(script);
    attempts++;
    if (attempts === 1) return Promise.reject(new Error('temporary guest failure'));
    return new Promise(resolve => { acknowledge = () => resolve(f.window.eval(script)); });
  } });
  await controller.start();
  await assert.rejects(controller.unlock(), /temporary guest failure/);
  assert(f.layer(), 'failed cleanup must not claim the guest layer was removed');
  let unlocked = false;
  const retry = controller.unlock().then(() => { unlocked = true; });
  await turn(); assert.equal(attempts, 2); assert.equal(unlocked, false); assert(f.layer());
  acknowledge(); await retry;
  assert.equal(unlocked, true); assert.equal(f.layer(), null);
  await controller.unlock(); await controller.unlock();
  assert.equal(attempts, 2, 'confirmed tokens are removed rather than polled on every request');
  controller.dispose(); await f.window.happyDOM.close();
});
test('a delayed retry for a failed old token cannot clear a newer selected target or unlock its caller', async () => {
  const f = fixture(); let attempts = 0, acknowledgeOld, selected;
  const selection = new Promise(resolve => { selected = resolve; });
  const controller = createAnnotationController({ ...f.page, execute(script) {
    if (!script.includes(')("cancel"')) return f.page.execute(script);
    attempts++;
    if (attempts === 1) return Promise.reject(new Error('temporary guest failure'));
    if (attempts === 2) return new Promise(resolve => { acknowledgeOld = () => resolve(f.window.eval(script)); });
    return f.page.execute(script);
  } }, { onSelection: selected, pollInterval: 80 });
  await controller.start(); await assert.rejects(controller.unlock(), /temporary guest failure/);
  const oldUnlock = controller.unlock(), rejected = assert.rejects(oldUnlock, /ANNOTATION_UNLOCK_FAILED/);
  await turn();
  await controller.start(); await controller.pickAt(20, 30);
  const target = await selection;
  acknowledgeOld(); await rejected;
  assert.equal(controller.getSnapshot().phase, 'selected');
  assert.equal(controller.getSnapshot().selection.id, target.id);
  assert.equal(f.window.eval(annotationScript('poll', target.id)).phase, 'selected');
  assert(f.layer(), 'old-token cleanup must not remove the current guest capture layer');
  await controller.unlock(); assert.equal(f.layer(), null);
  const confirmedAttempts = attempts; await controller.unlock(); assert.equal(attempts, confirmedAttempts);
  controller.dispose(); await f.window.happyDOM.close();
});
test('a replacement selection waits out an older raw installation before dispatching its own start', async () => {
  const f = fixture(); let installOld, starts = 0, selected;
  const selection = new Promise(resolve => { selected = resolve; });
  const controller = createAnnotationController({ ...f.page, execute(script) {
    if (script.includes(')("start"') && ++starts === 1) return new Promise(resolve => { installOld = () => resolve(f.window.eval(script)); });
    return f.page.execute(script);
  } }, { onSelection: selected, pollInterval: 80 });
  const oldStart = controller.start(); await turn();
  const replacement = controller.start(); await turn();
  assert.equal(starts, 1, 'an unsettled raw installation must not overtake a new picker');
  installOld(); await Promise.all([oldStart, replacement]);
  assert.equal(starts, 2); assert.equal(f.window.document.querySelectorAll('[data-dsh-browser-annotation="capture"]').length, 1);
  await controller.pickAt(20, 30); const target = await selection;
  assert.equal(f.window.eval(annotationScript('poll', target.id)).phase, 'selected');
  await controller.unlock(); assert.equal(f.layer(), null);
  controller.dispose(); await f.window.happyDOM.close();
});
test('unlock waits for a late installation and its second cleanup', async () => {
  const f = fixture(); let install, first = true;
  const controller = createAnnotationController({ ...f.page, execute(script) {
    if (first) { first = false; return new Promise(resolve => { install = () => resolve(f.window.eval(script)); }); }
    return f.page.execute(script);
  } });
  const start = controller.start(); await turn();
  let unlocked = false; const pending = controller.unlock().then(() => { unlocked = true; });
  await turn(); assert.equal(unlocked, false); install(); await Promise.all([pending, start]);
  assert.equal(f.layer(), null); controller.dispose(); await f.window.happyDOM.close();
});
test('saved markers keep captured nodes across selection starts and never resolve selectors or mutate the page', async () => {
  const f = fixture(), w = f.window, selections = [];
  let nextSelection;
  const selected = () => new Promise(resolve => { nextSelection = resolve; });
  const controller = createAnnotationController(f.page, { onSelection: value => { selections.push(value); nextSelection?.(value); }, pollInterval: 80 });
  await controller.start(); let pending = selected(); await controller.pickAt(20, 30); const first = await pending;
  await controller.setMarkers([{ id: 'note_one', number: 1, selection: first }]);
  assert.equal(controller.getSnapshot().markers[0].id, 'note_one');
  await controller.start(); f.setTarget(w.document.querySelector('button')); pending = selected(); await controller.pickAt(20, 30); const second = await pending;
  const items = [{ id: 'note_one', number: 1, selection: first }, { id: 'note_two', number: 2, selection: second }];
  const observer = new w.MutationObserver(() => {}); observer.observe(w.document, { subtree: true, childList: true, attributes: true });
  await controller.setMarkers(items); assert.equal(controller.getSnapshot().markers.length, 2);
  await controller.setMarkersVisible(false); assert.equal(controller.getSnapshot().markers.length, 0);
  await controller.setMarkersVisible(true); assert.equal(controller.getSnapshot().markers.length, 2);
  assert.equal(observer.takeRecords().length, 0, 'saved markers must not invalidate page-runtime DOM snapshots');
  w.document.querySelector('a').remove(); await controller.setMarkers(items); assert.deepEqual(controller.getSnapshot().markers.map(item => item.id), ['note_two']);
  await controller.unlock(); assert.equal(controller.getSnapshot().markers.length, 0); assert.equal(f.layer(), null);
  observer.disconnect(); controller.dispose(); await w.happyDOM.close();
});
test('marker budget limits output and main-frame navigation drops captured node authority', async () => {
  const f = fixture(); let choose;
  const chosen = new Promise(resolve => { choose = resolve; });
  const controller = createAnnotationController(f.page, { onSelection: choose, pollInterval: 80 });
  await controller.start(); await controller.pickAt(20, 30); const selection = await chosen;
  const items = Array.from({ length: 30 }, (_, index) => ({ id: `note_${index}`, number: index + 1, selection }));
  await controller.setMarkers(items); assert.equal(controller.getSnapshot().markers.length, 20);
  const navigation = new f.window.Event('did-navigate-in-page'); navigation.isMainFrame = true; f.element.dispatchEvent(navigation); await turn();
  await controller.setMarkers(items); assert.equal(controller.getSnapshot().markers.length, 0);
  assert.throws(() => annotationMarkerScript('set', 'owner', { items: [{ id: 'x', selection: { id: '"bad' } }] }), /INVALID_MARKER_TARGET/);
  controller.dispose(); await f.window.happyDOM.close();
});
test('failed marker clearing remains fail-closed and retryable before native page actions', async () => {
  const f = fixture(); let choose, clearAttempts = 0;
  const chosen = new Promise(resolve => { choose = resolve; });
  const controller = createAnnotationController({ ...f.page, execute(script) {
    if (script.includes(')("clear"') && ++clearAttempts === 1) return Promise.reject(new Error('marker clear failed'));
    return f.page.execute(script);
  } }, { onSelection: choose, pollInterval: 80 });
  await controller.start(); await controller.pickAt(20, 30); const selection = await chosen;
  await controller.setMarkers([{ id: 'saved', number: 29, selection }]); assert.equal(controller.getSnapshot().markers[0].number, 29);
  await assert.rejects(controller.unlock(), /marker clear failed/);
  await controller.unlock(); assert.equal(clearAttempts, 2); assert.equal(controller.getSnapshot().markers.length, 0);
  controller.dispose(); await f.window.happyDOM.close();
});
test('guest data is bounded, URLs lose credentials and card JSON remains valid under hostile escaping', () => {
  const raw = { id: 'id', tag: 'button', title: '"'.repeat(500), url: 'https://user:pass@example.test/path', selector: '\\'.repeat(4000), text: '\\'.repeat(5000), outerHTML: '"'.repeat(10000), extra: 'untrusted extra' };
  const selection = sanitizeSelection(raw);
  assert.equal(selection.url, 'https://example.test/path'); assert(!('extra' in selection));
  for (const field of ['text', 'title', 'selector', 'url']) assert(selection[field].length <= ANNOTATION_LIMITS[field]);
  const card = formatAnnotationCard(selection, '"'.repeat(5000));
  assert(card.length <= ANNOTATION_LIMITS.card); const data = JSON.parse(card.slice(card.indexOf('{')));
  assert.equal(data.target.tag, 'button'); assert.equal(data.target.truncated, true);
  assert.equal(sanitizeSelection({ ...raw, url: 'javascript:alert(1)' }), null);
  assert.throws(() => annotationScript('eval', 'token'), /INVALID_ANNOTATION_OPERATION/);
  assert.throws(() => annotationScript('start', '";alert(1)'), /INVALID_ANNOTATION_OPERATION/);
});
function confirmedBatch() {
  return { version: 1, sessionId: 'panel-session', batchId: 'batch_one', revision: 4, confirmed: true, items: [{ id: 'note_one', number: 1, comment: 'Make the primary action clearer', selection: { id: 'capture_one', tag: 'button', text: 'Save', selector: '#save', outerHTML: '<button>Save</button>', title: 'Demo', url: 'https://page.test/demo' } }] };
}
test('public reference source inserts a real chip and serializes only confirmed batch metadata', async () => {
  const scope = { bail(ctx, event, request) { assert.equal(ctx, scope); assert.equal(event, 'slash/input-insert-reference'); inserted = request; return true; } };
  let source, inserted, sent = 0, reviewed, unregistered = false;
  const services = { sessions: { scope: id => id === 'panel-session' ? scope : undefined, scopeOf: () => 'panel-session' }, conversation: { input: { for: () => ({ actions: { captureInsertion: () => ({ start: 1, end: 8, draftRev: 9 }), persistDraft() {} }, focus() {}, submit: () => sent++ }) } }, inputTriggers: { registerSource(value) { source = value; return () => { unregistered = true; }; } } };
  const registry = registerAnnotationReferenceSource(services, { onReview: value => { reviewed = value; } });
  const insert = createAnnotationBatchInserter({ ...services, referenceSource: registry }, 'panel-session');
  assert.deepEqual(insert(confirmedBatch()), { ok: true, mode: 'chip' }); assert.equal(inserted.reference.label, '1 条注释'); assert.equal(inserted.reference.source, source.name);
  assert.deepEqual(inserted.span, { start: 8, end: 8, draftRev: 9 }); assert.equal(sent, 0);
  const serialized = await source.codec.serialize(inserted.reference.ref, new AbortController().signal);
  assert.match(serialized, /batchId=batch_one; revision=4; count=1/); assert(!serialized.includes('Make the primary')); assert(!serialized.includes('panel-session')); assert(!serialized.includes('https://page.test'));
  assert.equal(source.openReference({ sessionId: 'foreign' }, inserted.reference), false); assert.equal(reviewed, undefined);
  assert.equal(source.openReference({ sessionId: 'panel-session' }, inserted.reference), true); assert.equal(reviewed.batchId, 'batch_one');
  const firstRequest = inserted;
  const numbered = confirmedBatch(); numbered.revision++; numbered.items[0].number = 29; numbered.items[0].tabId = 'tab_one'; numbered.items[0].documentId = 'doc_one';
  insert(numbered); source.openReference({ sessionId: 'panel-session' }, inserted.reference);
  assert.equal(reviewed.items[0].number, 29); assert.equal(reviewed.items[0].tabId, 'tab_one'); assert.equal(reviewed.items[0].documentId, 'doc_one'); inserted = firstRequest;
  const changed = confirmedBatch(); changed.items[0].comment = 'Different content, same revision'; assert.throws(() => insert(changed), /ANNOTATION_BATCH_CONFLICT/);
  assert.throws(() => insert({ ...confirmedBatch(), confirmed: false }), /INVALID_ANNOTATION_BATCH/);
  assert.throws(() => createAnnotationBatchInserter({ ...services, referenceSource: registry }, 'foreign')(confirmedBatch()), /INVALID_ANNOTATION_BATCH/);
  const aborted = new AbortController(); aborted.abort(); await assert.rejects(source.codec.serialize(inserted.reference.ref, aborted.signal));
  const persistedRef = inserted.reference.ref; registry.dispose(); assert(unregistered);
  const replacement = registerAnnotationReferenceSource(services);
  assert.match(await source.codec.serialize(persistedRef, new AbortController().signal), /batchId=batch_one; revision=4; count=1/);
  assert.equal(source.openReference({ sessionId: 'panel-session' }, { ref: persistedRef }), false, 'restored metadata must not invent restored private review contents');
  assert.match(source.codec.clipboardText(persistedRef), /1 条注释/);
  await assert.rejects(source.codec.serialize('ann-v1:bad-json', new AbortController().signal), /INVALID_ANNOTATION_REFERENCE/);
  await assert.rejects(source.codec.serialize('ann-v1:' + encodeURIComponent(JSON.stringify({ v: 1, b: 'forged', r: 1, n: 100000 })), new AbortController().signal), /INVALID_ANNOTATION_REFERENCE/);
  replacement.dispose();
});
test('batch fallback inserts readable bounded annotations while retaining selected text and chips', () => {
  let draft = 'Original \ufffc selected'; const span = { start: 0, end: 10, draftRev: 3 }, scope = {};
  const services = { sessions: { scope: () => scope, scopeOf: () => 'panel-session' }, conversation: { input: { for: () => ({ actions: { captureInsertion: () => span, insertText(text, at) { draft = draft.slice(0, at.start) + text + draft.slice(at.end); return true; } } }) } } };
  const insert = createAnnotationBatchInserter(services, 'panel-session'); assert.deepEqual(insert(confirmedBatch()), { ok: true, mode: 'text' });
  assert(draft.startsWith('Original \ufffc')); assert(draft.includes('Make the primary action clearer')); assert(draft.includes('网页批注')); assert(!draft.includes('"outerHTML"'));
  const batch = confirmedBatch(); batch.items = Array.from({ length: 20 }, (_, index) => ({ ...batch.items[0], id: `note_${index}`, comment: 'x'.repeat(800) }));
  assert(formatAnnotationBatchText(batch).length <= ANNOTATION_LIMITS.card);
});
test('public composer adapter resolves the panel session, preserves chip edits via InputActions and never sends', () => {
  const scope = {}, spans = [], writes = []; let focused = 0, persisted = 0, submissions = 0;
  let draft = 'A \ufffc text selected'; // One reference chip occupies offset 2; the selection spans it.
  const actions = { captureInsertion: () => ({ start: 0, end: 8, draftRev: 42 }), insertText(text, span) { writes.push(text); spans.push(span); draft = draft.slice(0, span.start) + text + draft.slice(span.end); return true; }, persistDraft: () => persisted++ };
  const services = { sessions: { scope: id => id === 'panel-session' ? scope : undefined, scopeOf: ctx => ctx === scope ? 'panel-session' : undefined }, conversation: { input: { for: ctx => { assert.equal(ctx, scope); return { actions, focus: () => focused++, submit: () => submissions++ }; } }, send: () => submissions++ } };
  const insert = createAnnotationDraftInserter(services, 'panel-session');
  assert.equal(insert('Reference card'), true); assert.equal(writes[0], '\n\nReference card\n'); assert.deepEqual(spans[0], { start: 8, end: 8, draftRev: 42 });
  assert.equal(draft, 'A \ufffc text\n\nReference card\n selected');
  assert.equal(focused, 1); assert.equal(persisted, 1); assert.equal(submissions, 0);
  actions.insertText = () => false; assert.throws(() => insert('Another card'), /DRAFT_CHANGED/);
  assert.throws(() => createAnnotationDraftInserter(services, 'other-session')('Card'), /DRAFT_UNAVAILABLE/);
  services.sessions.scopeOf = () => 'different-session'; assert.throws(() => insert('Card'), /DRAFT_UNAVAILABLE/);
});
