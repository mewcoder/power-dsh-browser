import { Buffer } from 'node:buffer';
import { createLeaseNetworkService } from './lease-network-service.js';

// One browser capability channel plus the unchanged legacy network channel.
// Both are served by the same handler logic and the same leased network service
// with identical lease/sender checks; the legacy channel exposes only the
// original network operations so existing preload/network tooling keeps working
// unchanged, while the capability channel adds the bounded one-off CDP surface.
// No client-supplied WebContents ids, no arbitrary page JavaScript.
export const DESKTOP_BROWSER_CHANNEL = 'dshx-browser:cap:v1';
export const DESKTOP_LEGACY_NETWORK_CHANNEL = 'dsh-browser:network:v1';
const INSTALLATION = Symbol.for('dshx-browser.cap.bridge.v1');
const MAX_JSON_BYTES = 60000;
const CDP_TIMEOUT_MS = 8000;

const NETWORK_OPERATIONS = Object.freeze(['status', 'start', 'list', 'read', 'body', 'frames', 'clear', 'stop']);
const CDP_OPERATIONS = Object.freeze(['emulate', 'clearEmulation', 'cookies', 'accessibility', 'input']);
// Download tracking and file-input uploads are capability-channel-only. They are
// intentionally absent from NETWORK_OPERATIONS so the legacy channel keeps
// rejecting them as INVALID_NETWORK_REQUEST.
const DOWNLOAD_OPERATIONS = Object.freeze(['downloads', 'clearDownloads', 'downloadCancel', 'upload']);
// The tracker ops are served from bridge-local state; `upload` uses CDP.
const TRACKER_OPERATIONS = Object.freeze(['downloads', 'clearDownloads', 'downloadCancel']);
const OPERATIONS = Object.freeze([...NETWORK_OPERATIONS, ...CDP_OPERATIONS, ...DOWNLOAD_OPERATIONS, 'capabilities']);

const ERROR_CODES = new Set([
  // Request shape / option validation (browser surface).
  'INVALID_CAPABILITY_REQUEST', 'INVALID_CAPABILITY_OPTIONS',
  // Delegated network service codes (kept verbatim).
  'INVALID_NETWORK_REQUEST', 'INVALID_NETWORK_OPTIONS', 'INVALID_NETWORK_QUERY', 'INVALID_BODY_KIND',
  'NETWORK_FORBIDDEN', 'NETWORK_LEASE_UNAVAILABLE', 'NETWORK_CAPTURE_UNAVAILABLE',
  'NETWORK_REQUEST_NOT_FOUND', 'NETWORK_DEBUGGER_ALREADY_ATTACHED', 'NETWORK_START_CANCELED',
  'NETWORK_START_CANCELLED', 'NETWORK_COMMAND_CANCELLED', 'NETWORK_COMMAND_TIMEOUT',
  'NETWORK_BODY_RESPONSE_TOO_LARGE', 'NETWORK_METADATA_RESPONSE_TOO_LARGE', 'NETWORK_GUEST_DESTROYED',
  'NETWORK_RESPONSE_TOO_LARGE', 'NETWORK_BRIDGE_DISPOSED', 'NETWORK_INTERNAL_ERROR',
  // CDP failures.
  'CDP_BUSY', 'CDP_TIMEOUT', 'CDP_UNAVAILABLE', 'CDP_ERROR',
  // Download/upload surface.
  'UPLOAD_TARGET_NOT_FOUND', 'DOWNLOAD_NOT_FOUND',
]);

const fail = code => { throw new Error(code); };
const errorReply = code => ({ ok: false, error: { code, message: code } });
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value))
  && Reflect.ownKeys(value).every(key => typeof key === 'string' && Object.getOwnPropertyDescriptor(value, key)?.get === undefined && Object.getOwnPropertyDescriptor(value, key)?.set === undefined);
const keys = (value, allowed, code) => {
  if (!object(value) || Object.getOwnPropertyNames(value).some(key => !allowed.includes(key))) fail(code);
};
const text = (value, max) => typeof value === 'string' && value.length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value);
const string = (value, max) => typeof value === 'string' && value.length <= max;
// Absolute-looking local path: POSIX root or a Windows drive root. Uploads only
// set files on a file input; the path is never evaluated as page JavaScript.
const absolutePath = value => typeof value === 'string'
  && (value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value));
