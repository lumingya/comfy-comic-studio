const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { randomUUID } = require("node:crypto");
const source = fs.readFileSync(`${__dirname}/../workspace.js`, "utf8");
const plain = (value) => JSON.parse(JSON.stringify(value));
const flush = async () => { for (let i = 0; i < 4; i++) await Promise.resolve(); };

function ports() {
  const makePort = () => ({
    closed: false, started: false, listeners: new Map(),
    addEventListener(type, listener) { this.listeners.set(type, listener); },
    start() { this.started = true; },
    close() { this.closed = true; },
    postMessage(data, transfer = []) {
      if (!this.closed && !this.peer.closed) this.peer.emit("message", { data, ports: transfer });
    },
    emit(type, event) { if (!this.closed) this.listeners.get(type)?.(event); },
  });
  const one = makePort(), two = makePort();
  one.peer = two;
  two.peer = one;
  return [one, two];
}

function harness() {
  const listeners = new Map(), styles = new Map(), sent = [], windows = [];
  const created = [], revoked = [], timers = new Map(), bitmaps = [];
  const bitmap = { width: 16, height: 16 };
  const root = { lang: "zh-CN", dataset: {}, style: { setProperty: (key, value) => styles.set(key, value) } };
  const document = {
    documentElement: root, images: [], querySelectorAll: () => [], getElementById: () => null,
    dispatchEvent(event) { this.lastEvent = event; },
  };
  let hostPort, childPort, timerId = 0;
  class MessageChannel {
    constructor() { [this.port1, this.port2] = ports(); childPort = this.port1; }
  }
  const parent = {
    postMessage(message, origin, transfer) {
      windows.push({ message, origin, transfer });
      assert.equal(message.type, "mio:panel:ready");
      assert.equal(message.version, 2);
      assert.equal(origin, "*");
      assert.equal(transfer.length, 1);
      hostPort = transfer[0];
      hostPort.addEventListener("message", ({ data }) => sent.push(data));
      hostPort.start();
    },
  };
  const window = {};
  vm.runInNewContext(source, {
    window, parent, document, MessageChannel, URLSearchParams, Blob, TextEncoder,
    location: { hash: "#mio-session=session-a" }, crypto: { randomUUID },
    HTMLInputElement: class {}, HTMLTextAreaElement: class {},
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init.detail; } },
    addEventListener: (name, listener) => listeners.set(name, listener),
    fetch: () => assert.fail("sandbox transport must never fetch directly"),
    URL: {
      createObjectURL(blob) { const url = `blob:panel-${created.length}`; created.push({ blob, url }); return url; },
      revokeObjectURL: (url) => revoked.push(url),
    },
    createImageBitmap: async (blob) => {
      const image = { ...bitmap, blob, closed: false, close() { this.closed = true; } };
      bitmaps.push(image);
      return image;
    },
    setTimeout: (listener) => { timers.set(++timerId, listener); return timerId; },
    clearTimeout: (id) => timers.delete(id),
  });
  const send = (data, transfer = []) => hostPort.postMessage({ version: 2, session: "session-a", ...data }, transfer);
  const respond = (request, data = {}, status = 200) => send({
    type: "mio:panel:response", rid: request.rid, status, ok: status >= 200 && status < 300, data,
  });
  const dispose = () => {
    listeners.get("pagehide")();
    assert.equal(childPort.closed, true);
    assert.equal(timers.size, 0);
    assert.equal(windows.length, 1, "only ready may use window messages");
  };
  return {
    api: window.MioRetouch, root, document, styles, sent, windows, created, revoked,
    timers, bitmap, bitmaps, childPort, listeners, parent, send, respond, dispose,
    init: (appearance = {}) => send({ type: "mio:panel:init", context: { episode_id: "ep" }, appearance }),
    windowMessage: (data) => listeners.get("message")?.({ source: parent, origin: "https://mio.local", data }),
  };
}

