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
          dialogue_status: "assessed",
          dialogue_score: 2,
          dialogue_note: "The expression conflicts with the line.",
          dialogue_votes: 2,
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
          dialogue_status: "assessed",
          dialogue_score: 4,
          dialogue_note: "The calm expression supports the line.",
          dialogue_votes: 3,
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
  const windowSent = [];
  let hostPort, childPort;
  class MessageChannel {
    constructor() {
      const makePort = () => ({
        closed: false,
        addEventListener(name, listener) {
          this[`on${name}`] = listener;
        },
        start() {},
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
  const receive = ({ data: message }) => {
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
        hostPort.postMessage(
          {
            type: "mio:panel:media",
            version: 2,
            session: "test-session",
            rid: message.rid,
            media_id: `media-${message.rid}`,
            mime: "image/png",
            bytes: 4,
          },
          [port],
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
      hostPort.postMessage({
        type: "mio:panel:response",
        version: 2,
        session: "test-session",
        rid: message.rid,
        status,
        ok: status >= 200 && status < 300,
        data,
      });
    });
  };
  const parent = {
    postMessage(message, origin, transfer) {
      windowSent.push(message);
      assert.equal(message.type, "mio:panel:ready");
      assert.equal(message.version, 2);
      assert.equal(origin, "*");
      assert.equal(transfer.length, 1);
      hostPort = transfer[0];
      hostPort.addEventListener("message", receive);
      hostPort.start();
    },
  };
  Object.defineProperty(w, "parent", { value: parent });
  Object.defineProperty(w, "MessageChannel", { value: MessageChannel });
  Object.defineProperty(w.crypto, "randomUUID", { value: randomUUID });
  Object.defineProperty(w.URL, "createObjectURL", {
    value: () => "blob:fixture",
  });
  Object.defineProperty(w.URL, "revokeObjectURL", { value: () => {} });
  w.confirm = () =>
    assert.fail("sandbox panels must use the inline confirmation controls");
  w.HTMLElement.prototype.scrollIntoView = function () {
    this.dataset.located = "true";
  };
  w.eval(script);
  const send = (type, extra = {}) =>
    hostPort.postMessage({
      type,
      version: 2,
      session: "test-session",
      ...extra,
    });
  w.dispatchEvent(
    new w.MessageEvent("message", {
      source: parent,
      data: {
        type: "mio:panel:init",
        version: 2,
        session: "test-session",
        context: { episode_id: "wrong" },
      },
    }),
  );
  assert.equal(calls.length, 0, "window init cannot start business requests");
  send("mio:panel:init", {
    context: { episode_id: "ep", series_id: "series" },
    appearance,
  });
  const initialTheme = w.document.documentElement.dataset.theme;
  w.dispatchEvent(
    new w.MessageEvent("message", {
      source: parent,
      data: {
        type: "mio:panel:appearance",
        version: 2,
        session: "test-session",
        appearance: { theme: initialTheme === "dark" ? "light" : "dark" },
      },
    }),
  );
  assert.equal(
    w.document.documentElement.dataset.theme,
    initialTheme,
    "window appearance cannot change the panel",
  );
  return {
    w,
    calls,
    send,
    $: (id) => w.document.getElementById(id),
    close: () => {
      w.dispatchEvent(new w.Event("pagehide"));
      assert.equal(childPort.closed, true);
      assert.equal(windowSent.length, 1, "only ready uses the window channel");
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
      p.$("confirmation").hidden,
      true,
      "confirmation starts hidden",
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

async function verifyDialogueScoringAndLocales() {
  const value = fixture();
  const note =
    'The smile conflicts with the warning. <img id="dialogue-injection" src="x" onerror="window.dialogueInjected=true">';
  value.takes[0].qa.dialogue_note = note;
  const p = await createPanel(
    async (message) =>
      message.request_id === "episode"
        ? { data: structuredClone(value) }
        : { data: {} },
    { locale: "en" },
  );
  const candidate = (id) =>
    p.w.document
      .querySelector(`input[data-take-id="${id}"]`)
      .closest(".candidate");
  try {
    await p.click("load");
    let row = candidate("low").querySelector(".dialogue-result");
    assert.equal(row.dataset.dialogueStatus, "assessed");
    assert.match(row.textContent, /Dialogue fit: 2\/5 · 2 valid vote\(s\)/);
    assert.equal(row.querySelector(".dialogue-note").textContent, note);
    assert.equal(p.w.document.getElementById("dialogue-injection"), null);
    assert.equal(p.w.dialogueInjected, undefined);
    assert.match(
      candidate("high").querySelector(".dialogue-result").textContent,
      /Dialogue fit: 4\/5 · 3 valid vote\(s\)/,
    );
    assert.match(
      candidate("high").querySelector(".score").textContent,
      /^Pass/,
    );
    p.send("mio:panel:appearance", { appearance: { locale: "zh-CN" } });
    row = candidate("low").querySelector(".dialogue-result");
    assert.match(row.textContent, /台词契合度：2\/5 · 2 有效票/);
    assert.equal(row.querySelector(".dialogue-note").textContent, note);
    assert.match(
      candidate("high").querySelector(".score").textContent,
      /^通过/,
    );
    assert.equal(p.w.document.getElementById("dialogue-injection"), null);
  } finally {
    p.close();
  }
  console.log(
    "Native dialogue scores, evidence, votes, locale updates and safe text PASS",
  );
}

async function verifyDialogueUnknownAndNotAssessed() {
  const value = fixture();
  const legacy = { passed: true, score: 0.92, votes: 3, action_ok: true };
  const unknownNote =
    'Cannot assess <script id="dialogue-script">bad()</script>';
  const cases = [
    ["legacy", legacy],
    ["zero-votes", { ...legacy, score: 1, votes: 0 }],
    [
      "refusal",
      {
        ...legacy,
        passed: false,
        score: 0.64,
        dialogue_status: "unknown",
        dialogue_score: null,
        dialogue_note: unknownNote,
        dialogue_votes: 1,
      },
    ],
    ...[null, "5", true, 6].map((score, index) => [
      `invalid-${index}`,
      {
        ...legacy,
        dialogue_status: "assessed",
        dialogue_score: score,
        dialogue_note: "This malformed score is not evidence.",
        dialogue_votes: 3,
      },
    ]),
    [
      "no-dialogue",
      {
        ...legacy,
        dialogue_status: "not_assessed",
        dialogue_score: null,
        dialogue_note: "Do not show a hallucinated assessment for empty lines.",
        dialogue_votes: 0,
      },
    ],
    ["not-reviewed", null],
  ];
  value.takes = cases.map(([id, qa]) => ({
    id,
    panel_id: "p1",
    stage: "draft",
    status: "candidate",
    qa,
  }));
  const p = await createPanel(
    async (message) =>
      message.request_id === "episode"
        ? { data: structuredClone(value) }
        : { data: {} },
    { locale: "en" },
  );
  const candidate = (id) =>
    p.w.document
      .querySelector(`input[data-take-id="${id}"]`)
      .closest(".candidate");
  try {
    await p.click("load");
    for (const [id] of cases.filter(
      ([id]) => id !== "no-dialogue" && id !== "not-reviewed",
    )) {
      const card = candidate(id);
      const row = card.querySelector(".dialogue-result");
      assert.equal(row.dataset.dialogueStatus, "unknown", id);
      assert.match(row.textContent, /Dialogue fit: Unknown/, id);
      assert.doesNotMatch(row.textContent, /Dialogue fit: [0-5]\/5/, id);
      if (id === "zero-votes") {
        assert.equal(card.querySelector(".score"), null);
        assert.doesNotMatch(card.textContent, /100\/100/);
      } else {
        assert.match(
          card.querySelector(".score").textContent,
          /^Review incomplete/,
          id,
        );
      }
    }
    assert.match(
      candidate("legacy").textContent,
      /No usable dialogue-fit assessment/,
    );
    assert.equal(
      candidate("refusal").querySelector(".dialogue-note").textContent,
      unknownNote,
    );
    assert.equal(p.w.document.getElementById("dialogue-script"), null);
    let row = candidate("no-dialogue").querySelector(".dialogue-result");
    assert.equal(row.dataset.dialogueStatus, "not_assessed");
    assert.equal(row.textContent, "Dialogue fit: Not assessed (no dialogue)");
    assert.equal(row.querySelector(".dialogue-note"), null);
    assert.match(
      candidate("no-dialogue").querySelector(".score").textContent,
      /^Pass/,
    );
    assert.equal(
      candidate("not-reviewed").querySelector(".dialogue-result"),
      null,
    );
    assert.match(candidate("not-reviewed").textContent, /Not reviewed/);
    p.send("mio:panel:appearance", { appearance: { locale: "zh-CN" } });
    assert.match(
      candidate("legacy").querySelector(".dialogue-result").textContent,
      /台词契合度：未知/,
    );
    assert.match(
      candidate("legacy").querySelector(".score").textContent,
      /^评审不完整/,
    );
    row = candidate("no-dialogue").querySelector(".dialogue-result");
    assert.equal(row.textContent, "台词契合度：未评估（无台词）");
    assert.match(candidate("zero-votes").textContent, /台词契合度：未知/);
  } finally {
    p.close();
  }
  console.log(
    "Unknown/refused/legacy/invalid dialogue evidence, zero votes and not-assessed states PASS",
  );
}

async function verifyDialogueEmptyAndErrorStates() {
  let value = { id: "ep", panels: [], takes: [] };
  let failRead = true;
  const p = await createPanel(
    async (message) => {
      if (message.request_id === "episode" && failRead)
        return { status: 503, data: { detail: "review unavailable" } };
      return { data: structuredClone(value) };
    },
    { locale: "en" },
  );
  try {
    await p.click("load");
    assert.match(p.$("status").textContent, /503.*review unavailable/);
    assert.equal(p.$("takes").querySelector(".dialogue-result"), null);
    failRead = false;
    await p.click("load");
    assert.match(p.$("takes").textContent, /This episode has no panels/);
    assert.equal(p.$("review-episode").disabled, true);
    assert.equal(p.$("review-selected").disabled, true);
    assert.equal(p.$("takes").querySelector(".dialogue-result"), null);
    value = { id: "ep", panels: [{ id: "p1", order: 0 }], takes: [] };
    await p.click("load");
    assert.match(p.$("takes").textContent, /No candidate images/);
    assert.equal(p.$("takes").querySelector(".dialogue-result"), null);
  } finally {
    p.close();
  }
  console.log("Empty and failed reads do not invent dialogue score cards PASS");
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
    const beforeSelected = p.calls.length;
    await p.click("review-selected");
    assert.equal(p.$("confirmation").hidden, false);
    assert.match(p.$("confirmation-message").textContent, /1/);
    assert.equal(p.w.document.activeElement, p.$("cancel-action"));
    assert.equal(
      p.calls.length,
      beforeSelected,
      "selected review waits for confirmation",
    );
    await p.click("cancel-action");
    assert.equal(p.$("confirmation").hidden, true);
    assert.equal(
      p.calls.length,
      beforeSelected,
      "cancelling selected review submits nothing",
    );
    await p.click("review-selected");
    p.choose("low", false);
    p.choose("high");
    await p.click("confirm-action");
    const review = p.calls
      .filter((call) => call.request_id === "review")
      .at(-1);
    assert.deepEqual(
      Array.from(review.body.take_ids),
      ["low"],
      "confirming uses the selection captured when the prompt opened",
    );
    assert.equal(review.body.auto_adopt, false);
    assert.ok(review.body.idempotency_key);
    assert.equal(
      p.$("status").textContent,
      "Review queued. Refresh to check progress. Retrying the same selection reuses its idempotency key.",
    );
    const beforeWhole = p.calls.length;
    await p.click("review-episode");
    assert.equal(p.$("confirmation").hidden, false);
    assert.match(p.$("confirmation-message").textContent, /4/);
    assert.equal(
      p.calls.length,
      beforeWhole,
      "whole-episode review waits for confirmation",
    );
    p.$("cancel-action").dispatchEvent(
      new p.w.KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    await flush();
    assert.equal(p.$("confirmation").hidden, true);
    assert.equal(
      p.calls.length,
      beforeWhole,
      "Escape cancels whole-episode review",
    );
    await p.click("review-episode");
    await p.click("confirm-action");
    const whole = p.calls.filter((call) => call.request_id === "review").at(-1);
    assert.equal(whole.body.auto_adopt, false);
    assert.deepEqual(Array.from(whole.body.take_ids).sort(), [
      "high",
      "low",
      "middle",
      "unreviewed",
    ]);
    const beforeAdopt = p.calls.length;
    await p.click("adopt-top");
    assert.equal(p.$("confirmation").hidden, false);
    assert.match(p.$("confirmation-message").textContent, /1/);
    assert.equal(
      p.calls.length,
      beforeAdopt,
      "batch adoption waits for confirmation",
    );
    await p.click("cancel-action");
    assert.equal(p.$("confirmation").hidden, true);
    assert.equal(
      p.calls.length,
      beforeAdopt,
      "cancelling batch adoption submits nothing",
    );
    await p.click("adopt-top");
    await p.click("confirm-action");
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
    const beforeClose = p.calls.length;
    await p.click("review-episode");
    assert.equal(p.$("confirmation").hidden, false);
    p.w.dispatchEvent(new p.w.Event("pagehide"));
    await flush();
    assert.equal(
      p.$("confirmation").hidden,
      true,
      "pagehide cancels pending confirmation",
    );
    await p.click("confirm-action");
    assert.equal(
      p.calls.length,
      beforeClose,
      "a closed confirmation cannot submit a request",
    );
  } finally {
    p.close();
  }
  console.log(
    "Inline confirmation/cancellation/Escape, single/episode VLM review, explicit adoption/rejection, top-score batch, pagehide and job refresh PASS",
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
  await verifyDialogueScoringAndLocales();
  await verifyDialogueUnknownAndNotAssessed();
  await verifyDialogueEmptyAndErrorStates();
  await verifyReviewActionsAndBatchAdoption();
  await verifyErrorsAndImageBridge();
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
