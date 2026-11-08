window.__ModuleLoader__.load({id:"dsh-x-browser",factory(require){const module={exports:{}};const exports=module.exports;
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/client.js
var client_exports = {};
__export(client_exports, {
  BrowserPanel: () => BrowserPanel,
  apply: () => apply,
  dictionaries: () => dictionaries,
  inject: () => inject
});
module.exports = __toCommonJS(client_exports);
var import_react4 = __toESM(require("react"), 1);

// src/protocol.js
var LIMITS = Object.freeze({ timeout: 15e3, text: 12e3, elements: 120, image: 4e6, wire: 55e5 });
var BrowserError = class extends Error {
  constructor(code, message = code) {
    super(`${code}: ${message}`);
    this.code = code;
  }
};
function fail(code, message) {
  throw new BrowserError(code, message);
}
function abortable(promise, signal) {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => {
      signal.removeEventListener("abort", abort);
      reject(signal.reason);
    };
    signal.addEventListener("abort", abort, { once: true });
    Promise.resolve(promise).then((value) => {
      signal.removeEventListener("abort", abort);
      resolve(value);
    }, (error) => {
      signal.removeEventListener("abort", abort);
      reject(error);
    });
    if (signal.aborted) abort();
  });
}
function id() {
  return globalThis.crypto.randomUUID();
}
function validId(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 200;
}
function httpUrl(value, applicationOrigin) {
  if (typeof value !== "string" || value.length > 8192) fail("INVALID_URL");
  let url;
  try {
    url = new URL(value);
  } catch {
    fail("INVALID_URL");
  }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url["password"]) fail("INVALID_URL", "Use HTTP(S) without credentials");
  if (applicationOrigin && url.origin === applicationOrigin) fail("HOST_URL_BLOCKED");
  return url.href;
}

// src/rpc.js
var codec = (name, parse) => ({ mode: "strict", typeSymbol: `dsh-browser#${name}`, create: () => ({ parse }) });
var token = codec("Token", (value) => {
  if (!validId(value)) throw new TypeError("Invalid token");
  return value;
});
var json = codec("BoundedJson", (value) => {
  if (value === void 0 || JSON.stringify(value).length > LIMITS.wire) throw new TypeError("Invalid/oversized JSON");
  return value;
});
var integer = codec("Epoch", (value) => {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError("Invalid epoch");
  return value;
});
var definitions = { connect: [["sessionId", token], ["instance", token]], openRequested: [], poll: [["key", token]], reply: [["key", token], ["requestId", token], ["epoch", integer], ["result", json]], stop: [["key", token]], disconnect: [["key", token]] };
var RPC = Object.entries(definitions).map(([method, parameters]) => ({
  id: `dsh-browser#dshBrowser/${method}`,
  service: "dshBrowser",
  namespace: "dshBrowser",
  method,
  invocation: { kind: "direct" },
  parameters: parameters.map(([name, codec2]) => ({ name, wire: name, source: "json", codec: codec2 })),
  result: json
}));
async function call(remote, method, ...args) {
  const result = await remote.dshBrowser[method](...args);
  if (!result.ok) throw result.error;
  return result.value;
}

// src/network-client.js
var actions = {
  status: ["captureId"],
  start: ["maxRequests", "maxBodyBytes", "maxTotalBodyBytes", "childTargets", "websocketFrames"],
  list: ["captureId", "afterSequence", "limit", "filter"],
  read: ["captureId", "requestId", "hop", "targetSessionId", "targetId"],
  body: ["captureId", "requestId", "hop", "kind", "offset", "limit", "targetSessionId", "targetId"],
  frames: ["captureId", "requestId", "hop", "targetSessionId", "targetId"],
  clear: ["captureId"],
  stop: ["captureId"]
};
var object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
var token2 = (value, limit = 128) => typeof value === "string" && value.length > 0 && value.length <= limit;
var GuestNetwork = class {
  captureId = null;
  closed = false;
  generation = 0;
  tail = Promise.resolve();
  constructor(bridge, lease) {
    this.bridge = bridge;
    this.lease = lease;
  }
  available() {
    return this.bridge?.protocolVersion === 1 && typeof this.bridge.request === "function";
  }
  status() {
    return { available: this.available(), capturing: !!this.captureId, captureId: this.captureId, scope: "owned-root-target", childTargets: false };
  }
  payload(args) {
    if (!object(args) || !Object.hasOwn(actions, args.action)) throw new BrowserError("INVALID_NETWORK_ACTION");
    const fields = actions[args.action];
    if (Object.keys(args).some((key) => !["action", "tabId", ...fields].includes(key))) throw new BrowserError("INVALID_NETWORK_OPTIONS");
    const payload = { operation: args.action, lease: this.lease };
    if (["list", "read", "body", "clear", "stop"].includes(args.action) && !token2(args.captureId)) throw new BrowserError("NETWORK_CAPTURE_REQUIRED");
    if (args.captureId !== void 0) {
      if (!token2(args.captureId)) throw new BrowserError("INVALID_NETWORK_CAPTURE");
      payload.captureId = args.captureId;
    }
    if (["read", "body", "frames"].includes(args.action) && !token2(args.requestId, 200)) throw new BrowserError("NETWORK_REQUEST_REQUIRED");
    if (args.action === "frames" && args.kind !== void 0) throw new BrowserError("INVALID_NETWORK_OPTIONS");
    if (args.action === "body" && !["request", "response"].includes(args.kind)) throw new BrowserError("INVALID_BODY_KIND");
    if (args.action === "start") {
      payload.options = Object.fromEntries(fields.filter((key) => args[key] !== void 0).map((key) => [key, args[key]]));
    } else if (["list", "read", "body", "frames"].includes(args.action)) {
      const query = {};
      for (const key of fields) {
        if (key === "captureId" || args[key] === void 0) continue;
        query[key === "targetSessionId" ? "sessionId" : key] = args[key];
      }
      payload.query = query;
    }
    return payload;
  }
  async invoke(payload) {
    if (!this.available()) throw new BrowserError("NETWORK_BRIDGE_UNAVAILABLE", "Install and load the owned-page Desktop bridge to capture network traffic");
    let reply;
    try {
      reply = await this.bridge.request(payload);
    } catch {
      throw new BrowserError("NETWORK_BRIDGE_UNAVAILABLE");
    }
    if (!object(reply) || typeof reply.ok !== "boolean") throw new BrowserError("INVALID_NETWORK_RESPONSE");
    if (!reply.ok) {
      const raw = reply.error?.code;
      const code = typeof raw === "string" && /^[A-Z0-9_]{1,80}$/.test(raw) ? raw : "NETWORK_BRIDGE_ERROR";
      throw new BrowserError(code === "BRIDGE_UNAVAILABLE" ? "NETWORK_BRIDGE_UNAVAILABLE" : code);
    }
    if (!object(reply.value)) throw new BrowserError("INVALID_NETWORK_RESPONSE");
    return reply.value;
  }
  request(args, signal) {
    signal.throwIfAborted();
    const payload = this.payload(args), generation = this.generation;
    const job = this.tail.then(async () => {
      signal.throwIfAborted();
      if (this.closed) throw new BrowserError("PANEL_CLOSED");
      if (generation !== this.generation) throw new BrowserError("CANCELLED");
      if (args.action === "status" && !this.available()) return this.status();
      const previous = this.captureId;
      const value = await this.invoke(payload);
      if (this.closed || signal.aborted || generation !== this.generation) {
        if (args.action === "start" && token2(value.captureId) && value.captureId !== previous) {
          await this.invoke({ operation: "stop", lease: this.lease, captureId: value.captureId }).catch(() => {
          });
        }
        signal.throwIfAborted();
        throw new BrowserError(this.closed ? "PANEL_CLOSED" : "CANCELLED");
      }
      if (args.action === "start" || args.action === "status") this.captureId = token2(value.captureId) ? value.captureId : null;
      if (args.action === "stop" && this.captureId === args.captureId) this.captureId = null;
      return { ...value, available: true, untrusted: true };
    });
    this.tail = job.catch(() => {
    });
    return abortable(job, signal);
  }
  stopCapture() {
    this.generation++;
    const known = this.captureId;
    this.captureId = null;
    const stopped = known && this.available() ? this.invoke({ operation: "stop", lease: this.lease, captureId: known }).catch(() => {
    }) : Promise.resolve();
    this.tail = Promise.allSettled([this.tail, stopped]).then(() => {
    });
    return this.tail;
  }
  // The host's release(lease) hook owns native cleanup even when no IPC reply
  // can return. Pending starts observe closed and release any late capture.
  dispose() {
    this.closed = true;
    this.generation++;
    this.captureId = null;
  }
};

// src/cap-client.js
var EXPECTED_BRIDGE_BUILD = "2026-11-08.1";
var ACTIONS = /* @__PURE__ */ new Set(["capabilities", "screenshot", "emulate", "clearEmulation", "cookies", "accessibility", "input", "downloads", "clearDownloads", "upload", "downloadCancel"]);
var object2 = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
var pick = (source, keys) => Object.fromEntries(keys.filter((key) => source[key] !== void 0).map((key) => [key, source[key]]));
function optionsFor(args) {
  switch (args.action) {
    case "screenshot":
      return pick(args, ["fullPage"]);
    case "emulate":
      return pick(args, ["width", "height", "deviceScaleFactor", "mobile", "userAgent", "timezone", "media"]);
    case "cookies":
      return { action: args.cookieAction };
    case "input":
      return {
        type: args.inputType,
        ...pick(args, ["mouseType", "x", "y", "button", "clickCount", "key", "code", "text", "modifiers"])
      };
    case "upload":
      return { selector: args.selector, files: args.files };
    case "downloadCancel":
      return { id: args.downloadId };
    default:
      return {};
  }
}
var GuestCap = class {
  closed = false;
  tail = Promise.resolve();
  constructor(bridge, lease) {
    this.bridge = bridge;
    this.lease = lease;
  }
  available() {
    return this.bridge?.protocolVersion === 1 && typeof this.bridge.request === "function";
  }
  payload(args) {
    if (!object2(args) || !ACTIONS.has(args.action)) throw new BrowserError("INVALID_CAP_ACTION");
    if (args.action === "screenshot") throw new BrowserError("CAPABILITY_UNSUPPORTED", "Full-page/CDP screenshot is unavailable on this Electron host; use browser_screenshot for the viewport");
    if (args.action === "cookies" && !["get", "clear"].includes(args.cookieAction)) throw new BrowserError("INVALID_CAP_OPTIONS");
    if (args.action === "input" && !["mouse", "key"].includes(args.inputType)) throw new BrowserError("INVALID_CAP_OPTIONS");
    if (args.action === "upload" && (typeof args.selector !== "string" || !Array.isArray(args.files) || !args.files.length)) throw new BrowserError("INVALID_CAP_OPTIONS");
    if (args.action === "downloadCancel" && !Number.isSafeInteger(args.downloadId)) throw new BrowserError("INVALID_CAP_OPTIONS");
    const options = optionsFor(args), payload = { operation: args.action, lease: this.lease };
    if (Object.keys(options).length > 0) payload.options = options;
    return payload;
  }
  // A bridge installed from an older patch may lack newer operations; surface
  // that as an explicit reinstall request rather than an opaque failure.
  async verify() {
    if (!this.available()) throw new BrowserError("CAP_BRIDGE_UNAVAILABLE");
    const caps = await this.invoke({ operation: "capabilities", lease: this.lease });
    if (caps.build !== EXPECTED_BRIDGE_BUILD) throw new BrowserError("BRIDGE_OUTDATED", `Installed bridge build ${caps.build ?? "unknown"} does not match ${EXPECTED_BRIDGE_BUILD}; reinstall the bridge`);
    return caps;
  }
  async invoke(payload) {
    if (!this.available()) throw new BrowserError("CAP_BRIDGE_UNAVAILABLE", "Install and load the owned-page Desktop bridge");
    let reply;
    try {
      reply = await this.bridge.request(payload);
    } catch {
      throw new BrowserError("CAP_BRIDGE_UNAVAILABLE");
    }
    if (!object2(reply) || typeof reply.ok !== "boolean") throw new BrowserError("INVALID_CAP_RESPONSE");
    if (!reply.ok) {
      const raw = reply.error?.code;
      const code = typeof raw === "string" && /^[A-Z0-9_]{1,80}$/.test(raw) ? raw : "CAP_BRIDGE_ERROR";
      throw new BrowserError(code === "BRIDGE_UNAVAILABLE" ? "CAP_BRIDGE_UNAVAILABLE" : code);
    }
    if (!object2(reply.value)) throw new BrowserError("INVALID_CAP_RESPONSE");
    return reply.value;
  }
  request(args, signal) {
    signal.throwIfAborted();
    const payload = this.payload(args);
    const job = this.tail.then(async () => {
      signal.throwIfAborted();
      if (this.closed) throw new BrowserError("PANEL_CLOSED");
      const value = await this.invoke(payload);
      signal.throwIfAborted();
      return { ...value, untrusted: true };
    });
    this.tail = job.catch(() => {
    });
    return abortable(job, signal);
  }
  dispose() {
    this.closed = true;
  }
};

