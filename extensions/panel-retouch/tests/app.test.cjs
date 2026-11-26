const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("../../../web/node_modules/jsdom");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const flush = async () => { for (let index = 0; index < 8; index++) await new Promise(setImmediate); };
const episode = () => ({
  id: "ep-a", panels: [{ id: "panel-a", order: 0 }],
  takes: [
    { id: "source", panel_id: "panel-a", status: "candidate" },
    { id: "edit-a", panel_id: "panel-a", status: "candidate", parent_take_id: "source", edits: [{ kind: "inpaint" }] },
    { id: "edit-b", panel_id: "panel-a", status: "candidate", parent_take_id: "source", edits: [{ kind: "outpaint" }] }
  ]
});

function harness(mode = "loaded") {
  const dom = new JSDOM(read("index.html"), { runScripts: "outside-only", url: "https://panel.invalid/#mio-session=session" });
  const { window } = dom;
  const $ = (id) => window.document.getElementById(id);
  const calls = { posts: [], uploads: [], images: [], released: [], revoked: [], shown: [], recent: [], stops: 0 };
  let nextId = 0;
  window.confirm = () => assert.fail("sandbox adoption must use the visible confirmation controls");
  window.URL.createObjectURL = () => assert.fail("port-delivered images already have a local object URL");
  window.URL.revokeObjectURL = (url) => calls.revoked.push(url);
  Object.defineProperty(window.crypto, "randomUUID", { value: () => `intent-${++nextId}` });
  const style = window.document.createElement("style");
  style.textContent = read("panel.css");
  window.document.head.append(style);
  window.MioRetouch = {
    session: "session", localize() {},
    text: (key, vars = {}) => `${key}${vars.error ? `:${vars.error}` : ""}`,
    async get(route) {
      if (mode === "error") throw new Error("503 offline");
      if (route === "series") return mode === "empty" ? [] : [{ id: "series-a", title: "Series" }];
      if (route === "series/series-a/episodes?limit=200") return { items: [{ id: "ep-a", title: "Episode" }] };
      if (route === "episodes/ep-a") return episode();
      if (route === "profiles") return [{ id: "profile-a", name: "Bound", edits: { inpaint: { enabled: true, workflow_id: "repair", kind: "inpaint" } } }];
      assert.fail(`unexpected API read: ${route}`);
    },
    async request(route) {
      const url = `blob:retouch-${calls.images.length + 1}`;
      calls.images.push({ route, url });
      return { url, blob: async () => assert.fail("the local media URL should be used") };
    },
    async post(route, body) {
      calls.posts.push({ route, body });
      if (route.endsWith("/edit")) return { id: "job-a", state: "queued" };
      if (route.endsWith("/adopt")) {
        const value = episode();
        value.takes.find((take) => route.includes(`/takes/${take.id}/`)).status = "adopted";
        return value;
      }
      assert.fail(`unexpected API write: ${route}`);
    },
    async upload(blob, filename) { calls.uploads.push({ blob, filename }); return { id: "mask-asset" }; },
    release: (url) => calls.released.push(url)
  };
  window.MioMaskEditor = class {
    constructor(image, canvas, stage, controls) { this.drawing = false; this.revision = 2; this.mode = "brush"; calls.maskControls = controls; }
    reset() {} resize() {} render() {} undo() {} redo() {} clear() {}
    async blob(feather, invert) { calls.mask = { feather, invert }; return new window.Blob(["mask"], { type: "image/png" }); }
  };
  window.MioJobTracker = {
    state: "", onComplete() {}, async recent(id) { calls.recent.push(id); },
    async show(job) { calls.shown.push(job); }, async refresh() {}, async cancel() {}, stop() { calls.stops += 1; }
  };
  window.eval(read("logic.js"));
  window.eval(read("app.js"));
  return { window, $, calls, close: () => dom.window.close() };
}