const int = (value, min, max = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(value) && value >= min && value <= max;
const number = (value, min, max) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
const bool = value => typeof value === 'boolean';
const fits = value => Buffer.byteLength(JSON.stringify({ ok: true, value }), 'utf8') < MAX_JSON_BYTES;

// Validate every renderer field before consulting authentication, leases or CDP.
// `legacy` restricts the request to the original network operation set.
function validate(request, legacy = false) {
  if (!object(request)) fail(legacy ? 'INVALID_NETWORK_REQUEST' : 'INVALID_CAPABILITY_REQUEST');
  const { operation, lease } = request;
  // Structural rejections keep the original network code on the legacy channel
  // and for network operations; the browser surface uses its own request code.
  const shapeCode = legacy || (typeof operation === 'string' && NETWORK_OPERATIONS.includes(operation))
    ? 'INVALID_NETWORK_REQUEST' : 'INVALID_CAPABILITY_REQUEST';
  keys(request, ['operation', 'lease', 'captureId', 'query', 'options'], shapeCode);
  if (legacy) {
    if (typeof operation !== 'string' || !NETWORK_OPERATIONS.includes(operation)) fail('INVALID_NETWORK_REQUEST');
  } else if (typeof operation !== 'string' || !OPERATIONS.includes(operation)) {
    fail('INVALID_CAPABILITY_REQUEST');
  }

  // Capabilities is a static description of this channel; it reuses no lease.
  if (operation === 'capabilities') {
    if ('captureId' in request || 'query' in request || 'options' in request) fail('INVALID_CAPABILITY_REQUEST');
    if ('lease' in request && !text(lease, 128)) fail('INVALID_CAPABILITY_REQUEST');
    if (Buffer.byteLength(JSON.stringify(request), 'utf8') > MAX_JSON_BYTES) fail('INVALID_CAPABILITY_REQUEST');
    return request;
  }

  if (!text(lease, 128)) fail(NETWORK_OPERATIONS.includes(operation) ? 'INVALID_NETWORK_REQUEST' : 'INVALID_CAPABILITY_REQUEST');
  return NETWORK_OPERATIONS.includes(operation) ? validateNetwork(request) : validateCdp(request);
}

// Exact copy of the existing network request validation: same fields, same
// bounds, same codes. Network semantics must not drift.
function validateNetwork(request) {
  const { operation, lease, captureId } = request;
  if ('captureId' in request && !text(captureId, 128)) fail('INVALID_NETWORK_REQUEST');
  if (!['status', 'start'].includes(operation) && !text(captureId, 128)) fail('INVALID_NETWORK_REQUEST');
  if (operation === 'start' && 'captureId' in request) fail('INVALID_NETWORK_REQUEST');
  if ('options' in request) {
    if (operation !== 'start') fail('INVALID_NETWORK_REQUEST');
    keys(request.options, ['maxRequests', 'maxBodyBytes', 'maxTotalBodyBytes', 'childTargets', 'websocketFrames'], 'INVALID_NETWORK_OPTIONS');
    for (const key of Object.getOwnPropertyNames(request.options)) {
      if (key === 'childTargets' || key === 'websocketFrames') {
        if (typeof request.options[key] !== 'boolean') fail('INVALID_NETWORK_OPTIONS');
        continue;
      }
      // Mirrors NETWORK_BUDGETS in src/constants.js (this module is injected
      // into the host ASAR and cannot import plugin sources).
      const max = { maxRequests: 500, maxBodyBytes: 2 * 1024 * 1024, maxTotalBodyBytes: 16 * 1024 * 1024 }[key];
      if (!int(request.options[key], 1, max)) fail('INVALID_NETWORK_OPTIONS');
    }
  }
  if ('query' in request && !['list', 'read', 'body', 'frames'].includes(operation)) fail('INVALID_NETWORK_REQUEST');
  const query = 'query' in request ? request.query : {};
  if (operation === 'list') {
    keys(query, ['afterSequence', 'limit', 'filter'], 'INVALID_NETWORK_QUERY');
    if ('afterSequence' in query && !int(query.afterSequence, 0)) fail('INVALID_NETWORK_QUERY');
    if ('limit' in query && !int(query.limit, 1, 100)) fail('INVALID_NETWORK_QUERY');
    if ('filter' in query && (typeof query.filter !== 'string' || query.filter.length > 200)) fail('INVALID_NETWORK_QUERY');
  } else if (operation === 'read' || operation === 'body' || operation === 'frames') {
    keys(query, operation === 'body' ? ['requestId', 'hop', 'kind', 'offset', 'limit', 'sessionId', 'targetId'] : operation === 'frames' ? ['requestId', 'hop', 'sessionId', 'targetId'] : ['requestId', 'hop', 'sessionId', 'targetId'], 'INVALID_NETWORK_QUERY');
    if (!text(query.requestId, 200) || ('hop' in query && !int(query.hop, 0))) fail('INVALID_NETWORK_QUERY');
    if (operation === 'body') {
      if (!['request', 'response'].includes(query.kind)) fail('INVALID_BODY_KIND');
      if ('offset' in query && !int(query.offset, 0)) fail('INVALID_NETWORK_QUERY');
      if ('limit' in query && !int(query.limit, 1, 16000)) fail('INVALID_NETWORK_QUERY');
    }
  }
  if (Buffer.byteLength(JSON.stringify(request), 'utf8') > MAX_JSON_BYTES) fail('INVALID_NETWORK_REQUEST');
  return request;
}

// Per-operation option whitelist with explicit type/range bounds. Any unknown
// key fails before a lease is read or a debugger is touched.
function validateCdp(request) {
  const { operation } = request;
  if ('captureId' in request || 'query' in request) fail('INVALID_CAPABILITY_REQUEST');
  const options = 'options' in request ? request.options : {};
  if (!object(options)) fail('INVALID_CAPABILITY_OPTIONS');

  if (operation === 'emulate') {
    keys(options, ['width', 'height', 'deviceScaleFactor', 'mobile', 'userAgent', 'timezone', 'media'], 'INVALID_CAPABILITY_OPTIONS');
    const hasWidth = 'width' in options, hasHeight = 'height' in options;
    if (hasWidth !== hasHeight) fail('INVALID_CAPABILITY_OPTIONS');
    if (hasWidth && (!int(options.width, 1, 10000) || !int(options.height, 1, 10000))) fail('INVALID_CAPABILITY_OPTIONS');
    if ('deviceScaleFactor' in options && !number(options.deviceScaleFactor, 0.1, 5)) fail('INVALID_CAPABILITY_OPTIONS');
    if ('mobile' in options && !bool(options.mobile)) fail('INVALID_CAPABILITY_OPTIONS');
    if ('userAgent' in options && !text(options.userAgent, 2048)) fail('INVALID_CAPABILITY_OPTIONS');
    if ('timezone' in options && !text(options.timezone, 128)) fail('INVALID_CAPABILITY_OPTIONS');
    if ('media' in options && !text(options.media, 32)) fail('INVALID_CAPABILITY_OPTIONS');
  } else if (operation === 'clearEmulation' || operation === 'accessibility') {
    keys(options, [], 'INVALID_CAPABILITY_OPTIONS');
  } else if (operation === 'cookies') {
    keys(options, ['action'], 'INVALID_CAPABILITY_OPTIONS');
    if (!['get', 'clear'].includes(options.action)) fail('INVALID_CAPABILITY_OPTIONS');
  } else if (operation === 'input') {
    keys(options, ['type', 'mouseType', 'x', 'y', 'button', 'clickCount', 'key', 'code', 'text', 'modifiers'], 'INVALID_CAPABILITY_OPTIONS');
    if (!['mouse', 'key'].includes(options.type)) fail('INVALID_CAPABILITY_OPTIONS');
    if ('mouseType' in options && !['mousePressed', 'mouseReleased', 'mouseMoved', 'mouseWheel'].includes(options.mouseType)) fail('INVALID_CAPABILITY_OPTIONS');
    if ('x' in options && !number(options.x, -100000, 100000)) fail('INVALID_CAPABILITY_OPTIONS');
    if ('y' in options && !number(options.y, -100000, 100000)) fail('INVALID_CAPABILITY_OPTIONS');
    if ('button' in options && !['none', 'left', 'middle', 'right', 'back', 'forward'].includes(options.button)) fail('INVALID_CAPABILITY_OPTIONS');
    if ('clickCount' in options && !int(options.clickCount, 1, 3)) fail('INVALID_CAPABILITY_OPTIONS');
    if ('key' in options && !text(options.key, 64)) fail('INVALID_CAPABILITY_OPTIONS');
    if ('code' in options && !text(options.code, 64)) fail('INVALID_CAPABILITY_OPTIONS');
    if ('text' in options && !string(options.text, 10000)) fail('INVALID_CAPABILITY_OPTIONS');
    if ('modifiers' in options && !int(options.modifiers, 0, 15)) fail('INVALID_CAPABILITY_OPTIONS');
    if (options.type === 'mouse' && !('mouseType' in options)) fail('INVALID_CAPABILITY_OPTIONS');
  } else if (operation === 'downloads' || operation === 'clearDownloads') {
    keys(options, [], 'INVALID_CAPABILITY_OPTIONS');
  } else if (operation === 'downloadCancel') {
    keys(options, ['id'], 'INVALID_CAPABILITY_OPTIONS');
    if (!int(options.id, 0)) fail('INVALID_CAPABILITY_OPTIONS');
  } else if (operation === 'upload') {
    keys(options, ['selector', 'files'], 'INVALID_CAPABILITY_OPTIONS');
    if (!text(options.selector, 512)) fail('INVALID_CAPABILITY_OPTIONS');
    const files = options.files;
    if (!Array.isArray(files) || files.length < 1 || files.length > 10) fail('INVALID_CAPABILITY_OPTIONS');
    for (const file of files) {
      if (!text(file, 4096) || !absolutePath(file)) fail('INVALID_CAPABILITY_OPTIONS');
    }
  } else {
    fail('INVALID_CAPABILITY_REQUEST');
  }
  if (Buffer.byteLength(JSON.stringify(request), 'utf8') > MAX_JSON_BYTES) fail('INVALID_CAPABILITY_REQUEST');
  return request;
}

function envelope(value) {
  const json = JSON.stringify({ ok: true, value: value ?? null });
  if (Buffer.byteLength(json, 'utf8') > MAX_JSON_BYTES) return errorReply('NETWORK_RESPONSE_TOO_LARGE');
  // JSON data only: never hand Electron a debugger, guest or arbitrary object.
  return JSON.parse(json);
}

// `build` identifies the bridge surface. The plugin compares it with its own
// expected value so a stale patch reports "reinstall the bridge" instead of
// silently failing on a missing operation.
const BRIDGE_BUILD = '2026-11-08.2';
const capabilities = () => ({
  version: 1, build: BRIDGE_BUILD, operations: [...OPERATIONS], network: true,
  emulate: true, cookies: true, accessibility: true, input: true,
  downloads: true, upload: true,
});

// Bound a single CDP command to ~8s; a stuck command cannot hold the lease open.
function cdpCommand(debug, method, params) {
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (callback, value) => { if (done) return; done = true; clearTimeout(timer); callback(value); };
    const timer = setTimeout(() => finish(reject, Error('CDP_TIMEOUT')), CDP_TIMEOUT_MS);
    try {
      Promise.resolve(debug.sendCommand(method, params)).then(
        value => finish(resolve, value),
        () => finish(reject, Error('CDP_ERROR')),
      );
    } catch { finish(reject, Error('CDP_ERROR')); }
  });
}

