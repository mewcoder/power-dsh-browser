import { BrowserError, validId, httpUrl } from './protocol.js';
import { sanitizeSelection } from './annotations.js';

export const ARCHIVE_LIMITS = Object.freeze({ items: 20, bytes: 32768, perSession: 8, total: 128 });
const fail = code => { throw new BrowserError(code); };
const boundedId = value => validId(value) && !/[\u0000-\u001f\u007f]/.test(value);
const immutable = value => { if (value && typeof value === 'object') { for (const item of Object.values(value)) immutable(item); Object.freeze(value); } return value; };

// A publication is explicit user confirmation, not a mirror of the live editor.
// Reconstruct known fields before storing; page data is never host authority.
export function validateAnnotationBatch(value, sessionId) {
  if (!value || value.version !== 1 || value.confirmed !== true || value.sessionId !== sessionId) fail('ANNOTATION_CONFIRMATION_REQUIRED');
  if (!boundedId(value.batchId) || !Number.isSafeInteger(value.revision) || value.revision < 1) fail('INVALID_ANNOTATION_BATCH');
  if (!Array.isArray(value.items) || !value.items.length || value.items.length > ARCHIVE_LIMITS.items) fail('INVALID_ANNOTATION_ITEMS');
  if (new TextEncoder().encode(JSON.stringify(value)).length > ARCHIVE_LIMITS.bytes) fail('ANNOTATION_BATCH_TOO_LARGE');
  const ids = new Set(), numbers = new Set();
  const items = value.items.map(item => {
    if (!item || !boundedId(item.id) || !boundedId(item.tabId) || !boundedId(item.documentId)) fail('INVALID_ANNOTATION_ITEM');
    if (ids.has(item.id) || numbers.has(item.number) || !Number.isSafeInteger(item.number) || item.number < 1) fail('INVALID_ANNOTATION_ITEM');
    if (typeof item.comment !== 'string' || !item.comment.trim() || item.comment.length > 2000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(item.comment)) fail('INVALID_ANNOTATION_COMMENT');
    const selection = sanitizeSelection(item.selection);
    if (!selection || !['createdAt', 'updatedAt'].every(field => Number.isSafeInteger(item[field]) && item[field] >= 0)) fail('INVALID_ANNOTATION_TARGET');
    // Reject credentials even if a future Client mistakenly includes them.
    httpUrl(item.selection.url);
    ids.add(item.id); numbers.add(item.number);
    return { id: item.id, number: item.number, tabId: item.tabId, documentId: item.documentId, selection, comment: item.comment, createdAt: item.createdAt, updatedAt: item.updatedAt };
  });
  return immutable({ version: 1, sessionId, batchId: value.batchId, revision: value.revision, confirmed: true, items });
}

// Volatile, bounded user-confirmed snapshots. The session always comes from the
// authenticated panel or Agent execution context, never a model parameter.
export class AnnotationArchive {
  records = new Map();
  key(sessionId, batchId, revision) { return JSON.stringify([sessionId, batchId, revision]); }
  publish(sessionId, input) {
    const batch = validateAnnotationBatch(input, sessionId), key = this.key(sessionId, batch.batchId, batch.revision);
    const existing = this.records.get(key);
    if (existing) {
      if (JSON.stringify(existing.batch) !== JSON.stringify(batch)) fail('ANNOTATION_REVISION_CONFLICT');
      return { batchId: batch.batchId, revision: batch.revision, count: batch.items.length };
    }
    this.records.set(key, { batch, resolved: new Set() });
    const sessionKeys = [...this.records].filter(([, record]) => record.batch.sessionId === sessionId).map(([id]) => id);
    while (sessionKeys.length > ARCHIVE_LIMITS.perSession) this.records.delete(sessionKeys.shift());
    while (this.records.size > ARCHIVE_LIMITS.total) this.records.delete(this.records.keys().next().value);
    return { batchId: batch.batchId, revision: batch.revision, count: batch.items.length };
  }
  select(sessionId, batchId, revision) {
    if (!boundedId(batchId) || revision !== undefined && (!Number.isSafeInteger(revision) || revision < 1)) fail('INVALID_ANNOTATION_REFERENCE');
    const matches = [...this.records.values()].filter(({ batch }) => batch.sessionId === sessionId && batch.batchId === batchId && (revision === undefined || batch.revision === revision));
    const record = matches.sort((a, b) => b.batch.revision - a.batch.revision)[0];
    if (!record) fail('ANNOTATION_BATCH_NOT_FOUND');
    return record;
  }
  list(sessionId) {
    return { batches: [...this.records.values()].filter(({ batch }) => batch.sessionId === sessionId).map(({ batch, resolved }) => ({ batchId: batch.batchId, revision: batch.revision, count: batch.items.length, unresolved: batch.items.length - resolved.size })) };
  }
  read(sessionId, batchId, revision) {
    const { batch, resolved } = this.select(sessionId, batchId, revision);
    return { ...batch, untrustedPageContent: true, items: batch.items.map(item => ({ ...item, resolved: resolved.has(item.id) })) };
  }
  resolve(sessionId, batchId, revision, annotationIds) {
    const record = this.select(sessionId, batchId, revision), ids = annotationIds ?? record.batch.items.map(item => item.id);
    if (!Array.isArray(ids) || !ids.length || ids.length > ARCHIVE_LIMITS.items || ids.some(id => !boundedId(id) || !record.batch.items.some(item => item.id === id))) fail('INVALID_ANNOTATION_IDS');
    for (const id of ids) record.resolved.add(id);
    return this.read(sessionId, batchId, record.batch.revision);
  }
  dispose() { this.records.clear(); }
}