// src/electron-page.js
var ElectronPage = class {
  element = null;
  reservation = null;
  listeners = [];
  released = false;
  consoleMessages = [];
  consoleDropped = 0;
  state = { initialized: false, ready: false, url: "", title: "", loading: false, canGoBack: false, canGoForward: false, error: "" };
  constructor(bridge, container, origin, update, invalidate, { onInput, onOpen } = {}) {
    Object.assign(this, { bridge, container, origin, update, invalidate, onInput, onOpen });
  }
  status() {
    return { ...this.state, desktop: true, network: this.networkClient?.status() ?? { available: false, capturing: false, captureId: null } };
  }
  readNetwork(args, signal) {
    if (!this.networkClient) throw new BrowserError("PAGE_NOT_INITIALIZED");
    return this.networkClient.request(args, signal);
  }
  stopNetworkCapture() {
    return this.networkClient?.stopCapture() ?? Promise.resolve();
  }
  readCap(args, signal) {
    if (!this.capClient) throw new BrowserError("PAGE_NOT_INITIALIZED");
    return this.capClient.request(args, signal);
  }
  emit(patch) {
    Object.assign(this.state, patch);
    if (!this.released) this.update(this.status());
  }
  recordConsole(event) {
    if (this.released) return;
    const small = (value, limit) => typeof value === "string" ? value.slice(0, limit).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "") : "";
    let sourceId = "";
    try {
      const url = new URL(small(event.sourceId, 2048), this.state.url || void 0);
      if (["http:", "https:"].includes(url.protocol)) {
        url.username = "";
        url["password"] = "";
        sourceId = url.href.slice(0, 512);
      }
    } catch {
      if (/^VM\d+$/.test(event.sourceId || "")) sourceId = small(event.sourceId, 80);
    }
    this.consoleMessages.push({ level: Number.isInteger(event.level) && event.level >= 0 && event.level <= 3 ? event.level : 1, message: small(event.message, 2e3), line: Number.isSafeInteger(event.line) && event.line >= 0 ? event.line : 0, sourceId });
    if (this.consoleMessages.length > 50) {
      this.consoleMessages.shift();
      this.consoleDropped = Math.min(Number.MAX_SAFE_INTEGER, this.consoleDropped + 1);
    }
  }
  readConsole({ clear = false } = {}) {
    if (clear !== true && clear !== false) throw new BrowserError("INVALID_CONSOLE_OPTIONS");
    const value = { messages: this.consoleMessages.map((message) => ({ ...message })), truncated: this.consoleDropped > 0, dropped: this.consoleDropped, untrusted: true, scope: "owned-guest" };
    while (JSON.stringify(value).length > 6e4 && value.messages.length) {
      value.messages.shift();
      value.dropped++;
      value.truncated = true;
    }
    if (clear) {
      this.consoleMessages = [];
      this.consoleDropped = 0;
    }
    return value;
  }
  listen(name, callback) {
    this.element.addEventListener(name, callback);
    this.listeners.push(() => this.element?.removeEventListener(name, callback));
  }
  async mount(workspace, signal) {
    const reservation = await this.bridge.acquire(workspace);
    this.reservation = reservation;
    this.networkClient = new GuestNetwork(this.bridge.network, reservation.lease);
    this.capClient = new GuestCap(this.bridge.cap, reservation.lease);
    if (signal.aborted || this.released) {
      this.networkClient.dispose();
      await this.bridge.release(reservation.lease);
      return;
    }
    const frame = document.createElement("webview");
    this.element = frame;
    frame.style.cssText = "display:flex;flex:1;width:100%;height:100%;min-height:200px";
    frame.setAttribute("name", reservation.lease);
    frame.setAttribute("partition", reservation.partition);
    frame.setAttribute("data-sidebar-browser-frame", "");
    frame.setAttribute("allowpopups", "");
    frame.setAttribute("src", `about:blank#${reservation.lease}`);
    this.listen("console-message", (event) => this.recordConsole(event));
    this.listen("dom-ready", () => this.emit({ initialized: true, ready: true, error: "" }));
    this.listen("did-start-navigation", (event) => {
      if (event.isMainFrame) {
        if (!event.isInPlace) {
          this.consoleMessages = [];
          this.consoleDropped = 0;
        }
        this.invalidate();
        this.emit({ ready: false, loading: true, error: "" });
      }
    });
    const info = () => {
      if (this.released) return;
      this.emit({ url: frame.getURL().startsWith("about:blank") ? "" : frame.getURL(), title: frame.getTitle().slice(0, 500), canGoBack: frame.canGoBack(), canGoForward: frame.canGoForward() });
    };
    this.listen("did-navigate", info);
    this.listen("did-navigate-in-page", (event) => {
      if (event.isMainFrame) {
        this.invalidate();
        info();
        this.emit({ ready: true });
      }
    });
    this.listen("page-title-updated", info);
    this.listen("did-start-loading", () => this.emit({ loading: true }));
    this.listen("did-stop-loading", () => {
      info();
      this.emit({ loading: false });
    });
    this.listen("did-fail-load", (event) => {
      if (event.isMainFrame && event.errorCode !== -3) this.emit({ ready: false, loading: false, error: `${event.errorCode}: ${event.errorDescription}`.slice(0, 500) });
    });
    this.listen("render-process-gone", () => {
      this.invalidate();
      this.emit({ ready: false, loading: false, error: "PAGE_CRASHED" });
    });
    this.removeOpen = this.bridge.onOpenRequested(reservation.lease, (url) => {
      const opened = this.onOpen ? this.onOpen(url) : this.navigate("open", url, signal);
      Promise.resolve(opened).catch((error) => this.emit({ error: error.message }));
    });
    await new Promise((resolve, reject) => {
      let timer;
      const clear = () => {
        clearTimeout(timer);
        signal.removeEventListener("abort", abort);
        frame.removeEventListener("dom-ready", ready);
        frame.removeEventListener("render-process-gone", crashed);
      };
      const ready = () => {
        clear();
        resolve();
      };
      const abort = () => {
        clear();
        reject(signal.reason);
      };
      const crashed = () => {
        clear();
        reject(new BrowserError("PAGE_CRASHED"));
      };
      signal.addEventListener("abort", abort, { once: true });
      frame.addEventListener("dom-ready", ready);
      frame.addEventListener("render-process-gone", crashed);
      timer = setTimeout(() => {
        clear();
        reject(new BrowserError("GUEST_INIT_TIMEOUT"));
      }, 14e3);
      this.container.appendChild(frame);
      if (signal.aborted) abort();
    });
  }
  async navigate(action, url, signal) {
    signal.throwIfAborted();
    const frame = this.element;
    if (!frame || !this.state.initialized) throw new BrowserError("PAGE_NOT_READY");
    if (action === "back" && !frame.canGoBack() || action === "forward" && !frame.canGoForward()) throw new BrowserError("NO_HISTORY");
    this.navigation?.abort(new BrowserError("NAVIGATION_REPLACED"));
    const navigation = new AbortController();
    this.navigation = navigation;
    signal = AbortSignal.any([signal, navigation.signal]);
    return new Promise((resolve, reject) => {
      let timer;
      const clear = () => {
        clearTimeout(timer);
        signal.removeEventListener("abort", abort);
        frame.removeEventListener("did-stop-loading", done);
        frame.removeEventListener("did-fail-load", failed);
        frame.removeEventListener("render-process-gone", crashed);
        frame.removeEventListener("did-navigate-in-page", sameDocument);
        if (this.navigation === navigation) this.navigation = null;
      };
      const done = () => {
        clear();
        this.state.error ? reject(new BrowserError("NAVIGATION_FAILED", this.state.error)) : resolve();
      };
      const sameDocument = (event) => {
        if (event.isMainFrame) done();
      };
      const failed = (event) => {
        if (event.isMainFrame && event.errorCode !== -3) {
          clear();
          reject(new BrowserError("NAVIGATION_FAILED", String(event.errorDescription)));
        }
      };
      const crashed = () => {
        clear();
        reject(new BrowserError("PAGE_CRASHED"));
      };
      const abort = () => {
        clear();
        frame.stop();
        reject(signal.reason);
      };
      signal.addEventListener("abort", abort, { once: true });
      frame.addEventListener("did-stop-loading", done);
      frame.addEventListener("did-fail-load", failed);
      frame.addEventListener("render-process-gone", crashed);
      frame.addEventListener("did-navigate-in-page", sameDocument);
      timer = setTimeout(() => {
        clear();
        frame.stop();
        reject(new BrowserError("NAVIGATION_TIMEOUT"));
      }, 14e3);
      try {
        if (action === "open") frame.loadURL(httpUrl(url, this.origin)).then(done, (error) => {
          clear();
          reject(error);
        });
        else if (action === "back") frame.goBack();
        else if (action === "forward") frame.goForward();
        else frame.reload();
      } catch (error) {
        clear();
        reject(error);
      }
    });
  }
  execute(script) {
    return this.element.executeJavaScript(script, false);
  }
  async input(plan, args, check) {
    const frame = this.element;
    check();
    frame.focus();
    this.onInput?.({ action: plan.action, x: plan.x, y: plan.y });
    if (["click", "fill", "press"].includes(plan.action)) {
      check();
      await frame.sendInputEvent({ type: "mouseMove", x: plan.x, y: plan.y });
      check();
      try {
        await frame.sendInputEvent({ type: "mouseDown", x: plan.x, y: plan.y, button: "left", clickCount: 1 });
      } finally {
        await frame.sendInputEvent({ type: "mouseUp", x: plan.x, y: plan.y, button: "left", clickCount: 1 });
      }
    }
    if (plan.action === "fill") {
      check();
      try {
        await frame.sendInputEvent({ type: "keyDown", keyCode: "A", modifiers: ["meta"] });
      } finally {
        await frame.sendInputEvent({ type: "keyUp", keyCode: "A", modifiers: ["meta"] });
      }
      check();
      await frame.insertText(args.value);
    } else if (plan.action === "press") {
      check();
      try {
        await frame.sendInputEvent({ type: "keyDown", keyCode: "Enter" });
      } finally {
        await frame.sendInputEvent({ type: "keyUp", keyCode: "Enter" });
      }
    } else if (plan.action === "scroll") {
      check();
      await frame.sendInputEvent({ type: "mouseWheel", x: plan.x, y: plan.y, deltaY: args.deltaY, deltaX: 0 });
    }
  }
  // Electron's capturePage can transiently fail (UnknownVizError) while the guest
  // is compositing or occluded. Retry briefly and never report a blank image.
  // (CDP Page.captureScreenshot hangs on stock Electron, so it is not a fallback.)
  async capture() {
    const frame = this.element;
    if (!frame) throw new BrowserError("PAGE_NOT_INITIALIZED");
    let lastError;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        const image = await frame.capturePage();
        if (image && !image.isEmpty()) return image.toDataURL();
        lastError = new Error("EMPTY_IMAGE");
      } catch (error) {
        lastError = error;
      }
      await new Promise((resolve) => setTimeout(resolve, 150 * (attempt + 1)));
    }
    throw new BrowserError("SCREENSHOT_UNAVAILABLE", String(lastError?.message || "Guest did not produce an image").slice(0, 200));
  }
  stop() {
    this.element?.stop();
  }
  async dispose() {
    if (this.released) return;
    this.released = true;
    this.networkClient?.dispose();
    this.capClient?.dispose();
    this.consoleMessages = [];
    this.consoleDropped = 0;
    this.navigation?.abort(new BrowserError("PANEL_CLOSED"));
    this.removeOpen?.();
    for (const remove of this.listeners.splice(0)) remove();
    this.element?.remove();
    if (this.reservation) await this.bridge.release(this.reservation.lease);
  }
};
async function workspaceIdentity(source, sessionId, signal) {
  signal.throwIfAborted();
  if (source.getSnapshot().phase !== "ready") await new Promise((resolve, reject) => {
    const abort = () => {
      stop();
      reject(signal.reason);
    };
    const stop = source.subscribe(() => {
      if (source.getSnapshot().phase === "ready") {
        stop();
        signal.removeEventListener("abort", abort);
        resolve();
      }
    });
    signal.addEventListener("abort", abort, { once: true });
  });
  signal.throwIfAborted();
  const workspace = source.getSnapshot().items.find((item) => item.sessionIds.includes(sessionId));
  return workspace ? `cwd:${workspace.path}` : `session:${sessionId}`;
}