// Attach exactly when the guest's debugger is free; always detach only what we
// attached. If the network recorder already owns the debugger this reports
// CDP_BUSY and leaves that attachment untouched.
async function withDebugger(guest, fn) {
  const debug = guest?.debugger;
  if (!debug || typeof debug.attach !== 'function' || typeof debug.isAttached !== 'function') fail('CDP_UNAVAILABLE');
  let attached;
  try { attached = debug.isAttached(); } catch { fail('CDP_UNAVAILABLE'); }
  if (attached) fail('CDP_BUSY');
  try { debug.attach('1.3'); } catch { fail('CDP_UNAVAILABLE'); }
  let result, error;
  try { result = await fn(debug); } catch (caught) { error = caught; }
  try { debug.detach(); } catch { if (!error) error = Error('CDP_UNAVAILABLE'); }
  if (error) throw error;
  return result;
}

const boundedText = (value, max) => (typeof value === 'string' ? value.slice(0, max) : '');
const boundCookie = cookie => ({
  name: boundedText(cookie?.name, 256), value: boundedText(cookie?.value, 4096),
  domain: boundedText(cookie?.domain, 256), path: boundedText(cookie?.path, 256),
  ...(typeof cookie?.sameSite === 'string' ? { sameSite: boundedText(cookie.sameSite, 32) } : {}),
  ...(Number.isFinite(cookie?.expires) ? { expires: cookie.expires } : {}),
  secure: !!cookie?.secure, httpOnly: !!cookie?.httpOnly, session: !!cookie?.session,
});
const boundNode = node => ({
  nodeId: boundedText(node?.nodeId, 64), ignored: !!node?.ignored,
  role: boundedText(node?.role?.value, 128), name: boundedText(node?.name?.value, 512),
  description: boundedText(node?.description?.value, 512),
  childIds: Array.isArray(node?.childIds) ? node.childIds.slice(0, 64).map(id => boundedText(id, 64)) : [],
});

