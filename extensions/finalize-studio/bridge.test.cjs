const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { randomUUID } = require("node:crypto");

async function main() {
  const listeners = {},
    sent = [],
    created = [],
    revoked = [],
    timers = new Map();
  const parent = {
    postMessage(message) {
      sent.push(message);
    },
  };
  const window = {};
  let timerId = 0;
  vm.runInNewContext(fs.readFileSync(__dirname + "/bridge.js", "utf8"), {
    window,
    parent,
    location: { hash: "#mio-session=test-session" },
    URLSearchParams,
    Blob,
    URL: {
      createObjectURL(blob) {
        assert.ok(blob instanceof Blob);
        const url = `blob:panel-${created.length}`;
        created.push(url);
        return url;
      },
      revokeObjectURL(url) {
        revoked.push(url);
      },
    },
    crypto: { randomUUID },
    document: {
      getElementById() {
        return { textContent: "" };
      },
    },
    addEventListener(name, fn) {
      listeners[name] = fn;
    },
    setTimeout(fn) {
      timers.set(++timerId, fn);
      return timerId;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
  });
  const api = window.MioPanel;
  let context;
  const appearances = [];
  api.onAppearance((value) => appearances.push(value));
  api.connect((value) => {
    context = value;
  });
  assert.equal(sent[0].type, "mio:panel:ready");
  const event = (data, ports = []) =>
    listeners.message({
      source: parent,
      data: { version: 1, session: "test-session", ...data },
      ports,
    });
  listeners.message({
    source: {},
    data: {
      type: "mio:panel:init",
      version: 1,
      session: "test-session",
      context: { episode_id: "wrong" },
    },
  });
  assert.equal(context, undefined);
  event({
    type: "mio:panel:init",
    context: { episode_id: "episode" },
    appearance: { tokens: { accent: "#cba" }, theme: "dark", locale: "en" },
  });
  assert.equal(api.context.episode_id, "episode");
  assert.equal(appearances.at(-1).theme, "dark");
  event({
    type: "mio:panel:appearance",
    appearance: { tokens: { accent: "#abc" }, theme: "light", locale: "zh-CN" },
  });
  assert.equal(appearances.at(-1).theme, "light");
  assert.equal(appearances.at(-1).tokens.accent, "#abc");
  const request = api.episode();
  const json = sent.at(-1);
  assert.equal(json.request_id, "episode");
  event({
    type: "mio:panel:response",
    rid: json.rid,
    ok: true,
    data: { id: "episode" },
  });
  assert.equal((await request).id, "episode");
  const image = () => ({
    dataset: {},
    removeAttribute(key) {
      delete this[key];
    },
  });
  const deliver = (rid, id) => {
    const port = {
      started: false,
      closed: false,
      start() {
        this.started = true;
      },
      close() {
        this.closed = true;
      },
    };
    event(
      {
        type: "mio:panel:media",
        rid,
        media_id: id,
        mime: "image/png",
        bytes: 4,
      },
      [port],
    );
    assert.equal(port.started, true);
    port.onmessage({
      data: { type: "image", blob: new Blob(["test"], { type: "image/png" }) },
    });
    return port;
  };
  const img = image();
  const first = api.image(img, "take-a");
  const port = deliver(sent.at(-1).rid, "media-a");
  await first;
  assert.equal(img.src, created[0]);
  port.onmessage({ data: { type: "revoke" } });
  assert.equal(img.src, undefined);
  assert.ok(revoked.includes(created[0]));
  assert.equal(port.closed, true);
  const older = api.image(img, "older");
  const oldId = sent.at(-1).rid;
  const newer = api.image(img, "newer");
  const newId = sent.at(-1).rid;
  deliver(newId, "new-media");
  await newer;
  const current = img.src;
  deliver(oldId, "old-media");
  await older;
  assert.equal(img.src, current);
  assert.ok(revoked.includes(created.at(-1)));
  const unknown = {
    closed: false,
    close() {
      this.closed = true;
    },
  };
  event(
    { type: "mio:panel:media", rid: "unknown", media_id: "unknown-media" },
    [unknown],
  );
  assert.equal(unknown.closed, true);
  assert.equal(sent.at(-1).type, "mio:panel:release");
  const failure = api.request("episode");
  const failureId = sent.at(-1).rid;
  event({
    type: "mio:panel:response",
    rid: failureId,
    ok: false,
    status: 403,
    data: { detail: "denied" },
  });
  await assert.rejects(failure, /denied/);
  listeners.pagehide();
  assert.equal(img.src, undefined);
  assert.equal(timers.size, 0);
  console.log(
    "panel bridge: session, JSON, local Blob, stale media, revocation and cleanup passed",
  );
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
