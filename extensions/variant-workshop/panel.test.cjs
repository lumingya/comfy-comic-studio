const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { JSDOM } = require("../../web/node_modules/jsdom");
const dir = __dirname;
const manifest = JSON.parse(fs.readFileSync(path.join(dir, "mio-extension.json"), "utf8"));
const flush = async () => {
  for (let i = 0; i < 6; i++) await new Promise(setImmediate);
};

function contractTest() {
  assert.equal(manifest.id, "variant-workshop");
  assert.equal(manifest.main, undefined, "the panel is a declarative sandbox package");
  const panel = manifest.contributes.panels[0];
  assert.equal(panel.slot, "episode");
  const requests = Object.fromEntries(panel.requests.map((request) => [request.id, request]));
  assert.deepEqual([requests.variants.method, requests.variants.path, requests.variants.scope], ["POST", "/series/{series_id}/variants", "write"]);
  assert.deepEqual([requests.render.method, requests.render.path, requests.render.scope], ["POST", "/episodes/{episode_id}/render", "render"]);
  assert.deepEqual([requests["take-image"].method, requests["take-image"].response, requests["take-image"].scope], ["GET", "image", "read"]);
  assert.deepEqual([requests["export-album"].response, requests["export-pdf"].response], ["download", "download"]);
  for (const file of ["panel.js", "bridge.js", "model.js"]) {
    const source = fs.readFileSync(path.join(dir, file), "utf8");
    assert.doesNotMatch(source, /\bfetch\s*\(|XMLHttpRequest|ctx\.internal/);
  }
}

async function setup({ failEpisode = false } = {}) {
  const dom = new JSDOM(fs.readFileSync(path.join(dir, "panel.html"), "utf8"), {
    url: "https://local.invalid/#mio-session=fixture",
    runScripts: "outside-only",
    pretendToBeVisual: true,
  });
  const w = dom.window;
  const calls = [];
  const appearanceListeners = new Set();
  const episode = {
    id: "ep",
    series_id: "series",
    panels: [
      { id: "p1", order: 0, description: "First" },
      { id: "p2", order: 1, description: "Second" },
    ],
    takes: [{ id: "take-base", panel_id: "p1", variant_id: null, status: "candidate" }],
  };
  const series = {
    id: "series",
    variants: [],
    bible: {
      styles: [{ id: "ink", name: "Ink" }],
      characters: [{ id: "hero", name: "Hero", appearance: ["red coat"] }],
    },
  };
  const panelBridge = {
    initialized: Promise.resolve({ episode_id: "ep", series_id: "series", appearance: { locale: "en", theme: "dark", tokens: { bg: "#111111", accent: "#88dd99" } } }),
    request: async (requestId, payload = {}) => {
      calls.push({ request_id: requestId, ...payload });
      if (requestId === "episode" && failEpisode) throw new Error("Service unavailable");
      if (requestId === "episode") return structuredClone(episode);
      if (requestId === "series") return structuredClone(series);
      if (requestId === "variants") {
        series.variants.push(...payload.body.variants);
        episode.takes.push({ id: "take-variant", panel_id: "p1", variant_id: payload.body.variants[0].id, status: "candidate" });
        return structuredClone(series);
      }
      if (requestId === "render") return { id: "job-1", state: "queued", total: 8 };
      if (requestId === "job") return { id: "job-1", state: "completed", items: [{ state: "complete" }, { state: "failed" }] };
      if (requestId === "take-image") return { media_id: "media-1", url: "blob:fixture", mime: "image/png", bytes: 64 };
      if (requestId === "adopt") return structuredClone(episode);
      if (requestId === "export-album" || requestId === "export-pdf") return { filename: "album.html" };
      throw new Error(`Unexpected operation ${requestId}`);
    },
    released: [],
    release: (mediaId) => { panelBridge.released.push(mediaId); },
    onAppearance: (listener) => { appearanceListeners.add(listener); return () => appearanceListeners.delete(listener); },
  };
  w.panelBridge = panelBridge;
  w.structuredClone = structuredClone;
  w.crypto.randomUUID = () => "fixed-id";
  vm.runInContext(fs.readFileSync(path.join(dir, "model.js"), "utf8"), dom.getInternalVMContext());
  vm.runInContext(fs.readFileSync(path.join(dir, "panel.js"), "utf8"), dom.getInternalVMContext());
  await flush();
  return {
    w,
    calls,
    close: () => dom.window.close(),
    $: (id) => w.document.getElementById(id),
    click: async (id) => { w.document.getElementById(id).click(); await flush(); },
    appearanceListeners,
    released: panelBridge.released,
  };
}

async function interactionTest() {
  const p = await setup();
  try {
    assert.equal(p.calls.length, 0, "opening does not read or render");
    assert.equal(p.$("load").disabled, false);
    assert.equal(p.w.document.documentElement.style.getPropertyValue("--bg"), "#111111");
    await p.click("load");
    assert.equal(p.calls.map((call) => call.request_id).join(","), "episode,series");
    assert.equal(p.$("workspace").hidden, false);
    assert.match(p.$("render-estimate").textContent, /No variants to render/);

    const base = p.w.document.querySelector('input[value="__base__"]');
    base.checked = true;
    base.dispatchEvent(new p.w.Event("change"));
    assert.match(p.$("render-estimate").textContent, /1 variants × 2 panels = 2 panel jobs · 2 candidate images/);
    await p.click("render");
    const render = p.calls.find((call) => call.request_id === "render");
    assert.deepEqual(Array.from(render.body.panel_ids), ["p1", "p2"]);
    assert.deepEqual(Array.from(render.body.variant_ids), [null]);
    assert.equal(render.body.adopt_first, false);
    assert.equal(render.body.adopt_replace, false);

    await p.click("refresh");
    assert.match(p.$("job").textContent, /complete 1\/2 · failed 1/);
    assert.equal(p.$("status").dataset.state, "ok");

    p.appearanceListeners.forEach((listener) => listener({ locale: "zh-CN", theme: "light", tokens: { bg: "#fafafa" } }));
    assert.equal(p.w.document.documentElement.lang, "zh-CN");
    assert.equal(p.w.document.documentElement.style.getPropertyValue("--bg"), "#fafafa");
    assert.equal(p.$("load").textContent, "读取作品");

    const style = p.w.document.querySelector('input[value="ink"]');
    const character = p.w.document.querySelector('input[value="hero"]');
    style.checked = true;
    style.dispatchEvent(new p.w.Event("change", { bubbles: true }));
    character.checked = true;
    character.dispatchEvent(new p.w.Event("change", { bubbles: true }));
    p.$("target").value = "";
    p.$("target").dispatchEvent(new p.w.Event("change"));
    assert.equal(p.$("derive").disabled, true, "appearance variants require a target character");
    p.$("target").value = "hero";
    p.$("target").dispatchEvent(new p.w.Event("change"));
    assert.equal(p.$("derive").disabled, false);
    assert.match(p.$("matrix-preview").textContent, /Ink · Hero/);
    await p.click("derive");
    const append = p.calls.find((call) => call.request_id === "variants");
    assert.equal(append.body.variants.length, 1);
    assert.equal(append.body.variants[0].style_id, "ink");
    assert.deepEqual(append.body.variants[0].characters.hero.appearance, ["red coat"]);

    p.$("version").value = "*";
    p.$("version").dispatchEvent(new p.w.Event("change"));
    p.$("dimension").value = "style";
    p.$("dimension").dispatchEvent(new p.w.Event("change"));
    await p.click("show");
    const takes = [...p.w.document.querySelectorAll("#takes .take input[type=checkbox]")];
    assert.equal(takes.length, 2, "the style dimension includes the original and matching style variant");
    for (const input of takes) {
      input.checked = true;
      input.dispatchEvent(new p.w.Event("change", { bubbles: true }));
      await flush();
    }
    assert.equal(p.$("comparison").querySelectorAll("figure").length, 2);
    p.$("takes").querySelector("button").click();
    await flush();
    assert.ok(p.calls.some((call) => call.request_id === "adopt"));
    assert.deepEqual(p.released, ["media-1", "media-1"], "comparison images are released after adoption");
  } finally {
    p.close();
  }
}

async function errorTest() {
  const p = await setup({ failEpisode: true });
  try {
    await p.click("load");
    assert.equal(p.$("status").dataset.state, "error");
    assert.equal(p.$("status").textContent, "Service unavailable");
    assert.equal(p.$("workspace").hidden, true);
  } finally {
    p.close();
  }
}

contractTest();
interactionTest().then(errorTest).then(() => {
  console.log("variant-workshop: manifest, inert launch, estimates, panel subset, API body, progress, live appearance, error states PASS");
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
