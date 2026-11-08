import test from 'node:test';
import assert from 'node:assert/strict';
import { createAnnotationStore, BATCH_LIMITS } from '../src/annotation-store.js';
const selection = (id = 'picked') => ({ id, tag: 'button', selector: '#save', title: 'Example', url: 'https://form.test/', text: 'Save', outerHTML: '<button>Save</button>' });
function setup() { const store = createAnnotationStore({ sessionId: 's' }); store.setContext({ tabId: 't1', documentId: 'doc-1', url: 'https://form.test/' }); return store; }
function add(store, comment = 'Improve this control', id) { store.capture(selection(id)); store.setComment(comment); return store.save(); }
test('consecutive selections retain independent comments, captured page and stable item identities', () => {
  const store = setup(), first = add(store, 'Make the first control clearer', 'pick-1'), second = add(store, 'Rename this action', 'pick-2');
  assert.equal(store.getSnapshot().items.length, 2); assert.notEqual(first.id, second.id); assert.deepEqual(store.getSnapshot().items.map(item => item.number), [1, 2]);
  store.edit(first.id); store.setComment('Use a stronger label'); store.save();
  assert.equal(store.getSnapshot().items[0].id, first.id); assert.equal(store.getSnapshot().items[0].comment, 'Use a stronger label'); assert.equal(store.getSnapshot().items[1].comment, 'Rename this action');
  assert.equal(store.getSnapshot().revision, 3); store.remove(first.id); assert.equal(store.getSnapshot().items[0].number, 2);
});
test('tab/document switch preserves saved reference data but never draws stale markers', () => {
  const store = setup(); add(store);
  store.setContext({ tabId: 't2', documentId: 'doc-1' }); assert.equal(store.markers().length, 0); add(store, 'Tab two');
  store.setContext({ tabId: 't1', documentId: 'doc-1' }); assert.equal(store.markers().length, 1);
  store.setContext({ tabId: 't1', documentId: 'doc-2' }); assert.equal(store.markers().length, 0); assert.equal(store.getSnapshot().items.length, 2);
});
test('user confirmation produces an immutable publication isolated from later draft edits', () => {
  const store = setup(), first = add(store, 'Original user opinion');
  assert.equal(store.getPublished(), null); assert.equal(store.prepareBatch().confirmed, false);
  const published = store.confirm(); assert.equal(published.confirmed, true); assert.equal(published.sessionId, 's');
  store.edit(first.id); store.setComment('Changed after publication'); store.save();
  assert.equal(published.items[0].comment, 'Original user opinion'); assert.equal(store.getPublished(), published); assert.equal(store.getSnapshot().revision, published.revision + 1);
  assert.throws(() => { published.items[0].comment = 'mutation'; }, TypeError);
  store.capture(selection('unfinished')); store.setComment('Not yet saved'); assert.throws(() => store.confirm(), /UNSAVED_EDITOR/);
});
test('metadata reads preserve open comment draft, mode and saved items', () => {
  const store = setup(); add(store); store.capture(selection('draft')); store.setComment('Keep this text'); const before = store.getSnapshot();
  store.getSnapshot(); store.markers(); store.prepareBatch(); store.getPublished(); store.setContext({ tabId: 't1', documentId: 'doc-1' });
  assert.equal(store.getSnapshot(), before); assert.equal(store.getSnapshot().editor.comment, 'Keep this text');
});
test('empty opinions, item count and UTF8 collection limits fail atomically', () => {
  const store = setup(); store.capture(selection()); assert.throws(() => store.save(), /COMMENT_REQUIRED/);
  for (let index = 0; index < BATCH_LIMITS.items; index++) add(store, `Comment ${index}`, `pick-${index}`);
  const snapshot = store.getSnapshot(); assert.throws(() => store.capture(selection('overflow')), /ITEM_LIMIT/); assert.equal(store.getSnapshot(), snapshot);
  const bytes = setup(); let rejected = false;
  for (let index = 0; index < 20; index++) {
    bytes.capture({ ...selection(`unicode-${index}`), outerHTML: '界'.repeat(1600), text: '界'.repeat(800) }); bytes.setComment('界'.repeat(2000));
    const previous = bytes.getSnapshot().items;
    try { bytes.save(); } catch (error) { assert.match(error.message, /BATCH_LIMIT/); assert.equal(bytes.getSnapshot().items, previous); rejected = true; break; }
  }
  assert.equal(rejected, true); assert(new TextEncoder().encode(JSON.stringify(bytes.prepareBatch())).length <= BATCH_LIMITS.bytes);
});
test('exit clears only the unsaved editor, explicit clear removes saved draft and never mutates published batch', () => {
  const store = setup(); add(store); const published = store.confirm(); store.capture(selection('discard')); store.setComment('Unfinished'); store.exit();
  assert.equal(store.getSnapshot().items.length, 1); assert.equal(store.getSnapshot().editor, null); assert.equal(store.getSnapshot().mode, false);
  store.clear(); assert.equal(store.getSnapshot().items.length, 0); assert.equal(published.items.length, 1);
});
