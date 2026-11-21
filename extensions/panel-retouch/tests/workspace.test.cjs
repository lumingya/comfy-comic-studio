const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

async function main() {
  const listeners = new Map();
  const styles = new Map();
  const root = { lang: "zh-CN", dataset: {}, style: { setProperty: (key, value) => styles.set(key, value) } };
  const document = {
    documentElement: root,
    querySelectorAll: () => [],
    getElementById: () => null,
    dispatchEvent: (event) => { document.lastEvent = event; },
  };
  const parent = { postMessage: (message, origin) => sent.push({ message, origin }) };
  const sent = [];
  let fetchCall;
  let failApi = false;
  const window = {};
  vm.runInNewContext(fs.readFileSync(`${__dirname}/../workspace.js`, "utf8"), {
    window,
    parent,
    location: { hash: "#mio-session=session-a", origin: "https://mio.local" },
    document,
    URLSearchParams,
    HTMLInputElement: class {},
    HTMLTextAreaElement: class {},
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init.detail; } },
    addEventListener: (name, listener) => listeners.set(name, listener),
    fetch: async (path, init) => {
      fetchCall = { path, init };
      if (failApi) return { ok: false, status: 503, statusText: "Service Unavailable", json: async () => ({ detail: "offline" }) };
      return { ok: true, json: async () => ({ id: "asset-mask" }) };
    },
    encodeURIComponent,
    setTimeout,
    clearTimeout,
  });
  assert.equal(sent[0].message.type, "mio:workspace:ready");
  assert.equal(sent[0].message.session, "session-a");
  const message = (data, source = parent, origin = "https://mio.local") => listeners.get("message")({ data, source, origin });
  message({ type: "mio:workspace:context", session: "bad", locale: "en", theme: "dark" });
  assert.equal(window.MioRetouch.text("title"), "单格精修");
  message({ type: "mio:workspace:context", session: "session-a", locale: "en-US", theme: "dark", tokens: { "--accent": "#123456", "--text": "#fefefe" } });
  assert.equal(window.MioRetouch.text("title"), "Panel retouch");
  assert.equal(root.dataset.theme, "dark");
  assert.equal(root.lang, "en");
  assert.equal(styles.get("--accent"), "#123456");
  assert.equal(document.lastEvent.type, "mio-context");
  await window.MioRetouch.get("profiles");
  assert.equal(fetchCall.path, "/api/profiles");
  assert.equal(fetchCall.init.credentials, "same-origin");
  const blob = new Blob(["png"], { type: "image/png" });
  await window.MioRetouch.upload(blob, "mask.png");
  assert.match(fetchCall.path, /^\/api\/assets\?filename=mask\.png$/);
  assert.equal(fetchCall.init.body, blob);
  await assert.rejects(window.MioRetouch.request("https://outside.invalid"), /same-origin/);
  failApi = true;
  await assert.rejects(window.MioRetouch.get("profiles"), (error) => error.status === 503 && error.message === "offline");
  console.log("panel-retouch: workspace session, theme/locale sync, and API errors passed");
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
