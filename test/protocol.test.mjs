import test from 'node:test';
import assert from 'node:assert/strict';
import { Broker, ownerOf, sessionOf, httpUrl } from '../src/protocol.js';
import { RPC } from '../src/rpc.js';
const peer = () => { const controller = new AbortController(); return { principal: { kind: 'owner' }, signal: controller.signal, controller }; };
const signal = () => new AbortController().signal;
test('execution identity comes only from Agent context; owner is mandatory', () => {
  assert.throws(() => sessionOf({ sessionId: 'victim' }), /AGENT_CONTEXT_REQUIRED/);
  assert.equal(sessionOf({ agent: { session: { id: 'real' } } }), 'real');
  assert.throws(() => ownerOf({ peer: { principal: { kind: 'visitor' } } }), /OWNER_REQUIRED/);
  assert.throws(() => httpUrl('file:///tmp/test'), /INVALID_URL/);
  const credentialUrl = new URL('https://example.test'); credentialUrl.username = 'test-user';
  assert.throws(() => httpUrl(credentialUrl.href), /INVALID_URL/);
  assert.throws(() => httpUrl('https://host.test/path', 'https://host.test'), /HOST_URL_BLOCKED/);
});
test('session, peer, private panel key, and ambiguous windows isolate routing', async () => {
  const b = new Broker(), a = peer(), stranger = peer();
  const { key } = b.connect('session-a', 'window-one', a);
  assert.throws(() => b.request('session-b', 'snapshot', {}, signal()), /PANEL_OFFLINE/);
  assert.throws(() => b.poll(key, stranger), /PANEL_DISCONNECTED/);
  const p = b.request('session-a', 'snapshot', {}, signal());
  const command = b.poll(key, a).commands[0];
  assert.equal(command.operation, 'snapshot');
  b.reply(key, a, command.id, command.epoch, { ok: true, value: { text: 'untrusted' } });
  assert.deepEqual(await p, { text: 'untrusted' });
  const extra = b.connect('session-a', 'window-two', a);
  assert.throws(() => b.select('session-a'), /AMBIGUOUS_PANEL/);
  b.disconnect(extra.key, a); b.dispose();
});
test('stop removes queued actions and rejects late results; new epoch resumes', async () => {
  const b = new Broker(), a = peer(), { key } = b.connect('s', 'w', a);
  const p = b.request('s', 'act', {}, signal());
  const rejection = assert.rejects(p, /STOPPED/);
  const command = b.poll(key, a).commands[0];
  b.stop(b.panel(key, a)); await rejection;
  assert.equal(b.reply(key, a, command.id, command.epoch, { ok: true, value: 'late' }).accepted, false);
  assert.deepEqual(b.poll(key, a).commands.map(c => c.kind), ['stop']);
  const next = b.request('s', 'status', {}, signal());
  const c = b.poll(key, a).commands[0]; assert.equal(c.epoch, 1);
  b.reply(key, a, c.id, c.epoch, { ok: true, value: {} }); await next; b.dispose();
});
test('abort before delivery does not leave an actionable queue item', async () => {
  const b = new Broker(), a = peer(), { key } = b.connect('s', 'w', a), controller = new AbortController();
  const p = b.request('s', 'act', {}, controller.signal), rejected = assert.rejects(p, /CANCELLED/);
  assert.throws(() => b.request('s', 'snapshot', {}, signal()), /BUSY/);
  controller.abort(); await rejected;
  assert.deepEqual(b.poll(key, a).commands.map(c => c.kind), ['cancel']); b.dispose();
});
test('timeout, heartbeat expiry, peer closure and Host unload settle pending work', async () => {
  const b = new Broker({ timeout: 10 }), a = peer(); b.connect('s', 'w', a);
  await assert.rejects(b.request('s', 'snapshot', {}, signal()), /TIMEOUT/); b.dispose();
  let now = 0; const heartbeat = new Broker({ now: () => now }), p = peer(); heartbeat.connect('s', 'w', p);
  const pending = heartbeat.request('s', 'act', {}, signal()), rejected = assert.rejects(pending, /STOPPED/);
  now = 3001; heartbeat.sweep(); await rejected; assert.equal(heartbeat.panels.size, 0); heartbeat.dispose();
  for (const close of ['peer', 'host']) {
    const broker = new Broker(), client = peer(); broker.connect('s', 'w', client);
    const pending = broker.request('s', 'act', {}, signal()), rejection = assert.rejects(pending, /STOPPED/);
    if (close === 'peer') client.controller.abort(); else broker.dispose();
    await rejection; assert.equal(broker.pending.size, 0); broker.dispose();
  }
});
test('strict RPC descriptors share exact positional contract and bound tokens', () => {
  assert.deepEqual(RPC.map(x => x.method), ['connect', 'openRequested', 'poll', 'reply', 'stop', 'disconnect', 'publishAnnotations']);
  assert.throws(() => RPC[0].parameters[0].codec.create().parse(''), /Invalid token/);
  assert.throws(() => RPC[3].parameters[2].codec.create().parse(-1), /Invalid epoch/);
});