async function emulate(guest, options = {}) {
  return withDebugger(guest, async debug => {
    const applied = [];
    if ('width' in options && 'height' in options) {
      await cdpCommand(debug, 'Emulation.setDeviceMetricsOverride', {
        width: options.width, height: options.height,
        deviceScaleFactor: options.deviceScaleFactor ?? 1, mobile: options.mobile ?? false,
      });
      applied.push('deviceMetrics');
    }
    if ('userAgent' in options) {
      await cdpCommand(debug, 'Emulation.setUserAgentOverride', { userAgent: options.userAgent });
      applied.push('userAgent');
    }
    if ('timezone' in options) {
      await cdpCommand(debug, 'Emulation.setTimezoneOverride', { timezoneId: options.timezone });
      applied.push('timezone');
    }
    if ('media' in options) {
      await cdpCommand(debug, 'Emulation.setEmulatedMedia', { media: options.media, features: [] });
      applied.push('media');
    }
    return { applied };
  });
}

async function clearEmulation(guest) {
  return withDebugger(guest, async debug => {
    await cdpCommand(debug, 'Emulation.clearDeviceMetricsOverride', {});
    // Best-effort resets; an unsupported reset must not block the clear.
    for (const [method, params] of [
      ['Emulation.setUserAgentOverride', { userAgent: '' }],
      ['Emulation.setTimezoneOverride', { timezoneId: '' }],
      ['Emulation.setEmulatedMedia', { media: '', features: [] }],
    ]) { try { await cdpCommand(debug, method, params); } catch { /* reset is best-effort */ } }
    return { cleared: true };
  });
}