// src/constants.js
var MAX_TABS = 12;
var MIN_TABS = 1;
var DEFAULT_HOME_URL = "";
var DEFAULT_AUTO_OPEN = true;

// src/page-runtime.js
function pageRuntime(request) {
  const key = "__dshBrowserObservation_v1";
  const error = (code) => {
    throw new Error(code);
  };
  const visible = (el2) => {
    for (let node = el2; node instanceof Element; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (node.hidden || node.getAttribute("aria-hidden") === "true" || style.display === "none" || style.visibility === "hidden") return false;
    }
    return el2.getClientRects().length > 0;
  };
  const role = (el2) => el2.getAttribute("role") || ({ BUTTON: "button", A: "link", TEXTAREA: "textbox", SELECT: "combobox", INPUT: ["checkbox", "radio"].includes(el2.type) ? el2.type : ["button", "submit", "reset"].includes(el2.type) ? "button" : "textbox" }[el2.tagName] || "element");
  const name = (el2) => [el2.getAttribute("aria-label"), (el2.getAttribute("aria-labelledby") || "").split(/\s+/).map((id2) => document.getElementById(id2)?.textContent || "").join(" "), [...el2.labels || []].map((l) => l.textContent).join(" "), el2.getAttribute("alt"), el2.getAttribute("title"), el2.textContent, el2.getAttribute("placeholder")].map((value) => (value || "").replace(/\s+/g, " ").trim()).find(Boolean)?.slice(0, 240) || "";
  let state = window[key];
  if (request.operation === "snapshot") {
    state?.observer.disconnect();
    state = { documentId: state?.documentId || crypto.randomUUID(), snapshotId: crypto.randomUUID(), refs: /* @__PURE__ */ new Map(), dirty: false };
    window[key] = state;
    const elements = [{ ref: "page", role: "document", name: "Page viewport", scrollOnly: true }];
    const candidates = document.querySelectorAll('button,a[href],input,textarea,select,[role], [contenteditable="true"]');
    for (const el2 of [...candidates].slice(0, 4e3)) {
      if (elements.length >= 120) break;
      if (!visible(el2) || el2.type === "hidden" || el2.type === "file") continue;
      const ref = `e${elements.length + 1}`;
      state.refs.set(ref, el2);
      elements.push({ ref, role: role(el2), name: name(el2), disabled: !!el2.disabled });
    }
    let text = "", visited = 0;
    const walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT);
    while (walker.nextNode() && text.length < 12e3 && visited++ < 2e4) {
      const node = walker.currentNode, parent = node.parentElement;
      if (!parent || parent.closest("script,style,noscript,textarea,select") || !visible(parent)) continue;
      const part = node.textContent.replace(/\s+/g, " ").trim();
      if (part) text += part + "\n";
    }
    state.observer = new MutationObserver(() => {
      state.dirty = true;
    });
    state.observer.observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
    return { documentId: state.documentId, snapshotId: state.snapshotId, url: location.href.slice(0, 8192), title: document.title.slice(0, 500), text: text.slice(0, 12e3), elements, truncated: text.length >= 12e3 || candidates.length > elements.length, untrusted: true, scope: "main-frame" };
  }
  if (request.operation === "inspect") {
    const args2 = request.args || {};
    const depth = args2.depth ?? 2, limit = args2.limit ?? 40;
    if (!Number.isInteger(depth) || depth < 0 || depth > 5 || !Number.isInteger(limit) || limit < 1 || limit > 80) error("INVALID_INSPECT_LIMIT");
    if (args2.selector !== void 0 && (typeof args2.selector !== "string" || !args2.selector || args2.selector.length > 512) || args2.ref && args2.selector !== void 0) error("INVALID_SELECTOR");
    let root, matchCount = 0;
    if (args2.ref) {
      if (!state || args2.documentId !== state.documentId || args2.snapshotId !== state.snapshotId) error("STALE_SNAPSHOT");
      if (state.observer.takeRecords().length) state.dirty = true;
      if (state.dirty) error("STALE_SNAPSHOT");
      root = args2.ref === "page" ? document.body : state.refs.get(args2.ref);
      if (!root?.isConnected) error("TARGET_UNAVAILABLE");
      matchCount = 1;
    } else {
      let matches;
      try {
        matches = document.querySelectorAll(args2.selector || "body");
      } catch {
        error("INVALID_SELECTOR");
      }
      matchCount = matches.length;
      root = matches[0];
    }
    const small = (value, size) => typeof value === "string" ? value.slice(0, size).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "") : "";
    const number = (value) => Number.isFinite(value) ? Math.round(Math.max(-1e7, Math.min(1e7, value)) * 10) / 10 : 0;
    const safeUrl = (value) => {
      try {
        const url = new URL(value, location.href);
        if (!["http:", "https:"].includes(url.protocol)) return "";
        url.username = "";
        url["password"] = "";
        return small(url.href, 2048);
      } catch {
        return "";
      }
    };
    const rect2 = (element) => {
      const value = element.getBoundingClientRect();
      return { x: number(value.x ?? value.left), y: number(value.y ?? value.top), width: number(value.width), height: number(value.height) };
    };
    const shown = (element) => {
      for (let node = element; node instanceof Element; node = node.parentElement) {
        const css = getComputedStyle(node);
        if (node.hidden || node.getAttribute("aria-hidden") === "true" || css.display === "none" || ["hidden", "collapse"].includes(css.visibility)) return false;
      }
      return true;
    };
    const excluded = (element) => ["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "HEAD", "META", "LINK"].includes(element.tagName) || !shown(element);
    const control = (element) => ["INPUT", "TEXTAREA", "SELECT", "OPTION"].includes(element.tagName) || element.isContentEditable || element.closest('[contenteditable]:not([contenteditable="false"])') || ["textbox", "searchbox"].includes(element.getAttribute("role"));
    const attributes = ["alt", "placeholder", "href", "src", "type", "name", "title", "role", "aria-label", "aria-labelledby", "aria-describedby", "aria-hidden", "dir", "lang", "disabled", "readonly", "required", "autocomplete", "width", "height", "colspan", "rowspan"];
    const styleNames = ["display", "position", "box-sizing", "width", "height", "min-width", "max-width", "min-height", "max-height", "top", "right", "bottom", "left", "margin", "padding", "gap", "flex-direction", "align-items", "justify-content", "grid-template-columns", "font-family", "font-size", "font-weight", "line-height", "color", "background-color", "background-image", "border", "border-radius", "box-shadow", "text-align", "opacity", "overflow", "transform", "z-index"];
    let used = 3500, count = 0, scanned = 0, truncated = false, full = false;
    const reserve = (value) => {
      const cost = JSON.stringify(value).length + 2;
      if (used + cost > 59e3) {
        full = truncated = true;
        return false;
      }
      used += cost;
      return true;
    };
    const visit = (element, level) => {
      if (!element || full || count >= limit || ++scanned > 4e3) {
        truncated = true;
        return null;
      }
      if (excluded(element)) return null;
      const css = getComputedStyle(element), attrs = {}, styles = {};
      for (const key2 of attributes) {
        const raw = element.getAttribute(key2);
        if (raw === null) continue;
        attrs[key2] = ["href", "src"].includes(key2) ? safeUrl(raw) : small(raw, 240);
      }
      for (const key2 of styleNames) styles[key2] = small(css.getPropertyValue(key2), 120);
      let text = "";
      if (!control(element)) for (const node2 of [...element.childNodes].slice(0, 80)) {
        if (node2.nodeType === Node.TEXT_NODE) text += small(node2.textContent, 400).replace(/\s+/g, " ") + " ";
        if (text.length >= 160) break;
      }
      const node = { tag: small(element.localName, 40), id: small(element.id, 160), class: small(element.getAttribute("class") || "", 240), role: small(role(element), 80), text: text.trim().slice(0, 160), attributes: attrs, rect: rect2(element), styles, children: [] };
      if (!reserve(node)) return null;
      count++;
      if (!control(element)) {
        if (level < depth) for (const child of element.children) {
          if (full || count >= limit || scanned >= 4e3) {
            truncated = true;
            break;
          }
          const next = visit(child, level + 1);
          if (next) node.children.push(next);
        }
        else if (element.children.length) truncated = true;
      }
      return node;
    };
    const tree = root ? visit(root, 0) : null, images = [];
    if (root && !full) {
      const candidates = root.matches("img") ? [root] : root.querySelectorAll("img");
      for (let index = 0; index < Math.min(candidates.length, 4e3); index++) {
        if (images.length >= 20) {
          truncated = true;
          break;
        }
        const image = candidates[index];
        if (excluded(image) || control(image)) continue;
        const item = { src: safeUrl(image.currentSrc || image.getAttribute("src") || ""), alt: small(image.getAttribute("alt") || "", 160), naturalWidth: number(image.naturalWidth), naturalHeight: number(image.naturalHeight), rect: rect2(image) };
        if (!reserve(item)) break;
        images.push(item);
      }
    }
    return { url: safeUrl(location.href), title: small(document.title, 500), viewport: { width: number(innerWidth), height: number(innerHeight), dpr: number(devicePixelRatio), scrollX: number(scrollX), scrollY: number(scrollY) }, tree, images, matchCount, nodeCount: count, truncated, untrusted: true, scope: "main-frame" };
  }
  if (request.operation !== "act") error("UNKNOWN_PAGE_OPERATION");
  const args = request.args;
  if (!state || args.documentId !== state.documentId || args.snapshotId !== state.snapshotId || state.dirty || state.observer.takeRecords().length) error("STALE_SNAPSHOT");
  if (args.action === "scroll" && args.ref === "page") {
    if (!Number.isFinite(args.deltaY) || Math.abs(args.deltaY) > 2e3) error("INVALID_SCROLL");
    state.dirty = true;
    return { action: "scroll", x: Math.floor(innerWidth / 2), y: Math.floor(innerHeight / 2) };
  }
  let el;
  if (args.ref) el = state.refs.get(args.ref);
  else {
    const matches = [...state.refs.values()].filter((node) => role(node) === args.role && name(node) === args.name);
    if (matches.length !== 1) error("AMBIGUOUS_TARGET");
    el = matches[0];
  }
  if (!el || !el.isConnected || !visible(el)) error("TARGET_UNAVAILABLE");
  if (el.disabled || el.getAttribute("aria-disabled") === "true" || el.type === "file") error("TARGET_DISABLED");
  state.dirty = true;
  if (!["click", "fill", "press", "scroll"].includes(args.action)) error("UNSUPPORTED_ACTION");
  const rect = el.getBoundingClientRect();
  const x = Math.floor(rect.left + rect.width / 2), y = Math.floor(rect.top + rect.height / 2);
  if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) error("TARGET_OUTSIDE_VIEWPORT");
  const top = document.elementFromPoint(x, y);
  if (!top || !(top === el || el.contains(top))) error("TARGET_OBSCURED");
  if (args.action === "fill") {
    if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) || el.readOnly || !(el instanceof HTMLTextAreaElement || ["text", "search", "email", "url", "tel", "password"].includes(el.type))) error("NOT_FILLABLE");
    if (typeof args.value !== "string" || args.value.length > 1e4) error("INVALID_VALUE");
  } else if (args.action === "press") {
    if (args.key !== "Enter") error("UNSUPPORTED_KEY");
  } else if (args.action === "scroll" && (!Number.isFinite(args.deltaY) || Math.abs(args.deltaY) > 2e3)) error("INVALID_SCROLL");
  return { action: args.action, x, y };
}
function pageScript(operation, args) {
  return `(${pageRuntime.toString()})(${JSON.stringify({ operation, args })})`;
}

