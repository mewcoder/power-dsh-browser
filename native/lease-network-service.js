import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import { createNetworkRecorder } from './network-recorder.js';

// Leave room for the bridge envelope and Host tab metadata.
const BODY_JSON_BYTES = 59000;

// Page the stored string, including base64, in UTF-16 code units. `bytes` remains
// the core's total decoded body byte count; it is not a chunk size. Unknown
// encoding/bytes on pending or unavailable bodies are explicitly null.
function bodyPage(core, query = {}) {
  if (!query || typeof query !== 'object' || Array.isArray(query)) throw Error('INVALID_NETWORK_QUERY');
  const { offset = 0, limit = 12000, ...selection } = query;
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 16000) throw Error('INVALID_NETWORK_QUERY');
  const { body, ...metadata } = core.body(selection);
  const text = typeof body === 'string' ? body : '';
  const page = length => ({
    ...metadata,
    encoding: metadata.encoding ?? (typeof body === 'string' ? (metadata.base64Encoded ? 'base64' : 'utf8') : null),
    bytes: metadata.bytes ?? null,
    body: text.slice(offset, offset + length),
    offset, nextOffset: offset + length, hasMore: offset + length < text.length,
    offsetUnit: 'utf16-code-units',
  });
  const fits = value => Buffer.byteLength(JSON.stringify(value), 'utf8') < BODY_JSON_BYTES;
  let low = 0, high = Math.min(limit, Math.max(0, text.length - offset));
  let result = page(high);
  if (fits(result)) return result;
  result = page(0);
  if (!fits(result)) throw Error('NETWORK_BODY_RESPONSE_TOO_LARGE');
  // Escaped controls/lone surrogates can cost six JSON bytes per code unit.
  // Measure the complete response, not just the unescaped source chunk.
  while (low < high) {
    const length = Math.ceil((low + high) / 2), candidate = page(length);
    if (fits(candidate)) { low = length; result = candidate; }
    else high = length - 1;
  }
  return result;
}

// MAIN-process service. The host supplies its original assertProductSender and
// real DesktopBrowserGuests.leases map; no renderer-supplied page ids are trusted.
// release(lease) and dispose() are trusted host lifecycle hooks, not renderer RPCs.
export function createLeaseNetworkService({ assertProductSender, leases, recorder = createNetworkRecorder }) {
  const captures = new Map(), pending = new Map(); let disposed = false;
  function guest(event, lease) {
    assertProductSender(event);
    const entry = leases.get(lease);
    if (disposed || typeof lease !== 'string' || !entry || entry.owner !== event.sender || !entry.guest || entry.guest.isDestroyed()) throw Error('NETWORK_LEASE_UNAVAILABLE');
    return entry.guest;
  }
  function capture(event, lease, captureId) {
    const page = guest(event, lease), value = captures.get(lease);
    if (!value || value.captureId !== captureId || value.guest !== page || value.owner !== event.sender) throw Error('NETWORK_CAPTURE_UNAVAILABLE');
    return value;
  }
  const api = {
    async start(event, lease, options = {}) {
      const page = guest(event, lease);
      if (!options || typeof options !== 'object' || Array.isArray(options) || Object.keys(options).some(key => !['maxRequests', 'maxBodyBytes', 'maxTotalBodyBytes', 'childTargets', 'websocketFrames'].includes(key))) throw Error('INVALID_NETWORK_OPTIONS');
      let existing = captures.get(lease), attempt = pending.get(lease);
      if (existing?.guest === page && existing.owner === event.sender) return { ...existing.recorder.status(), captureId: existing.captureId };
      // A lease string may have been rebound. Never reuse a different guest's
      // recorder, even while its asynchronous initialization is still pending.
      if (existing || (attempt && (attempt.guest !== page || attempt.owner !== event.sender))) {
        api.release(lease); attempt = undefined;
      }
      if (!attempt) {
        attempt = { canceled: false, guest: page, owner: event.sender, controller: new AbortController() };
        const canceled = new Promise((_resolve, reject) => { attempt.reject = reject; });
        attempt.destroyed = () => {
          if (pending.get(lease) === attempt || captures.get(lease)?.attempt === attempt) api.release(lease);
        };
        page.once('destroyed', attempt.destroyed);
        pending.set(lease, attempt);
        // The race frees callers promptly even if an injected factory never
        // settles. Installation remains observed and disposes any late instance.
        const installation = Promise.resolve().then(() => {
          if (attempt.canceled) throw Error('NETWORK_START_CANCELED');
          return recorder(page, { ...options, signal: attempt.controller.signal });
        }).then(instance => {
          try {
            if (attempt.canceled || guest(event, lease) !== page || pending.get(lease) !== attempt) throw Error('NETWORK_START_CANCELED');
            const value = { captureId: randomUUID(), guest: page, owner: event.sender, recorder: instance, attempt };
            captures.set(lease, value);
            return value;
          } catch (error) { instance.dispose(); throw error; }
        });
        attempt.promise = Promise.race([installation, canceled]).finally(() => {
          if (pending.get(lease) === attempt) pending.delete(lease);
          if (captures.get(lease)?.attempt !== attempt) page.removeListener('destroyed', attempt.destroyed);
        });
      }
      const value = await attempt.promise;
      if (attempt.canceled || guest(event, lease) !== page || captures.get(lease) !== value) throw Error('NETWORK_START_CANCELED');
      return { ...value.recorder.status(), captureId: value.captureId };
    },
    statusOf(event, lease, captureId) {
      const value = capture(event, lease, captureId);
      return { ...value.recorder.status(), captureId: value.captureId };
    },
    list(event, lease, captureId, query) { return capture(event, lease, captureId).recorder.list(query); },
    read(event, lease, captureId, query) { return capture(event, lease, captureId).recorder.read(query); },
    body(event, lease, captureId, query) { return bodyPage(capture(event, lease, captureId).recorder, query); },
    frames(event, lease, captureId, query) {
      const recorder = capture(event, lease, captureId).recorder;
      if (typeof recorder.frames !== 'function') throw Error('INVALID_NETWORK_QUERY');
      return recorder.frames(query);
    },
    clear(event, lease, captureId) { return capture(event, lease, captureId).recorder.clear(); },
    stop(event, lease, captureId) { capture(event, lease, captureId); api.release(lease); return { stopped: true }; },
    release(lease) {
      const value = captures.get(lease), attempt = pending.get(lease) || value?.attempt;
      pending.delete(lease); captures.delete(lease);
      if (attempt) {
        attempt.canceled = true;
        attempt.guest.removeListener('destroyed', attempt.destroyed);
        attempt.reject(Error('NETWORK_START_CANCELED'));
        attempt.controller.abort();
      }
      value?.recorder.dispose();
    },
    dispose() { if (disposed) return; disposed = true; for (const lease of new Set([...captures.keys(), ...pending.keys()])) api.release(lease); },
  };
  return api;
}