async function cookies(guest, options = {}) {
  return withDebugger(guest, async debug => {
    if (options.action === 'clear') {
      await cdpCommand(debug, 'Network.clearBrowserCookies', {});
      return { cleared: true };
    }
    const result = await cdpCommand(debug, 'Network.getAllCookies', {});
    const all = Array.isArray(result?.cookies) ? result.cookies : [];
    let truncated = all.length > 500;
    const list = all.slice(0, 500).map(boundCookie);
    const build = () => ({ cookies: list, count: list.length, truncated });
    let value = build();
    // Trim from the tail until the whole reply fits the 60k JSON budget.
    while (list.length > 0 && !fits(value)) { list.pop(); truncated = true; value = build(); }
    return value;
  });
}

async function accessibility(guest) {
  return withDebugger(guest, async debug => {
    await cdpCommand(debug, 'Accessibility.enable', {});
    const result = await cdpCommand(debug, 'Accessibility.getFullAXTree', {});
    const all = Array.isArray(result?.nodes) ? result.nodes : [];
    let truncated = all.length > 200;
    const list = all.slice(0, 200).map(boundNode);
    const build = () => ({ nodes: list, count: list.length, truncated });
    let value = build();
    while (list.length > 0 && !fits(value)) { list.pop(); truncated = true; value = build(); }
    return value;
  });
}

async function input(guest, options = {}) {
  return withDebugger(guest, async debug => {
    if (options.type === 'mouse') {
      const params = { type: options.mouseType };
      if ('x' in options) params.x = options.x;
      if ('y' in options) params.y = options.y;
      if ('button' in options) params.button = options.button;
      if ('clickCount' in options) params.clickCount = options.clickCount;
      if ('modifiers' in options) params.modifiers = options.modifiers;
      await cdpCommand(debug, 'Input.dispatchMouseEvent', params);
    } else {
      // keyDown for a key event; char when text is supplied (CDP requires text for char).
      const params = { type: 'text' in options ? 'char' : 'keyDown' };
      if ('key' in options) params.key = options.key;
      if ('code' in options) params.code = options.code;
      if ('text' in options) params.text = options.text;
      if ('modifiers' in options) params.modifiers = options.modifiers;
      await cdpCommand(debug, 'Input.dispatchKeyEvent', params);
    }
    return { dispatched: true };
  });
}

const runCdp = (operation, guest, options) => {
  switch (operation) {
    case 'emulate': return emulate(guest, options);
    case 'clearEmulation': return clearEmulation(guest);
    case 'cookies': return cookies(guest, options);
    case 'accessibility': return accessibility(guest);
    case 'input': return input(guest, options);
    case 'upload': return upload(guest, options);
    default: return Promise.reject(Error('INVALID_CAPABILITY_REQUEST'));
  }
};

// Download tracking state is per installation: one bounded ring of summaries and
// one WeakSet of sessions that already carry our will-download listener.
const MAX_DOWNLOADS = 50;
const DOWNLOAD_STATES = new Set(['progressing', 'completed', 'cancelled', 'interrupted']);