// src/runner.js
var PageRunner = class {
  active = null;
  generation = 0;
  closed = false;
  constructor(adapter, onBusy = () => {
  }) {
    this.adapter = adapter;
    this.onBusy = onBusy;
  }
  invalidate() {
    this.generation++;
    if (this.active && !["navigate", "network"].includes(this.active.operation)) this.active.controller.abort(new BrowserError("DOCUMENT_CHANGED"));
  }
  cancel(requestId) {
    if (requestId && this.active?.id !== requestId) return;
    if (this.active && (!requestId || requestId === this.active.id)) {
      this.active.controller.abort(new BrowserError("CANCELLED"));
      if (!["inspect", "console", "network", "cap", "status"].includes(this.active.operation)) this.adapter.stop();
    }
    this.invalidate();
  }
  dispose() {
    this.closed = true;
    this.cancel();
  }
  async run(command) {
    if (this.closed) throw new BrowserError("PANEL_CLOSED");
    if (command.expires <= Date.now()) throw new BrowserError("REQUEST_EXPIRED");
    if (this.active) throw new BrowserError("BUSY");
    const controller = new AbortController(), active = { id: command.id, controller, operation: command.operation };
    const signal = command.signal ? AbortSignal.any([controller.signal, command.signal]) : controller.signal;
    const passive = ["inspect", "console", "network", "cap", "status"].includes(command.operation);
    this.active = active;
    if (!passive) this.onBusy(true);
    const timer = setTimeout(() => {
      controller.abort(new BrowserError("TIMEOUT"));
      if (!passive) this.adapter.stop();
    }, Math.max(1, command.expires - Date.now()));
    const check = () => {
      signal.throwIfAborted();
      if (this.closed) throw new BrowserError("PANEL_CLOSED");
    };
    try {
      const { operation, args } = command;
      check();
      if (operation === "status") return this.adapter.status();
      if (operation === "navigate") {
        this.invalidate();
        if (!["open", "back", "forward", "reload"].includes(args.action)) throw new BrowserError("INVALID_NAVIGATION");
        await abortable(this.adapter.navigate(args.action, args.action === "open" ? httpUrl(args.url, this.adapter.origin) : void 0, signal), signal);
        check();
        return this.adapter.status();
      }
      if (operation === "console" || operation === "network" || operation === "cap") {
        if (!this.adapter.status().initialized) throw new BrowserError("PAGE_NOT_INITIALIZED");
        const result2 = await abortable(operation === "network" ? this.adapter.readNetwork(args || {}, signal) : operation === "cap" ? this.adapter.readCap(args || {}, signal) : this.adapter.readConsole(args || {}), signal);
        check();
        return result2;
      }
      if (!this.adapter.status().ready) throw new BrowserError("PAGE_NOT_READY");
      const generation = this.generation;
      let result;
      if (operation === "snapshot" || operation === "act" || operation === "inspect") {
        if (operation === "inspect" && args?.generation !== void 0 && args.generation !== generation) throw new BrowserError("STALE_DOCUMENT");
        if (operation === "act" && args.generation !== generation) throw new BrowserError("STALE_DOCUMENT");
        result = await abortable(this.adapter.execute(pageScript(operation, args)), signal);
        check();
        if (generation !== this.generation) throw new BrowserError("DOCUMENT_CHANGED");
        if (operation === "snapshot" || operation === "inspect") result.generation = generation;
        else {
          if (!Number.isFinite(result?.x) || !Number.isFinite(result?.y) || result.action !== args.action) throw new BrowserError("INVALID_INPUT_PLAN");
          await abortable(this.adapter.input(result, args, () => {
            check();
            if (generation !== this.generation) throw new BrowserError("DOCUMENT_CHANGED");
          }), signal);
          check();
          if (generation !== this.generation) throw new BrowserError("DOCUMENT_CHANGED", "The action may already have navigated; observe the new page");
          result = { acted: true, action: args.action, observationConsumed: true };
        }
      } else if (operation === "screenshot") {
        const dataUrl = await abortable(this.adapter.capture(), signal);
        check();
        if (generation !== this.generation) throw new BrowserError("DOCUMENT_CHANGED");
        if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/png;base64,") || dataUrl.length > Math.ceil(LIMITS.image * 4 / 3) + 100) throw new BrowserError("SCREENSHOT_TOO_LARGE");
        result = { dataUrl, generation };
      } else throw new BrowserError("UNKNOWN_OPERATION");
      return result;
    } finally {
      clearTimeout(timer);
      if (this.active === active) {
        this.active = null;
        if (!passive) this.onBusy(false);
      }
    }
  }
};

// src/session-tabs.js
var SessionTabs = class {
  entries = /* @__PURE__ */ new Map();
  activeTabId = null;
  closed = false;
  request = null;
  constructor({ createPage, createContainer, workspace, signal, maxTabs = MAX_TABS, onChange = () => {
  }, onActivity = () => {
  }, onSwitch = () => {
  }, onClose = () => {
  } }) {
    Object.assign(this, { createPage, createContainer, workspace, signal, maxTabs, onChange, onActivity, onSwitch, onClose });
  }
  list() {
    return { activeTabId: this.activeTabId, tabs: [...this.entries.values()].map((entry) => ({ tabId: entry.tabId, ...entry.page.status() })) };
  }
  emit() {
    if (!this.closed) this.onChange(this.list());
  }
  current() {
    const entry = this.entries.get(this.activeTabId);
    if (!entry) throw new BrowserError("NO_ACTIVE_TAB");
    return entry;
  }
  getPage() {
    if (!this.activeTabId) return null;
    const { tabId, page, runner } = this.current();
    return { tabId, page, runner };
  }
  async newTab(url, signal = this.signal) {
    if (this.closed) throw new BrowserError("PANEL_CLOSED");
    if (this.entries.size >= this.maxTabs) throw new BrowserError("TAB_LIMIT", "Close a tab before opening another");
    if (url) url = httpUrl(url);
    signal.throwIfAborted();
    const previousActive = this.activeTabId;
    const tabId = id(), container = this.createContainer(tabId), lifetime = new AbortController();
    const entry = { tabId, container, lifetime };
    const page = this.createPage(container, () => this.emit(), () => {
      entry.runner.invalidate();
      if (this.activeTabId === tabId) this.onSwitch({ reason: "navigate", tabId });
    }, tabId);
    const runner = new PageRunner(page, (busy) => this.onActivity({ busy, operation: this.request?.operation, tabId }));
    Object.assign(entry, { page, runner });
    this.entries.set(tabId, entry);
    this.select(tabId, "agent");
    const life = AbortSignal.any([this.signal, lifetime.signal]);
    entry.mounted = page.mount(this.workspace, life);
    entry.mounted.catch((error) => {
      if (!life.aborted && !this.closed) {
        page.emit?.({ error: error.message });
        this.emit();
      }
    });
    this.emit();
    try {
      if (url) {
        await abortable(entry.mounted, signal);
        signal.throwIfAborted();
        await abortable(page.navigate("open", url, signal), signal);
      }
      signal.throwIfAborted();
      return { tabId, ...this.list() };
    } catch (error) {
      if (signal.aborted && this.entries.get(tabId) === entry) {
        lifetime.abort();
        runner.dispose();
        this.onClose(tabId);
        this.entries.delete(tabId);
        const wasActive = this.activeTabId === tabId;
        if (wasActive) {
          this.activeTabId = null;
          const previous = this.entries.has(previousActive) ? previousActive : [...this.entries.keys()].at(-1);
          if (previous) this.select(previous, "agent");
        }
        container.remove();
        void page.dispose().catch(() => {
        });
        this.emit();
      }
      throw error;
    }
  }
  select(tabId, source = "user") {
    if (!this.entries.has(tabId)) throw new BrowserError("TAB_NOT_FOUND");
    if (this.activeTabId !== tabId) {
      if (source === "user") this.cancel();
      const previous = this.entries.get(this.activeTabId);
      previous?.runner.cancel();
      this.activeTabId = tabId;
      this.current().runner.invalidate();
      this.onSwitch({ reason: "select", tabId });
    }
    for (const entry of this.entries.values()) {
      const selected = entry.tabId === tabId;
      entry.container.style.visibility = selected ? "visible" : "hidden";
      entry.container.style.pointerEvents = selected ? "auto" : "none";
      entry.container.setAttribute("aria-hidden", String(!selected));
    }
    this.emit();
    return this.list();
  }
  async close(tabId, source = "user", signal = this.signal) {
    signal.throwIfAborted();
    const entry = this.entries.get(tabId);
    if (!entry) throw new BrowserError("TAB_NOT_FOUND");
    if (source === "user") this.cancel();
    this.onClose(tabId);
    entry.lifetime.abort();
    entry.runner.dispose();
    this.entries.delete(tabId);
    if (this.activeTabId === tabId) {
      this.activeTabId = null;
      const next = [...this.entries.keys()].at(-1);
      if (next) this.select(next, "agent");
      else this.onSwitch({ reason: "close", tabId });
    }
    this.emit();
    try {
      await abortable(entry.page.dispose(), signal);
    } finally {
      entry.container.remove();
    }
    signal.throwIfAborted();
    if (!this.entries.size && !this.closed) await this.newTab(void 0, signal);
    signal.throwIfAborted();
    return this.list();
  }
  cancel(requestId) {
    if (this.request && (!requestId || requestId === this.request.id)) this.request.controller.abort(new BrowserError("CANCELLED"));
    for (const entry of this.entries.values()) entry.runner.cancel(requestId);
  }
  stopNetworkCaptures() {
    return Promise.allSettled([...this.entries.values()].map((entry) => entry.page.stopNetworkCapture?.()));
  }
  async navigate(action, url, signal = this.signal) {
    const entry = this.current();
    this.cancel();
    await abortable(entry.mounted, signal);
    return entry.page.navigate(action, url, signal);
  }
  async run(command) {
    if (this.closed) throw new BrowserError("PANEL_CLOSED");
    if (this.request) throw new BrowserError("BUSY");
    if (command.expires <= Date.now()) throw new BrowserError("REQUEST_EXPIRED");
    const controller = new AbortController(), request = { id: command.id, operation: command.operation, controller };
    this.request = request;
    const timer = setTimeout(() => controller.abort(new BrowserError("TIMEOUT")), Math.max(1, command.expires - Date.now()));
    const signal = AbortSignal.any([controller.signal, this.signal, ...command.signal ? [command.signal] : []]);
    try {
      if (command.operation === "tabs") {
        const { action, tabId: tabId2, url } = command.args;
        if (action === "list") return this.list();
        this.onActivity({ busy: true, operation: "tabs", tabId: this.activeTabId });
        if (action === "new") return await abortable(this.newTab(url, signal), signal);
        if (action === "select") return this.select(tabId2, "agent");
        if (action === "close") return await abortable(this.close(tabId2 || this.activeTabId, "agent", signal), signal);
        throw new BrowserError("INVALID_TAB_ACTION");
      }
      const entry = this.current(), tabId = entry.tabId;
      if (["act", "inspect", "console", "network", "cap"].includes(command.operation) && command.args.tabId !== tabId) throw new BrowserError("STALE_TAB", "Select the observed tab and take a fresh snapshot");
      if (command.args.tabId && command.args.tabId !== tabId) throw new BrowserError("TAB_NOT_ACTIVE");
      signal.throwIfAborted();
      if (command.operation === "status") return { ...entry.page.status(), tabId, connected: true, tabCount: this.entries.size };
      await abortable(entry.mounted, signal);
      signal.throwIfAborted();
      const value = await abortable(entry.runner.run({ ...command, signal }), signal);
      signal.throwIfAborted();
      if (this.activeTabId !== tabId || !this.entries.has(tabId)) throw new BrowserError("TAB_CHANGED");
      return { ...value, tabId, ...command.operation === "status" ? { connected: true, tabCount: this.entries.size } : {} };
    } finally {
      clearTimeout(timer);
      if (this.request === request) {
        this.request = null;
        this.onActivity({ busy: false, tabId: this.activeTabId });
      }
    }
  }
  async dispose() {
    if (this.closed) return;
    this.closed = true;
    this.cancel();
    const entries = [...this.entries.values()];
    this.entries.clear();
    this.activeTabId = null;
    await Promise.all(entries.map(async (entry) => {
      this.onClose(entry.tabId);
      entry.lifetime.abort();
      entry.runner.dispose();
      try {
        await entry.page.dispose();
      } finally {
        entry.container.remove();
      }
    }));
  }
};

