const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { JSDOM } = require("../../../web/node_modules/jsdom");
const root = path.resolve(__dirname, "..");
const read = (name) => fs.readFileSync(path.join(root, name), "utf8");

test("manifest grants only the minimal episode read, panel write, image and download APIs", () => {
  const manifest = JSON.parse(read("mio-extension.json"));
  assert.equal(manifest.id, "motion-studio");
  const panel = manifest.contributes.panels[0];
  assert.equal(panel.slot, "episode");
  assert.deepEqual(
    panel.requests.map((request) => [
      request.id,
      request.method,
      request.path,
      request.scope,
    ]),
    [
      ["episode", "GET", "/episodes/{episode_id}", "read"],
      ["motion-plan", "GET", "/episodes/{episode_id}/motion-plan", "read"],
      [
        "patch-panel",
        "PATCH",
        "/episodes/{episode_id}/panels/{panel_id}",
        "write",
      ],
      [
        "take-image",
        "GET",
        "/episodes/{episode_id}/takes/{take_id}/image",
        "read",
      ],
      ["export-motion", "POST", "/export/motion", "write"],
    ],
  );
  assert.equal(
    panel.requests.find((request) => request.id === "export-motion").response,
    "download",
  );
  assert.equal(
    panel.requests.find((request) => request.id === "take-image").response,
    "image",
  );
});

test("local model formats English/Chinese, estimates dialogue duration, and filters empty speech", () => {
  const dom = new JSDOM("<!doctype html>", { runScripts: "outside-only" });
  dom.window.eval(read("model.js"));
  const model = dom.window.MotionModel;
  assert.equal(model.text("en", "saveShot"), "Save this shot");
  assert.equal(model.text("zh-CN", "saveShot"), "保存当前镜头");
  assert.equal(model.speechSeconds([{ text: "你好" }]), 0.3);
  assert.equal(model.speakable([{ text: " " }, { text: "台词" }]).length, 1);
  dom.window.close();
});

