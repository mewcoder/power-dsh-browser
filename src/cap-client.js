import { BrowserError, abortable } from './protocol.js';

// Keep in sync with native/desktop-browser-bridge.js BRIDGE_BUILD.
export const EXPECTED_BRIDGE_BUILD = '2026-11-08.2';
const ACTIONS = new Set(['capabilities', 'emulate', 'clearEmulation', 'cookies', 'accessibility', 'input', 'downloads', 'clearDownloads', 'upload', 'downloadCancel']);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const pick = (source, keys) => Object.fromEntries(keys.filter(key => source[key] !== undefined).map(key => [key, source[key]]));

function optionsFor(args) {
  switch (args.action) {
    case 'emulate': return pick(args, ['width', 'height', 'deviceScaleFactor', 'mobile', 'userAgent', 'timezone', 'media']);
    case 'cookies': return { action: args.cookieAction };
    case 'input': return {
      type: args.inputType,
      ...pick(args, ['mouseType', 'x', 'y', 'button', 'clickCount', 'key', 'code', 'text', 'modifiers']),
    };
    case 'upload': return { selector: args.selector, files: args.files };
    case 'downloadCancel': return { id: args.downloadId };
    default: return {};
  }
}

// Serializes capability requests so two one-off CDP attaches never race, and
// maps the friendly tool args onto the host bridge's bounded option objects.
export class GuestCap {
  closed = false; tail = Promise.resolve();
  constructor(bridge, lease) { this.bridge = bridge; this.lease = lease; }
  available() { return this.bridge?.protocolVersion === 1 && typeof this.bridge.request === 'function'; }
  payload(args) {
    if (!object(args) || !ACTIONS.has(args.action)) throw new BrowserError('INVALID_CAP_ACTION');
    // Full-page/CDP screenshot is intentionally not exposed: Page.captureScreenshot
    // hangs on stock Electron webviews without a paint lease. browser_screenshot
    // (native capturePage) is the only screenshot path.
    if (args.action === 'cookies' && !['get', 'clear'].includes(args.cookieAction)) throw new BrowserError('INVALID_CAP_OPTIONS');
    if (args.action === 'input' && !['mouse', 'key'].includes(args.inputType)) throw new BrowserError('INVALID_CAP_OPTIONS');
    if (args.action === 'upload' && (typeof args.selector !== 'string' || !Array.isArray(args.files) || !args.files.length)) throw new BrowserError('INVALID_CAP_OPTIONS');
    if (args.action === 'downloadCancel' && !Number.isSafeInteger(args.downloadId)) throw new BrowserError('INVALID_CAP_OPTIONS');
    const options = optionsFor(args), payload = { operation: args.action, lease: this.lease };
    // capabilities rejects any options key; other ops accept an optional object.
    if (Object.keys(options).length > 0) payload.options = options;
    return payload;
  }
  // A bridge installed from an older patch may lack newer operations; surface
  // that as an explicit reinstall request rather than an opaque failure.
  async verify() {
    if (!this.available()) throw new BrowserError('CAP_BRIDGE_UNAVAILABLE');
    const caps = await this.invoke({ operation: 'capabilities', lease: this.lease });
    if (caps.build !== EXPECTED_BRIDGE_BUILD) throw new BrowserError('BRIDGE_OUTDATED', `Installed bridge build ${caps.build ?? 'unknown'} does not match ${EXPECTED_BRIDGE_BUILD}; reinstall the bridge`);
    return caps;
  }
  async invoke(payload) {
    if (!this.available()) throw new BrowserError('CAP_BRIDGE_UNAVAILABLE', 'Install and load the owned-page Desktop bridge');
    let reply;
    try { reply = await this.bridge.request(payload); }
    catch { throw new BrowserError('CAP_BRIDGE_UNAVAILABLE'); }
    if (!object(reply) || typeof reply.ok !== 'boolean') throw new BrowserError('INVALID_CAP_RESPONSE');
    if (!reply.ok) {
      const raw = reply.error?.code;
      const code = typeof raw === 'string' && /^[A-Z0-9_]{1,80}$/.test(raw) ? raw : 'CAP_BRIDGE_ERROR';
      throw new BrowserError(code === 'BRIDGE_UNAVAILABLE' ? 'CAP_BRIDGE_UNAVAILABLE' : code);
    }
    if (!object(reply.value)) throw new BrowserError('INVALID_CAP_RESPONSE');
    return reply.value;
  }
  request(args, signal) {
    signal.throwIfAborted();
    const payload = this.payload(args);
    const job = this.tail.then(async () => {
      signal.throwIfAborted();
      if (this.closed) throw new BrowserError('PANEL_CLOSED');
      const value = await this.invoke(payload);
      signal.throwIfAborted();
      return { ...value, untrusted: true };
    });
    this.tail = job.catch(() => {});
    return abortable(job, signal);
  }
  dispose() { this.closed = true; }
}