// Refresh a record from its live Electron DownloadItem. A hostile or already
// destroyed item must never break listing, cancelling or the event listener.
const refreshDownload = record => {
  const item = record.item, summary = record.summary;
  if (!item) return summary;
  try {
    const state = item.getState();
    if (typeof state === 'string' && state) summary.state = DOWNLOAD_STATES.has(state) ? state : boundedText(state, 32);
  } catch {}
  try {
    const received = item.getReceivedBytes();
    if (Number.isFinite(received) && received >= 0) summary.receivedBytes = received;
  } catch {}
  try {
    const total = item.getTotalBytes();
    if (Number.isFinite(total) && total >= 0) summary.totalBytes = total;
  } catch {}
  try {
    const savePath = item.getSavePath();
    if (typeof savePath === 'string' && savePath.length > 0) summary.savePath = boundedText(savePath, 4096);
  } catch {}
  return summary;
};

const snapshotDownload = record => {
  const summary = refreshDownload(record);
  return {
    id: summary.id, url: summary.url, filename: summary.filename,
    ...(summary.mimeType ? { mimeType: summary.mimeType } : {}),
    state: summary.state, receivedBytes: summary.receivedBytes, totalBytes: summary.totalBytes,
    ...(summary.savePath ? { savePath: summary.savePath } : {}),
    startedAt: summary.startedAt,
  };
};

// Attach the will-download listener lazily, once per unique session object.
// Missing sessions (or a throwing emitter) degrade to an empty download list.
function attachDownloads(downloads, guest) {
  const session = guest?.session;
  if (!session || typeof session.on !== 'function' || downloads.sessions.has(session)) return;
  downloads.sessions.add(session);
  try {
    session.on('will-download', (event, item) => {
      try {
        if (!item || typeof item !== 'object') return;
        const readText = (getter, max) => {
          try { const value = getter(); return typeof value === 'string' ? boundedText(value, max) : ''; } catch { return ''; }
        };
        const readBytes = getter => {
          try { const value = getter(); return Number.isFinite(value) && value >= 0 ? value : 0; } catch { return 0; }
        };
        const savePath = readText(() => item.getSavePath(), 4096);
        const record = {
          item,
          summary: {
            id: downloads.nextId++,
            url: readText(() => item.getURL(), 4096),
            filename: readText(() => item.getFilename(), 512),
            mimeType: readText(() => item.getMimeType(), 128),
            state: 'progressing',
            receivedBytes: readBytes(() => item.getReceivedBytes()),
            totalBytes: readBytes(() => item.getTotalBytes()),
            ...(savePath ? { savePath } : {}),
            startedAt: new Date().toISOString(),
          },
        };
        refreshDownload(record);
        downloads.records.push(record);
        while (downloads.records.length > MAX_DOWNLOADS) downloads.records.shift();
        try { item.on('updated', () => { try { refreshDownload(record); } catch {} }); } catch {}
        try {
          item.once('done', (_e, state) => {
            try {
              if (typeof state === 'string' && state) record.summary.state = DOWNLOAD_STATES.has(state) ? state : boundedText(state, 32);
              refreshDownload(record);
            } catch {}
          });
        } catch {}
      } catch { /* listener must never throw into Electron */ }
    });
  } catch { /* an unusable session just yields an empty list */ }
}

function runDownloads(operation, guest, options, downloads) {
  if (operation === 'downloads') {
    attachDownloads(downloads, guest);
    const items = downloads.records.map(snapshotDownload);
    let truncated = false;
    const build = () => ({ items, count: items.length, ...(truncated ? { truncated } : {}) });
    let value = build();
    // Drop the oldest summaries until the whole reply fits the 60k JSON budget.
    while (items.length > 0 && !fits(value)) { items.shift(); truncated = true; value = build(); }
    return value;
  }
  if (operation === 'clearDownloads') {
    downloads.records.length = 0;
    return { cleared: true };
  }
  // downloadCancel: only a tracked, still-progressing item can be cancelled.
  const record = downloads.records.find(value => value.summary.id === options.id);
  if (!record) fail('DOWNLOAD_NOT_FOUND');
  const item = record.item;
  let cancelled = false;
  try {
    if (refreshDownload(record).state === 'progressing' && item && typeof item.cancel === 'function') {
      item.cancel();
      record.summary.state = 'cancelled';
      cancelled = true;
    }
  } catch { cancelled = false; }
  return { cancelled };
}

