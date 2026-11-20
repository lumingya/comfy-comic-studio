const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("../../web/node_modules/jsdom");
const root = path.join(__dirname, "../../examples/extensions");
const flush = async () => {
  for (let i = 0; i < 5; i++) await new Promise(setImmediate);
};

async function panel(id, backend) {
  const dir = path.join(root, id);
  const dom = new JSDOM(fs.readFileSync(path.join(dir, "panel.html"), "utf8"), {
    url: "https://local.invalid/#mio-session=fixture",
    runScripts: "outside-only",
    pretendToBeVisual: true,
  });
  const w = dom.window;
  const calls = [];
  const parent = {
    postMessage(message) {
      if (message.type !== "mio:panel:request") return;
      calls.push(message);
      queueMicrotask(async () => {
        const reply = await backend(message);
        w.dispatchEvent(
          new w.MessageEvent("message", {
            source: parent,
            data: {
              type: "mio:panel:response",
              version: 1,
              session: "fixture",
              rid: message.rid,
              status: reply.status ?? 200,
              ok: (reply.status ?? 200) < 400,
              data: reply.data,
            },
          }),
        );
      });
    },
  };
  Object.defineProperty(w, "parent", { value: parent });
  w.HTMLElement.prototype.scrollIntoView = function () {
    this.dataset.located = "true";
  };
  w.eval(fs.readFileSync(path.join(dir, "panel.js"), "utf8"));
  w.dispatchEvent(
    new w.MessageEvent("message", {
      source: parent,
      data: {
        type: "mio:panel:init",
        version: 1,
        session: "fixture",
        context: { episode_id: "ep", series_id: "series" },
      },
    }),
  );
  return {
    w,
    calls,
    close: () => w.close(),
    $: (id) => w.document.getElementById(id),
    click: async (id) => {
      w.document.getElementById(id).click();
      await flush();
    },
    choose: (id, checked) => {
      const el = w.document.querySelector(`input[value="${id}"]`);
      el.checked = checked;
      el.dispatchEvent(new w.Event("change"));
    },
  };
}

async function qa() {
  const episode = {
    panels: [1, 2, 3, 4].map((n) => ({ id: "p" + n, order: n - 1 })),
    takes: [
      {
        id: "empty",
        panel_id: "p1",
        stage: "draft",
        status: "candidate",
        qa: null,
      },
      {
        id: "zero",
        panel_id: "p2",
        stage: "draft",
        status: "candidate",
        qa: { passed: true, score: 1, votes: 0, issues: ["Skipped"] },
      },
      {
        id: "failed",
        panel_id: "p3",
        stage: "draft",
        status: "adopted",
        qa: {
          passed: false,
          score: 0.3,
          votes: 3,
          issues: ["Identity drift"],
          identity: [{ character_id: "char", score: 2, missing: ["hat"] }],
        },
      },
      {
        id: "passed",
        panel_id: "p4",
        stage: "draft",
        status: "candidate",
        qa: { passed: true, score: 0.9, votes: 3, issues: [] },
      },
    ],
  };
  const p = await panel("qa-review", async (message) => ({
    data:
      message.request_id === "episode"
        ? episode
        : { id: "job", state: "completed", items: [{ state: "complete" }] },
  }));
  try {
    assert.equal(p.calls.length, 0, "opening is inert");
    await p.click("load");
    assert.deepEqual(
      p.calls.map((c) => c.request_id),
      ["episode"],
    );
    assert.equal(
      (p.$("takes").textContent.match(/100\/100/g) ?? []).length,
      0,
      "zero votes is never a fabricated perfect score",
    );
    assert.ok(p.$("takes").textContent.includes("30/100"));
    assert.ok(p.$("takes").textContent.includes("Identity drift"));
    p.$("issues").querySelector("button").click();
    assert.equal(p.w.document.querySelector("article").dataset.located, "true");
    p.choose("failed", true);
    p.choose("passed", true);
    await p.click("review");
    await p.click("review");
    const submits = p.calls.filter((c) => c.request_id === "review");
    assert.equal(submits.length, 2);
    assert.equal(submits[0].body.auto_adopt, false);
    assert.equal(
      submits[0].body.idempotency_key,
      submits[1].body.idempotency_key,
    );
    p.$("problems-only").checked = true;
    p.$("problems-only").dispatchEvent(new p.w.Event("change"));
    await p.click("review");
    const filtered = p.calls.filter((c) => c.request_id === "review").at(-1);
    assert.deepEqual(Array.from(filtered.body.take_ids), ["failed"]);
    assert.notEqual(
      filtered.body.idempotency_key,
      submits[0].body.idempotency_key,
    );
    await p.click("refresh-job");
    assert.ok(p.$("job").textContent.includes("1/1"));
  } finally {
    p.close();
  }
  console.log(
    "QA DOM: inert, actual scoring, issue location, explicit non-adoption, idempotency, filtered selection, progress PASS",
  );
}