async function main() {
  for (const [mode, expected] of [["empty", "noSeries"], ["error", "seriesLoadError:503 offline"]]) {
    const test = harness(mode);
    await flush();
    assert.equal(test.$("status").textContent, expected);
    assert.equal(test.calls.posts.length, 0, "opening the panel never starts a render job");
    if (mode === "error") assert.equal(test.$("status").dataset.kind, "error");
    test.close();
  }

  const test = harness();
  const { window, $, calls } = test;
  try {
    await flush();
    assert.equal($("mask-canvas").getAttribute("aria-describedby"), "mask-hint mask-position");
    assert.equal($("mask-position").getAttribute("role"), "status");
    assert.equal(calls.maskControls.position, $("mask-position"), "mask editor receives the visible keyboard position/status output");
    assert.equal(calls.maskControls.text, window.MioRetouch.text, "cursor and gesture status use the active locale");
    const hover = [...window.document.styleSheets].flatMap((sheet) => [...sheet.cssRules])
      .find((rule) => rule.selectorText === "button.primary:not(:disabled):hover");
    assert.equal(hover?.style.background, "var(--accent)", "primary hover retains an opaque accent background");
    assert.equal(hover?.style.color, "var(--accent-ink)");
    assert.equal($("status").textContent, "chooseEpisode");
    $("load").click();
    await flush();
    assert.equal($("status").textContent, "loaded");
    assert.equal(calls.images.length, 3, "source and comparison images use declared image reads");
    for (const image of [$("source-image"), $("before-image"), $("after-image")]) assert.match(image.src, /^blob:retouch-/);
    assert.equal(calls.posts.length, 0);
    $("source-image").dispatchEvent(new window.Event("load"));

    $("submit").click();
    await flush();
    assert.equal(calls.uploads.length, 1);
    assert.equal(calls.uploads[0].blob.type, "image/png");
    assert.match(calls.uploads[0].filename, /^retouch-mask-\d+\.png$/);
    assert.equal(calls.posts[0].route, "episodes/ep-a/edit");
    assert.deepEqual(JSON.parse(JSON.stringify(calls.posts[0].body)), {
      take_id: "source", profile_id: "profile-a", kind: "inpaint",
      params: { mask_asset_id: "mask-asset", feather: 12, invert: false }, idempotency_key: "retouch-intent-1"
    });
    $("submit").click();
    await flush();
    assert.equal(calls.uploads.length, 1, "unchanged masks reuse their uploaded asset");
    assert.equal(calls.posts[1].body.idempotency_key, calls.posts[0].body.idempotency_key);
    $("new-intent").click();
    $("submit").click();
    await flush();
    assert.notEqual(calls.posts[2].body.idempotency_key, calls.posts[0].body.idempotency_key);

    const adoptionCount = () => calls.posts.filter((call) => call.route.endsWith("/adopt")).length;
    assert.equal(window.getComputedStyle($("adopt-confirmation")).display, "none", "hidden confirmation stays hidden under panel CSS");
    $("adopt").click();
    assert.equal($("adopt-confirmation").hidden, false);
    assert.equal(window.document.activeElement, $("cancel-adopt"));
    assert.equal($("result").disabled, true, "selection is frozen while asking for confirmation");
    assert.equal(adoptionCount(), 0);
    $("cancel-adopt").click();
    await flush();
    assert.equal(adoptionCount(), 0, "cancel has no write effect");
    assert.equal($("adopt-confirmation").hidden, true);
    $("adopt").click();
    $("adopt-confirmation").dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    await flush();
    assert.equal(adoptionCount(), 0, "Escape cancels without writing");

    $("result").value = "edit-a";
    $("adopt").click();
    $("result").value = "edit-b";
    $("confirm-adopt").click();
    await flush();
    assert.equal(adoptionCount(), 1);
    assert.equal(calls.posts.at(-1).route, "episodes/ep-a/takes/edit-a/adopt", "confirmation uses its captured take even if selection is mutated");
    assert.equal(calls.posts.at(-1).body, undefined, "adoption keeps the existing request body");
    assert.equal($("status").textContent, "adopted");
    assert.ok(calls.released.length >= 2, "replaced comparison images release host-owned media");

    $("adopt").click();
    assert.equal($("adopt-confirmation").hidden, false);
    window.dispatchEvent(new window.Event("pagehide"));
    $("confirm-adopt").click();
    await flush();
    assert.equal(adoptionCount(), 1, "leaving cancels any outstanding confirmation");
    assert.equal($("adopt-confirmation").hidden, true);
    assert.ok(calls.stops > 0);
    for (const image of [$("source-image"), $("before-image"), $("after-image")]) assert.ok(calls.released.includes(image.src), "leaving releases current local media URLs");
    console.log("panel-retouch: empty/error states, port image URLs, mask submission, idempotency, and local adoption confirmation passed");
  } finally { test.close(); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