function makeHarness({ failLoad = false } = {}) {
  const dom = new JSDOM(read("panel.html"), {
    runScripts: "outside-only",
    url: "https://mio.invalid/panel.html",
  });
  const { window } = dom;
  const calls = [];
  const animations = [];
  let ready;
  const panels = [
    { id: "p1", description: "A street at night", motion: null, dialogues: [] },
    { id: "p2", description: "A quiet goodbye", motion: null, dialogues: [] },
  ];
  const episode = {
    id: "ep1",
    revision: 4,
    panels,
    takes: [
      { id: "t1", panel_id: "p1", status: "adopted", variant_id: null },
      { id: "t2", panel_id: "p2", status: "adopted", variant_id: null },
    ],
  };
  const plan = {
    moves: [
      "still",
      "push_in",
      "pull_out",
      "pan_left",
      "pan_right",
      "pan_up",
      "pan_down",
      "shake",
    ],
    transitions: ["cut", "fade", "slide"],
    total_seconds: 4,
    shots: panels.map((panel, index) => ({
      panel_id: panel.id,
      index,
      move: "push_in",
      auto_move: "push_in",
      auto_hold: 2,
      hold: 2,
      transition: "fade",
      has_image: true,
      lines: [
        {
          text: index ? "We made it." : "你好世界",
          speaker: "Ari",
          voice: { pitch: 1, rate: 1 },
        },
      ],
      description: panel.description,
    })),
  };
  window.MotionBridge = {
    ready(callback) {
      ready = callback;
    },
    release() {},
    async request(id, request = {}) {
      calls.push({ id, ...request });
      if (id === "episode") {
        if (failLoad) throw new Error("service unavailable");
        return episode;
      }
      if (id === "motion-plan") return plan;
      if (id === "take-image")
        return {
          media_id: request.path_params.take_id,
          url: "blob:https://mio.invalid/test",
        };
      if (id === "patch-panel") {
        const target = panels.find(
          (item) => item.id === request.path_params.panel_id,
        );
        target.motion = request.body.changes.motion;
        episode.revision += 1;
        return episode;
      }
      if (id === "export-motion")
        return { download_ready: true, filename: "motion.html" };
      throw new Error(`unexpected request ${id}`);
    },
  };
  window.matchMedia = () => ({ matches: false });
  window.CSS = { escape: (value) => value };
  window.Element.prototype.animate = function () {
    const animation = {
      paused: false,
      pause() { this.paused = true; },
      cancel() {},
      currentTime: 0,
    };
    animations.push(animation);
    return animation;
  };
  const utterances = [];
  window.SpeechSynthesisUtterance = function (value) {
    this.text = value;
    utterances.push(this);
  };
  window.speechSynthesis = {
    getVoices: () => [{ name: "local", lang: "en-US" }],
    speak(utterance) {
      setTimeout(() => utterance.onend?.(), 0);
    },
    cancel() {},
  };
  window.eval(read("model.js"));
  window.eval(read("panel.js"));
  ready({
    episode_id: "ep1",
    locale: "en",
    theme: "light",
    tokens: { accent: "#128070", text: "#101820" },
  });
  return { dom, window, calls, utterances, panels, animations };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
async function settle() {
  for (let i = 0; i < 8; i += 1) await tick();
}

test("loads, saves camera/timing/transition, and requests the real offline export", async () => {
  const h = makeHarness();
  const { window } = h;
  assert.equal(
    window.document.documentElement.style.getPropertyValue("--accent"),
    "#128070",
  );
  window.document.getElementById("load").click();
  await settle();
  assert.equal(window.document.getElementById("editor").hidden, false);
  assert.equal(
    window.document.getElementById("shot-description").textContent,
    "A street at night",
  );
  const firstShot = window.document.querySelector('[data-id="p1"]');
  assert.equal(firstShot.tagName, "BUTTON");
  assert.equal(firstShot.getAttribute("role"), null, "timeline items retain the native button role");
  assert.equal(firstShot.tabIndex, 0, "timeline buttons remain keyboard-focusable");
  assert.equal(firstShot.getAttribute("aria-pressed"), "true");
  assert.equal(window.document.querySelector('[data-id="p2"]').getAttribute("aria-pressed"), "false");
  firstShot.focus();
  assert.equal(window.document.activeElement, firstShot);
  firstShot.dispatchEvent(
    new window.KeyboardEvent("keydown", {
      key: "ArrowRight",
      bubbles: true,
      cancelable: true,
    }),
  );
  assert.equal(window.document.activeElement, window.document.querySelector('[data-id="p2"]'));
  window.document.getElementById("voice-preview").click();
  await settle();
  assert.equal(h.utterances.length, 1);
  assert.equal(window.document.getElementById("status").textContent, "Dialogue audition complete.");
  const move = window.document.getElementById("move");
  move.value = "pan_left";
  move.dispatchEvent(new window.Event("change", { bubbles: true }));
  const hold = window.document.getElementById("hold");
  hold.value = "4.5";
  hold.dispatchEvent(new window.Event("input", { bubbles: true }));
  const transition = window.document.getElementById("transition");
  transition.value = "slide";
  transition.dispatchEvent(new window.Event("change", { bubbles: true }));
  window.document.getElementById("save").click();
  await settle();
  const patch = h.calls.find((call) => call.id === "patch-panel");
  assert.deepEqual(JSON.parse(JSON.stringify(patch.body.changes.motion)), {
    move: "pan_left",
    hold: 4.5,
    transition: "slide",
  });
  assert.equal(patch.body.revision, 4);
  assert.equal(window.document.getElementById("export").disabled, false);
  window.document.getElementById("export").click();
  await settle();
  const exported = h.calls.find((call) => call.id === "export-motion");
  assert.equal(exported.body.episode_id, "ep1");
  assert.equal(exported.body.lang, "en");
  assert.equal(
    window.document
      .getElementById("status")
      .textContent.includes("motion.html"),
    true,
  );
  h.dom.window.close();
});

test("shows API failures without blanking the panel, and rejects invalid durations", async () => {
  const failed = makeHarness({ failLoad: true });
  failed.window.document.getElementById("load").click();
  await settle();
  assert.match(
    failed.window.document.getElementById("status").textContent,
    /service unavailable/,
  );
  failed.dom.window.close();

  const h = makeHarness();
  h.window.document.getElementById("load").click();
  await settle();
  const hold = h.window.document.getElementById("hold");
  hold.value = "31";
  hold.dispatchEvent(new h.window.Event("input", { bubbles: true }));
  assert.equal(h.window.document.getElementById("save").disabled, true);
  assert.equal(
    h.calls.some((call) => call.id === "patch-panel"),
    false,
  );
  h.dom.window.close();
});

test("dismisses reread confirmation with Keep or Escape and preserves the unsaved shot", async () => {
  const h = makeHarness();
  try {
    const { window } = h;
    const load = window.document.getElementById("load");
    load.click();
    await settle();
    const move = window.document.getElementById("move");
    move.value = "pan_left";
    move.dispatchEvent(new window.Event("change", { bubbles: true }));
    const callCount = h.calls.length;

    for (const action of ["keep", "Escape"]) {
      load.focus();
      load.click();
      const confirmation = window.document.getElementById("discard-confirm");
      const discard = window.document.getElementById("discard");
      assert.equal(confirmation.hidden, false);
      assert.equal(window.document.activeElement, discard);
      if (action === "keep") window.document.getElementById("keep").click();
      else {
        const escape = new window.KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
        });
        discard.dispatchEvent(escape);
        assert.equal(escape.defaultPrevented, true);
      }
      assert.equal(confirmation.hidden, true);
      assert.equal(window.document.activeElement, load);
      assert.equal(move.value, "pan_left");
      assert.equal(window.document.getElementById("save").disabled, false);
      assert.equal(h.calls.length, callCount, "dismissal sends no requests");
    }

    window.document.getElementById("save").click();
    await settle();
    const patch = h.calls.find((call) => call.id === "patch-panel");
    assert.equal(patch.body.changes.motion.move, "pan_left");
  } finally {
    h.dom.window.close();
  }
});

test("first scrub after editing keeps the selected percentage and pauses at that time", async () => {
  const h = makeHarness();
  try {
    h.window.document.getElementById("load").click();
    await settle();
    const hold = h.window.document.getElementById("hold");
    hold.value = "4.5";
    hold.dispatchEvent(new h.window.Event("input", { bubbles: true }));
    const scrub = h.window.document.getElementById("scrub");
    scrub.value = "100";
    scrub.dispatchEvent(new h.window.Event("input", { bubbles: true }));
    assert.equal(scrub.value, "100");
    assert.equal(h.animations.at(-1).currentTime, 4500);
    assert.equal(h.animations.at(-1).paused, true);
    assert.equal(h.calls.some((call) => call.id === "patch-panel"), false);
  } finally {
    h.dom.window.close();
  }
});