// src/browser-shell.js
var import_react = __toESM(require("react"), 1);
var h = import_react.default.createElement;
function addressUrl(value) {
  const text = value.trim();
  if (!text) return "";
  if (/^https?:\/\//i.test(text)) return httpUrl(text);
  if (/^(localhost|127\.\d+\.\d+\.\d+|\[::1\])(?::\d+)?(?:\/|$)/i.test(text)) return httpUrl(`http://${text}`);
  if (/^[\w-]+(?:\.[\w-]+)+(?:\:\d+)?(?:\/|$)/i.test(text)) return httpUrl(`https://${text}`);
  if (/^[a-z][a-z\d+.-]*:/i.test(text)) return httpUrl(text);
  return `https://duckduckgo.com/?q=${encodeURIComponent(text)}`;
}
function Icon({ name, size = 16, ...props }) {
  const paths = {
    back: "m14 5-7 7 7 7",
    forward: "m10 5 7 7-7 7",
    reload: "M20 7v5h-5M20 12a8 8 0 1 0-2 6M20 7l-2-2",
    close: "m7 7 10 10M17 7 7 17",
    plus: "M12 5v14M5 12h14",
    home: "m3 11 9-8 9 8M5 10v10h5v-6h4v6h5V10",
    globe: "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM3 12h18M12 3c5 5 5 13 0 18-5-5-5-13 0-18Z",
    lock: "M7 10V7a5 5 0 0 1 10 0v3M5 10h14v11H5zM12 14v3",
    arrow: "M5 12h14m-6-6 6 6-6 6",
    search: "M16 16l5 5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z",
    stop: "M6 6h12v12H6z",
    cursor: "m5 3 15 9-7 2-3 7-5-18Z",
    more: "M5 12h.01M12 12h.01M19 12h.01",
    check: "m5 12 4 4L19 6",
    info: "M12 11v6M12 7h.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z",
    comment: "M21 11a9 9 0 0 1-9 9H5l-3 2V11a9 9 0 0 1 19 0ZM7 10h10M7 14h6",
    eye: "M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12ZM15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z",
    trash: "M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7",
    edit: "m14 4 6 6M4 20l5-1L21 7l-6-6L3 13l1 7Z",
    spark: "m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z",
    gear: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"
  };
  return h("svg", { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true, ...props }, h("path", { d: paths[name] || paths.globe }));
}
var shellCss = `
[data-dsh-agent-browser]{--ab-bg:var(--dsw-alias-bg-base,#fff);--ab-layer:var(--dsw-alias-bg-layer-1,#f7f8fa);--ab-quiet:var(--dsw-alias-bg-layer-2,#eef0f4);--ab-text:var(--dsw-alias-label-primary,#1f2329);--ab-muted:var(--dsw-alias-label-secondary,#68717d);--ab-border:var(--dsw-alias-border-l3,#e8eaee);--ab-accent:var(--dsw-alias-state-business-primary,#4d6bfe);--ab-hover:var(--dsw-alias-interactive-bg-hover,rgba(110,120,140,.1));display:flex;flex-direction:column;height:100%;min-width:0;min-height:0;background:var(--ab-bg);color:var(--ab-text);font:13px var(--dsw-font-family,system-ui,sans-serif);isolation:isolate;overflow:hidden}
[data-dsh-agent-browser] *{box-sizing:border-box}
[data-dsh-agent-browser] button,[data-dsh-agent-browser] input{font:inherit}
[data-dsh-agent-browser] button{color:inherit;cursor:pointer}
[data-dsh-agent-browser] button:disabled{opacity:.35;cursor:default}
[data-dsh-agent-browser] button:focus-visible,[data-dsh-agent-browser] input:focus-visible{outline:2px solid var(--ab-accent);outline-offset:2px}
[data-dsh-agent-browser] .ab-tabs{display:flex;align-items:center;gap:4px;flex:none;padding:6px 8px 0;background:var(--ab-layer);border-bottom:1px solid var(--ab-border);min-height:40px}
[data-dsh-agent-browser] .ab-tabscroll{display:flex;align-items:center;gap:3px;min-width:0;overflow-x:auto;scrollbar-width:thin;flex:1}
[data-dsh-agent-browser] .ab-tab{display:flex;align-items:center;gap:7px;min-width:90px;max-width:180px;flex:1 1 130px;height:32px;padding:0 7px 0 10px;border-radius:9px 9px 0 0;background:transparent;color:var(--ab-muted);border:1px solid transparent;border-bottom:0;position:relative}
[data-dsh-agent-browser] .ab-tab:hover{background:var(--ab-hover);color:var(--ab-text)}
[data-dsh-agent-browser] .ab-tab[data-active=true]{background:var(--ab-bg);color:var(--ab-text);border-color:var(--ab-border);font-weight:500}
[data-dsh-agent-browser] .ab-tab-label{border:0;background:none;padding:0;display:flex;align-items:center;gap:7px;min-width:0;flex:1;height:100%;text-align:left}
[data-dsh-agent-browser] .ab-tab-label span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
[data-dsh-agent-browser] .ab-close{display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;padding:0;border:0;border-radius:5px;background:transparent;color:var(--ab-muted);flex:none}
[data-dsh-agent-browser] .ab-close:hover{background:var(--ab-hover);color:var(--ab-text)}
[data-dsh-agent-browser] .ab-icon{display:inline-flex;align-items:center;justify-content:center;width:29px;height:29px;padding:0;border:0;border-radius:8px;background:transparent;color:var(--ab-muted);flex:none}
[data-dsh-agent-browser] .ab-icon:hover:not(:disabled){background:var(--ab-hover);color:var(--ab-text)}
[data-dsh-agent-browser] .ab-toolbar{display:flex;align-items:center;gap:2px;padding:8px;flex:none;position:relative;border-bottom:1px solid var(--ab-border);min-width:0}
[data-dsh-agent-browser] .ab-address{display:flex;align-items:center;gap:6px;flex:1;min-width:50px;height:32px;margin:0 4px;padding:0 8px 0 10px;border:1px solid transparent;border-radius:18px;background:var(--ab-quiet);color:var(--ab-muted)}
[data-dsh-agent-browser] .ab-address:focus-within{background:var(--ab-bg);border-color:var(--ab-accent);box-shadow:0 0 0 2px color-mix(in srgb,var(--ab-accent) 12%,transparent)}
[data-dsh-agent-browser] .ab-address input{width:100%;min-width:0;flex:1;padding:0;background:transparent;border:0;outline:none;color:var(--ab-text);font-size:12px;height:28px}
[data-dsh-agent-browser] .ab-address input:focus-visible{outline:0}
[data-dsh-agent-browser] .ab-address .ab-go{display:none;width:22px;height:22px}
[data-dsh-agent-browser] .ab-address:focus-within .ab-go{display:inline-flex}
[data-dsh-agent-browser] .ab-progress{position:absolute;height:2px;background:var(--ab-accent);left:0;bottom:-1px;width:30%;animation:ab-loading 1.4s ease-in-out infinite}
[data-dsh-agent-browser] .ab-viewport{position:relative;flex:1;min-height:160px;min-width:0;overflow:hidden;background:var(--ab-bg)}
[data-dsh-agent-browser] .ab-page{position:absolute;inset:0;display:flex;min-height:0;min-width:0}
[data-dsh-agent-browser] .ab-start{position:absolute;inset:0;z-index:2;background:var(--ab-bg);display:flex;align-items:center;justify-content:center;padding:24px;overflow:auto}
[data-dsh-agent-browser] .ab-start-inner{max-width:440px;width:100%;text-align:center;padding-bottom:8vh}
[data-dsh-agent-browser] .ab-start-mark{width:64px;height:64px;display:flex;align-items:center;justify-content:center;border:1px solid var(--ab-border);border-radius:20px;background:var(--ab-layer);color:var(--ab-accent);margin:0 auto 22px;box-shadow:0 6px 20px rgba(20,30,60,.035)}
[data-dsh-agent-browser] .ab-start h2{margin:0 0 8px;font-size:23px;font-weight:560;letter-spacing:-.6px}
[data-dsh-agent-browser] .ab-start p{margin:0 auto 24px;color:var(--ab-muted);font-size:13px;line-height:1.6;max-width:330px}
[data-dsh-agent-browser] .ab-start-search{height:44px;padding:0 8px 0 14px;margin-bottom:22px;background:var(--ab-layer);border:1px solid var(--ab-border);border-radius:14px;display:flex;align-items:center;gap:10px;box-shadow:0 2px 6px rgba(20,30,60,.025)}
[data-dsh-agent-browser] .ab-start-search:focus-within{border-color:var(--ab-accent)}
[data-dsh-agent-browser] .ab-start-search input{flex:1;min-width:0;background:none;border:0;color:var(--ab-text);outline:0;height:40px;font-size:13px}
[data-dsh-agent-browser] .ab-shortcuts{display:flex;justify-content:center;gap:12px}
[data-dsh-agent-browser] .ab-shortcut{border:0;background:transparent;display:flex;align-items:center;flex-direction:column;gap:8px;min-width:72px;padding:8px;border-radius:12px;font-size:11px;color:var(--ab-muted)}
[data-dsh-agent-browser] .ab-shortcut:hover{background:var(--ab-hover)}
[data-dsh-agent-browser] .ab-shortcut b{display:flex;align-items:center;justify-content:center;width:40px;height:40px;border:1px solid var(--ab-border);border-radius:13px;background:var(--ab-layer);font-size:16px;color:var(--ab-text)}
[data-dsh-agent-browser] .ab-footer{display:flex;align-items:center;justify-content:space-between;gap:8px;min-height:30px;padding:4px 10px;border-top:1px solid var(--ab-border);font-size:11px;color:var(--ab-muted);flex:none}
[data-dsh-agent-browser] .ab-status{display:flex;align-items:center;gap:6px;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
[data-dsh-agent-browser] .ab-dot{width:6px;height:6px;border-radius:50%;background:#63a585;flex:none}
[data-dsh-agent-browser] .ab-agent{display:inline-flex;align-items:center;gap:6px;color:var(--ab-accent)}
[data-dsh-agent-browser] .ab-stop{border:0;background:color-mix(in srgb,var(--ab-accent) 9%,transparent);color:var(--ab-accent);border-radius:6px;font-size:11px;display:flex;align-items:center;gap:4px;padding:3px 6px}
[data-dsh-agent-browser] .ab-session{border:0;background:none;color:var(--ab-muted);padding:2px;display:flex;align-items:center;gap:5px;font-size:11px}
[data-dsh-agent-browser] .ab-error{display:flex;align-items:center;gap:8px;padding:8px 10px;border-bottom:1px solid var(--ab-border);color:var(--dsw-alias-state-error-primary,#b34646);background:var(--ab-layer);font-size:12px}
[data-dsh-agent-browser] .ab-error span{flex:1;min-width:0;overflow-wrap:anywhere}
[data-dsh-agent-browser] .ab-info{background:var(--ab-layer);padding:10px 12px;font-size:11px;line-height:1.7;border-top:1px solid var(--ab-border);overflow-wrap:anywhere;color:var(--ab-muted)}
[data-dsh-agent-browser] .ab-agent-badge{position:absolute;right:12px;top:52px;z-index:2147483001;pointer-events:none;padding:2px 8px;border-radius:999px;background:color-mix(in srgb,var(--ab-accent) 14%,var(--ab-bg));color:var(--ab-accent);border:1px solid color-mix(in srgb,var(--ab-accent) 40%,transparent);font-size:12px;font-weight:600}
[data-dsh-agent-browser] .ab-agent-cursor{position:absolute;z-index:2147483000;pointer-events:none;width:30px;height:31px;margin:-4px 0 0 -5px;filter:drop-shadow(0 2px 4px rgba(0,0,0,.35)) drop-shadow(0 0 5px color-mix(in srgb,var(--ab-accent) 55%,transparent));transition:left .12s ease-out,top .12s ease-out;will-change:left,top}
[data-dsh-agent-browser] .ab-click-marker{position:absolute;z-index:10;pointer-events:none;width:30px;height:30px;margin:-15px 0 0 -15px;border:2px solid var(--ab-accent);border-radius:50%;background:color-mix(in srgb,var(--ab-accent) 12%,transparent);box-shadow:0 0 0 5px color-mix(in srgb,var(--ab-accent) 8%,transparent);animation:ab-click .8s ease-out forwards}
[data-dsh-agent-browser] .ab-spinner{animation:ab-spin 1s linear infinite}
@keyframes ab-spin{to{transform:rotate(360deg)}}
@keyframes ab-loading{0%{left:0;width:0}50%{left:30%;width:40%}100%{left:100%;width:0}}
@keyframes ab-click{from{transform:scale(.7);opacity:1}to{transform:scale(1.5);opacity:0}}
@media(prefers-reduced-motion:reduce){[data-dsh-agent-browser] .ab-spinner,[data-dsh-agent-browser] .ab-progress{animation:none}[data-dsh-agent-browser] .ab-click-marker{animation:none;opacity:.6}}
`;

// src/settings.js
var SETTINGS_KEY = "dshx-browser.settings.v1";
var SETTINGS_DEFAULTS = Object.freeze({
  autoOpen: DEFAULT_AUTO_OPEN,
  homeUrl: DEFAULT_HOME_URL,
  maxTabs: MAX_TABS,
  maxRequests: 200,
  maxBodyBytes: 1048576,
  maxTotalBodyBytes: 8388608
});
var clampInt = (value, fallback, min, max) => {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(number)));
};
var httpUrl2 = (value) => {
  if (typeof value !== "string" || !value.trim()) return "";
  try {
    const url = new URL(value.trim());
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url["password"] ? url.href : "";
  } catch {
    return "";
  }
};
function normalizeSettings(input = {}) {
  const value = input && typeof input === "object" ? input : {};
  return {
    autoOpen: typeof value.autoOpen === "boolean" ? value.autoOpen : SETTINGS_DEFAULTS.autoOpen,
    homeUrl: httpUrl2(value.homeUrl),
    maxTabs: clampInt(value.maxTabs, SETTINGS_DEFAULTS.maxTabs, 1, MAX_TABS),
    maxRequests: clampInt(value.maxRequests, SETTINGS_DEFAULTS.maxRequests, 1, 500),
    maxBodyBytes: clampInt(value.maxBodyBytes, SETTINGS_DEFAULTS.maxBodyBytes, 1024, 2 * 1024 * 1024),
    maxTotalBodyBytes: clampInt(value.maxTotalBodyBytes, SETTINGS_DEFAULTS.maxTotalBodyBytes, 1024 * 1024, 16 * 1024 * 1024)
  };
}
function loadSettings(storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem?.(SETTINGS_KEY);
    return normalizeSettings(raw ? JSON.parse(raw) : {});
  } catch {
    return { ...SETTINGS_DEFAULTS };
  }
}
function saveSettings(patch, storage = globalThis.localStorage) {
  const next = normalizeSettings({ ...loadSettings(storage), ...patch && typeof patch === "object" ? patch : {} });
  try {
    storage?.setItem?.(SETTINGS_KEY, JSON.stringify(next));
  } catch {
  }
  return next;
}

