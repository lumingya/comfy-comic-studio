const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("../../web/node_modules/jsdom");

const root = __dirname;
const flush = async () => {
  for (let index = 0; index < 6; index++) await new Promise(setImmediate);
};
const plain = (value) => JSON.parse(JSON.stringify(value));
const episode = (revision = 4) => ({
  id: "episode-a",
  series_id: "series-a",
  revision,
  panels: [
    { id: "panel-a", order: 0, description: "Opening", width_mode: "full" },
  ],
});
const proposal = {
  base_revision: 4,
  ops: [
    {
      id: "op-a",
      target: "panel-a",
      op: "update_panel",
      summary: "Shorten the description",
      changes: { description: ["Old", "<script>alert(1)</script>"] },
    },
  ],
};

async function createPanel(backend) {
  const dom = new JSDOM(
    fs.readFileSync(path.join(root, "panel.html"), "utf8"),
    {
      url: "https://local.invalid/#mio-session=fixture",
      runScripts: "outside-only",
      pretendToBeVisual: true,
    },
  );
  const window = dom.window;
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
      const response = await backend(message);
      hostPort.postMessage({
        type: "mio:panel:response",
        version: 2,
        session: "fixture",
        rid: message.rid,
        status: response.status ?? 200,
        ok: (response.status ?? 200) >= 200 && (response.status ?? 200) < 300,
        data: response.data,
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
  Object.defineProperty(window, "parent", { value: parent });
  Object.defineProperty(window, "MessageChannel", { value: MessageChannel });
  window.eval(fs.readFileSync(path.join(root, "panel.js"), "utf8"));
  window.dispatchEvent(
    new window.MessageEvent("message", {
      source: parent,
      data: {
        type: "mio:panel:init",
        version: 2,
        session: "fixture",
        context: { episode_id: "wrong" },
      },
    }),
  );
  assert.equal(calls.length, 0, "window init cannot start business requests");
  const send = (data) =>
    hostPort.postMessage({ version: 2, session: "fixture", ...data });
  send({
    type: "mio:panel:init",
    session: "fixture",
    context: { episode_id: "episode-a", series_id: "series-a" },
    appearance: {
      locale: "en",
      theme: "dark",
      tokens: { bg: "#121212", text: "#eeeeee", accent: "#e2b77d" },
    },
  });
  const initialTheme = window.document.documentElement.dataset.theme;
  window.dispatchEvent(
    new window.MessageEvent("message", {
      source: parent,
      data: {
        type: "mio:panel:appearance",
        version: 2,
        session: "fixture",
        appearance: {
          locale: "zh-CN",
          theme: "light",
          tokens: { accent: "#ffffff" },
        },
      },
    }),
  );
  assert.equal(
    window.document.documentElement.dataset.theme,
    initialTheme,
    "window appearance cannot change the panel",
  );
  await flush();
  return {
    window,
    calls,
    send,
    $: (id) => window.document.getElementById(id),
    click: async (id) => {
      window.document.getElementById(id).click();
      await flush();
    },
    choose: (id, checked) => {
      const input = window.document.querySelector(`input[value="${id}"]`);
      input.checked = checked;
      input.dispatchEvent(new window.Event("change"));
    },
    close: () => {
      window.dispatchEvent(new window.Event("pagehide"));
      assert.equal(childPort.closed, true);
      assert.equal(windowSent.length, 1, "only ready uses the window channel");
      window.close();
    },
  };
}

async function scriptReviewCheckpointAndTheme() {
  const panel = await createPanel(async (request) => {
    if (request.request_id === "episode") return { data: episode() };
    if (request.request_id === "propose") return { data: proposal };
    if (request.request_id === "work-head")
      return { data: { head: "a".repeat(64) } };
    if (request.request_id === "checkpoint")
      return {
        data: {
          id: "checkpoint-a",
          name: request.body.name,
          head: "b".repeat(64),
        },
      };
    if (request.request_id === "apply")
      return { data: { applied: request.body.accepted, revision: 5 } };
    throw new Error(`Unexpected request ${request.request_id}`);
  });
  try {
    assert.equal(panel.calls.length, 0, "opening the panel is inert");
    assert.equal(panel.$("title").textContent, "Script assistant · Mio");
    assert.equal(panel.window.document.documentElement.dataset.theme, "dark");
    assert.equal(
      panel.window.document.documentElement.style.getPropertyValue("--accent"),
      "#e2b77d",
    );
    panel.$("instruction").value = "Tighten the opening";
    panel.$("instruction").dispatchEvent(new panel.window.Event("input"));
    await panel.click("propose");
    assert.equal(
      panel.calls.filter((call) => call.request_id === "apply").length,
      0,
    );
    assert.equal(panel.$("ops").querySelectorAll("input:checked").length, 0);
    assert.ok(panel.$("ops").textContent.includes("<script>alert(1)</script>"));
    assert.equal(
      panel.$("ops").querySelector("script"),
      null,
      "proposal content is rendered as text",
    );
    panel.choose("op-a", true);
    await panel.click("apply");
    const checkpointIndex = panel.calls.findIndex(
      (call) => call.request_id === "checkpoint",
    );
    const applyIndex = panel.calls.findIndex(
      (call) => call.request_id === "apply",
    );
    assert.ok(
      checkpointIndex >= 0 && checkpointIndex < applyIndex,
      "checkpoint precedes write",
    );
    assert.equal(
      panel.calls[checkpointIndex].body.expected_head,
      "a".repeat(64),
    );
    assert.deepEqual(Array.from(panel.calls[applyIndex].body.accepted), [
      "op-a",
    ]);
    assert.equal(panel.calls[applyIndex].body.base_revision, 4);
    assert.ok(panel.$("status").textContent.includes("Applied 1 changes"));

    panel.send({
      type: "mio:panel:appearance",
      appearance: {
        locale: "zh-CN",
        theme: "light",
        tokens: { accent: "#c45742" },
      },
    });
    assert.equal(panel.$("title").textContent, "剧本助手 · Mio");
    assert.equal(panel.window.document.documentElement.dataset.theme, "light");
    assert.equal(
      panel.window.document.documentElement.style.getPropertyValue("--accent"),
      "#c45742",
    );
  } finally {
    panel.close();
  }
}

async function staleProposalIsNotCheckpointedOrApplied() {
  let revision = 4;
  const panel = await createPanel(async (request) => {
    if (request.request_id === "episode") return { data: episode(revision) };
    if (request.request_id === "propose") return { data: proposal };
    return { data: {} };
  });
  try {
    panel.$("instruction").value = "Revise";
    panel.$("instruction").dispatchEvent(new panel.window.Event("input"));
    await panel.click("propose");
    panel.choose("op-a", true);
    revision = 5;
    await panel.click("apply");
    assert.equal(
      panel.calls.some((call) => call.request_id === "checkpoint"),
      false,
    );
    assert.equal(
      panel.calls.some((call) => call.request_id === "apply"),
      false,
    );
    assert.ok(panel.$("status").textContent.includes("work changed"));
    assert.equal(panel.$("apply").disabled, true);
  } finally {
    panel.close();
  }
}

async function pacingReviewUsesRevisionAndSubset() {
  const panel = await createPanel(async (request) => {
    if (request.request_id === "episode") return { data: episode() };
    if (request.request_id === "pacing-suggest")
      return {
        data: {
          revision: 4,
          suggestions: [
            {
              panel_id: "panel-a",
              order: 0,
              changes: { width_mode: "inset", gap_after: 48 },
              reasons: ["Beat after dialogue"],
            },
          ],
        },
      };
    if (request.request_id === "pacing-apply") return { data: episode(5) };
    throw new Error(`Unexpected request ${request.request_id}`);
  });
  try {
    await panel.click("suggest-pacing");
    assert.deepEqual(plain(panel.calls[1].query), { preset: "auto" });
    assert.equal(
      panel.$("pacing-ops").querySelectorAll("input:checked").length,
      0,
    );
    const box = panel.$("pacing-ops").querySelector("input");
    box.checked = true;
    box.dispatchEvent(new panel.window.Event("change"));
    await panel.click("apply-pacing");
    const apply = panel.calls.find(
      (call) => call.request_id === "pacing-apply",
    );
    assert.equal(apply.body.base_revision, 4);
    assert.deepEqual(plain(apply.body.patches), [
      { panel_id: "panel-a", changes: { width_mode: "inset", gap_after: 48 } },
    ]);
    assert.equal(panel.$("pacing-ops").querySelector("input").disabled, true);
  } finally {
    panel.close();
  }
}

async function proposalErrorsAreVisible() {
  const panel = await createPanel(async (request) => {
    if (request.request_id === "episode") return { data: episode() };
    return { status: 503, data: { detail: "Model service unavailable" } };
  });
  try {
    panel.$("instruction").value = "Revise";
    panel.$("instruction").dispatchEvent(new panel.window.Event("input"));
    await panel.click("propose");
    assert.ok(
      panel.$("status").textContent.includes("Could not generate a proposal"),
    );
    assert.ok(
      panel.$("status").textContent.includes("Model service unavailable"),
    );
    assert.equal(panel.$("ops").childElementCount, 0);
    assert.equal(panel.$("apply").disabled, true);
  } finally {
    panel.close();
  }
}

async function emptyStoryboardDoesNotRequestModelSuggestions() {
  const panel = await createPanel(async (request) => {
    assert.equal(request.request_id, "episode", "empty documents only need a local read");
    return { data: { ...episode(), panels: [] } };
  });
  try {
    panel.$("instruction").value = "Revise";
    panel.$("instruction").dispatchEvent(new panel.window.Event("input"));
    await panel.click("propose");
    assert.deepEqual(panel.calls.map((call) => call.request_id), ["episode"]);
    assert.match(panel.$("ops").textContent, /There are no changes to review/);
    assert.match(panel.$("status").textContent, /No storyboard is available/);
    assert.equal(panel.$("apply").disabled, true);
    assert.equal(panel.$("checkpoint").disabled, true);
    assert.equal(panel.$("propose").disabled, false, "a later nonempty document can be reloaded");
    await panel.click("suggest-pacing");
    assert.deepEqual(panel.calls.map((call) => call.request_id), ["episode", "episode"]);
    assert.match(panel.$("pacing-status").textContent, /No storyboard is available/);
    assert.equal(panel.$("apply-pacing").disabled, true);
    assert.equal(panel.$("suggest-pacing").disabled, false);
  } finally {
    panel.close();
  }
}

function packageContractAndResponsiveKeyboardControls() {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(root, "mio-extension.json"), "utf8"),
  );
  assert.equal(manifest.id, "script-assistant");
  const panel = manifest.contributes.panels[0];
  assert.equal(panel.slot, "episode");
  const requests = Object.fromEntries(
    panel.requests.map((item) => [item.id, item]),
  );
  assert.deepEqual(
    [
      requests.propose.path,
      requests.apply.path,
      requests["pacing-suggest"].path,
      requests["pacing-apply"].path,
    ],
    [
      "/episodes/{episode_id}/assistant/propose",
      "/episodes/{episode_id}/assistant/apply",
      "/episodes/{episode_id}/pacing/suggest",
      "/episodes/{episode_id}/pacing/apply",
    ],
  );
  assert.equal(requests.propose.scope, "render");
  assert.equal(requests.apply.scope, "write");
  assert.equal(requests.checkpoint.scope, "write");
  const html = fs.readFileSync(path.join(root, "panel.html"), "utf8");
  assert.match(html, /@media\s*\(max-width:\s*640px\)/);
  assert.match(html, /button:focus-visible/);
  assert.match(html, /aria-live="polite"/);
  assert.doesNotMatch(html, /tabindex="-1"/);
}

(async () => {
  await scriptReviewCheckpointAndTheme();
  await staleProposalIsNotCheckpointedOrApplied();
  await pacingReviewUsesRevisionAndSubset();
  await proposalErrorsAreVisible();
  await emptyStoryboardDoesNotRequestModelSuggestions();
  packageContractAndResponsiveKeyboardControls();
  console.log(
    "Script Assistant DOM: inert start, theme/locale, safe diff, checkpoint-before-apply, stale revision, pacing subset and error state PASS",
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