async function handshakeAndAppearance() {
  const h = harness();
  try {
    assert.equal(h.windows[0].message.session, "session-a");
    assert.equal(h.windows[0].transfer[0].peer, h.childPort);
    assert.equal(h.childPort.started, true);
    assert.equal(h.listeners.has("message"), false, "no window business-message fallback");
    const queued = h.api.get("profiles");
    assert.equal(h.sent.length, 0, "calls queue until init arrives over the port");
    h.windowMessage({ type: "mio:panel:init", version: 2, session: "session-a", appearance: { locale: "en" } });
    h.send({ type: "mio:panel:init", session: "stale" });
    h.send({ type: "mio:panel:init", version: 1 });
    assert.equal(h.sent.length, 0);
    assert.equal(h.api.text("title"), "单格精修");
    assert.match(h.api.text("maskHint"), /Space\/Enter/);
    assert.match(h.api.text("maskCursor", { tool: "画笔", x: 2, y: 3, width: 320, height: 160, state: "就绪" }), /画笔游标：2, 3 \/ 320 × 160 px。就绪/);
    h.init({ locale: "en-US", theme: "dark", tokens: { accent: "#123456", text: "#fefefe", bg: "#111111" } });
    assert.equal(h.api.text("title"), "Panel retouch");
    assert.match(h.api.text("maskIdle"), /Shift\+arrows move 10 px/);
    assert.match(h.api.text("maskDrawing"), /Esc cancels/);
    assert.equal(h.root.dataset.theme, "dark");
    assert.equal(h.root.lang, "en");
    assert.equal(h.styles.get("--accent"), "#123456", "appearance uses unprefixed protocol token names");
    assert.equal(h.styles.get("--ink"), "#fefefe");
    assert.equal(h.styles.get("--canvas"), "#111111");
    assert.equal(h.document.lastEvent.type, "mio-context");
    const request = h.sent.at(-1);
    assert.equal(request.request_id, "profiles");
    let settled = false;
    queued.then(() => { settled = true; });
    h.windowMessage({ type: "mio:panel:response", version: 2, session: "session-a", rid: request.rid, ok: true, data: ["injected"] });
    await flush();
    assert.equal(settled, false);
    h.respond(request, ["profile-a"]);
    assert.deepEqual(plain(await queued), ["profile-a"]);
    const count = h.sent.length;
    h.send({ type: "mio:panel:appearance", appearance: { locale: "zh-CN", theme: "light", tokens: { accent: "#abcdef" } } });
    assert.equal(h.api.text("title"), "单格精修");
    assert.equal(h.styles.get("--accent"), "#abcdef");
    assert.equal(h.sent.length, count, "appearance updates never call an API");
  } finally { h.dispose(); }
}

async function declaredRoutesAndErrors() {
  const h = harness();
  h.init();
  try {
    for (const [path, method, id, params, query, body] of [
      ["series", "GET", "series", {}, {}],
      ["series/work%20a/episodes", "GET", "episodes", { series_id: "work a" }, {}],
      ["episodes/ep", "GET", "episode", { episode_id: "ep" }, {}],
      ["profiles", "GET", "profiles", {}, {}],
      ["episodes/ep/edit", "POST", "edit", { episode_id: "ep" }, {}, { kind: "inpaint" }],
      ["jobs?owner=panel-retouch&state=queued", "GET", "jobs", {}, { owner: "panel-retouch", state: "queued" }],
      ["jobs/job-a", "GET", "job", { job_id: "job-a" }, {}],
      ["jobs/job-a/cancel", "POST", "cancel", { job_id: "job-a" }, {}, {}],
      ["episodes/ep/takes/take-a/adopt", "POST", "adopt", { episode_id: "ep", take_id: "take-a" }, {}, {}],
    ]) {
      const pending = h.api.request(`/api/${path}`, { method, headers: { Authorization: "ignored" }, ...(body ? { body: JSON.stringify(body) } : {}) });
      const request = h.sent.at(-1);
      assert.deepEqual(plain(request), {
        version: 2, session: "session-a", type: "mio:panel:request", request_id: id,
        path_params: params, query, ...(body ? { body } : {}), rid: request.rid,
      });
      h.respond(request, { id });
      assert.equal((await (await pending).json()).id, id);
    }
    const count = h.sent.length;
    for (const [path, init] of [
      ["https://outside.invalid"], ["/api/profiles#fragment"], ["/api/tokens"],
      ["/api/ext/other/run"], ["/api/assets", { method: "POST" }],
      ["/api/profiles", { method: "POST" }], ["/api/episodes/ep/edit", { method: "GET" }],
    ]) await assert.rejects(h.api.request(path, init), /Only declared panel requests/);
    assert.equal(h.sent.length, count, "undeclared paths and methods never enter the bridge");
    const failed = h.api.get("profiles");
    h.respond(h.sent.at(-1), { detail: "offline" }, 503);
    await assert.rejects(failed, (error) => error.status === 503 && error.message === "offline");
    const fallback = h.api.get("profiles");
    h.respond(h.sent.at(-1), {}, 500);
    await assert.rejects(fallback, (error) => error.status === 500 && error.message === "HTTP 500");
  } finally { h.dispose(); }
}

