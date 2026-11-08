import { BrowserError, abortable } from './protocol.js';

const ACTIONS = new Set(['capabilities', 'screenshot', 'emulate', 'clearEmulation', 'cookies', 'accessibility', 'input', 'downloads', 'clearDownloads', 'upload', 'downloadCancel']);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const pick = (source, keys) => Object.fromEntries(keys.filter(key => source[key] !== undefined).map(key => [key, source[key]]));

function optionsFor(args) {
  switch (args.action) {
    case 'screenshot': return pick(args, ['fullPage']);
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
    // CDP Page.captureScreenshot hangs on stock Electron webviews without a paint
    // lease (a Codex-only native interface), so fail fast instead of timing out.
    if (args.action === 'screenshot') throw new BrowserError('CAPABILITY_UNSUPPORTED', 'Full-page/CDP screenshot is unavailable on this Electron host; use browser_screenshot for the viewport');
    if (args.action === 'cookies' && !['get', 'clear'].includes(args.cookieAction)) throw new BrowserError('INVALID_CAP_OPTIONS');
    if (args.action === 'input' && !['mouse', 'key'].includes(args.inputType)) throw new BrowserError('INVALID_CAP_OPTIONS');
    if (args.action === 'upload' && (typeof args.selector !== 'string' || !Array.isArray(args.files) || !args.files.length)) throw new BrowserError('INVALID_CAP_OPTIONS');
    if (args.action === 'downloadCancel' && !Number.isSafeInteger(args.downloadId)) throw new BrowserError('INVALID_CAP_OPTIONS');
    const options = optionsFor(args), payload = { operation: args.action, lease: this.lease };
    // capabilities rejects any options key; other ops accept an optional object.
    if (Object.keys(options).length > 0) payload.options = options;
    return payload;
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