// src/use-panel-settings.js
var import_react2 = __toESM(require("react"), 1);
var normalizeHostSettings = (value) => {
  const result = {};
  if (typeof value?.autoOpen === "boolean") result.autoOpen = value.autoOpen;
  if (typeof value?.homeUrl === "string") result.homeUrl = value.homeUrl;
  if (Number.isSafeInteger(value?.maxTabs) && value.maxTabs >= MIN_TABS && value.maxTabs <= MAX_TABS) result.maxTabs = value.maxTabs;
  return result;
};
function usePanelSettings() {
  const [settings, setSettings] = import_react2.default.useState(() => loadSettings());
  const [open, setOpen] = import_react2.default.useState(false);
  import_react2.default.useEffect(() => {
    const forms = globalThis.__dshBrowserConfigForms;
    if (!forms) return;
    let unsubscribe;
    try {
      const form = forms.get("dsh-x-browser");
      const apply2 = () => {
        const value = form.getSnapshot()?.value;
        if (value) setSettings((current) => ({ ...current, ...normalizeHostSettings(value) }));
      };
      apply2();
      unsubscribe = form.subscribe(apply2);
    } catch {
    }
    return () => {
      try {
        unsubscribe?.();
      } catch {
      }
    };
  }, []);
  const update = (patch) => {
    const next = saveSettings(patch);
    setSettings(next);
    return next;
  };
  return { settings, setSettings, open, setOpen, update };
}

// src/agent-cursor.js
var import_react3 = __toESM(require("react"), 1);

// src/cursor-asset.js
var AGENT_CURSOR = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAC4AAAAwCAYAAABuZUjcAAAG+klEQVR4Ae1ZW2xUVRS982qnj+lzSh9UrLWosVFq+TAkRmpi0URJSBogqRggavyF1Cj6Q0P94A+iURJDQrH6Q2OxIF/EEE0a0hqBEBKRQihSIYHQxwzTTtuZua51e/Z4GeZxh85MP2AnJ/d1HuvsvfY++5yraU/kiTzeYtN1PVq6u7vtvPK9fNOWSZzxXhIQhFfjecuWLfa7d+/a+vr6GvB+bPPmzXpzc7O+WHWxLu+15RTRLG7tbW1tzps3b64OhUKDeD+pK8Hzb4FA4MNr166tZh2pLxaRCedaqD4Ccfl8vo/MgOOJTOLcuXNVaCOTiFIpJ3RSgxigL168+EIq0DEyOT8///29e/fa165d6wKdHCwm8FKyAtpG0zc0NLjn5uZ+EETXr1/X8d7gNL7pu3btMt4lkkgkMsZJTE1NvclJoJ2DljA5d2aBs2M4XZ7X6/Vg8CkBsmnTJgN0bGlpadF7e3tTTgJK6IE/PIc2hiW0RatmzAI21an75MmTa8yDxwMdW2gRTmJyMjG7Yp1aJhFDpfQmw8bsDLdFe/bsaTIPSHpYAS9lx44d+vHjx/VkIpMYGhpagTbGJOJQKfUkVANXdXV1Ea7V6PSsDIIO0wIuhRPmJM6cOZNsDpOgUp84tab8wWQFTU/mF6JxAi8uLl5x9erVfdIzB34U4LGTSNepJSppyTSvKjjq6+sLcPVu27btAZ5LVMlEserUpJKyQuJoxA+cYVNTUz4eywsKCp7CAjS8VLqkKqmcemZm5hNGOpP2HwIe5XlFRUVJYWFh3YULFz6LEhEdZwO4ZsGpYZlXCV5bDKPxtU6e19XVFYLnVZ2dnS3hcHg6G3TRUviDmUagzLeKwk7ReuwMCC4CbYedTucCZj8Bb/9VPmIh0nIhY2Nj2s6dO6PPbrf7nWAw6ATfJRONKzblEJ6ioqIaLEbvmelSVlaWM62LIOb/g3flTEVUEvcwZ8j1xsbGCG7DmF0YTnEWHu7jN4DWEBG0XAgsH70HXX0ej8cBSyQPixJdALSM0eXWrVu9MvtMxPRUhb5k5jjo2g/gXvoevjsSAtcWA76zqqqqGNfqU6dOdWaTLuyPYA8cOPBQbGdw2L9//2uoV4niVsATat7QOj25pKSkAs7xDJblcemMK+BSwcpKSgsmS8xGRkY+p9VpfXI8ocZFlBPkl5eXl6JhPfj11VLpkkir8QTL/h+HDh3qyM/Pf5ZWR/GooGFLCVxli8XMXXp6etrMHadLlyNHjiQFisjhu3Hjxi9QSveGDRteR5tmgobSVoq2VRqcHLiunJQNFF0apqenR2SgdFIAajqeTExM/Hnp0qXvjh49+rHL5WpF3ZdRXkRpwnhP41pD0HRKpcQoaHsi4Az0PIKorKwMOxwOhsYFRJfT8n39+vWaVdm+fXv03u/3j0Kr+9rb299AavFBa2vr1/j+u91u9wGsH1WmsX748/Ly/NiJBUCZYG1t7QIXRkuD6WqTK5sL0oUpgFljVlMAM6cHBwe7AOol0OB5xd9VzIvYP0JeJX2K0YyBQVJbLU52mEzjHJQLQQR0odYXBgYGJqGxEaljXiQSCdoaReTw4cND0G4A5T4ila+0tNQPTd+HlgOwbgARJghLB9etWze/cePG8LFjx6jpiOCxJPr/xxXGBhrXuvPnz38q2rOSMTLjE6GPKC3XULPctHCho2Zj96D6Uk8DVAekSyFXr46OjlfSyRjN27bLly9/iXcroWUj7xCw+oNnL5kR0ToH4oAIT6vu3LkzIGAOHjyYFLhZED3eZbqs9rVGTNazeVzHmE5zki5wpFqrGaM5DHLlZUgVbVuKyRmQ6AaDng8AjVboYl50YKWfuJjgfQmKsZtZCo/tFuvpCFE6NxiIKiEk9Qu3b9/+WT7u3bs3biNz1Lly5crp2dnZEG7DmqJQWpHiUUTx0NA6Yyw3GOaMkRJ7aMSdvFm2bt26Bu+9sgXTckATAW84qRqYdGnADvwvAcZFhmeMcghkXnR4WiAZnjpFsGrpjADnxa5228wYV544ceJ93YLAudtgpWpay1KGlwXw0RQApYpOOjo6+k0iwMz4hoeHv2DCxEQNbWitnESTWDFOu6h1mh33dVgJV+/evfttOOsgHPdvgoXz/guq/NjV1fUW6jSh1KB4SBPZ7GYCSNptoHUHokQessV8RJoChMZCKDgP535OpKc2FS1CeJ7DdRZznEEJgv8hrKThTEQTp5a+GGcv0O4CH+Cg3K2EwXkXKMH+qFEdWmfomwPgeayWc9hBhWCFcNZDYAqxmXZIbjodkybFYy+vkp5qixtcmVDGuP3IHcmqBw0avwrBXzv4bWMZHx+XJT/Mhau/v5/P1jYCuRLd9NcZjw7572n657lsf5/TlZyA/Q9N3TljZhaAsAAAAABJRU5ErkJggg==";

// src/agent-cursor.js
var h2 = import_react3.default.createElement;
function AgentCursor({ point, visible }) {
  if (!visible || !point) return null;
  return h2("div", {
    className: "ab-agent-cursor",
    style: { left: point.x, top: point.y },
    "aria-hidden": true
  }, h2("img", { src: AGENT_CURSOR, width: 30, height: 31, alt: "", draggable: false }));
}
function ClickMarker({ marker }) {
  if (!marker) return null;
  return h2("div", {
    key: marker.key,
    className: "ab-click-marker",
    style: { left: marker.x, top: marker.y },
    "aria-hidden": true
  });
}

// src/locale.js
var dictionaries = {
  en: { title: "DSHX Browser", description: "Browse the web with your Agent", address: "Search or enter a website", go: "Go", back: "Back", forward: "Forward", reload: "Reload page", stopLoading: "Stop loading", stop: "Stop Agent", close: "Close tab", closePanel: "Close browser", newTab: "New tab", home: "Home", session: "Current conversation", unavailable: "Open DSH Desktop to use the shared browser.", starting: "Connecting\u2026", connected: "Connected", offline: "Agent disconnected", reconnect: "Reconnect", busy: "Agent is working", idle: "Ready", loading: "Loading\u2026", stopped: "Agent control stopped", error: "Something went wrong", dismiss: "Dismiss", startTitle: "A page to explore", startDescription: "Open a website, ask your Agent to help, or leave feedback directly on the page.", shortcuts: "Quick links", pageTitle: "New tab", sessionDetail: "This browser is connected to the current conversation.", details: "Connection details", tabLimit: "You can keep up to 12 tabs open.", navigate: "Opening a page", snapshot: "Reading the page", act: "Interacting with the page", screenshot: "Taking a screenshot", tabs: "Managing tabs", secure: "HTTPS connection", insecure: "HTTP connection", retry: "Try again", settingsTitle: "X Browser", settingsIntro: "Preferences for the shared browser panel.", autoOpenLabel: "Open the panel when a browser tool needs it", homeUrlLabel: "New-tab home URL", maxTabsLabel: "Maximum tabs", saved: "Saved", saveFailed: "Could not save", settingsOutdated: "Update the plugin to edit these settings" },
  zh: { title: "DSHX \u6D4F\u89C8\u5668", description: "\u4E0E Agent \u4E00\u8D77\u6D4F\u89C8\u7F51\u9875", address: "\u641C\u7D22\u6216\u8F93\u5165\u7F51\u5740", go: "\u524D\u5F80", back: "\u540E\u9000", forward: "\u524D\u8FDB", reload: "\u5237\u65B0\u9875\u9762", stopLoading: "\u505C\u6B62\u52A0\u8F7D", stop: "\u505C\u6B62 Agent", close: "\u5173\u95ED\u6807\u7B7E\u9875", closePanel: "\u5173\u95ED\u6D4F\u89C8\u5668", newTab: "\u65B0\u6807\u7B7E\u9875", home: "\u4E3B\u9875", session: "\u5F53\u524D\u4F1A\u8BDD", unavailable: "\u8BF7\u5728 DSH Desktop \u4E2D\u4F7F\u7528\u5171\u4EAB\u6D4F\u89C8\u5668\u3002", starting: "\u6B63\u5728\u8FDE\u63A5\u2026", connected: "\u5DF2\u8FDE\u63A5", offline: "Agent \u8FDE\u63A5\u5DF2\u65AD\u5F00", reconnect: "\u91CD\u65B0\u8FDE\u63A5", busy: "Agent \u6B63\u5728\u64CD\u4F5C", idle: "\u5C31\u7EEA", loading: "\u52A0\u8F7D\u4E2D\u2026", stopped: "\u5DF2\u505C\u6B62 Agent \u63A7\u5236", error: "\u6682\u65F6\u65E0\u6CD5\u5B8C\u6210\u6B64\u64CD\u4F5C", dismiss: "\u5173\u95ED\u63D0\u793A", startTitle: "\u4ECE\u8FD9\u91CC\u5F00\u59CB\u63A2\u7D22", startDescription: "\u6253\u5F00\u4E00\u4E2A\u7F51\u9875\uFF0C\u8BA9 Agent \u5E2E\u4F60\u64CD\u4F5C\uFF0C\u4E5F\u53EF\u4EE5\u76F4\u63A5\u5728\u9875\u9762\u4E0A\u7559\u4E0B\u53CD\u9988\u3002", shortcuts: "\u5FEB\u6377\u8BBF\u95EE", pageTitle: "\u65B0\u6807\u7B7E\u9875", sessionDetail: "\u6B64\u6D4F\u89C8\u5668\u8FDE\u63A5\u5230\u5F53\u524D\u804A\u5929\u4F1A\u8BDD\u3002", details: "\u8FDE\u63A5\u8BE6\u60C5", tabLimit: "\u6700\u591A\u53EF\u540C\u65F6\u6253\u5F00 12 \u4E2A\u6807\u7B7E\u9875\u3002", navigate: "\u6B63\u5728\u6253\u5F00\u7F51\u9875", snapshot: "\u6B63\u5728\u9605\u8BFB\u9875\u9762", act: "\u6B63\u5728\u64CD\u4F5C\u9875\u9762", screenshot: "\u6B63\u5728\u622A\u56FE", tabs: "\u6B63\u5728\u7BA1\u7406\u6807\u7B7E\u9875", secure: "HTTPS \u8FDE\u63A5", insecure: "HTTP \u8FDE\u63A5", retry: "\u91CD\u8BD5", settingsTitle: "X Browser", settingsIntro: "\u5171\u4EAB\u6D4F\u89C8\u5668\u9762\u677F\u7684\u504F\u597D\u8BBE\u7F6E\u3002", autoOpenLabel: "\u6D4F\u89C8\u5668\u5DE5\u5177\u9700\u8981\u65F6\u81EA\u52A8\u6253\u5F00\u9762\u677F", homeUrlLabel: "\u65B0\u6807\u7B7E\u9ED8\u8BA4\u4E3B\u9875", maxTabsLabel: "\u6700\u5927\u6807\u7B7E\u6570", saved: "\u5DF2\u4FDD\u5B58", saveFailed: "\u4FDD\u5B58\u5931\u8D25", settingsOutdated: "\u8BF7\u66F4\u65B0\u63D2\u4EF6\u540E\u518D\u7F16\u8F91\u8FD9\u4E9B\u8BBE\u7F6E" }
};

