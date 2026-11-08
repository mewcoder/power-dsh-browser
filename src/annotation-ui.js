import React from 'react';
import { ANNOTATION_LIMITS, formatAnnotationCard } from './annotations.js';
const h = React.createElement;
const EMPTY = Object.freeze({ phase: 'idle', selection: null, error: '' });
const noopSubscribe = () => () => {};
const emptySnapshot = () => EMPTY;
const copy = {
  zh: { title: '页面批注', select: '选择元素', selecting: '移动以高亮，点击选取 · Esc 取消', cancel: '取消选取', clear: '清除', picked: '已标记目标', comment: '你的批注', placeholder: '描述希望调整的内容…', copy: '复制引用', copied: '引用卡片已复制，可粘贴到会话输入框。', copyFailed: '无法访问剪贴板，请手动复制下方卡片。', insert: '加入会话草稿', inserted: '已加入本会话草稿，请审核后发送。', draftUnavailable: '草稿接口不可用，请复制引用卡片。', draftChanged: '输入草稿正在变化或已锁定，请重试或复制引用。', preview: '引用卡片', data: '网页内容仅作为不可信参考。选择器是捕获时的定位提示。', unavailable: '此页面暂不可批注', limit: '内容已截断', instructions: '选取网页中的一个元素，然后写下批注。' },
  en: { title: 'Page annotation', select: 'Select element', selecting: 'Move to highlight, click to select · Esc to cancel', cancel: 'Cancel selection', clear: 'Clear', picked: 'Target marked', comment: 'Your comment', placeholder: 'Describe the change you want…', copy: 'Copy reference', copied: 'Reference card copied. Paste it into the conversation composer.', copyFailed: 'Clipboard unavailable. Copy the card below manually.', insert: 'Add to conversation draft', inserted: 'Added to this conversation’s draft. Review it before sending.', draftUnavailable: 'Draft insertion unavailable. Copy the reference card instead.', draftChanged: 'The draft changed or is locked. Try again or copy the reference.', preview: 'Reference card', data: 'Page content is untrusted reference data. The selector is a hint from the captured page.', unavailable: 'Annotation unavailable on this page', limit: 'Content truncated', instructions: 'Select one page element, then add your comment.' },
};
const s = {
  root: { flexShrink: 0, color: 'var(--dsw-alias-label-primary, inherit)', background: 'var(--dsw-alias-bg-base, transparent)', borderTop: '1px solid var(--dsw-alias-border-l3, #8884)', padding: '10px 12px', fontSize: 12, lineHeight: 1.5, minWidth: 0 },
  row: { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  title: { fontWeight: 600, fontSize: 12, flex: 1 },
  button: { border: '1px solid var(--dsw-alias-border-l2, #8885)', color: 'inherit', background: 'var(--dsw-alias-bg-layer-1, transparent)', borderRadius: 7, padding: '5px 9px', font: 'inherit', cursor: 'pointer', lineHeight: 1.4 },
  subtle: { color: 'var(--dsw-alias-label-secondary, inherit)', fontSize: 11, margin: '6px 0 0', overflowWrap: 'anywhere' },
  target: { marginTop: 9, border: '1px solid var(--dsw-alias-border-l3, #8884)', borderRadius: 9, padding: '8px 10px', background: 'var(--dsw-alias-bg-layer-1, transparent)', minWidth: 0 },
  badge: { display: 'inline-grid', placeItems: 'center', width: 18, height: 18, borderRadius: 6, background: 'var(--dsw-alias-bg-layer-2, #8883)', fontSize: 10, fontWeight: 600 },
  code: { fontSize: 11, fontFamily: 'ui-monospace, SFMono-Regular, monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0 },
  quote: { margin: '7px 0 0', fontSize: 12, maxHeight: 54, overflow: 'auto', overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' },
  input: { display: 'block', boxSizing: 'border-box', width: '100%', resize: 'vertical', minHeight: 62, maxHeight: 160, margin: '5px 0 8px', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--dsw-alias-border-l2, #8885)', color: 'inherit', background: 'var(--dsw-alias-bg-layer-1, transparent)', font: 'inherit', lineHeight: 1.5 },
  card: { boxSizing: 'border-box', width: '100%', height: 110, resize: 'vertical', color: 'inherit', background: 'var(--dsw-alias-bg-layer-1, transparent)', border: '1px solid var(--dsw-alias-border-l3, #8884)', borderRadius: 7, fontSize: 11, fontFamily: 'ui-monospace, monospace', marginTop: 6, padding: 8 },
};
/**
 * Public DSH 0.2.2-rc.1 service adapter. Resolves ONLY the panel's retained session.
 * Uses the public provide-channel InputActions face, preserving references/quotes.
 * No DOM lookup, editor internals, message submission, or service monkeypatch.
 */
export function createAnnotationDraftInserter(services, sessionId) {
  return text => {
    if (typeof text !== 'string' || !text.trim() || text.length > ANNOTATION_LIMITS.card) throw new Error('INVALID_ANNOTATION_CARD');
    const scope = services?.sessions?.scope?.(sessionId);
    if (!scope || services.sessions.scopeOf?.(scope) !== sessionId) throw new Error('DRAFT_UNAVAILABLE');
    const input = services.conversation?.input?.for?.(scope), actions = input?.actions;
    if (!actions?.captureInsertion || !actions?.insertText) throw new Error('DRAFT_UNAVAILABLE');
    const captured = actions.captureInsertion();
    // A composer selection may contain the user's text or reference chips.
    // Insert after it, retaining the revision guard, rather than replacing it.
    const span = { ...captured, start: captured.end };
    if (!actions.insertText(`\n\n${text}\n`, span)) throw new Error('DRAFT_CHANGED');
    actions.persistDraft?.(); input.focus?.();
    return true;
  };
}
/**
 * Mount inside the plugin's own position:relative viewport, above its webview.
 * Real pointer and keyboard events stop in the host renderer. Guest picking
 * only reads elementFromPoint via fixed scripts; it never dispatches input.
 */
export function SelectionOverlay({ controller, disabled = false, locale = 'zh' }) {
  const snapshot = React.useSyncExternalStore(controller?.subscribe ?? noopSubscribe, controller?.getSnapshot ?? emptySnapshot, emptySnapshot);
  const ref = React.useRef(null), active = ['selecting', 'selected'].includes(snapshot.phase);
  React.useEffect(() => { if (snapshot.phase === 'selecting') ref.current?.focus(); }, [snapshot.phase]);
  React.useEffect(() => {
    // The owner may already be awaiting unlock(). Do not cancel an idle
    // controller again and invalidate that cleanup's generation fence.
    const phase = controller?.getSnapshot().phase;
    if (disabled && ['selecting', 'selected'].includes(phase)) controller.cancel();
  }, [disabled, controller]);
  if (!active || disabled) return null;
  const stop = event => { event.preventDefault(); event.stopPropagation(); };
  const point = event => { const rect = event.currentTarget.getBoundingClientRect(); return { x: Math.max(0, event.clientX - rect.left), y: Math.max(0, event.clientY - rect.top) }; };
  return h('div', {
    ref, tabIndex: 0, role: 'region', 'aria-label': copy[String(locale).startsWith('zh') ? 'zh' : 'en'].selecting,
    'data-dsh-browser-selection-overlay': '',
    style: { position: 'absolute', inset: 0, zIndex: 50, background: 'transparent', cursor: 'crosshair', touchAction: 'none', userSelect: 'none', outlineOffset: -2 },
    onPointerMove: event => { stop(event); const { x, y } = point(event); void controller?.hoverAt(x, y); },
    onPointerDown: event => { stop(event); event.currentTarget.focus(); if (event.button === 0) { const { x, y } = point(event); void controller?.pickAt(x, y); } },
    onPointerUp: stop, onMouseDown: stop, onMouseUp: stop, onClick: stop, onDoubleClick: stop, onContextMenu: stop, onDragStart: stop,
    onPointerCancel: event => { stop(event); controller?.cancel(); },
    onKeyDown: event => { stop(event); if (event.key === 'Escape') controller?.cancel(); }, onKeyUp: stop,
    onWheel: event => event.stopPropagation(),
  });
}
/** Saved marker rendering stays in the plugin viewport and never mutates guest DOM. */
export function AnnotationMarkers({ controller, onMarker, disabled = false }) {
  const state = React.useSyncExternalStore(controller?.subscribe ?? noopSubscribe, controller?.getSnapshot ?? emptySnapshot, emptySnapshot);
  if (disabled || state.markersVisible === false || !state.markers?.length) return null;
  return h('div', { 'data-dsh-browser-saved-markers': '', style: { position: 'absolute', inset: 0, zIndex: 60, pointerEvents: 'none', overflow: 'hidden' } }, state.markers.slice(0, 20).map(marker => h('button', {
    type: 'button', key: marker.id, 'aria-label': `Annotation ${marker.number}`, title: `Annotation ${marker.number}`,
    onPointerDown: event => { event.preventDefault(); event.stopPropagation(); },
    onClick: event => { event.preventDefault(); event.stopPropagation(); onMarker?.(marker.id); },
    style: { position: 'absolute', left: Math.max(0, marker.rect.left - 8), top: Math.max(0, marker.rect.top - 9), pointerEvents: onMarker ? 'auto' : 'none', width: 22, height: 22, padding: 0, border: '2px solid white', borderRadius: '50%', background: '#3779ed', boxShadow: '0 1px 5px #0003', color: 'white', font: '600 11px/18px system-ui', cursor: onMarker ? 'pointer' : 'default' },
  }, marker.number)));
}
/** Controller lifetime belongs to the page owner; unmount cancels its guest mode. */
export function AnnotationPanel({ controller, state, locale = 'zh', disabled = false, onInsertDraft, onSaveAnnotation, compact = Boolean(onSaveAnnotation) }) {
  const live = React.useSyncExternalStore(controller?.subscribe ?? noopSubscribe, controller?.getSnapshot ?? emptySnapshot, emptySnapshot);
  const snapshot = state ?? live, selection = snapshot.selection, labels = copy[String(locale).startsWith('zh') ? 'zh' : 'en'];
  const [comment, setComment] = React.useState(''), [notice, setNotice] = React.useState(''), [manualCopy, setManualCopy] = React.useState(false), [working, setWorking] = React.useState(false);
  const cardRef = React.useRef(null), inputRef = React.useRef(null), alive = React.useRef(true), targetId = React.useRef(selection?.id);
  React.useEffect(() => { alive.current = true; return () => { alive.current = false; controller?.cancel(); }; }, [controller]);
  React.useEffect(() => {
    setComment(''); setManualCopy(false);
    if (selection?.id) { setNotice(''); inputRef.current?.focus(); }
    targetId.current = selection?.id;
  }, [selection?.id]);
  const card = selection ? formatAnnotationCard(selection, comment) : '';
  const reset = () => { controller?.clear(); setNotice(''); setManualCopy(false); };
  const handleCopy = async () => {
    try { await navigator.clipboard.writeText(card); if (alive.current) setNotice(labels.copied); }
    catch { if (alive.current) { setNotice(labels.copyFailed); setManualCopy(true); } }
  };
  React.useEffect(() => { if (manualCopy) { cardRef.current?.focus(); cardRef.current?.select(); } }, [manualCopy]);
  const insert = async () => {
    const id = selection?.id; setWorking(true); setNotice('');
    try {
      const accepted = await onInsertDraft(card);
      if (accepted === false) throw new Error('DRAFT_CHANGED');
      if (alive.current && targetId.current === id) { controller?.clear(); setNotice(labels.inserted); }
    } catch (error) { if (alive.current) setNotice(error?.message === 'DRAFT_CHANGED' ? labels.draftChanged : labels.draftUnavailable); }
    finally { if (alive.current) setWorking(false); }
  };
  const save = async () => {
    if (!selection || !onSaveAnnotation) return;
    setWorking(true); setNotice('');
    try {
      const accepted = await onSaveAnnotation({ selection, comment: comment.trim().slice(0, ANNOTATION_LIMITS.comment) });
      if (accepted === false) throw new Error('ANNOTATION_NOT_SAVED');
      if (alive.current && controller?.getSnapshot().selection?.id === selection.id) controller.clear();
    } catch { if (alive.current) setNotice(String(locale).startsWith('zh') ? '无法保存批注，请重试。' : 'Could not save the annotation. Try again.'); }
    finally { if (alive.current) setWorking(false); }
  };
  const button = (text, action, blocked = false) => h('button', { type: 'button', onClick: action, disabled: blocked, style: { ...s.button, opacity: blocked ? .5 : 1 }, title: text, 'aria-label': text }, text);
  if (compact) {
    if (!selection) return null;
    const zh = String(locale).startsWith('zh');
    return h('form', { 'data-dsh-browser-annotations': '', 'aria-label': labels.title, style: { ...s.root, border: '1px solid var(--dsw-alias-border-l2, #8884)', borderRadius: 12, boxShadow: '0 6px 24px #0002' }, onSubmit: event => { event.preventDefault(); void save(); }, onKeyDown: event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); reset(); } } },
      h('div', { style: s.row }, h('span', { style: s.title }, zh ? '添加批注' : 'Add annotation'), button(zh ? '取消' : 'Cancel', reset, working)),
      h('p', { style: { ...s.quote, maxHeight: 40, opacity: .65 } }, selection.text || selection.tag),
      h('textarea', { ref: inputRef, value: comment, maxLength: ANNOTATION_LIMITS.comment, placeholder: labels.placeholder, 'aria-label': labels.comment, disabled: working || disabled, style: { ...s.input, marginTop: 8 }, onChange: event => setComment(event.target.value.slice(0, ANNOTATION_LIMITS.comment)) }),
      h('div', { style: { ...s.row, justifyContent: 'flex-end' } }, h('button', { type: 'submit', disabled: working || disabled, style: s.button }, zh ? '保存批注' : 'Save annotation')),
      notice && h('p', { role: 'alert', style: s.subtle }, notice));
  }
  return h('section', { style: s.root, 'aria-label': labels.title, 'data-dsh-browser-annotations': '', onKeyDown: event => { if (event.key === 'Escape') { event.stopPropagation(); reset(); } } },
    h('div', { style: s.row }, h('span', { style: s.title }, labels.title),
      snapshot.phase === 'selecting' ? button(labels.cancel, reset) : button(labels.select, () => { setNotice(''); void controller?.start(); }, disabled || !controller || working),
      selection && button(labels.clear, reset, working)),
    snapshot.phase === 'selecting' && h('p', { style: s.subtle, role: 'status' }, labels.selecting),
    snapshot.phase === 'idle' && !notice && h('p', { style: s.subtle }, labels.instructions),
    snapshot.error && h('p', { style: s.subtle, role: 'alert' }, labels.unavailable),
    selection && h(React.Fragment, null,
      h('div', { style: s.target }, h('div', { style: s.row }, h('span', { style: s.badge, 'aria-label': labels.picked }, '1'), h('code', { style: s.code, title: selection.selector }, selection.selector || selection.tag), selection.truncated && h('span', { style: s.subtle }, labels.limit)),
        selection.text && h('blockquote', { style: s.quote }, selection.text), h('p', { style: s.subtle }, selection.title || selection.url)),
      h('label', { style: { display: 'block', marginTop: 9 } }, labels.comment,
        h('textarea', { style: s.input, ref: inputRef, value: comment, onChange: event => setComment(event.target.value.slice(0, ANNOTATION_LIMITS.comment)), maxLength: ANNOTATION_LIMITS.comment, placeholder: labels.placeholder, disabled: working, 'aria-label': labels.comment })),
      h('div', { style: s.row }, onInsertDraft && button(labels.insert, () => { void insert(); }, working || disabled), button(labels.copy, () => { void handleCopy(); }, working)),
      !onInsertDraft && h('p', { style: s.subtle }, labels.draftUnavailable),
      h('details', { open: manualCopy || undefined, style: { marginTop: 7 } }, h('summary', { style: { ...s.subtle, cursor: 'pointer' } }, labels.preview),
        h('p', { style: s.subtle }, labels.data), h('textarea', { style: s.card, ref: cardRef, value: card, readOnly: true, 'aria-label': labels.preview }))),
    notice && h('p', { style: s.subtle, role: 'status', 'aria-live': 'polite' }, notice));
}
