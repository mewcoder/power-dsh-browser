import { BrowserError, LIMITS, httpUrl, abortable } from './protocol.js';
import { pageScript } from './page-runtime.js';
export class PageRunner {
  active = null; generation = 0; closed = false;
  constructor(adapter, onBusy = () => {}) { this.adapter = adapter; this.onBusy = onBusy; }
  invalidate() {
    this.generation++;
    if (this.active && !['navigate', 'network'].includes(this.active.operation)) this.active.controller.abort(new BrowserError('DOCUMENT_CHANGED'));
  }
  cancel(requestId) {
    if (requestId && this.active?.id !== requestId) return;
    if (this.active && (!requestId || requestId === this.active.id)) {
      this.active.controller.abort(new BrowserError('CANCELLED'));
      if (!['inspect', 'console', 'network', 'cap', 'status'].includes(this.active.operation)) this.adapter.stop();
    }
    this.invalidate();
  }
  dispose() { this.closed = true; this.cancel(); }
  async run(command) {
    if (this.closed) throw new BrowserError('PANEL_CLOSED');
    if (command.expires <= Date.now()) throw new BrowserError('REQUEST_EXPIRED');
    if (this.active) throw new BrowserError('BUSY');
    const controller = new AbortController(), active = { id: command.id, controller, operation: command.operation };
    const signal = command.signal ? AbortSignal.any([controller.signal, command.signal]) : controller.signal;
    const passive = ['inspect', 'console', 'network', 'cap', 'status'].includes(command.operation);
    this.active = active; if (!passive) this.onBusy(true);
    const timer = setTimeout(() => { controller.abort(new BrowserError('TIMEOUT')); if (!passive) this.adapter.stop(); }, Math.max(1, command.expires - Date.now()));
    const check = () => { signal.throwIfAborted(); if (this.closed) throw new BrowserError('PANEL_CLOSED'); };
    try {
      const { operation, args } = command;
      check();
      if (operation === 'status') return this.adapter.status();
      if (operation === 'navigate') {
        this.invalidate();
        if (!['open', 'back', 'forward', 'reload'].includes(args.action)) throw new BrowserError('INVALID_NAVIGATION');
        await abortable(this.adapter.navigate(args.action, args.action === 'open' ? httpUrl(args.url, this.adapter.origin) : undefined, signal), signal);
        check(); return this.adapter.status();
      }
      if (operation === 'console' || operation === 'network' || operation === 'cap') {
        if (!this.adapter.status().initialized) throw new BrowserError('PAGE_NOT_INITIALIZED');
        const result = await abortable(operation === 'network' ? this.adapter.readNetwork(args || {}, signal) : operation === 'cap' ? this.adapter.readCap(args || {}, signal) : this.adapter.readConsole(args || {}), signal);
        check(); return result;
      }
      if (!this.adapter.status().ready) throw new BrowserError('PAGE_NOT_READY');
      const generation = this.generation;
      let result;
      if (operation === 'snapshot' || operation === 'act' || operation === 'inspect') {
        if (operation === 'inspect' && args?.generation !== undefined && args.generation !== generation) throw new BrowserError('STALE_DOCUMENT');
        if (operation === 'act' && args.generation !== generation) throw new BrowserError('STALE_DOCUMENT');
        result = await abortable(this.adapter.execute(pageScript(operation, args)), signal);
        check();
        if (generation !== this.generation) throw new BrowserError('DOCUMENT_CHANGED');
        if (operation === 'snapshot' || operation === 'inspect') result.generation = generation;
        else {
          if (!Number.isFinite(result?.x) || !Number.isFinite(result?.y) || result.action !== args.action) throw new BrowserError('INVALID_INPUT_PLAN');
          await abortable(this.adapter.input(result, args, () => { check(); if (generation !== this.generation) throw new BrowserError('DOCUMENT_CHANGED'); }), signal);
          check();
          if (generation !== this.generation) throw new BrowserError('DOCUMENT_CHANGED', 'The action may already have navigated; observe the new page');
          result = { acted: true, action: args.action, observationConsumed: true };
        }
      } else if (operation === 'screenshot') {
        const dataUrl = await abortable(this.adapter.capture(), signal); check();
        if (generation !== this.generation) throw new BrowserError('DOCUMENT_CHANGED');
        if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/png;base64,') || dataUrl.length > Math.ceil(LIMITS.image * 4 / 3) + 100) throw new BrowserError('SCREENSHOT_TOO_LARGE');
        result = { dataUrl, generation };
      } else throw new BrowserError('UNKNOWN_OPERATION');
      return result;
    } finally {
      clearTimeout(timer);
      if (this.active === active) { this.active = null; if (!passive) this.onBusy(false); }
    }
  }
}