// src/client.js
var noopSubscribe = () => () => {
};
var h3 = import_react4.default.createElement;
var KIND = "dsh-agent-browser";
var ID = "dsh-browser";
var inject = ["slots", "locale", "sidebarRight", "sidebarRightTabs", "remote", "configForms"];
async function apply(ctx) {
  const namespace = "dshAgentBrowser", t = ctx.locale.bind(namespace);
  ctx.effect(() => ctx.locale.register(namespace, dictionaries));
  const localeSource = { subscribe: (listener) => ctx.locale.subscribe(listener), getSnapshot: () => ctx.locale.getSnapshot().active };
  await ctx.remote.$mount({ package: ID, descriptors: RPC });
  ctx.inject(["remote.dshBrowser", "workspaces", "configForms"], (scope) => {
    scope.effect(() => scope.sidebarRightTabs.register({ id: ID, kind: KIND, title: () => t("title"), keepMounted: true, guide: [{ id: "open", title: () => t("title"), description: () => t("description") }] }));
    scope.effect(() => scope.slots.inject("sidebar.right.pane.tab", () => scope.slots.register({ name: "sidebar.right.pane.tab", key: ID, locale: namespace, inject: (sessionId) => ({ sessionId, remote: scope.remote, workspaces: scope.workspaces, localeSource }) }, BrowserPanel)));
    scope.effect(() => {
      if (!scope.configForms) return () => {
      };
      const form = scope.configForms.get("dsh-x-browser");
      globalThis.__dshBrowserConfigForms = scope.configForms;
      const clearGlobal = () => {
        if (globalThis.__dshBrowserConfigForms === scope.configForms) delete globalThis.__dshBrowserConfigForms;
      };
      const SettingsPage = () => {
        const snapshot = import_react4.default.useSyncExternalStore(form.subscribe, form.getSnapshot, form.getSnapshot);
        const value = snapshot?.value ?? {};
        const [draftHome, setDraftHome] = import_react4.default.useState(value.homeUrl ?? "");
        const [notice, setNotice] = import_react4.default.useState("");
        import_react4.default.useEffect(() => {
          setDraftHome(value.homeUrl ?? "");
        }, [value.homeUrl]);
        const save = async (field, next) => {
          setNotice("");
          try {
            await scope.configForms.describe().load();
            const latest = form.getSnapshot();
            if (latest.status !== "ready") throw new Error(t("settingsOutdated"));
            if (!await form.set(field, next)) throw new Error(t("saveFailed"));
            setNotice(t("saved"));
          } catch (error) {
            setNotice(error?.message || t("saveFailed"));
          }
        };
        const row = { display: "flex", alignItems: "center", gap: 8, padding: "10px 0", borderBottom: "1px solid var(--dsw-alias-border-l3, #e8eaee)" };
        const input = { padding: "4px 8px", border: "1px solid var(--dsw-alias-border-l3, #e8eaee)", borderRadius: 6, background: "var(--dsw-alias-bg-base, #fff)", color: "inherit", minWidth: 220 };
        return h3(
          "section",
          { style: { padding: "4px 2px", display: "grid", gap: 4 } },
          h3("h2", { style: { margin: "0 0 4px", fontSize: 16 } }, t("settingsTitle")),
          h3("p", { style: { margin: "0 0 8px", opacity: 0.7, fontSize: 13 } }, t("settingsIntro")),
          h3("label", { style: row }, h3("input", { type: "checkbox", checked: value.autoOpen !== false, onChange: (event) => void save("autoOpen", event.target.checked) }), t("autoOpenLabel")),
          h3("label", { style: row }, h3("span", { style: { flex: 1 } }, t("homeUrlLabel")), h3("input", { type: "text", value: draftHome, placeholder: "https://\u2026", spellCheck: false, style: input, onChange: (event) => setDraftHome(event.target.value), onBlur: () => void save("homeUrl", draftHome) })),
          h3("label", { style: row }, h3("span", { style: { flex: 1 } }, t("maxTabsLabel")), h3("input", { type: "number", min: MIN_TABS, max: MAX_TABS, value: value.maxTabs ?? MAX_TABS, style: { ...input, minWidth: 90, width: 90 }, onChange: (event) => void save("maxTabs", Number(event.target.value)) })),
          notice && h3("p", { style: { margin: "8px 0 0", fontSize: 13, opacity: 0.8 } }, notice)
        );
      };
      const releaseSection = scope.slots.register({ name: "settings.section", id: "dsh-x-browser", order: 60, locale: namespace, label: () => t("settingsTitle") }, SettingsPage);
      const releaseIcon = scope.slots.register({ name: "settings.section.icon", id: "dsh-x-browser" }, ({ size = 16 } = {}) => h3(Icon, { name: "globe", size }));
      return () => {
        releaseSection();
        releaseIcon();
        clearGlobal();
      };
    });
    scope.effect(() => {
      let disposed = false, timer, inFlight = false;
      const tick = async () => {
        if (disposed) return;
        if (!inFlight) {
          inFlight = true;
          try {
            if (loadSettings().autoOpen) {
              const result = await scope.remote.dshBrowser.openRequested();
              if (result?.ok && result.value === true) {
                try {
                  ctx.sidebarRight.openTab(KIND);
                } catch {
                  try {
                    ctx.sidebarRight.toggleExpanded?.();
                    ctx.sidebarRight.openTab(KIND);
                  } catch {
                  }
                }
              }
            }
          } catch {
          }
          inFlight = false;
        }
        if (!disposed) timer = setTimeout(tick, 400);
      };
      timer = setTimeout(tick, 300);
      return () => {
        disposed = true;
        clearTimeout(timer);
      };
    });
  });
}
function BrowserPanel({ sessionId, remote, workspaces, useTabInfo, t, localeSource }) {
  const { tab } = useTabInfo();
  const locale = import_react4.default.useSyncExternalStore(localeSource?.subscribe ?? noopSubscribe, localeSource?.getSnapshot ?? (() => "en"), () => "en");
  const container = import_react4.default.useRef(null), controls = import_react4.default.useRef(null), address = import_react4.default.useRef(null);
  const [view, setView] = import_react4.default.useState({ activeTabId: null, tabs: [] });
  const { settings, open: settingsOpen, setOpen: setSettingsOpen, update: updateSettings } = usePanelSettings();
  const [agentPoint, setAgentPoint] = import_react4.default.useState(null), [cursorShown, setCursorShown] = import_react4.default.useState(false);
  const [homeDraft, setHomeDraft] = import_react4.default.useState(() => settings.homeUrl);
  const settingsLabels = String(locale).startsWith("zh") ? { settings: "\u8BBE\u7F6E", autoOpen: "\u9700\u8981\u65F6\u81EA\u52A8\u6253\u5F00\u9762\u677F", homeUrl: "\u65B0\u6807\u7B7E\u9ED8\u8BA4\u4E3B\u9875", maxTabs: "\u6700\u5927\u6807\u7B7E\u6570", note: "\u7F51\u7EDC\u6293\u5305\u4E0A\u9650\u5728\u8C03\u7528\u5DE5\u5177\u65F6\u6309\u9700\u6307\u5B9A\u3002" } : { settings: "Settings", autoOpen: "Open panel when needed", homeUrl: "New-tab home URL", maxTabs: "Max tabs", note: "Network capture limits are set per tool call." };
  const [draft, setDraft] = import_react4.default.useState(""), [search, setSearch] = import_react4.default.useState("");
  const [activity, setActivity] = import_react4.default.useState({ busy: false }), [connection, setConnection] = import_react4.default.useState("starting"), [error, setError] = import_react4.default.useState(""), [details, setDetails] = import_react4.default.useState(false), [marker, setMarker] = import_react4.default.useState(null);
  const active = view.tabs.find((entry) => entry.tabId === view.activeTabId);
  import_react4.default.useEffect(() => {
    setDraft(active?.url || "");
    setError("");
    setMarker(null);
  }, [active?.tabId, active?.url]);
  import_react4.default.useEffect(() => {
    const carrier = globalThis.dshDesktop, bridge = carrier?.protocolVersion === 1 ? carrier.browser : void 0;
    if (!bridge) {
      setConnection("unavailable");
      return;
    }
    const life = new AbortController();
    let manager, panelKey, timer, markerTimer, cursorTimer, closed = false, epoch = 0, admitting = true;
    const requests = /* @__PURE__ */ new Map();
    const cancelPending = (requestId) => {
      for (const [key, controller] of requests) if (!requestId || key === requestId) controller.abort(new Error("CANCELLED"));
      manager?.cancel(requestId);
    };
    const disconnect = async () => {
      if (panelKey) {
        const key = panelKey;
        panelKey = void 0;
        await call(remote, "disconnect", key).catch(() => {
        });
      }
    };
    const feedback = (event, tabId) => {
      if (closed || manager?.activeTabId !== tabId) return;
      if (Number.isFinite(event?.x) && Number.isFinite(event?.y)) setAgentPoint({ x: event.x, y: event.y });
      setCursorShown(true);
      clearTimeout(cursorTimer);
      cursorTimer = setTimeout(() => {
        if (!closed) setCursorShown(false);
      }, 2800);
      setMarker({ ...event, tabId, key: id() });
      clearTimeout(markerTimer);
      markerTimer = setTimeout(() => {
        if (!closed) setMarker(null);
      }, 1200);
    };
    const stop = async () => {
      admitting = false;
      cancelPending();
      void manager?.stopNetworkCaptures();
      setMarker(null);
      if (panelKey) {
        try {
          const result = await call(remote, "stop", panelKey);
          epoch = result.epoch;
          admitting = true;
        } catch (error2) {
          if (!closed) setError(error2.message);
        }
      }
    };
    const run = async (command) => {
      const passive = ["status", "inspect", "console", "network", "cap"].includes(command.operation) || command.operation === "tabs" && command.args.action === "list";
      const control = new AbortController();
      requests.set(command.id, control);
      try {
        if (!passive) {
        }
        control.signal.throwIfAborted();
        if (closed || !admitting || command.epoch !== epoch || command.expires <= Date.now()) return;
        const value = await manager.run({ ...command, signal: control.signal });
        if (!closed && panelKey && command.epoch === epoch) await call(remote, "reply", panelKey, command.id, command.epoch, { ok: true, value });
      } catch (error2) {
        if (!closed && panelKey && command.epoch === epoch) await call(remote, "reply", panelKey, command.id, command.epoch, { ok: false, error: String(error2.message).slice(0, 1e3) }).catch(() => {
        });
      } finally {
        if (requests.get(command.id) === control) requests.delete(command.id);
        if (!passive && !closed) setMarkerRevision((value) => value + 1);
      }
    };
    const poll = async () => {
      if (closed || !panelKey) return;
      try {
        const { commands } = await call(remote, "poll", panelKey);
        if (closed) return;
        for (const command of commands) {
          if (command.kind === "stop") {
            epoch = command.epoch;
            cancelPending();
            void manager?.stopNetworkCaptures();
            setMarker(null);
          } else if (command.kind === "cancel") cancelPending(command.id);
        }
        const cancelled = new Set(commands.filter((c) => c.kind === "cancel").map((c) => c.id));
        for (const command of commands) if (command.kind === "request" && admitting && !cancelled.has(command.id) && command.epoch === epoch) void run(command);
        timer = setTimeout(poll, 250);
      } catch (error2) {
        manager?.cancel();
        void manager?.stopNetworkCaptures();
        if (!closed) {
          setConnection("offline");
          setError("");
        }
        await disconnect();
      }
    };
    const connect = async () => {
      if (panelKey || closed) return;
      try {
        setConnection("starting");
        const result = await call(remote, "connect", sessionId, id());
        panelKey = result.key;
        if (closed) {
          await disconnect();
          return;
        }
        epoch = 0;
        setConnection("connected");
        void poll();
      } catch (error2) {
        if (!closed) {
          setConnection("offline");
          setError(error2.message);
        }
      }
    };
    const initialize = async () => {
      try {
        const workspace = await workspaceIdentity(workspaces.list, sessionId, life.signal);
        const prefs = loadSettings();
        manager = new SessionTabs({
          workspace,
          signal: life.signal,
          maxTabs: prefs.maxTabs,
          createContainer(tabId) {
            const node = document.createElement("div");
            node.className = "ab-page";
            node.dataset.browserTab = tabId;
            container.current.appendChild(node);
            return node;
          },
          createPage(node, update, invalidate, tabId) {
            const page = new ElectronPage(bridge, node, location.origin, update, invalidate, { onInput: (event) => feedback(event, tabId), onOpen: (url) => {
              manager.cancel();
              return manager.newTab(url);
            } });
            return page;
          },
          onChange: (next) => {
            if (!closed) setView(next);
          },
          onActivity: (next) => {
            if (!closed) setActivity(next);
          }
        });
        await manager.newTab(prefs.homeUrl || void 0);
        life.signal.throwIfAborted();
        await connect();
      } catch (error2) {
        if (!closed) {
          setConnection("offline");
          setError(error2.message);
        }
      }
    };
    void initialize();
    const unbind = tab.actions.bindCommands({ refresh: () => {
      void manager?.navigate("reload").catch((e) => setError(e.message));
    } });
    const cleanup = () => {
      if (closed) return;
      closed = true;
      clearTimeout(timer);
      clearTimeout(markerTimer);
      clearTimeout(cursorTimer);
      life.abort();
      cancelPending();
      controls.current = null;
      void disconnect();
      void manager?.dispose().catch(() => {
      });
      unbind?.();
    };
    tab.signal.addEventListener("abort", cleanup, { once: true });
    window.addEventListener("pagehide", cleanup);
    return () => {
      tab.signal.removeEventListener("abort", cleanup);
      window.removeEventListener("pagehide", cleanup);
      cleanup();
    };
  }, [sessionId, remote, workspaces, tab.signal, tab.actions]);
  const perform = async (action) => {
    controls.current?.cancel();
    setError("");
    try {
      await action();
    } catch (error2) {
      if (error2?.name !== "AbortError") setError(error2.message);
    }
  };
  const navigate = (action, value) => perform(() => controls.current?.manager.navigate(action, action === "open" ? addressUrl(value) : void 0));
  const newTab = () => perform(async () => {
    controls.current?.manager.cancel();
    await controls.current?.manager.newTab(loadSettings().homeUrl || void 0);
    requestAnimationFrame(() => address.current?.focus());
  });
  const select = (tabId) => perform(() => controls.current?.manager.select(tabId));
  const close = (tabId) => perform(() => controls.current?.manager.close(tabId));
  const iconButton = (key, icon, action, disabled = false, extra = {}) => h3("button", { type: "button", className: "ab-icon", onClick: action, disabled, title: t(key), "aria-label": t(key), ...extra }, h3(Icon, { name: icon }));
  const tabName = (entry) => entry.title || (entry.url ? (() => {
    try {
      return new URL(entry.url).hostname;
    } catch {
      return entry.url;
    }
  })() : t("pageTitle"));
  const blank = !active?.url;
  return h3(
    "section",
    { "data-dsh-agent-browser": "", "aria-label": t("title") },
    h3("style", null, shellCss),
    h3(
      "div",
      { className: "ab-tabs" },
      h3("div", { className: "ab-tabscroll", role: "tablist", "aria-label": t("title") }, view.tabs.map((entry) => h3(
        "div",
        { className: "ab-tab", key: entry.tabId, "data-active": String(entry.tabId === view.activeTabId) },
        h3("button", { type: "button", className: "ab-tab-label", role: "tab", "aria-selected": entry.tabId === view.activeTabId, title: entry.url || t("pageTitle"), onClick: () => select(entry.tabId), onKeyDown: (event) => {
          if (["ArrowLeft", "ArrowRight"].includes(event.key)) {
            event.preventDefault();
            const index = view.tabs.findIndex((e) => e.tabId === entry.tabId);
            const next = view.tabs[(index + (event.key === "ArrowLeft" ? -1 : 1) + view.tabs.length) % view.tabs.length];
            void select(next.tabId);
            event.currentTarget.parentElement.parentElement.querySelectorAll("[role=tab]")[(index + (event.key === "ArrowLeft" ? -1 : 1) + view.tabs.length) % view.tabs.length]?.focus();
          }
        } }, h3(Icon, { name: entry.loading ? "reload" : "globe", size: 13, className: entry.loading ? "ab-spinner" : void 0 }), h3("span", null, tabName(entry))),
        h3("button", { className: "ab-close", type: "button", onClick: () => close(entry.tabId), title: `${t("close")} \xB7 ${tabName(entry)}`, "aria-label": `${t("close")} \xB7 ${tabName(entry)}` }, h3(Icon, { name: "close", size: 12 }))
      ))),
      iconButton("newTab", "plus", newTab, view.tabs.length >= (settings.maxTabs || MAX_TABS))
    ),
    h3(
      "form",
      { className: "ab-toolbar", onSubmit: (event) => {
        event.preventDefault();
        void navigate("open", draft);
      } },
      iconButton("back", "back", () => navigate("back"), !active?.canGoBack),
      iconButton("forward", "forward", () => navigate("forward"), !active?.canGoForward),
      active?.loading ? iconButton("stopLoading", "close", () => {
        controls.current?.manager.current().page.stop();
      }) : iconButton("reload", "reload", () => navigate("reload"), blank),
      h3(
        "label",
        { className: "ab-address" },
        h3(Icon, { name: active?.url?.startsWith("https:") ? "lock" : "globe", size: 13 }),
        h3("input", { ref: address, value: draft, placeholder: t("address"), "aria-label": t("address"), spellCheck: false, onFocus: (event) => event.currentTarget.select(), onChange: (event) => setDraft(event.target.value), onKeyDown: (event) => {
          if (event.key === "Escape") {
            setDraft(active?.url || "");
            event.currentTarget.blur();
          }
        } }),
        h3("button", { type: "submit", className: "ab-icon ab-go", title: t("go"), "aria-label": t("go") }, h3(Icon, { name: "arrow", size: 14 }))
      ),
      iconButton("settings", "gear", () => setSettingsOpen((open) => !open), false, { "aria-pressed": settingsOpen }),
      activity.busy && h3("div", { className: "ab-agent-badge", "aria-live": "polite" }, String(locale).startsWith("zh") ? "Agent \u64CD\u4F5C\u4E2D" : "Agent controlling"),
      active?.loading && h3("div", { className: "ab-progress", "aria-hidden": true })
    ),
    settingsOpen && h3(
      "div",
      { className: "ab-settings", role: "group", "aria-label": settingsLabels.settings, style: { display: "grid", gap: 8, padding: "10px 12px", borderBottom: "1px solid var(--ab-border)", background: "var(--ab-layer)" } },
      h3("label", { style: { display: "flex", alignItems: "center", gap: 8 } }, h3("input", { type: "checkbox", checked: settings.autoOpen, onChange: (event) => updateSettings({ autoOpen: event.target.checked }) }), settingsLabels.autoOpen),
      h3("label", { style: { display: "grid", gap: 4 } }, settingsLabels.homeUrl, h3("input", { type: "text", value: homeDraft, placeholder: "https://\u2026", spellCheck: false, onChange: (event) => setHomeDraft(event.target.value), onBlur: () => {
        const next = updateSettings({ homeUrl: homeDraft });
        setHomeDraft(next.homeUrl);
      }, style: { padding: "4px 6px", border: "1px solid var(--ab-border)", borderRadius: 6, background: "var(--ab-bg)", color: "var(--ab-text)" } })),
      h3("label", { style: { display: "grid", gap: 4 } }, settingsLabels.maxTabs, h3("input", { type: "number", min: MIN_TABS, max: MAX_TABS, value: settings.maxTabs, onChange: (event) => updateSettings({ maxTabs: Number(event.target.value) }), style: { width: 90, padding: "4px 6px", border: "1px solid var(--ab-border)", borderRadius: 6, background: "var(--ab-bg)", color: "var(--ab-text)" } })),
      h3("span", { style: { color: "var(--ab-muted)", fontSize: 12 } }, settingsLabels.note)
    ),
    (error || active?.error) && h3("div", { className: "ab-error", role: "alert" }, h3(Icon, { name: "info", size: 15 }), h3("span", null, error || active.error), iconButton("dismiss", "close", () => {
      setError("");
      controls.current?.manager.current().page.emit({ error: "" });
    })),
    h3(
      "div",
      { className: "ab-viewport" },
      h3("div", { ref: container, className: "ab-pages" }),
      blank && h3("div", { className: "ab-start" }, h3(
        "div",
        { className: "ab-start-inner" },
        h3("div", { className: "ab-start-mark" }, h3(Icon, { name: "globe", size: 32 })),
        h3("h2", null, t("startTitle")),
        h3("p", null, t("startDescription")),
        h3("form", { className: "ab-start-search", onSubmit: (event) => {
          event.preventDefault();
          void navigate("open", search);
        } }, h3(Icon, { name: "search", size: 18 }), h3("input", { value: search, placeholder: t("address"), "aria-label": t("address"), spellCheck: false, onChange: (event) => setSearch(event.target.value) }), h3("button", { type: "submit", className: "ab-icon", title: t("go"), "aria-label": t("go") }, h3(Icon, { name: "arrow" }))),
        h3("nav", { className: "ab-shortcuts", "aria-label": t("shortcuts") }, [["DSH", "D", "https://github.com/deepseek-ai/deepseek-harness"], ["MDN", "M", "https://developer.mozilla.org/"], ["Wikipedia", "W", "https://www.wikipedia.org/"]].map(([label, letter, url]) => h3("button", { type: "button", key: label, className: "ab-shortcut", onClick: () => navigate("open", url) }, h3("b", null, letter), label)))
      )),
      h3(AgentCursor, { point: agentPoint, visible: cursorShown || activity.busy || marker && marker.tabId === view.activeTabId }),
      h3(ClickMarker, { marker: marker && marker.tabId === view.activeTabId ? marker : null })
    ),
    h3(
      "div",
      { className: "ab-footer" },
      h3(
        "div",
        { className: "ab-status", role: "status", "aria-live": "polite" },
        activity.busy ? h3("span", { className: "ab-agent" }, h3(Icon, { name: "spark", size: 13 }), t(activity.operation || "busy")) : h3(import_react4.default.Fragment, null, h3("span", { className: "ab-dot", style: { opacity: connection === "connected" ? 1 : 0.3 } }), t(connection)),
        connection === "offline" && h3("button", { className: "ab-stop", onClick: () => controls.current?.connect() }, t("reconnect"))
      ),
      activity.busy ? h3("button", { className: "ab-stop", onClick: () => controls.current?.stop(), title: t("stop") }, h3(Icon, { name: "stop", size: 10 }), t("stop")) : h3("button", { className: "ab-session", title: t("details"), onClick: () => setDetails((value) => !value) }, h3(Icon, { name: "lock", size: 11 }), t("session"))
    ),
    details && h3("div", { className: "ab-info" }, t("sessionDetail"), h3("br"), sessionId, h3("br"), h3("button", { className: "ab-session", onClick: () => tab.actions.close() }, t("closePanel")))
  );
}

return module.exports;}});
