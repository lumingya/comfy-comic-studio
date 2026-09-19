import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { chromium } from "playwright";
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "mio-mapper-"));
const server = spawn("python", ["server.py"], {
  env: {
    ...process.env,
    MIO_DATA_DIR: temp,
    MIO_HOST: "127.0.0.1",
    MIO_PORT: "18821",
  },
  stdio: "ignore",
});
const url = "http://127.0.0.1:18821",
  artifacts = "docs/acceptance-workflow";
fs.mkdirSync(artifacts, { recursive: true });
let browser,
  count = 0;
const check = (v, label) => {
  assert.ok(v, label);
  count++;
  console.log("PASS " + label);
};
try {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(url + "/api/content")).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  browser = await chromium.launch({ args: ["--no-sandbox"] });
  const p = await browser.newPage({
      viewport: { width: 1568, height: 1080 },
      reducedMotion: "reduce",
    }),
    errors = [];
  p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(url);
  await p.waitForFunction(() => typeof rt !== "undefined" && !rt.booting);
  await p.evaluate(() => {
    document.querySelectorAll("dialog[open]").forEach((d) => d.close());
    state.settings.identity.onboarded = true;
    guidePreferences().seen = true;
    navigate(3);
  });
  check(
    (await p.locator(".wm-row").count()) === 8,
    "all eight mappings visible in compact list",
  );
  check(
    (await p.locator(".wm-inspector .mapping-rule").count()) === 1,
    "one editor rather than eight expanded forms",
  );
  check(
    (await p.locator(".wm-connection").getAttribute("open")) === null,
    "connection settings start folded",
  );
  await p.screenshot({ path: artifacts + "/desktop.png", fullPage: true });
  await p.locator("#wm-binding-search").fill("not-a-field");
  check(
    (await p.locator(".wm-row").count()) === 0,
    "mapping search empty state",
  );
  await p.locator("#wm-binding-search").fill("width");
  check(
    (await p.locator(".wm-row").count()) === 1,
    "mapping search matches input paths",
  );
  await p.locator(".wm-row-select").click();
  check(
    (await p.locator('[data-v3-binding="path"]').inputValue()) === "width",
    "select row edits the right target",
  );
  await p.locator("#wm-binding-search").fill("");
  await p.locator('[data-v3-binding="source"]').selectOption("literal");
  await p.locator('[data-v3-binding="value"]').fill("896");
  check(
    await p.evaluate(() => mapperSelectedBinding().value === "896"),
    "typing updates canonical workflow state",
  );
  check(
    (await p.locator(".wm-row.selected .wm-value").innerText()) === "896",
    "list updates while editing without losing input focus",
  );
  await p.locator(".wm-row.selected>input").uncheck();
  await p.locator('[data-act="wm-filter"][data-filter="enabled"]').click();
  check(
    (await p.locator(".wm-row").count()) === 7,
    "enabled filter respects toggles",
  );
  await p.locator('[data-act="wm-filter"][data-filter="all"]').click();
  await p.locator(".wm-row.selected>input").check();
  await p.locator('[data-act="wm-nodes"]').first().click();
  await p.locator("#v3-node-search").fill("ckpt_name");
  check(
    (await p.locator(".node-group").count()) === 1,
    "node browser searches actual inputs",
  );
  await p
    .locator('[data-act="v3-expose-input"][data-path="/ckpt_name"]')
    .click();
  check(
    (await p.locator(".wm-row").count()) === 9,
    "add field produces a new mapping",
  );
  check(
    (await p.locator('[data-v3-binding="path"]').inputValue()) === "/ckpt_name",
    "new mapping selected immediately",
  );
  await p.locator('[data-v3-binding="label"]').fill("模型选择");
  await p.locator('[data-v3-binding="path"]').fill("/missing");
  await p.locator('[data-v3-binding="path"]').press("Tab");
  await p.locator('[data-act="wm-tab"][data-tab="check"]').click();
  check(
    (await p.locator(".wm-issue").count()) === 1,
    "preflight detects missing field",
  );
  await p.locator(".wm-issue").click();
  await p.locator('[data-v3-binding="path"]').fill("/ckpt_name");
  await p.locator('[data-v3-binding="path"]').press("Tab");
  check(
    await p.evaluate(() => mapperBindingIssues().length === 0),
    "fixing target clears preflight error",
  );
  const snap = await p.evaluate(() => mappedExecutionSnapshot());
  await p
    .locator('[data-v3-binding="value"]')
    .fill("changed-model.safetensors");
  check(
    snap.workflow["4"].inputs.ckpt_name !==
      (await p.locator('[data-v3-binding="value"]').inputValue()),
    "execution snapshots remain detached",
  );
  check(
    await p.evaluate(async () => await savePythonWorkspace()),
    "backend acknowledges save",
  );
  await p.reload();
  await p.waitForFunction(() => typeof rt !== "undefined" && !rt.booting);
  await p.evaluate(() => navigate(3));
  check(
    await p.evaluate(() =>
      state.settings.comfy.bindings.some(
        (b) =>
          b.label === "模型选择" && b.value === "changed-model.safetensors",
      ),
    ),
    "edits persist through reload",
  );
  await p.locator("#wm-binding-search").fill("模型选择");
  await p.locator(".wm-row-select").click();
  await p.locator('[data-act="v3-remove-binding"]').click();
  await p.locator("#confirm-yes").click();
  await p.locator("#wm-binding-search").fill("");
  check(
    (await p.locator(".wm-row").count()) === 8,
    "delete removes mapping only",
  );
  check(
    await p.evaluate(
      () => Object.keys(state.settings.comfy.workflow).length === 7,
    ),
    "delete preserves original nodes",
  );
  const downloadPromise = p.waitForEvent("download");
  await p.locator('[data-act="v3-export-mapping"]').click();
  const download = await downloadPromise;
  await download.saveAs(path.join(temp, "roundtrip.json"));
  const exported = JSON.parse(
    fs.readFileSync(path.join(temp, "roundtrip.json")),
  );
  check(
    exported.bindings.length === 8 &&
      exported.kind === "comfycomic.workflow-mappings",
    "export downloads a real mapping package",
  );
  await p.locator('[data-act="wm-tab"][data-tab="settings"]').click();
  const chooserPromise = p.waitForEvent("filechooser");
  await p.locator('[data-act="v3-import-mapping"]').click();
  await (await chooserPromise).setFiles(path.join(temp, "roundtrip.json"));
  await p.waitForFunction(() => state.settings.comfy.presets.length === 2);
  check(
    await p.evaluate(() => state.settings.comfy.bindings.length === 8),
    "imported package round trips all mappings",
  );
  if (await p.locator("#modal[open]").count())
    await p.locator('[data-act="close-modal"]').first().click();
  await p.locator('[data-act="wm-tab"][data-tab="bindings"]').click();
  check(
    await p.evaluate(() => {
      const r = buildMappedWorkflow(
        { prompt: "test", negative: "", renderOverride: false },
        { bookTitle: "test" },
        { preview: true },
      );
      return (
        r.workflow["5"].inputs.width === 896 &&
        r.changes.some((c) => c.path === "text")
      );
    }),
    "application source resolver uses new pure compiler",
  );
  await p.locator('[data-act="ws-copy"]').click();
  check(
    await p.evaluate(() => state.settings.comfy.presets.length === 3),
    "copy creates independently editable workflow",
  );
  const title = await p.locator(".wm-title").inputValue();
  await p.locator(".wm-title").fill("独立测试副本");
  await p.locator(".wm-title").press("Tab");
  await p.evaluate(() => savePythonWorkspace());
  await p.locator(".workflow-library-item").first().click();
  check(
    (await p.locator(".wm-title").inputValue()) !== title &&
      (await p.locator(".wm-title").inputValue()) !== "独立测试副本",
    "switch returns to untouched original workflow title",
  );
  await p.locator("#wm-library-search").fill("不存在");
  check(
    (await p.locator(".workflow-library-item:visible").count()) === 0,
    "library search filters workflows",
  );
  await p.locator("#wm-library-search").fill("");
  await p.locator('[data-act="v3-preview-workflow"]').click();
  check(
    (await p.locator("#modal[open]").count()) === 1,
    "submission preview opens",
  );
  await p.locator('[data-act="close-modal"]').first().click();
  await p.setViewportSize({ width: 390, height: 844 });
  check(
    await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    "mobile has no horizontal overflow",
  );
  await p.locator("#ws-library-select").selectOption({ label: "独立测试副本" });
  check(
    (await p.locator(".wm-title").inputValue()) === "独立测试副本",
    "mobile workflow switch works",
  );
  await p.locator(".wm-row-select").first().click();
  check(
    await p.locator(".wm-inspector").isVisible(),
    "mobile selection exposes inspector",
  );
  await p.screenshot({ path: artifacts + "/mobile.png", fullPage: true });
  await p.setViewportSize({ width: 1280, height: 800 });
  check(
    await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    "laptop layout fits viewport",
  );
  await p.setViewportSize({ width: 1568, height: 1080 });
  await p.evaluate(() => {
    state.settings.studio.appearance.theme = "light";
    applyStudioPreferences();
  });
  await p.screenshot({ path: artifacts + "/light.png", fullPage: true });
  check(
    await p.evaluate(() => document.documentElement.dataset.theme === "light"),
    "light theme remains applied",
  );
  check(
    errors.length === 0,
    "no uncaught browser exceptions: " + errors.join("; "),
  );
  console.log(`WORKFLOW WORKBENCH: ${count} assertions PASS`);
} finally {
  await browser?.close();
  server.kill();
  fs.rmSync(temp, { recursive: true, force: true });
}