async function imageDeliveryAndRelease() {
  const h = harness();
  h.init();
  const blob = new Blob(["png"], { type: "image/png" });
  const begin = () => {
    const pending = h.api.request("/api/episodes/ep/takes/take-a/image");
    const request = h.sent.at(-1), [host, child] = ports();
    assert.equal(request.request_id, "image");
    assert.deepEqual(plain(request.path_params), { episode_id: "ep", take_id: "take-a" });
    h.send({ type: "mio:panel:media", rid: request.rid, media_id: request.rid, mime: blob.type, bytes: blob.size }, [child]);
    assert.equal(child.started, true);
    return { pending, request, host, child };
  };
  try {
    const first = begin();
    first.host.postMessage({ type: "image", blob });
    const response = await first.pending;
    assert.equal(await response.blob(), blob);
    assert.equal(response.url, "blob:panel-0");
    const image = { src: response.url, removeAttribute(name) { delete this[name]; } };
    h.document.images.push(image);
    h.api.release(response.url);
    assert.equal(image.src, undefined);
    assert.deepEqual(h.revoked, [response.url]);
    assert.equal(first.child.closed, true);
    assert.equal(h.sent.at(-1).type, "mio:panel:release");
    assert.equal(h.sent.at(-1).media_id, first.request.rid);
    const revoked = begin();
    const rejected = assert.rejects(revoked.pending, /revoked/);
    revoked.host.postMessage({ type: "revoke" });
    await rejected;
    assert.equal(revoked.child.closed, true);
    const invalid = begin();
    const invalidResult = assert.rejects(invalid.pending, /Invalid panel image/);
    invalid.host.postMessage({ type: "image", blob: new Blob(["wrong"], { type: "image/jpeg" }) });
    await invalidResult;
    assert.equal(invalid.child.closed, true);
    const [orphanHost, orphan] = ports();
    h.send({ type: "mio:panel:media", rid: "unknown", media_id: "orphan", mime: "image/png", bytes: 3 }, [orphan]);
    assert.equal(orphan.closed, true);
    assert.equal(h.sent.at(-1).media_id, "orphan");
    assert.equal(h.sent.at(-1).type, "mio:panel:release");
    orphanHost.close();
    const completed = begin();
    completed.host.postMessage({ type: "image", blob });
    const displayed = await completed.pending;
    completed.host.postMessage({ type: "revoke" });
    assert.ok(h.revoked.includes(displayed.url));
    assert.equal(completed.child.closed, true);
  } finally { h.dispose(); }
}

