// Runs only inside our guest. Deliberately closed operations: no model-supplied JavaScript.
function pageRuntime(request) {
  const key = '__dshBrowserObservation_v1';
  const error = code => { throw new Error(code); };
  const visible = el => {
    for (let node = el; node instanceof Element; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (node.hidden || node.getAttribute('aria-hidden') === 'true' || style.display === 'none' || style.visibility === 'hidden') return false;
    }
    return el.getClientRects().length > 0;
  };
  const role = el => el.getAttribute('role') || ({ BUTTON: 'button', A: 'link', TEXTAREA: 'textbox', SELECT: 'combobox', INPUT: ['checkbox', 'radio'].includes(el.type) ? el.type : ['button', 'submit', 'reset'].includes(el.type) ? 'button' : 'textbox' }[el.tagName] || 'element');
  const name = el => [el.getAttribute('aria-label'), (el.getAttribute('aria-labelledby') || '').split(/\s+/).map(id => document.getElementById(id)?.textContent || '').join(' '), [...(el.labels || [])].map(l => l.textContent).join(' '), el.getAttribute('alt'), el.getAttribute('title'), el.textContent, el.getAttribute('placeholder')].map(value => (value || '').replace(/\s+/g, ' ').trim()).find(Boolean)?.slice(0, 240) || '';
  let state = window[key];
  if (request.operation === 'snapshot') {
    state?.observer.disconnect();
    state = { documentId: state?.documentId || crypto.randomUUID(), snapshotId: crypto.randomUUID(), refs: new Map(), dirty: false };
    window[key] = state;
    const elements = [{ ref: 'page', role: 'document', name: 'Page viewport', scrollOnly: true }];
    const candidates = document.querySelectorAll('button,a[href],input,textarea,select,[role], [contenteditable="true"]');
    for (const el of [...candidates].slice(0, 4000)) {
      if (elements.length >= 120) break;
      if (!visible(el) || el.type === 'hidden' || el.type === 'file') continue;
      const ref = `e${elements.length + 1}`;
      state.refs.set(ref, el);
      elements.push({ ref, role: role(el), name: name(el), disabled: !!el.disabled });
    }
    let text = '', visited = 0;
    const walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT);
    while (walker.nextNode() && text.length < 12000 && visited++ < 20000) {
      const node = walker.currentNode, parent = node.parentElement;
      if (!parent || parent.closest('script,style,noscript,textarea,select') || !visible(parent)) continue;
      const part = node.textContent.replace(/\s+/g, ' ').trim();
      if (part) text += part + '\n';
    }
    state.observer = new MutationObserver(() => { state.dirty = true; });
    state.observer.observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
    return { documentId: state.documentId, snapshotId: state.snapshotId, url: location.href.slice(0, 8192), title: document.title.slice(0, 500), text: text.slice(0, 12000), elements, truncated: text.length >= 12000 || candidates.length > elements.length, untrusted: true, scope: 'main-frame' };
  }
  if (request.operation === 'inspect') {
    const args = request.args || {};
    const depth = args.depth ?? 2, limit = args.limit ?? 40;
    if (!Number.isInteger(depth) || depth < 0 || depth > 5 || !Number.isInteger(limit) || limit < 1 || limit > 80) error('INVALID_INSPECT_LIMIT');
    if (args.selector !== undefined && (typeof args.selector !== 'string' || !args.selector || args.selector.length > 512) || args.ref && args.selector !== undefined) error('INVALID_SELECTOR');
    let root, matchCount = 0;
    if (args.ref) {
      if (!state || args.documentId !== state.documentId || args.snapshotId !== state.snapshotId) error('STALE_SNAPSHOT');
      // Draining pending records must preserve their invalidation for later actions.
      if (state.observer.takeRecords().length) state.dirty = true;
      if (state.dirty) error('STALE_SNAPSHOT');
      root = args.ref === 'page' ? document.body : state.refs.get(args.ref);
      if (!root?.isConnected) error('TARGET_UNAVAILABLE');
      matchCount = 1;
    } else {
      let matches;
      try { matches = document.querySelectorAll(args.selector || 'body'); } catch { error('INVALID_SELECTOR'); }
      matchCount = matches.length; root = matches[0];
    }
    const small = (value, size) => typeof value === 'string' ? value.slice(0, size).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '') : '';
    const number = value => Number.isFinite(value) ? Math.round(Math.max(-10000000, Math.min(10000000, value)) * 10) / 10 : 0;
    const safeUrl = value => {
      try { const url = new URL(value, location.href); if (!['http:', 'https:'].includes(url.protocol)) return ''; url.username = ''; url['pass' + 'word'] = ''; return small(url.href, 2048); } catch { return ''; }
    };
    const rect = element => {
      const value = element.getBoundingClientRect();
      return { x: number(value.x ?? value.left), y: number(value.y ?? value.top), width: number(value.width), height: number(value.height) };
    };
    const shown = element => {
      for (let node = element; node instanceof Element; node = node.parentElement) {
        const css = getComputedStyle(node);
        if (node.hidden || node.getAttribute('aria-hidden') === 'true' || css.display === 'none' || ['hidden', 'collapse'].includes(css.visibility)) return false;
      }
      return true;
    };
    const excluded = element => ['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'HEAD', 'META', 'LINK'].includes(element.tagName) || !shown(element);
    const control = element => ['INPUT', 'TEXTAREA', 'SELECT', 'OPTION'].includes(element.tagName) || element.isContentEditable || element.closest('[contenteditable]:not([contenteditable="false"])') || ['textbox', 'searchbox'].includes(element.getAttribute('role'));
    const attributes = ['alt', 'placeholder', 'href', 'src', 'type', 'name', 'title', 'role', 'aria-label', 'aria-labelledby', 'aria-describedby', 'aria-hidden', 'dir', 'lang', 'disabled', 'readonly', 'required', 'autocomplete', 'width', 'height', 'colspan', 'rowspan'];
    const styleNames = ['display', 'position', 'box-sizing', 'width', 'height', 'min-width', 'max-width', 'min-height', 'max-height', 'top', 'right', 'bottom', 'left', 'margin', 'padding', 'gap', 'flex-direction', 'align-items', 'justify-content', 'grid-template-columns', 'font-family', 'font-size', 'font-weight', 'line-height', 'color', 'background-color', 'background-image', 'border', 'border-radius', 'box-shadow', 'text-align', 'opacity', 'overflow', 'transform', 'z-index'];
    let used = 3500, count = 0, scanned = 0, truncated = false, full = false;
    const reserve = value => { const cost = JSON.stringify(value).length + 2; if (used + cost > 59000) { full = truncated = true; return false; } used += cost; return true; };
    const visit = (element, level) => {
      if (!element || full || count >= limit || ++scanned > 4000) { truncated = true; return null; }
      if (excluded(element)) return null;
      const css = getComputedStyle(element), attrs = {}, styles = {};
      for (const key of attributes) {
        const raw = element.getAttribute(key); if (raw === null) continue;
        attrs[key] = ['href', 'src'].includes(key) ? safeUrl(raw) : small(raw, 240);
      }
      for (const key of styleNames) styles[key] = small(css.getPropertyValue(key), 120);
      let text = '';
      if (!control(element)) for (const node of [...element.childNodes].slice(0, 80)) {
        if (node.nodeType === Node.TEXT_NODE) text += small(node.textContent, 400).replace(/\s+/g, ' ') + ' ';
        if (text.length >= 160) break;
      }
      const node = { tag: small(element.localName, 40), id: small(element.id, 160), class: small(element.getAttribute('class') || '', 240), role: small(role(element), 80), text: text.trim().slice(0, 160), attributes: attrs, rect: rect(element), styles, children: [] };
      if (!reserve(node)) return null; count++;
      if (!control(element)) {
        if (level < depth) for (const child of element.children) {
          if (full || count >= limit || scanned >= 4000) { truncated = true; break; }
          const next = visit(child, level + 1); if (next) node.children.push(next);
        }
        else if (element.children.length) truncated = true;
      }
      return node;
    };
    const tree = root ? visit(root, 0) : null, images = [];
    if (root && !full) {
      const candidates = root.matches('img') ? [root] : root.querySelectorAll('img');
      for (let index = 0; index < Math.min(candidates.length, 4000); index++) {
        if (images.length >= 20) { truncated = true; break; }
        const image = candidates[index]; if (excluded(image) || control(image)) continue;
        const item = { src: safeUrl(image.currentSrc || image.getAttribute('src') || ''), alt: small(image.getAttribute('alt') || '', 160), naturalWidth: number(image.naturalWidth), naturalHeight: number(image.naturalHeight), rect: rect(image) };
        if (!reserve(item)) break; images.push(item);
      }
    }
    return { url: safeUrl(location.href), title: small(document.title, 500), viewport: { width: number(innerWidth), height: number(innerHeight), dpr: number(devicePixelRatio), scrollX: number(scrollX), scrollY: number(scrollY) }, tree, images, matchCount, nodeCount: count, truncated, untrusted: true, scope: 'main-frame' };
  }
  if (request.operation !== 'act') error('UNKNOWN_PAGE_OPERATION');
  const args = request.args;
  if (!state || args.documentId !== state.documentId || args.snapshotId !== state.snapshotId || state.dirty || state.observer.takeRecords().length) error('STALE_SNAPSHOT');
  if (args.action === 'scroll' && args.ref === 'page') {
    if (!Number.isFinite(args.deltaY) || Math.abs(args.deltaY) > 2000) error('INVALID_SCROLL');
    state.dirty = true;
    return { action: 'scroll', x: Math.floor(innerWidth / 2), y: Math.floor(innerHeight / 2) };
  }
  let el;
  if (args.ref) el = state.refs.get(args.ref);
  else {
    const matches = [...state.refs.values()].filter(node => role(node) === args.role && name(node) === args.name);
    if (matches.length !== 1) error('AMBIGUOUS_TARGET');
    el = matches[0];
  }
  if (!el || !el.isConnected || !visible(el)) error('TARGET_UNAVAILABLE');
  if (el.disabled || el.getAttribute('aria-disabled') === 'true' || el.type === 'file') error('TARGET_DISABLED');
  state.dirty = true; // Every action consumes the observation, including a failed action.
  if (!['click', 'fill', 'press', 'scroll'].includes(args.action)) error('UNSUPPORTED_ACTION');
  const rect = el.getBoundingClientRect();
  const x = Math.floor(rect.left + rect.width / 2), y = Math.floor(rect.top + rect.height / 2);
  if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) error('TARGET_OUTSIDE_VIEWPORT');
  const top = document.elementFromPoint(x, y);
  if (!top || !(top === el || el.contains(top))) error('TARGET_OBSCURED');
  if (args.action === 'fill') {
    if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) || el.readOnly || !(el instanceof HTMLTextAreaElement || ['text', 'search', 'email', 'url', 'tel', 'pass' + 'word'].includes(el.type))) error('NOT_FILLABLE');
    if (typeof args.value !== 'string' || args.value.length > 10000) error('INVALID_VALUE');
  } else if (args.action === 'press') {
    if (args.key !== 'Enter') error('UNSUPPORTED_KEY');
  } else if (args.action === 'scroll' && (!Number.isFinite(args.deltaY) || Math.abs(args.deltaY) > 2000)) error('INVALID_SCROLL');
  return { action: args.action, x, y };
}
export function pageScript(operation, args) { return `(${pageRuntime.toString()})(${JSON.stringify({ operation, args })})`; }
