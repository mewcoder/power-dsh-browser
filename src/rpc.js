import { LIMITS, validId } from './protocol.js';
import { validateAnnotationBatch } from './annotation-archive.js';
const codec = (name, parse) => ({ mode: 'strict', typeSymbol: `dsh-browser#${name}`, create: () => ({ parse }) });
const token = codec('Token', value => { if (!validId(value)) throw new TypeError('Invalid token'); return value; });
const json = codec('BoundedJson', value => {
  if (value === undefined || JSON.stringify(value).length > LIMITS.wire) throw new TypeError('Invalid/oversized JSON');
  return value;
});
const integer = codec('Epoch', value => { if (!Number.isSafeInteger(value) || value < 0) throw new TypeError('Invalid epoch'); return value; });
const batch = codec('ConfirmedAnnotationBatch', value => validateAnnotationBatch(value, value?.sessionId));
const definitions = { connect: [['sessionId', token], ['instance', token]], openRequested: [], poll: [['key', token]], reply: [['key', token], ['requestId', token], ['epoch', integer], ['result', json]], stop: [['key', token]], disconnect: [['key', token]], publishAnnotations: [['key', token], ['batch', batch]] };
export const RPC = Object.entries(definitions).map(([method, parameters]) => ({
  id: `dsh-browser#dshBrowser/${method}`, service: 'dshBrowser', namespace: 'dshBrowser', method,
  invocation: { kind: 'direct' },
  parameters: parameters.map(([name, codec]) => ({ name, wire: name, source: 'json', codec })),
  result: json,
}));
export async function call(remote, method, ...args) {
  const result = await remote.dshBrowser[method](...args);
  if (!result.ok) throw result.error;
  return result.value;
}