async function uploadBounds() {
  const h = harness();
  h.init();
  const blob = new Blob(["png"], { type: "image/png" });
  const sized = (bytes) => { const value = new Blob(["png"], { type: "image/png" }); Object.defineProperty(value, "size", { value: bytes }); return value; };
  try {
    const metadataBase = { version: 2, session: "session-a", type: "mio:panel:upload", rid: "0".repeat(36), filename: "", request_id: "upload-mask" };
    const overhead = new TextEncoder().encode(JSON.stringify(metadataBase)).byteLength;
    const filename = "a".repeat(65536 - overhead);
    h.bitmap.width = h.bitmap.height = 4096;
    const largest = sized(32 * 1024 * 1024);
    const accepted = h.api.upload(largest, filename);
    await flush();
    const request = h.sent.at(-1);
    assert.equal(request.type, "mio:panel:upload");
    assert.equal(request.version, 2);
    assert.equal(request.session, "session-a");
    assert.equal(request.request_id, "upload-mask");
    assert.equal(request.blob, largest);
    assert.equal(request.filename, filename);
    assert.equal(new TextEncoder().encode(JSON.stringify({ ...metadataBase, filename })).byteLength, 65536);
    h.respond(request, { id: "asset-mask" });
    assert.equal((await accepted).id, "asset-mask");
    assert.equal(h.bitmaps.at(-1).closed, true);
    const count = h.sent.length;
    await assert.rejects(h.api.upload({}, "mask.png"), /image allowance/);
    await assert.rejects(h.api.upload(new Blob([], { type: "image/png" }), "mask.png"), /image allowance/);
    await assert.rejects(h.api.upload(new Blob(["text"], { type: "text/plain" }), "mask.png"), /image allowance/);
    await assert.rejects(h.api.upload(sized(32 * 1024 * 1024 + 1), "mask.png"), /image allowance/);
    await assert.rejects(h.api.upload(blob, filename + "a"), /metadata exceeds 64 KiB/);
    await assert.rejects(h.api.upload(blob, "é".repeat(32768)), /metadata exceeds 64 KiB/);
    await assert.rejects(h.api.upload(blob, ""), /metadata exceeds 64 KiB/);
    h.bitmap.width = 4097;
    await assert.rejects(h.api.upload(blob, "mask.png"), /pixel allowance/);
    assert.equal(h.bitmaps.at(-1).closed, true);
    h.bitmap.width = 0;
    await assert.rejects(h.api.upload(blob, "mask.png"), /pixel allowance/);
    assert.equal(h.sent.length, count, "oversized or invalid uploads never reach the host");
  } finally { h.dispose(); }
}

async function disposal() {
  const h = harness();
  h.init();
  const image = new Blob(["png"], { type: "image/png" });
  const displayed = h.api.request("/api/episodes/ep/takes/shown/image");
  const displayedRequest = h.sent.at(-1), [displayHost, displayPort] = ports();
  h.send({ type: "mio:panel:media", rid: displayedRequest.rid, media_id: "shown", mime: image.type, bytes: image.size }, [displayPort]);
  displayHost.postMessage({ type: "image", blob: image });
  const displayedResponse = await displayed;
  const loading = h.api.request("/api/episodes/ep/takes/loading/image");
  const loadingRequest = h.sent.at(-1), [loadingHost, loadingPort] = ports();
  h.send({ type: "mio:panel:media", rid: loadingRequest.rid, media_id: "loading", mime: image.type, bytes: image.size }, [loadingPort]);
  const loadingRejected = assert.rejects(loading, /Panel session ended/);
  const pending = h.api.get("profiles");
  const rejected = assert.rejects(pending, /Panel session ended/);
  const count = h.sent.length;
  h.dispose();
  await Promise.all([rejected, loadingRejected]);
  assert.equal(displayPort.closed, true);
  assert.equal(loadingPort.closed, true);
  assert.ok(h.revoked.includes(displayedResponse.url));
  const urls = h.created.length;
  loadingHost.postMessage({ type: "image", blob: image });
  assert.equal(h.created.length, urls, "late image bytes cannot create a URL after pagehide");
  await assert.rejects(h.api.get("profiles"), /Panel session is unavailable/);
  assert.equal(h.sent.length, count);
  const queued = harness();
  const beforeInit = queued.api.get("profiles");
  const canceled = assert.rejects(beforeInit, /Panel session ended/);
  queued.dispose();
  await canceled;
  assert.equal(queued.sent.length, 0);
}

async function main() {
  await handshakeAndAppearance();
  await declaredRoutesAndErrors();
  await imageDeliveryAndRelease();
  await uploadBounds();
  await disposal();
  console.log("panel-retouch: document port, declared routes, canonical appearance, media, upload bounds and disposal passed");
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