async function script() {
  let revision = 4;
  let applyStatus = 200;
  let proposalStatus = 200;
  const episode = () => ({
    id: "ep",
    revision,
    panels: [1, 2, 3].map((n) => ({ id: "p" + n, order: n - 1 })),
  });
  const proposal = {
    base_revision: 4,
    ops: [
      {
        id: "op1",
        target: "p1",
        op: "update_panel",
        summary: "Description",
        changes: { description: ["Old", "New"] },
      },
      {
        id: "op2",
        target: "p2",
        op: "update_panel",
        summary: "Dialogue",
        changes: {
          dialogue: [[{ text: "Long line" }], [{ text: "Short line" }]],
        },
      },
      {
        id: "op3",
        target: "p3",
        op: "update_panel",
        summary: "Locked",
        blocked: "Locked panel",
        changes: { description: ["Locked old", "Locked new"] },
      },
    ],
  };
  const p = await panel("script-review", async (message) => {
    if (message.request_id === "episode") return { data: episode() };
    if (message.request_id === "propose")
      return {
        status: proposalStatus,
        data:
          proposalStatus === 200
            ? proposal
            : { detail: "Offline model unavailable" },
      };
    return {
      status: applyStatus,
      data:
        applyStatus === 200
          ? { applied: message.body.accepted, revision: 5 }
          : { detail: "Conflict" },
    };
  });
  try {
    assert.equal(p.calls.length, 0, "opening is inert");
    p.$("instruction").value = "Shorten dialogue";
    p.$("instruction").dispatchEvent(new p.w.Event("input"));
    await p.click("propose");
    assert.equal(p.calls.filter((c) => c.request_id === "apply").length, 0);
    assert.equal(p.$("ops").querySelectorAll("input:checked").length, 0);
    assert.ok(p.$("apply").disabled);
    assert.ok(p.$("ops").textContent.includes("Short line"));
    assert.ok(p.$("ops").textContent.includes("Long line"));
    assert.ok(p.w.document.querySelector('input[value="op3"]').disabled);
    await p.click("accept-all");
    assert.equal(p.$("ops").querySelectorAll("input:checked").length, 2);
    await p.click("reject-all");
    assert.equal(p.$("ops").querySelectorAll("input:checked").length, 0);
    p.choose("op2", true);
    await p.click("apply");
    const accepted = p.calls
      .filter((c) => c.request_id === "apply")
      .at(-1).body;
    assert.deepEqual(Array.from(accepted.accepted), ["op2"]);
    assert.equal(accepted.base_revision, 4);
    assert.ok(p.$("apply").disabled);
    await p.click("propose");
    p.choose("op2", true);
    revision = 6;
    const applyCount = p.calls.filter((c) => c.request_id === "apply").length;
    await p.click("apply");
    assert.equal(
      p.calls.filter((c) => c.request_id === "apply").length,
      applyCount,
      "known stale revision is blocked before mutation",
    );
    assert.ok(p.$("apply").disabled);
    revision = 4;
    applyStatus = 409;
    await p.click("propose");
    p.choose("op2", true);
    await p.click("apply");
    assert.ok(
      p.$("apply").disabled,
      "concurrent conflict disables old proposal",
    );
    proposalStatus = 500;
    await p.click("propose");
    assert.equal(p.$("ops").childElementCount, 0);
    assert.ok(
      p.$("apply").disabled,
      "failed regeneration cannot reactivate an old proposal",
    );
  } finally {
    p.close();
  }
  console.log(
    "Script DOM: inert, sentence diff, blocked selection, explicit subset apply, stale/racing revisions, failed regeneration PASS",
  );
}

(async () => {
  await qa();
  await script();
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
