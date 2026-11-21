const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

class Element {
  constructor(id) {
    Object.assign(this, { id, value: "", options: [], listeners: {}, disabled: false, hidden: false, textContent: "", dataset: {}, style: { setProperty() {} }, classList: { contains: () => false, add() {}, remove() {}, toggle() {} } });
  }
  addEventListener(type, handler) { this.listeners[type] = handler; }
  replaceChildren(...children) { this.options = children; if (this.options.length && !this.value) this.value = this.options[0].value || ""; }
  add(child) { this.options.push(child); if (this.options.length === 1) this.value = child.value; }
  removeAttribute() {}
  setAttribute() {}
  getBoundingClientRect() { return { width: 100, height: 100, left: 0, top: 0 }; }
}

async function main() {
  const elements = new Map();
  const getElementById = (id) => { if (!elements.has(id)) elements.set(id, new Element(id)); return elements.get(id); };
  const documentListeners = {};
  const document = {
    getElementById,
    querySelectorAll: () => [],
    addEventListener: (type, handler) => { documentListeners[type] = handler; },
  };
  let getFails = false;
  const posts = [];
  const api = {
    session: "session",
    localize() {},
    text: (key, vars = {}) => `${key}${vars.error ? `:${vars.error}` : ""}`,
    async get() { if (getFails) throw new Error("503 offline"); return []; },
    async request() { throw new Error("unexpected image request"); },
    async post(path) { posts.push(path); return {}; },
    async upload() { throw new Error("unexpected upload"); },
  };
  const window = {
    MioRetouch: api,
    MioRetouchLogic: { workflow: () => false, results: (episode) => episode?.takes || [] },
    MioMaskEditor: class { constructor() { this.drawing = false; this.revision = 0; this.mode = "brush"; } reset() {} resize() {} },
    MioJobTracker: { state: "", onComplete() {}, async recent() {}, async show() {}, async refresh() {}, async cancel() {}, stop() {} },
    addEventListener() {},
  };
  vm.runInNewContext(fs.readFileSync(`${__dirname}/../app.js`, "utf8"), {
    window, document, addEventListener() {}, Option: class { constructor(text, value) { this.text = text; this.value = value; } },
    confirm: () => true, crypto: { randomUUID: () => "id" }, URL: { revokeObjectURL() {} },
    Promise, Error, JSON, encodeURIComponent, Map, setTimeout, clearTimeout,
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(getElementById("status").textContent, "noSeries", "empty workspace gives a calm empty state");
  assert.equal(posts.length, 0, "opening the tool never creates a render job");
  getFails = true;
  await window.MioJobApp.init();
  assert.equal(getElementById("status").dataset.kind, "error");
  assert.equal(getElementById("status").textContent, "seriesLoadError:503 offline", "API errors are surfaced to the user");
  console.log("panel-retouch: no-data and backend-error UI states passed");
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