// Set files on a file input through DOM.setFileInputFiles only. No page
// JavaScript is evaluated and no DOM value is read back.
async function upload(guest, options = {}) {
  return withDebugger(guest, async debug => {
    const files = options.files;
    await cdpCommand(debug, 'DOM.enable', {});
    const document = await cdpCommand(debug, 'DOM.getDocument', { depth: 0 });
    const rootNodeId = document?.root?.nodeId;
    if (!int(rootNodeId, 0)) fail('UPLOAD_TARGET_NOT_FOUND');
    const found = await cdpCommand(debug, 'DOM.querySelector', { nodeId: rootNodeId, selector: options.selector });
    const nodeId = found?.nodeId;
    if (!int(nodeId, 0) || nodeId === 0) fail('UPLOAD_TARGET_NOT_FOUND');
    await cdpCommand(debug, 'DOM.setFileInputFiles', { files: [...files], nodeId });
    return { uploaded: files.length };
  });
}

/** Install inside the existing Desktop main closure, after assertProductSender.
 * No Electron import: the host supplies its authenticated lease manager and IPC.
 * A failed installation is inert and must never interrupt Desktop startup.
 */
export function installDesktopBrowserBridge({ ipcMain, app, browserGuests, assertProductSender } = {}) {
  let service, handler, legacyHandler, originalRelease, wrappedRelease, installed = false, cached = false, disposed = false;
  const registered = [];
  const tracked = new Map(), owners = new Map();
  // Per-installation download tracker: a bounded ring plus the sessions already
  // carrying our will-download listener (a WeakSet keeps no session alive).
  const downloads = { records: [], nextId: 1, sessions: new WeakSet() };
  let installation;
  const untrack = lease => {
    const value = tracked.get(lease);
    if (!value) return;
    tracked.delete(lease);
    if (value.guest && value.onDestroyed) value.guest.removeListener('destroyed', value.onDestroyed);
    const entry = owners.get(value.owner);
    entry?.leases.delete(lease);
    if (entry && entry.leases.size === 0) {
      value.owner.removeListener('destroyed', entry.onDestroyed);
      owners.delete(value.owner);
    }
  };
  const release = lease => {
    untrack(lease);
    try { service?.release(lease); } catch { /* Cleanup must not block the host release. */ }
  };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    for (const lease of [...tracked.keys()]) release(lease);
    // Drop retained DownloadItem references; the session listener is harmless.
    downloads.records.length = 0;
    try { service?.dispose(); } catch {}
    try { if (wrappedRelease && browserGuests?.release === wrappedRelease) browserGuests.release = originalRelease; } catch {}
    try { app?.removeListener('will-quit', dispose); } catch {}
    // Electron's public removeHandler has no ownership token. Its own handler
    // registry, when available, lets cleanup leave a later replacement intact.
    // Remove only the channels this installation actually registered.
    for (const [channel, fn] of registered) {
      try {
        const registry = ipcMain?._invokeHandlers;
        const canInspect = registry && typeof registry.get === 'function';
        if (!canInspect || registry.get(channel) === fn) ipcMain.removeHandler(channel);
      } catch {}
    }
    registered.length = 0;
    try { if (ipcMain?.[INSTALLATION] === installation) delete ipcMain[INSTALLATION]; } catch {}
  };
  try {
    if (!ipcMain || typeof ipcMain.handle !== 'function' || typeof ipcMain.removeHandler !== 'function'
      || !app || typeof app.on !== 'function' || typeof app.removeListener !== 'function'
      || !(browserGuests?.leases instanceof Map) || typeof browserGuests.release !== 'function'
      || typeof assertProductSender !== 'function') throw Error('INVALID_BRIDGE_HOST');
    if (ipcMain[INSTALLATION]) return ipcMain[INSTALLATION];
    service = createLeaseNetworkService({ leases: browserGuests.leases, assertProductSender });
    const ownLease = (event, lease, forbidden, unavailable) => {
      try { assertProductSender(event); } catch { fail(forbidden); }
      const entry = browserGuests.leases.get(lease);
      if (!entry || entry.owner !== event.sender || event.sender.isDestroyed()) fail(unavailable);
      return entry;
    };
    const track = (lease, owner, guest) => {
      const previous = tracked.get(lease);
      if (previous?.owner === owner && previous.guest === guest) return previous;
      if (previous) release(lease);
      let entry = owners.get(owner);
      if (!entry) {
        entry = { leases: new Set(), onDestroyed: () => { for (const id of [...entry.leases]) release(id); } };
        owners.set(owner, entry); owner.once('destroyed', entry.onDestroyed);
      }
      const value = { owner, guest, captureId: undefined, onDestroyed: () => release(lease) };
      entry.leases.add(lease); tracked.set(lease, value);
      guest.once('destroyed', value.onDestroyed);
      return value;
    };
    const dispatch = async (event, payload, legacy) => {
      try {
        const request = validate(payload, legacy);
        if (disposed) fail(legacy ? 'NETWORK_BRIDGE_DISPOSED' : 'NETWORK_BRIDGE_DISPOSED');
        const { operation, lease, captureId, query, options } = request;
        if (operation === 'capabilities') return envelope(capabilities());
        if (NETWORK_OPERATIONS.includes(operation)) {
          const entry = ownLease(event, lease, 'NETWORK_FORBIDDEN', 'NETWORK_LEASE_UNAVAILABLE');
          const guest = entry.guest && !entry.guest.isDestroyed() ? entry.guest : undefined;
          let active = tracked.get(lease);
          if (active && (active.owner !== event.sender || active.guest !== guest)) { release(lease); active = undefined; }
          if (operation === 'status') {
            if (captureId && captureId !== active?.captureId) fail('NETWORK_CAPTURE_UNAVAILABLE');
            let live;
            try { live = active?.captureId ? service.statusOf(event, lease, active.captureId) : undefined; } catch { live = undefined; }
            return envelope({ protocolVersion: 1, ready: true, initialized: !!guest,
              capabilities: [...NETWORK_OPERATIONS],
              scope: live?.scope ?? 'owned-root-target', childTargets: live?.childTargets ?? false,
              ...(live ? { requests: live.requests, cursor: live.cursor, dropped: live.dropped, bodyBytes: live.bodyBytes, extraInfoDropped: live.extraInfoDropped, limits: live.limits } : {}),
              ...(live?.children ? { children: live.children } : {}),
              ...(active?.captureId ? { captureId: active.captureId } : {}) });
          }
          if (!guest) fail('NETWORK_LEASE_UNAVAILABLE');
          if (operation === 'start') {
            const attempt = track(lease, event.sender, guest);
            try {
              const result = await service.start(event, lease, options);
              if (disposed || tracked.get(lease) !== attempt) fail('NETWORK_START_CANCELED');
              ownLease(event, lease, 'NETWORK_FORBIDDEN', 'NETWORK_LEASE_UNAVAILABLE');
              attempt.captureId = result.captureId;
              return envelope(result);
            } catch (error) {
              if (tracked.get(lease) === attempt) release(lease);
              throw error;
            }
          }
          const result = operation === 'clear' || operation === 'stop'
            ? service[operation](event, lease, captureId)
            : service[operation](event, lease, captureId, query);
          if (operation === 'stop') untrack(lease);
          return envelope(result);
        }
        // Remaining operations are bounded one-off CDP capabilities.
        const entry = ownLease(event, lease, 'NETWORK_FORBIDDEN', 'NETWORK_LEASE_UNAVAILABLE');
        const guest = entry.guest && !entry.guest.isDestroyed() ? entry.guest : undefined;
        if (!guest) fail('NETWORK_LEASE_UNAVAILABLE');
        if (TRACKER_OPERATIONS.includes(operation)) {
          return envelope(runDownloads(operation, guest, options ?? {}, downloads));
        }
        return envelope(await runCdp(operation, guest, options ?? {}));
      } catch (error) {
        const code = ERROR_CODES.has(error?.message) ? error.message : 'NETWORK_INTERNAL_ERROR';
        return errorReply(code);
      }
    };
    handler = (event, payload) => dispatch(event, payload, false);
    legacyHandler = (event, payload) => dispatch(event, payload, true);
    originalRelease = browserGuests.release;
    wrappedRelease = function (owner, lease, ...args) {
      // Wrong owners cannot cancel another renderer's capture, even if release
      // subsequently rejects. Cancellation is synchronous before guest.close().
      if (browserGuests.leases.get(lease)?.owner === owner && tracked.get(lease)?.owner === owner) release(lease);
      return originalRelease.call(this, owner, lease, ...args);
    };
    installation = Object.freeze({ protocolVersion: 1, ready: true, dispose });
    for (const [channel, fn] of [[DESKTOP_BROWSER_CHANNEL, handler], [DESKTOP_LEGACY_NETWORK_CHANNEL, legacyHandler]]) {
      ipcMain.handle(channel, fn);
      registered.push([channel, fn]);
    }
    installed = true;
    ipcMain[INSTALLATION] = installation; cached = true;
    browserGuests.release = wrappedRelease;
    app.on('will-quit', dispose);
    return installation;
  } catch {
    dispose();
    return Object.freeze({ protocolVersion: 1, ready: false, dispose });
  }
}
