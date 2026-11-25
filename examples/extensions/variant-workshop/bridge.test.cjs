const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { randomUUID } = require("node:crypto");
const { JSDOM } = require("../../../web/node_modules/jsdom");
const root = path.resolve(__dirname, "../../..");

function transportHarness() {
  const windows = [];
  const sent = [];
  let hostPort, childPort;
  class MessageChannel {
    constructor() {
      const makePort = () => ({
        started: false,
        closed: false,
        addEventListener(name, listener) {
          this[`on${name}`] = listener;
        },
        removeEventListener(name) {
          this[`on${name}`] = null;
        },
        start() {
          this.started = true;
        },
        close() {
          this.closed = true;
        },
        postMessage(data, ports = []) {
          if (!this.closed && !this.peer.closed)
            this.peer.onmessage?.({ data, ports });
        },
      });
      this.port1 = childPort = makePort();
      this.port2 = makePort();
      this.port1.peer = this.port2;
      this.port2.peer = this.port1;
    }
  }
  const parent = {
    postMessage(message, origin, ports) {
      windows.push(message);
      assert.equal(message.type, "mio:panel:ready");
      assert.equal(message.version, 2);
      assert.equal(origin, "*");
      assert.equal(ports.length, 1);
      hostPort = ports[0];
      hostPort.addEventListener("message", ({ data }) => sent.push(data));
      hostPort.start();
    },
  };
  return {
    parent,
    MessageChannel,
    sent,
    windows,
    send: (data, ports = []) =>
      hostPort.postMessage({ session: "fixture", ...data }, ports),
    get child() {
      return childPort;
    },
  };
}

async function standalone(relative, name) {
  const host = transportHarness();
  const listeners = {};
  const window = {};
  const timers = new Map();
  let timer = 0;
  vm.runInNewContext(fs.readFileSync(path.join(root, relative), "utf8"), {
    window,
    parent: host.parent,
    MessageChannel: host.MessageChannel,
    location: { hash: "#mio-session=fixture" },
    URLSearchParams,
    Blob,
    URL,
    crypto: { randomUUID },
    document: { images: [] },
    addEventListener: (type, listener) => {
      listeners[type] = listener;
    },
    setTimeout: (listener) => {
      timers.set(++timer, listener);
      return timer;
    },
    clearTimeout: (id) => timers.delete(id),
  });
  assert.equal(host.child.started, true, relative);
  const api = window[name];
  let receivedContext;
  if (name === "MotionBridge")
    api.ready((value) => {
      receivedContext = value;
    });
  const appearance = {
    tokens: { bg: "#17191b", accent: "#e0a070" },
    theme: "dark",
    locale: "en",
  };
  const init = {
    type: "mio:panel:init",
    version: 2,
    context: { episode_id: "episode" },
    appearance,
  };
  listeners.message?.({
    source: host.parent,
    data: { session: "fixture", ...init },
  });
  await assert.rejects(
    api.request("episode"),
    /./,
    "window init must not connect the SDK",
  );
  host.send(init);
  if (name === "MotionBridge") {
    assert.equal(receivedContext.episode_id, "episode");
    assert.deepEqual(
      receivedContext.appearance,
      appearance,
      "first init carries appearance",
    );
  }
  const request = api.request("episode");
  const call = host.sent.at(-1);
  assert.equal(call.type, "mio:panel:request");
  assert.equal(call.version, 2);
  host.send({
    type: "mio:panel:response",
    version: 2,
    rid: call.rid,
    ok: true,
    data: { id: "episode" },
  });
  assert.equal((await request).id, "episode");
  api.release("unknown");
  assert.equal(host.sent.at(-1).type, "mio:panel:release");
  listeners.pagehide();
  assert.equal(host.child.closed, true);
  assert.equal(timers.size, 0);
  assert.equal(host.windows.length, 1, "only ready uses the window channel");
}

function creationInspector() {
  const dir = path.join(root, "examples/extensions/creation-inspector");
  const dom = new JSDOM(fs.readFileSync(path.join(dir, "panel.html"), "utf8"), {
    url: "https://panel.invalid/#mio-session=fixture",
    runScripts: "outside-only",
  });
  const w = dom.window;
  const host = transportHarness();
  Object.defineProperty(w, "parent", { value: host.parent });
  Object.defineProperty(w, "MessageChannel", { value: host.MessageChannel });
  Object.defineProperty(w.crypto, "randomUUID", { value: randomUUID });
  w.eval(fs.readFileSync(path.join(dir, "panel.js"), "utf8"));
  assert.equal(host.child.started, true);
  const init = {
    type: "mio:panel:init",
    version: 2,
    context: { episode_id: "episode" },
  };
  w.dispatchEvent(
    new w.MessageEvent("message", {
      source: host.parent,
      data: { session: "fixture", ...init },
    }),
  );
  assert.equal(host.sent.length, 0, "window init must not subscribe");
  host.send(init);
  assert.equal(host.sent.length, 2);
  assert.ok(
    host.sent.every(
      (message) =>
        message.type === "mio:creation:subscribe" &&
        message.version === 1 &&
        message.enabled,
    ),
  );
  host.send({
    type: "mio:creation:event",
    version: 1,
    event: "selection.changed",
    activation: "active",
    digest: "a".repeat(64),
    context: {
      version: 1,
      context_id: "context-a",
      seq: 1,
      route: "script",
      series_id: null,
      episode_id: "episode",
      selection: { kind: "panels", ids: ["panel-a"], truncated: false },
      revisions: { episode: 4 },
    },
  });
  assert.equal(w.document.getElementById("selection-count").textContent, "1");
  w.document.getElementById("read").click();
  const request = host.sent.at(-1);
  assert.equal(request.type, "mio:panel:request");
  assert.equal(request.version, 2);
  host.send({
    type: "mio:panel:response",
    version: 2,
    rid: request.rid,
    ok: true,
    data: { id: "episode", revision: 4 },
  });
  assert.ok(w.document.getElementById("read-result").textContent.includes("4"));
  w.dispatchEvent(new w.Event("pagehide"));
  assert.equal(host.child.closed, true);
  assert.equal(host.windows.length, 1);
  assert.ok(
    host.sent
      .slice(-2)
      .every(
        (message) =>
          message.type === "mio:creation:subscribe" &&
          message.version === 1 &&
          !message.enabled,
      ),
  );
  w.close();
}

async function main() {
  for (const [file, api] of [
    ["extensions/variant-workshop/bridge.js", "panelBridge"],
    ["examples/extensions/variant-workshop/bridge.js", "panelBridge"],
    ["extensions/motion-studio/bridge.js", "MotionBridge"],
    ["examples/extensions/motion-studio/bridge.js", "MotionBridge"],
  ])
    await standalone(file, api);
  creationInspector();
  console.log(
    "document-bound panel transport: standalone SDK copies, context events, window isolation and cleanup passed",
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
