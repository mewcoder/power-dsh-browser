'use strict';

// Sandbox-safe CJS factory for the PowerDSH Browser capability channel. This file is
// inlined verbatim into the host preload; it must not require any local module.
const CHANNEL = 'dshx-browser:cap:v1';
const MAX_JSON_BYTES = 60000;
const OPERATIONS = ['status', 'start', 'list', 'read', 'body', 'frames', 'clear', 'stop',
  'capabilities', 'emulate', 'clearEmulation', 'cookies', 'accessibility', 'input',
  'downloads', 'clearDownloads', 'downloadCancel', 'upload'];
const ERROR_CODES = new Set([
  'INVALID_NETWORK_REQUEST', 'INVALID_NETWORK_OPTIONS', 'INVALID_NETWORK_QUERY', 'INVALID_BODY_KIND',
  'INVALID_CAPABILITY_REQUEST', 'INVALID_CAPABILITY_OPTIONS',
  'NETWORK_FORBIDDEN', 'NETWORK_LEASE_UNAVAILABLE', 'NETWORK_CAPTURE_UNAVAILABLE',
  'NETWORK_REQUEST_NOT_FOUND', 'NETWORK_DEBUGGER_ALREADY_ATTACHED', 'NETWORK_START_CANCELED',
  'NETWORK_START_CANCELLED', 'NETWORK_COMMAND_CANCELLED', 'NETWORK_COMMAND_TIMEOUT',
  'NETWORK_BODY_RESPONSE_TOO_LARGE', 'NETWORK_METADATA_RESPONSE_TOO_LARGE', 'NETWORK_GUEST_DESTROYED',
  'NETWORK_RESPONSE_TOO_LARGE', 'NETWORK_BRIDGE_DISPOSED',
  'CDP_BUSY', 'CDP_UNAVAILABLE', 'CDP_TIMEOUT', 'CDP_ERROR', 'CAPABILITY_UNSUPPORTED',
  'UPLOAD_TARGET_NOT_FOUND', 'DOWNLOAD_NOT_FOUND',
  'NETWORK_INTERNAL_ERROR', 'BRIDGE_UNAVAILABLE',
]);
const failure = code => ({ ok: false, error: { code, message: code } });
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value))
  && Reflect.ownKeys(value).every(key => typeof key === 'string'
    && Object.getOwnPropertyDescriptor(value, key)?.get === undefined
    && Object.getOwnPropertyDescriptor(value, key)?.set === undefined);
const text = value => typeof value === 'string' && value.length > 0 && value.length <= 128 && !/[\u0000-\u001f\u007f]/.test(value);
function jsonData(value, max = MAX_JSON_BYTES) {
  const json = JSON.stringify(value);
  if (typeof json !== 'string' || new TextEncoder().encode(json).byteLength > max) throw Error('JSON_LIMIT');
  return JSON.parse(json);
}

/** Called by the existing browser preload factory. Only JSON envelopes cross the
 * public API; the closure never returns ipcRenderer, events or raw invoke. */
function createDesktopCapBridge(ipcRenderer) {
  return Object.freeze({
    protocolVersion: 1,
    async request(payload) {
      let request;
      try {
        if (!object(payload) || Object.keys(payload).some(key => !['operation', 'lease', 'captureId', 'query', 'options'].includes(key))
          || !OPERATIONS.includes(payload.operation) || !text(payload.lease)
          || ('captureId' in payload && !text(payload.captureId))
          || ('query' in payload && !object(payload.query))
          || ('options' in payload && !object(payload.options))) return failure('INVALID_CAPABILITY_REQUEST');
        request = jsonData(payload);
      } catch { return failure('INVALID_CAPABILITY_REQUEST'); }
      let reply;
      try {
        if (!ipcRenderer || typeof ipcRenderer.invoke !== 'function') return failure('BRIDGE_UNAVAILABLE');
        reply = await ipcRenderer.invoke(CHANNEL, request);
      } catch { return failure('BRIDGE_UNAVAILABLE'); }
      try {
        if (!object(reply) || typeof reply.ok !== 'boolean') return failure('BRIDGE_UNAVAILABLE');
        if (!reply.ok) {
          const code = object(reply.error) && ERROR_CODES.has(reply.error.code) ? reply.error.code : 'NETWORK_INTERNAL_ERROR';
          return failure(code);
        }
        if (Object.keys(reply).some(key => !['ok', 'value'].includes(key)) || !Object.hasOwn(reply, 'value')) return failure('BRIDGE_UNAVAILABLE');
        const result = jsonData(reply);
        return Object.hasOwn(result, 'value') ? result : failure('BRIDGE_UNAVAILABLE');
      } catch { return failure('NETWORK_RESPONSE_TOO_LARGE'); }
    },
  });
}

module.exports = { createDesktopCapBridge };
