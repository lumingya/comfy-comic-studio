"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { JSDOM } = require("../../web/node_modules/jsdom");

const root = __dirname;
const manifest = JSON.parse(
  fs.readFileSync(path.join(root, "mio-extension.json"), "utf8"),
);
const html = fs.readFileSync(path.join(root, "panel.html"), "utf8");
const script = fs.readFileSync(path.join(root, "panel.js"), "utf8");
const css = fs.readFileSync(path.join(root, "panel.css"), "utf8");
const flush = async () => {
  for (let i = 0; i < 8; i++) await new Promise(setImmediate);
};

function fixture() {
  return {
    id: "ep",
    panels: [
      { id: "p1", order: 0, description: "A quiet room" },
      { id: "p2", order: 1, locked: true },
    ],
    takes: [
      {
        id: "low",
        panel_id: "p1",
        asset_id: "asset-low",
        stage: "draft",
        status: "candidate",
        qa: {
          passed: false,
          score: 0.35,
          votes: 3,
          issues: ["Identity drift <unsafe>", "Missing hat"],
          identity: [{ character_id: "c1", score: 2, missing: ["hat"] }],
          shot_ok: true,
          characters_ok: true,
          action_ok: false,
          model: "vlm-a",
          checked_at: "today",
        },
      },
      {
        id: "high",
        panel_id: "p1",
        asset_id: "asset-high",
        stage: "draft",
        status: "candidate",
        created_at: "2026-11-20",
        qa: {
          passed: true,
          score: 0.92,
          votes: 3,
          issues: [],
          identity: [{ character_id: "c1", score: 5, missing: [] }],
          shot_ok: true,
          characters_ok: true,
          action_ok: true,
        },
      },
      {
        id: "middle",
        panel_id: "p2",
        stage: "draft",
        status: "candidate",
        qa: {
          passed: false,
          score: 0.62,
          votes: 2,
          issues: ["Scene mismatch"],
        },
      },
      {
        id: "unreviewed",
        panel_id: "p2",
        stage: "draft",
        status: "candidate",
        qa: null,
      },
      {
        id: "rejected",
        panel_id: "p1",
        stage: "draft",
        status: "rejected",
        qa: null,
      },
    ],
  };
}

async function createPanel(
  handler = async () => ({ data: {} }),
  appearance = {},
) {
  const dom = new JSDOM(html, {
    url: "https://panel.invalid/#mio-session=test-session",
    runScripts: "outside-only",
    pretendToBeVisual: true,
  });
  const w = dom.window;
  const calls = [];
  const confirms = [];
  const parent = {
    postMessage(message) {
      if (message.type !== "mio:panel:request") return;
      calls.push(message);
      queueMicrotask(async () => {
        const result = await handler(message);
        const status = result.status ?? 200;
        const data = result.data ?? {};
        if (message.request_id === "image" && status < 400) {
          const port = {
            onmessage: null,
            start() {},
            close() {},
            postMessage() {},
          };
          w.dispatchEvent(
            new w.MessageEvent("message", {
              source: parent,
              ports: [port],
              data: {
                type: "mio:panel:media",
                version: 1,
                session: "test-session",
                rid: message.rid,
                media_id: `media-${message.rid}`,
                mime: "image/png",
                bytes: 4,
              },
            }),
          );
          queueMicrotask(() =>
            port.onmessage?.({
              data: {
                type: "image",
                blob: new w.Blob(["png"], { type: "image/png" }),
              },
            }),
          );
          return;
        }
        w.dispatchEvent(
          new w.MessageEvent("message", {
            source: parent,
            data: {
              type: "mio:panel:response",
              version: 1,
              session: "test-session",
              rid: message.rid,
              status,
              ok: status >= 200 && status < 300,
              data,
            },
          }),
        );
      });
    },
  };
  Object.defineProperty(w, "parent", { value: parent });
  Object.defineProperty(w.crypto, "randomUUID", { value: randomUUID });
  Object.defineProperty(w.URL, "createObjectURL", {
    value: () => "blob:fixture",
  });
  Object.defineProperty(w.URL, "revokeObjectURL", { value: () => {} });
  w.confirm = (message) => {
    confirms.push(message);
    return true;
  };
  w.HTMLElement.prototype.scrollIntoView = function () {
    this.dataset.located = "true";
  };
  w.eval(script);
  const send = (type, extra = {}) =>
    w.dispatchEvent(
      new w.MessageEvent("message", {
        source: parent,
        data: { type, version: 1, session: "test-session", ...extra },
      }),
    );
  send("mio:panel:init", {
    context: { episode_id: "ep", series_id: "series" },
    appearance,
  });
  return {
    w,
    calls,
    confirms,
    send,
    $: (id) => w.document.getElementById(id),
    close: () => {
      w.dispatchEvent(new w.Event("pagehide"));
      w.close();
    },
    click: async (id) => {
      w.document.getElementById(id).click();
      await flush();
    },
    choose: (id, checked = true) => {
      const input = w.document.querySelector(`input[data-take-id="${id}"]`);
      assert.ok(input, `missing checkbox ${id}`);
      input.checked = checked;
      input.dispatchEvent(new w.Event("change"));
    },
  };
}

