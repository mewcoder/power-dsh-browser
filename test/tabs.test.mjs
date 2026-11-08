import test from 'node:test';
import assert from 'node:assert/strict';
import { SessionTabs } from '../src/session-tabs.js';
import { addressUrl } from '../src/browser-shell.js';
const command = (operation, args = {}, timeout = 1000) => ({ id: crypto.randomUUID(), operation, args, expires: Date.now() + timeout });
function setup(overrides = {}) {
  const pages = [], lifetime = new AbortController();
  const manager = new SessionTabs({ signal: lifetime.signal, workspace: 'session:test', createContainer: () => ({ style: {}, setAttribute() {}, remove() { this.removed = true; } }),
    createPage() {
      const page = { state: { initialized: false, ready: false, url: '', title: '' }, disposed: false, inputs: 0,
        async mount(_workspace, signal) { this.signal = signal; this.state.initialized = this.state.ready = true; },
        status() { return { ...this.state }; }, emit(patch) { Object.assign(this.state, patch); },
        async navigate(_action, url) { this.state.url = url; }, execute: async () => ({ documentId: 'doc', snapshotId: 'snap', text: 'Example', elements: [] }),
        async input() { this.inputs++; }, stop() {}, async dispose() { this.disposed = true; }, ...overrides,
      }; pages.push(page); return page;
    },
  });
  return { manager, pages, lifetime };
}
test('internal tabs preserve guests and navigation independently; tabId fences old references', async () => {
  const { manager, pages } = setup();
  const first = await manager.newTab('https://one.test/'), second = await manager.newTab('https://two.test/');
  assert.equal(manager.entries.size, 2); assert.equal(pages[0].disposed, false);
  const snapshot = await manager.run(command('snapshot'));
  assert.equal(snapshot.tabId, second.tabId);
  manager.select(first.tabId);
  assert.equal(manager.current().page.status().url, 'https://one.test/');
  await assert.rejects(manager.run(command('act', { ...snapshot, action: 'click', ref: 'e1' })), /STALE_TAB/);
  manager.select(second.tabId);
  await assert.rejects(manager.run(command('act', { ...snapshot, action: 'click', ref: 'e1' })), /STALE_DOCUMENT/);
  assert.equal(pages[1].inputs, 0);
  await manager.close(second.tabId); assert.equal(pages[1].disposed, true); assert.equal(manager.activeTabId, first.tabId);
  await manager.dispose(); assert(pages.every(page => page.disposed));
});
test('tab tool list/new/select/close uses current panel and leaves one fresh blank tab', async () => {
  const { manager } = setup(); await manager.newTab();
  const result = await manager.run(command('tabs', { action: 'new', url: 'https://three.test/' }));
  assert.equal(result.tabs.length, 2);
  const firstId = result.tabs[0].tabId;
  await manager.run(command('tabs', { action: 'select', tabId: firstId }));
  assert.equal((await manager.run(command('tabs', { action: 'list' }))).activeTabId, firstId);
  await manager.run(command('tabs', { action: 'close', tabId: result.tabId }));
  const last = await manager.run(command('tabs', { action: 'close' }));
  assert.equal(last.tabs.length, 1); assert.equal(last.tabs[0].url, '');
  await assert.rejects(manager.run(command('tabs', { action: 'select', tabId: 'not-owned' })), /TAB_NOT_FOUND/); await manager.dispose();
});
test('cancelling new(url) before a guest mounts closes its lease and never navigates later', async () => {
  let finishMount, navigations = 0;
  const { manager, pages } = setup({ mount() { return new Promise(resolve => { finishMount = resolve; }); }, async navigate() { navigations++; } });
  const cmd = command('tabs', { action: 'new', url: 'https://late.test/' });
  const pending = manager.run(cmd), rejected = assert.rejects(pending, /CANCELLED/);
  manager.cancel(cmd.id); await rejected; await Promise.resolve();
  assert.equal(manager.entries.size, 0); assert.equal(pages[0].disposed, true);
  finishMount(); await Promise.resolve(); assert.equal(navigations, 0); await manager.dispose();
});
test('cancelled close settles immediately; delayed lease release cannot create a new tab', async () => {
  let release;
  const { manager } = setup({ dispose() { this.disposed = true; return new Promise(resolve => { release = resolve; }); } });
  await manager.newTab(); const cmd = command('tabs', { action: 'close' });
  const pending = manager.run(cmd), rejected = assert.rejects(pending, /CANCELLED/);
  manager.cancel(cmd.id); await rejected; assert.equal(manager.request, null); assert.equal(manager.entries.size, 0);
  release(); await Promise.resolve(); await Promise.resolve(); assert.equal(manager.entries.size, 0); await manager.dispose();
});
test('late cancellation from a previous request never interrupts the current observation', async () => {
  let resolve;
  const { manager } = setup({ execute: () => new Promise(r => { resolve = r; }) });
  await manager.newTab(); const current = command('snapshot'), pending = manager.run(current);
  await Promise.resolve(); await Promise.resolve();
  manager.cancel('already-finished-request');
  resolve({ documentId: 'new', snapshotId: 'new', text: 'Fresh' });
  assert.equal((await pending).text, 'Fresh'); await manager.dispose();
});
test('connection and tab metadata reads never take control or emit busy activity', async () => {
  const { manager, pages } = setup();
  await manager.newTab('https://annotated.test/');
  const activity = [];
  manager.onActivity = value => activity.push(value);
  pages[0].execute = () => { throw new Error('metadata must not execute guest code'); };
  pages[0].stop = () => { throw new Error('metadata must not cancel page input'); };
  const generation = manager.current().runner.generation;
  const status = await manager.run(command('status'));
  assert.equal(status.url, 'https://annotated.test/');
  assert.equal(status.connected, true);
  assert.equal((await manager.run(command('tabs', { action: 'list' }))).tabs.length, 1);
  assert.equal(manager.current().runner.generation, generation);
  assert.equal(activity.some(value => value.busy), false);
  pages[0].stop = () => {};
  await manager.dispose();
});
test('address field normalizes websites and local development URLs, and supports explicit search', () => {
  assert.equal(addressUrl('example.com/docs'), 'https://example.com/docs');
  assert.equal(addressUrl('localhost:8080/form'), 'http://localhost:8080/form');
  assert.match(addressUrl('browser annotations'), /^https:\/\/duckduckgo.com\/\?q=browser%20annotations/);
  assert.throws(() => addressUrl('file:///tmp/file'), /INVALID_URL/);
});
