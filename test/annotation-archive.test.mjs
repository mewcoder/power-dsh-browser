import test from 'node:test';
import assert from 'node:assert/strict';
import { AnnotationArchive, validateAnnotationBatch, ARCHIVE_LIMITS } from '../src/annotation-archive.js';
import { toolDefinitions, BrowserService } from '../src/index.js';
import { Broker } from '../src/protocol.js';
import { RPC } from '../src/rpc.js';

function batch(sessionId = 'session-a', overrides = {}) {
  return { version: 1, sessionId, batchId: 'batch-one', revision: 1, confirmed: true, items: [{ id: 'item-one', number: 1, tabId: 'tab-one', documentId: '3', selection: { id: 'capture-one', tag: 'button', text: 'Save', title: 'Page', url: 'https://example.test/form', selector: 'button#save', outerHTML: '<button id="save">Save</button>', truncated: false }, comment: 'Keep the button visible', createdAt: 1, updatedAt: 1 }], ...overrides };
}
test('only bounded user-confirmed batches are admitted; snapshots cannot be mutated after publication', () => {
  const archive = new AnnotationArchive(), draft = batch('session-a', { confirmed: false });
  assert.throws(() => archive.publish('session-a', draft), /CONFIRMATION_REQUIRED/);
  assert.throws(() => archive.publish('session-b', batch()), /CONFIRMATION_REQUIRED/);
  const value = batch(); archive.publish('session-a', value);
  value.items[0].comment = 'Changed after sharing';
  assert.equal(archive.read('session-a', 'batch-one').items[0].comment, 'Keep the button visible');
  assert.throws(() => archive.publish('session-a', batch('session-a', { items: [{ ...batch().items[0], comment: 'x'.repeat(2001) }] })), /INVALID_ANNOTATION_COMMENT/);
  assert.throws(() => validateAnnotationBatch({ ...batch(), extra: 'x'.repeat(ARCHIVE_LIMITS.bytes) }, 'session-a'), /BATCH_TOO_LARGE/);
  const credential = batch(); credential.items[0].selection.url = 'https://person@example.test/';
  assert.throws(() => archive.publish('session-a', credential), /INVALID_URL/);
});
test('confirmed revisions are immutable and session-isolated; resolution never rewrites user feedback', () => {
  const archive = new AnnotationArchive();
  archive.publish('session-a', batch()); archive.publish('session-a', batch('session-a', { revision: 2 }));
  archive.publish('session-b', batch('session-b'));
  assert.equal(archive.read('session-a', 'batch-one').revision, 2);
  assert.equal(archive.read('session-a', 'batch-one', 1).revision, 1);
  const conflict = batch(); conflict.items[0].comment = 'Different opinion';
  assert.throws(() => archive.publish('session-a', conflict), /REVISION_CONFLICT/);
  assert.throws(() => archive.read('session-c', 'batch-one'), /NOT_FOUND/);
  assert.throws(() => archive.resolve('session-a', 'batch-one', 1, ['foreign-item']), /INVALID_ANNOTATION_IDS/);
  const result = archive.resolve('session-a', 'batch-one', 1, ['item-one']);
  assert.equal(result.items[0].resolved, true);
  assert.equal(result.items[0].comment, 'Keep the button visible');
  assert.equal(archive.read('session-a', 'batch-one', 2).items[0].resolved, false);
  assert.equal(archive.read('session-b', 'batch-one').items[0].resolved, false);
});
test('archive bounds retained revisions and releases all data on unload', () => {
  const archive = new AnnotationArchive();
  for (let revision = 1; revision <= 10; revision++) archive.publish('session-a', batch('session-a', { revision }));
  assert.equal(archive.list('session-a').batches.length, ARCHIVE_LIMITS.perSession);
  assert.throws(() => archive.read('session-a', 'batch-one', 1), /NOT_FOUND/);
  for (let index = 0; index < 150; index++) archive.publish(`other-${index}`, batch(`other-${index}`));
  assert.equal(archive.records.size, ARCHIVE_LIMITS.total);
  archive.dispose(); assert.equal(archive.records.size, 0);
});
test('publication requires the live owner panel and rejects session forgery and ambiguous windows', () => {
  const broker = new Broker(), annotations = new AnnotationArchive();
  const peer = { principal: { kind: 'owner' }, signal: new AbortController().signal };
  const { key } = broker.connect('session-a', 'window-one', peer);
  const service = { broker, annotations, ctx: { invocation: { peer } } };
  const publish = value => BrowserService.prototype.publishAnnotations.call(service, key, value);
  assert.equal(publish(batch()).count, 1);
  assert.throws(() => publish(batch('session-b')), /CONFIRMATION_REQUIRED/);
  const visitor = { principal: { kind: 'guest' }, signal: new AbortController().signal };
  assert.throws(() => BrowserService.prototype.publishAnnotations.call({ ...service, ctx: { invocation: { peer: visitor } } }, key, batch()), /OWNER_REQUIRED/);
  broker.connect('session-a', 'window-two', peer);
  assert.throws(() => publish(batch()), /AMBIGUOUS_PANEL/);
  broker.dispose();
  assert.throws(() => publish(batch()), /PANEL_DISCONNECTED/);
  assert.equal(annotations.read('session-a', 'batch-one').items.length, 1);
});
test('annotation Agent tool reads confirmed batches without a page and cannot choose another session', async () => {
  const archive = new AnnotationArchive(); archive.publish('session-a', batch());
  const tools = toolDefinitions({}, { select() { throw Error('must not control a page to read feedback'); } }, archive);
  const tool = tools.find(tool => tool.name === 'browser_annotations');
  const exec = { agent: { session: { id: 'session-a' } }, signal: new AbortController().signal };
  const result = await tool.execute({ action: 'read', batchId: 'batch-one', revision: 1 }, exec);
  assert.equal(result.untrustedPageContent, true);
  await assert.rejects(tool.execute({ action: 'read', batchId: 'batch-one', sessionId: 'session-a' }, { ...exec, agent: { session: { id: 'session-b' } } }), /NOT_FOUND/);
  await assert.rejects(tool.execute({ action: 'read', batchId: 'batch-one' }, { ...exec, agent: null }), /AGENT_CONTEXT_REQUIRED/);
  assert.equal((await tool.execute({ action: 'resolve', batchId: 'batch-one' }, exec)).items[0].resolved, true);
  const publication = RPC.find(descriptor => descriptor.method === 'publishAnnotations');
  assert.deepEqual(publication.parameters.map(parameter => parameter.name), ['key', 'batch']);
  assert.throws(() => publication.parameters[1].codec.create().parse(batch('session-a', { confirmed: false })), /CONFIRMATION_REQUIRED/);
});
