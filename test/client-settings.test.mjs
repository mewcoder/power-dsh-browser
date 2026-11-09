import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { Window } from 'happy-dom';
import { build } from 'esbuild';
import vm from 'node:vm';

// Exercise apply() and its actual SettingsPage with receiver-dependent Host
// forms. Rendering BrowserPanel alone never executes this registration path.
test('settings page renders, follows Host updates, saves and disposes', async t => {
  const cache = new URL('../.reference/ui-verification/batches/', import.meta.url);
  const reactFile = new URL('react-18.3.1.development.js', cache);
  const domFile = new URL('react-dom-18.3.1.development.js', cache);
  if (!existsSync(reactFile) || !existsSync(domFile)) return t.skip('Run npm run test:ui to cache pinned React fixtures');
  const window = new Window({ url: 'http://fixture.invalid/' });
  window.eval(await readFile(reactFile, 'utf8'));
  window.eval(await readFile(domFile, 'utf8'));
  const compiled = await build({ entryPoints: ['src/client.js'], bundle: true, format: 'cjs', platform: 'browser', packages: 'external', write: false });
  const module = { exports: {} };
  vm.runInNewContext(new TextDecoder().decode(compiled.outputFiles[0].contents), {
    module, exports: module.exports,
    require(name) {
      if (name === 'react') return window.React;
      if (name === '@deepseek-ai/dsh-client-ui-primitives') return { GuideArtworkBrowser: () => null };
      throw Error(`Unexpected module: ${name}`);
    },
    setTimeout, clearTimeout,
  });
  class HostForm {
    listeners = new Set();
    snapshot = { status: 'ready', writable: true, value: { autoOpen: true, takeOverBrowser: false, homeUrl: '', maxTabs: 12 } };
    writes = [];
    getSnapshot() { return this.snapshot; }
    subscribe(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
    publish(patch) {
      this.snapshot = { ...this.snapshot, value: { ...this.snapshot.value, ...patch } };
      for (const listener of this.listeners) listener();
    }
    async set(key, value) { this.writes.push([key, value]); this.publish({ [key]: value }); return true; }
  }
  const form = new HostForm(), effects = [], registrations = new Map(), types = new Map(), injectedSlots = [];
  const ctx = {
    effect(callback) { const release = callback(); effects.push(release); return release; },
    locale: { bind: () => key => module.exports.dictionaries.zh[key] ?? key, register: () => () => {} },
    remote: { $mount: async ({ package: name, descriptors }) => {
      assert.equal(name, 'power-dsh-browser');
      assert(descriptors.every(item => item.id.startsWith('power-dsh-browser#dshBrowser/')));
    }, dshBrowser: { openRequested: async () => ({ ok: true, value: false }) } },
    workspaces: {},
    configForms: { get: id => { assert.equal(id, 'power-dsh-browser'); return form; }, describe: () => ({ load: async () => {} }) },
    sidebarRightTabs: { register(definition) {
      assert.equal(types.has(definition.id), false);
      types.set(definition.id, definition);
      return () => types.delete(definition.id);
    } },
    slots: {
      inject(name, callback) { injectedSlots.push(name); return callback(); },
      register(options, component) { registrations.set(options.name, component); return () => registrations.delete(options.name); },
    },
    inject(_services, callback) { callback(this); },
  };
  let root;
  const until = async probe => {
    for (let i = 0; i < 100; i++) {
      if (probe()) return;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.fail('Settings UI did not reach expected state');
  };
  try {
    await module.exports.apply(ctx);
    // Default false must still register a usable browser type on first mount.
    assert.equal(types.get('power-dsh-browser')?.kind, 'power-dsh-browser');
    assert(injectedSlots.includes('settings.section'));
    assert(injectedSlots.includes('settings.section.icon'));
    const mount = window.document.createElement('div'); window.document.body.append(mount);
    root = window.ReactDOM.createRoot(mount);
    root.render(window.React.createElement(registrations.get('settings.section')));
    await until(() => mount.querySelectorAll('[role=switch]').length === 2);
    assert.equal(mount.querySelectorAll('input').length, 0);
    assert.equal(mount.querySelector('h2').textContent, 'PowerDSH Browser');
    assert.match(mount.textContent, /共享浏览器面板的偏好设置/);
    const register = ctx.sidebarRightTabs.register;
    ctx.sidebarRightTabs.register = function () {
      this.register = register;
      throw new Error('Transient sidebar registration failure');
    };
    form.publish({ takeOverBrowser: true });
    assert.equal(types.size, 0, 'a failed replacement releases the previous type');
    form.publish({ takeOverBrowser: true });
    await until(() => mount.querySelectorAll('[role=switch]')[1]?.getAttribute('aria-checked') === 'true');
    assert.equal(types.get('power-dsh-browser').kind, 'browser');
    const autoOpen = mount.querySelector('[role=switch]');
    autoOpen.click();
    await until(() => form.writes.length === 1);
    assert.deepEqual(form.writes, [['autoOpen', false]]);
    assert.equal(autoOpen.getAttribute('aria-checked'), 'false');
    form.set = async () => false;
    await until(() => !autoOpen.disabled);
    autoOpen.click();
    await until(() => mount.querySelector('[role=alert]'));
    assert.equal(autoOpen.getAttribute('aria-checked'), 'false', 'refused saves restore the accepted switch value');
    form.publish({ takeOverBrowser: false });
    assert.equal(types.get('power-dsh-browser').kind, 'power-dsh-browser');
  } finally {
    root?.unmount();
    for (const release of effects.reverse()) if (typeof release === 'function') release();
    assert.equal(form.listeners.size, 0);
    assert.equal(types.size, 0);
    assert.equal(registrations.size, 0);
    await window.happyDOM.close();
  }
});