async function verifyManifest() {
  assert.equal(manifest.id, "qa-review");
  const panel = manifest.contributes.panels.find(
    (item) => item.id === "review",
  );
  assert.ok(panel);
  const requests = Object.fromEntries(
    panel.requests.map((item) => [item.id, item]),
  );
  assert.deepEqual(Object.keys(requests).sort(), [
    "adopt",
    "episode",
    "image",
    "job",
    "reject",
    "review",
  ]);
  assert.equal(requests.review.path, "/episodes/{episode_id}/qa");
  assert.equal(requests.review.scope, "render");
  assert.equal(
    requests.adopt.path,
    "/episodes/{episode_id}/takes/{take_id}/adopt",
  );
  assert.equal(requests.adopt.scope, "write");
  assert.equal(
    requests.reject.path,
    "/episodes/{episode_id}/takes/{take_id}/reject",
  );
  assert.equal(requests.reject.scope, "write");
  assert.deepEqual(
    [requests.image.method, requests.image.path, requests.image.response],
    ["GET", "/assets/{asset_id}", "image"],
  );
  assert.doesNotMatch(html, /https?:\/\//);
  assert.doesNotMatch(html, /<script[^>]+src=["']https?:/i);
  console.log(
    "Manifest/API declaration: review, read, write, and image scopes PASS",
  );
}

async function verifyAppearanceAndScoring() {
  let value = fixture();
  const p = await createPanel(
    async (message) => {
      if (message.request_id === "episode")
        return { data: structuredClone(value) };
      return { data: {} };
    },
    {
      tokens: { bg: "#fafafa", accent: "#123456", text: "#111111" },
      theme: "light",
      locale: "en",
    },
  );
  try {
    assert.equal(
      p.calls.length,
      0,
      "opening a panel must not read or submit anything",
    );
    assert.equal(
      p.w.document.querySelector("h1").textContent,
      "Quality review",
    );
    assert.equal(p.w.document.documentElement.lang, "en");
    assert.equal(
      p.w.document.documentElement.style.getPropertyValue("--bg"),
      "#fafafa",
    );
    assert.equal(p.w.document.documentElement.dataset.theme, "light");
    await p.click("load");
    assert.equal(p.calls[0].request_id, "episode");
    assert.equal(p.$("takes").querySelectorAll(".candidate").length, 5);
    assert.ok(p.$("takes").textContent.includes("92/100"));
    assert.ok(
      p.$("takes").textContent.includes("Character c1: consistency 2/5"),
    );
    assert.equal(
      p.$("takes").querySelector(".candidate").querySelector("img").hidden,
      true,
    );
    assert.equal(
      p
        .$("takes")
        .querySelector("img")
        .parentElement.textContent.includes("<unsafe>"),
      true,
      "untrusted issue text uses textContent",
    );
    p.$("severity-filter").value = "high";
    p.$("severity-filter").dispatchEvent(new p.w.Event("change"));
    assert.equal(p.$("takes").querySelectorAll(".candidate").length, 3);
    p.send("mio:panel:appearance", {
      appearance: {
        tokens: { accent: "#abcdef" },
        theme: "dark",
        locale: "zh-CN",
      },
    });
    assert.equal(
      p.w.document.querySelector("h1").textContent,
      "智能质检与辅助挑图",
    );
    assert.equal(p.w.document.documentElement.lang, "zh-CN");
    assert.equal(
      p.w.document.documentElement.style.getPropertyValue("--accent"),
      "#abcdef",
    );
    assert.equal(p.w.document.documentElement.dataset.theme, "dark");
  } finally {
    p.close();
  }
  assert.match(css, /max-width: 560px/);
  assert.match(css, /:focus-visible/);
  console.log(
    "Appearance, score cards, safe issue text, inferred severity filter, and responsive/keyboard styles PASS",
  );
}

async function verifyReviewActionsAndBatchAdoption() {
  let value = fixture();
  const p = await createPanel(
    async (message) => {
      if (message.request_id === "episode")
        return { data: structuredClone(value) };
      if (message.request_id === "review")
        return { data: { id: "job-1", state: "queued", items: [] } };
      if (message.request_id === "adopt") {
        const takeId = message.path_params.take_id;
        const chosen = value.takes.find((take) => take.id === takeId);
        for (const take of value.takes)
          if (take.panel_id === chosen.panel_id && take.status === "adopted")
            take.status = "candidate";
        chosen.status = "adopted";
        return { data: structuredClone(value) };
      }
      if (message.request_id === "reject") {
        value.takes.find(
          (take) => take.id === message.path_params.take_id,
        ).status = "rejected";
        return { data: structuredClone(value) };
      }
      if (message.request_id === "job")
        return {
          data: {
            id: "job-1",
            state: "completed",
            items: [{ state: "complete" }],
          },
        };
      return { status: 404, data: { detail: "missing" } };
    },
    { locale: "en", theme: "dark" },
  );
  try {
    await p.click("load");
    p.choose("low");
    await p.click("review-selected");
    const review = p.calls
      .filter((call) => call.request_id === "review")
      .at(-1);
    assert.deepEqual(Array.from(review.body.take_ids), ["low"]);
    assert.equal(review.body.auto_adopt, false);
    assert.ok(review.body.idempotency_key);
    assert.equal(
      p.$("status").textContent,
      "Review queued. Refresh to check progress. Retrying the same selection reuses its idempotency key.",
    );
    await p.click("review-episode");
    const whole = p.calls.filter((call) => call.request_id === "review").at(-1);
    assert.equal(whole.body.auto_adopt, false);
    assert.deepEqual(Array.from(whole.body.take_ids).sort(), [
      "high",
      "low",
      "middle",
      "unreviewed",
    ]);
    await p.click("adopt-top");
    const adoptions = p.calls.filter((call) => call.request_id === "adopt");
    assert.deepEqual(
      adoptions.map((call) => call.path_params.take_id),
      ["high"],
    );
    assert.match(p.$("status").textContent, /Adopted 1 take/);
    const rejected = p.w.document.querySelector(
      'button[aria-label="Reject: low"]',
    );
    assert.ok(rejected);
    rejected.click();
    await flush();
    assert.equal(
      p.calls.filter((call) => call.request_id === "reject").at(-1).path_params
        .take_id,
      "low",
    );
    await p.click("refresh-job");
    assert.match(p.$("job").textContent, /completed.*1\/1/);
    assert.equal(p.confirms.length, 3);
  } finally {
    p.close();
  }
  console.log(
    "Single/episode VLM review, explicit adoption/rejection, top-score batch, and job refresh PASS",
  );
}

async function verifyErrorsAndImageBridge() {
  let value = fixture();
  let failRead = true;
  const p = await createPanel(async (message) => {
    if (message.request_id === "episode" && failRead)
      return { status: 503, data: { detail: "service unavailable" } };
    if (message.request_id === "episode")
      return { data: structuredClone(value) };
    if (message.request_id === "image") return { data: {} };
    if (message.request_id === "reject")
      return { status: 409, data: { detail: "revision conflict" } };
    return { data: {} };
  });
  try {
    await p.click("load");
    assert.ok(p.$("status").classList.contains("error"));
    assert.match(p.$("status").textContent, /503.*service unavailable/);
    failRead = false;
    await p.click("load");
    const preview = p.w.document.querySelector(
      'button[aria-label="Preview image"]',
    );
    assert.ok(preview);
    preview.click();
    await flush();
    assert.equal(p.w.document.querySelector("img.preview").src, "blob:fixture");
    assert.equal(p.w.document.querySelector("img.preview").hidden, false);
    const reject = p.w.document.querySelector(
      'button[aria-label="Reject: low"]',
    );
    reject.click();
    await flush();
    assert.ok(p.$("status").classList.contains("error"));
    assert.match(p.$("status").textContent, /409.*revision conflict/);
    assert.equal(
      p.calls.filter((call) => call.request_id === "reject").length,
      1,
    );
  } finally {
    p.close();
  }
  console.log("HTTP error states and declared image bridge PASS");
}

(async () => {
  await verifyManifest();
  await verifyAppearanceAndScoring();
  await verifyReviewActionsAndBatchAdoption();
  await verifyErrorsAndImageBridge();
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
