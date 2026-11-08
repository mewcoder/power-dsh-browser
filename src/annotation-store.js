import { sanitizeSelection } from './annotations.js';
const MAX_ITEMS = 20, MAX_COMMENT = 2000, MAX_BYTES = 32768;
export const BATCH_LIMITS = Object.freeze({ items: MAX_ITEMS, comment: MAX_COMMENT, bytes: MAX_BYTES });
const clean = (value, length) => typeof value === 'string' ? value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').slice(0, length) : '';
const freeze = object => { if (object && typeof object === 'object') { for (const value of Object.values(object)) freeze(value); Object.freeze(object); } return object; };
const bytes = value => new TextEncoder().encode(JSON.stringify(value)).length;
const token = () => globalThis.crypto.randomUUID();
const error = code => { throw new Error(code); };
const emptyContext = Object.freeze({ tabId: '', documentId: '', url: '', title: '' });
/** Session-owned draft collection. Saved edits and user-confirmed publication are
 * separate immutable values: Agent metadata reads never mutate either one. */
export function createAnnotationStore({ sessionId, now = Date.now } = {}) {
  if (typeof sessionId !== 'string' || !sessionId || sessionId.length > 200) error('ANNOTATION_SESSION_REQUIRED');
  const listeners = new Set();
  let published = null;
  let snapshot = freeze({ sessionId, batchId: token(), revision: 0, items: [], context: emptyContext, mode: false, picking: false, markersVisible: true, editor: null, notice: '' });
  const update = patch => { snapshot = freeze({ ...snapshot, ...patch }); for (const listener of listeners) listener(); return snapshot; };
  const payload = (items = snapshot.items, revision = snapshot.revision, confirmed = false) => ({ version: 1, sessionId, batchId: snapshot.batchId, revision, confirmed, items });
  const changeItems = (items, patch = {}) => {
    const revision = snapshot.revision + 1;
    if (items.length > MAX_ITEMS) error('ANNOTATION_ITEM_LIMIT');
    if (bytes(payload(items, revision, true)) > MAX_BYTES) error('ANNOTATION_BATCH_LIMIT');
    return update({ items, revision, notice: '', ...patch });
  };
  const api = {
    getSnapshot: () => snapshot,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    setContext(value = {}) {
      const context = { tabId: clean(value.tabId, 200), documentId: clean(String(value.documentId ?? ''), 200), url: clean(value.url, 2048), title: clean(value.title, 200) };
      if (context.tabId === snapshot.context.tabId && context.documentId === snapshot.context.documentId) return snapshot;
      return update({ context, picking: false, editor: null, notice: '' });
    },
    enter() { return update({ mode: true, notice: '' }); },
    exit() { return update({ mode: false, picking: false, editor: null, notice: '' }); },
    setPicking(picking) { return update({ mode: true, picking: !!picking, ...(picking ? { editor: null } : {}) }); },
    setMarkersVisible(visible) { return update({ markersVisible: !!visible }); },
    capture(value) {
      const selection = sanitizeSelection(value);
      if (!selection || !snapshot.context.tabId || !snapshot.context.documentId) error('INVALID_ANNOTATION_CONTEXT');
      if (snapshot.items.length >= MAX_ITEMS) error('ANNOTATION_ITEM_LIMIT');
      return update({ mode: true, picking: false, editor: { selection, comment: '', itemId: null, tabId: snapshot.context.tabId, documentId: snapshot.context.documentId }, notice: '' });
    },
    setComment(comment) { if (!snapshot.editor) return snapshot; return update({ editor: { ...snapshot.editor, comment: clean(comment, MAX_COMMENT) } }); },
    discardEditor() { return update({ editor: null, picking: false }); },
    save() {
      const draft = snapshot.editor; if (!draft) error('ANNOTATION_EDITOR_REQUIRED');
      const comment = draft.comment.trim(); if (!comment) error('ANNOTATION_COMMENT_REQUIRED');
      const previous = snapshot.items.find(item => item.id === draft.itemId);
      const item = { id: previous?.id || token(), number: previous?.number || snapshot.items.reduce((max, item) => Math.max(max, item.number), 0) + 1, tabId: draft.tabId, documentId: draft.documentId, selection: draft.selection, comment, createdAt: previous?.createdAt ?? now(), updatedAt: now() };
      const items = previous ? snapshot.items.map(entry => entry.id === item.id ? item : entry) : [...snapshot.items, item];
      changeItems(items, { editor: null, picking: false, mode: true }); return item;
    },
    edit(itemId) {
      const item = snapshot.items.find(entry => entry.id === itemId); if (!item) error('ANNOTATION_NOT_FOUND');
      return update({ mode: true, picking: false, editor: { selection: item.selection, comment: item.comment, itemId: item.id, tabId: item.tabId, documentId: item.documentId }, notice: '' });
    },
    remove(itemId) { if (!snapshot.items.some(entry => entry.id === itemId)) return snapshot; return changeItems(snapshot.items.filter(item => item.id !== itemId), { editor: snapshot.editor?.itemId === itemId ? null : snapshot.editor }); },
    clear() { return changeItems([], { editor: null, picking: false }); },
    notice(value) { return update({ notice: clean(value, 400) }); },
    markers() { return snapshot.items.filter(item => item.tabId === snapshot.context.tabId && item.documentId === snapshot.context.documentId); },
    prepareBatch() { return freeze(payload()); },
    confirm() {
      if (!snapshot.items.length) error('ANNOTATION_BATCH_EMPTY');
      if (snapshot.editor) error('ANNOTATION_UNSAVED_EDITOR');
      if (bytes(payload(snapshot.items, snapshot.revision, true)) > MAX_BYTES) error('ANNOTATION_BATCH_LIMIT');
      published = freeze(payload(snapshot.items, snapshot.revision, true)); return published;
    },
    getPublished: () => published,
    resetPublished() { published = null; },
    dispose() { listeners.clear(); },
  };
  return api;
}
