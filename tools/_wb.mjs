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
const bind = (id, label, nodeId, path, source, value = "", type = "auto") => ({
  id, label, nodeId, path, type, source, value, enabled: true, autoField: false, warning: "", allowCreate: false, allowLink: false,
});
const FIXTURE = {
  title: "Anime · 基础图像管线",
  outputNodeId: "9",
  workflow: {
    3: { class_type: "KSampler", _meta: { title: "KSampler" }, inputs: { seed: 156680208700286, steps: 20, cfg: 8, sampler_name: "euler", scheduler: "normal", denoise: 1, model: ["4", 0], positive: ["6", 0], negative: ["7", 0], latent_image: ["5", 0] } },
    4: { class_type: "CheckpointLoaderSimple", _meta: { title: "Load Checkpoint" }, inputs: { ckpt_name: "v1-5-pruned-emaonly.safetensors" } },
    5: { class_type: "EmptyLatentImage", _meta: { title: "Empty Latent Image" }, inputs: { width: 512, height: 512, batch_size: 1 } },
    6: { class_type: "CLIPTextEncode", _meta: { title: "Positive Prompt" }, inputs: { text: "masterpiece, best quality", clip: ["4", 1] } },
    7: { class_type: "CLIPTextEncode", _meta: { title: "Negative Prompt" }, inputs: { text: "lowres, bad anatomy", clip: ["4", 1] } },
    8: { class_type: "VAEDecode", _meta: { title: "VAE Decode" }, inputs: { samples: ["3", 0], vae: ["4", 2] } },
    9: { class_type: "SaveImage", _meta: { title: "Save Image" }, inputs: { filename_prefix: "ComfyUI", images: ["8", 0] } },
  },
  bindings: [
    bind("bind_pos", "正向提示词", "6", "text", "positive", "", "text"),
    bind("bind_neg", "负向提示词", "7", "text", "negative", "", "text"),
    bind("bind_width", "画面宽度", "5", "width", "sceneParameter", "width", "number"),
    bind("bind_height", "画面高度", "5", "height", "sceneParameter", "height", "number"),
    bind("bind_steps", "采样步数", "3", "steps", "sceneParameter", "steps", "number"),
    bind("bind_cfg", "CFG", "3", "cfg", "sceneParameter", "cfg", "number"),
    bind("bind_seed", "随机种子", "3", "seed", "random", "", "number"),
    bind("bind_prefix", "输出文件前缀", "9", "filename_prefix", "bookTitle", "", "text"),
  ],
};
const url = "http://127.0.0.1:18821",
  artifacts = "/tmp/acc";
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
  const boot = async () => {
    console.log("boot: waiting"); try { await p.waitForFunction(() => typeof rt !== "undefined" && !rt.booting && backendRuntime.connected, null, {timeout: 15000}); } catch (e) { console.log("boot state", await p.evaluate(() => JSON.stringify({rt: typeof rt, booting: typeof rt !== "undefined" ? rt.booting : null, br: typeof backendRuntime !== "undefined" ? backendRuntime.connected : null, err: typeof backendRuntime !== "undefined" ? backendRuntime.error : null, url: location.href}))); throw e; }
    await p.evaluate(() => {
      document.querySelectorAll("dialog[open]").forEach((d) => d.close());
      state.settings.identity.onboarded = true;
      guidePreferences().seen = true;
      // Shipped application.json carries feature switches the studio defaults no longer list;
      // drop them so validateState() accepts the fixture workspace (independent of this page).
      for (const key of Object.keys(state.settings.studio.features || {}))
        if (!Object.hasOwn(studioDefaults.features, key)) delete state.settings.studio.features[key];
      navigate(3);
    });
  };
  await p.goto(url);
  await boot();
  // A self-contained fixture: the classic seven-node ComfyUI graph with eight bindings,
  // so the acceptance run never depends on whichever workflow ships in data/.
  console.log("before import", await p.evaluate(() => JSON.stringify(state.settings.comfy.presets.map(x => [x.id, x.title])))); await p.evaluate((fixture) => importWorkflowIntoMapper(fixture), FIXTURE); console.log("after import", await p.evaluate(() => JSON.stringify(state.settings.comfy.presets.map(x => [x.id, x.title]))));
  await p.waitForFunction(() => state.settings.comfy.presets.length === 2);
  const saved = await p.evaluate(async () => ({ ok: await savePythonWorkspace(), error: backendRuntime.error }));
  check(saved.ok, "fixture workflow persisted before the run" + (saved.ok ? "" : " (" + saved.error + ")"));
  const basePresets = 2;

  /* ---- compact bar: one line, connection folded, description behind "?" */
  check(
    (await p.locator(".wm-row").count()) === 8,
    "all eight mappings visible in compact list",
  );
  check(
    (await p.locator(".wm-inspector .mapping-rule").count()) === 1,
    "one editor rather than eight expanded forms",
  );
  check(
    (await p.locator(".wm-connection").getAttribute("open")) === null &&
      (await p.locator("#wf-connection-body").isHidden()),
    "connection settings start folded",
  );
  const bar = await p.locator(".wf-bar").boundingBox();
  check(bar && bar.height < 72, `top bar is a single compact line (${Math.round(bar?.height)}px)`);
  check(
    (await p.locator(".wf-bar h1").isVisible()) &&
      (await p.locator(".wf-bar .wf-connection-state b").isVisible()) &&
      (await p.locator('.wf-bar [data-act="ws-open-unified-import"]').isVisible()),
    "title, connection status and add-workflow share the bar",
  );
  await p.locator('[data-act="wf-connection-toggle"]').click();
  check(
    (await p.locator("#wf-connection-body").isVisible()) &&
      (await p.locator("#wf-connection-body .image-provider-panel").count()) === 1,
    "connection summary expands the provider panel in place",
  );
  await p.locator('[data-act="wf-connection-toggle"]').click();
  check(await p.locator("#wf-connection-body").isHidden(), "connection panel folds again");
  await p.locator('[data-act="wf-help"]').click();
  check(
    (await p.locator("#modal[open] .wf-help-sheet").count()) === 1,
    "page description lives behind the ? button",
  );
  await p.locator('[data-act="close-modal"]').first().click();
  await p.screenshot({ path: artifacts + "/desktop.png", fullPage: true });

  /* ---- library rail: collapsed by default, slides out from the left edge, pin remembers */
  check(
    (await p.locator(".wf-body.rail-floating").count()) === 1 &&
      (await p.locator("#wf-rail").isHidden()),
    "workflow library starts collapsed behind the edge handle",
  );
  await p.hover(".wf-rail-handle");
  await p.waitForSelector(".wf-body.rail-open");
  check(await p.locator("#wf-rail .wf-item").first().isVisible(), "hovering the left edge slides the library out");
  await p.screenshot({ path: artifacts + "/rail-drawer.png" });
  await p.mouse.move(900, 600);
  await p.waitForFunction(() => !document.querySelector(".wf-body.rail-open"), null, { timeout: 3000 });
  check((await p.locator("#wf-rail").isHidden()), "library hides again when the pointer leaves");
  await p.hover(".wf-rail-handle");
  await p.waitForSelector(".wf-body.rail-open");
  await p.locator('[data-act="wf-rail-pin"]').click();
  await p.mouse.move(900, 600);
  await p.waitForTimeout(500);
  check(
    (await p.locator(".wf-body.rail-pinned").count()) === 1 &&
      (await p.locator("#wf-rail .wf-item").first().isVisible()) &&
      (await p.evaluate(() => localStorage.getItem("mio.workflow.railPinned"))) === "true",
    "pin keeps the library open and remembers the choice",
  );
  await p.reload();
  await boot();
  check((await p.locator(".wf-body.rail-pinned").count()) === 1, "pinned state survives reload");
  await p.locator('[data-act="wf-rail-pin"]').click();
  check(
    (await p.locator(".wf-body.rail-floating.rail-open").count()) === 1 &&
      (await p.locator("#wf-rail .wf-item").first().isVisible()),
    "unpin returns to the floating drawer but keeps it open under the pointer",
  );
  await p.locator('[data-act="wf-rail-pin"]').click();
  check((await p.locator(".wf-body.rail-pinned").count()) === 1, "re-pin for the rest of the run");

  /* ---- search + filter */
  await p.locator("#wm-binding-search").fill("not-a-field");
  check((await p.locator(".wm-row").count()) === 0, "mapping search empty state");
  await p.locator("#wm-binding-search").fill("width");
  check((await p.locator(".wm-row").count()) === 1, "mapping search matches input paths");
  await p.locator(".wm-row .wm-row-select").click();
  check(
    ["width", "/width"].includes(await p.locator('[data-v3-binding="path"]').inputValue()),
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
  check(
    (await p.locator("[data-wf-preview-new]").innerText()).includes("896"),
    "step ③ preview follows the typed value live",
  );
  await p.locator(".wm-row.selected .wf-row-switch input").uncheck();
  await p.locator("#wm-filter-select").selectOption("enabled");
  check((await p.locator(".wm-row").count()) === 7, "enabled filter respects toggles");
  await p.locator("#wm-filter-select").selectOption("all");
  await p.locator(".wm-row.selected .wf-row-switch input").check();

  /* ---- guided inspector: ① where ② what ③ preview, advanced folded */
  check(
    (await p.locator(".wf-steps .wf-step").count()) === 3 &&
      (await p.locator(".wf-step .wf-step-head strong").allInnerTexts()).join("|") === "写到哪里|填什么|效果预览",
    "inspector is a three-step guided form",
  );
  check(
    (await p.locator(".mapping-rule .wf-contract").innerText()).includes("写入") &&
      (await p.locator(".mapping-rule").innerText()).includes("生效时机") === false &&
      (await p.locator(".mapping-rule").innerText()).includes("作用范围") === false,
    "timing / scope / source collapse into one plain sentence",
  );
  check(
    (await p.locator(".wf-advanced[open]").count()) === 0 &&
      (await p.locator('.wf-advanced [data-v3-binding="type"]').count()) === 1,
    "data type is folded into advanced options",
  );
  check(
    (await p.locator('select[data-v3-binding="nodeId"]').count()) === 1 &&
      (await p.locator('select[data-v3-binding="path"]').count()) === 1,
    "target step offers node and field pickers instead of raw JSON pointers",
  );

  /* ---- node picker → new mapping */
  await p.locator('[data-act="wm-nodes"]').first().click();
  await p.locator("#v3-node-search").fill("ckpt_name");
  check((await p.locator(".node-group").count()) === 1, "node browser searches actual inputs");
  await p.locator('[data-act="v3-expose-input"][data-path="/ckpt_name"]').click();
  check((await p.locator(".wm-row").count()) === 9, "add field produces a new mapping");
  check(
    (await p.locator('[data-v3-binding="path"]').inputValue()) === "/ckpt_name",
    "new mapping selected immediately",
  );
  await p.locator('[data-v3-binding="label"]').fill("模型选择");
  await p.locator('[data-act="wf-field-custom"]').click();
  await p.locator('input[data-v3-binding="path"]').fill("/missing");
  await p.locator('input[data-v3-binding="path"]').press("Tab");
  await p.locator(".wf-health-chip.is-bad").click();
  check((await p.locator(".wm-issue").count()) === 1, "preflight detects missing field");
  await p.locator(".wm-issue").click();
  await p.locator('input[data-v3-binding="path"]').fill("/ckpt_name");
  await p.locator('input[data-v3-binding="path"]').press("Tab");
  check(
    await p.evaluate(() => mapperBindingIssues().length === 0),
    "fixing target clears preflight error",
  );
  const snap = await p.evaluate(() => mappedExecutionSnapshot());
  await p.locator('[data-v3-binding="value"]').fill("changed-model.safetensors");
  check(
    snap.workflow["4"].inputs.ckpt_name !== (await p.locator('[data-v3-binding="value"]').inputValue()),
    "execution snapshots remain detached",
  );
  check(await p.evaluate(async () => await savePythonWorkspace()), "backend acknowledges save");
  await p.reload();
  await boot();
  check(
    await p.evaluate(() =>
      state.settings.comfy.bindings.some((b) => b.label === "模型选择" && b.value === "changed-model.safetensors"),
    ),
    "edits persist through reload",
  );

  /* ---- context menus: edit / manage actions on right click */
  await p.locator("#wm-binding-search").fill("模型选择");
  await p.locator(".wm-row .wm-row-select").click({ button: "right" });
  check(
    (await p.locator("#wf-menu.is-context").count()) === 1 &&
      (await p.locator('#wf-menu [data-act="wf-binding-toggle"]').count()) === 1 &&
      (await p.locator('#wf-menu [data-act="wf-binding-rename"]').count()) === 1 &&
      (await p.locator('#wf-menu [data-act="v3-copy-binding"]').count()) === 1 &&
      (await p.locator('#wf-menu [data-act="v3-remove-binding"]').count()) === 1,
    "right-click on a mapping opens its edit / manage menu",
  );
  await p.screenshot({ path: artifacts + "/context-menu.png" });
  await p.locator('#wf-menu [data-act="wf-binding-toggle"]').click();
  check(
    await p.evaluate(() => state.settings.comfy.bindings.find((b) => b.label === "模型选择").enabled === false),
    "context menu toggles the mapping",
  );
  await p.locator(".wm-row .wf-row-more, .wm-row [data-act=\"wf-row-menu\"]").first().click();
  check((await p.locator('#wf-menu [data-act="v3-remove-binding"]').count()) === 1, "row ⋯ button opens the same menu");
  await p.locator('#wf-menu [data-act="v3-remove-binding"]').click();
  await p.locator("#confirm-yes").click();
  await p.locator("#wm-binding-search").fill("");
  check((await p.locator(".wm-row").count()) === 8, "delete removes mapping only");
  check(
    await p.evaluate(() => Object.keys(state.settings.comfy.workflow).length === 7),
    "delete preserves original nodes",
  );

  /* ---- ⋯ menu keeps the workflow-level utilities */
  await p.locator("#wf-menu-button").click();
  check(
    (await p.locator('#wf-menu [data-act="v3-export-mapping"]').count()) === 1 &&
      (await p.locator('#wf-menu [data-act="v3-import-mapping"]').count()) === 1 &&
      (await p.locator('#wf-menu [data-act="v3-preview-workflow"]').count()) === 1 &&
      (await p.locator('#wf-menu [data-act="v3-auto-bind"]').count()) === 1,
    "secondary actions moved into the ⋯ menu",
  );
  const downloadPromise = p.waitForEvent("download");
  await p.locator('#wf-menu [data-act="v3-export-mapping"]').click();
  const download = await downloadPromise;
  await download.saveAs(path.join(temp, "roundtrip.json"));
  const exported = JSON.parse(fs.readFileSync(path.join(temp, "roundtrip.json")));
  check(
    exported.bindings.length === 8 && exported.kind === "comfycomic.workflow-mappings",
    "export downloads a real mapping package",
  );
  await p.locator("#wf-menu-button").click();
  const chooserPromise = p.waitForEvent("filechooser");
  await p.locator('#wf-menu [data-act="v3-import-mapping"]').click();
  await (await chooserPromise).setFiles(path.join(temp, "roundtrip.json"));
  await p.locator("#confirm-yes").click();
  await p.waitForFunction((n) => state.settings.comfy.presets.length === n + 1, basePresets);
  check(
    await p.evaluate(() => state.settings.comfy.bindings.length === 8),
    "imported package round trips all mappings",
  );
  if (await p.locator("#modal[open]").count()) await p.locator('[data-act="close-modal"]').first().click();
  check(
    await p.evaluate(() => {
      const r = buildMappedWorkflow(
        { prompt: "test", negative: "", renderOverride: false },
        { bookTitle: "test" },
        { preview: true },
      );
      return r.workflow["5"].inputs.width === 896 && r.changes.some((c) => c.path === "text");
    }),
    "application source resolver uses new pure compiler",
  );

  /* ---- workflow context menu (rename / copy / export / delete) */
  await p.locator("#wf-rail .wf-item.active .wf-item-body").click({ button: "right" });
  check(
    (await p.locator('#wf-menu [data-act="wf-ws-rename"]').count()) === 1 &&
      (await p.locator('#wf-menu [data-act="wf-ws-copy"]').count()) === 1 &&
      (await p.locator('#wf-menu [data-act="wf-ws-export"]').count()) === 1 &&
      (await p.locator('#wf-menu [data-act="wf-ws-delete"]').count()) === 1,
    "right-click on a workflow offers rename / copy / export / delete",
  );
  await p.locator('#wf-menu [data-act="wf-ws-copy"]').click();
  check(
    await p.evaluate((n) => state.settings.comfy.presets.length === n + 2, basePresets),
    "copy creates independently editable workflow",
  );
  const title = await p.locator(".wm-title").inputValue();
  await p.locator(".wm-title").fill("独立测试副本");
  await p.locator(".wm-title").press("Tab");
  check(
    (await p.locator("#wf-rail .wf-item.active .wf-item-title").innerText()) === "独立测试副本",
    "library item echoes the title while typing",
  );
  await p.evaluate(() => savePythonWorkspace());
  await p.locator("#wf-rail .wf-item .wf-item-body").first().click();
  check(
    (await p.locator(".wm-title").inputValue()) !== title &&
      (await p.locator(".wm-title").inputValue()) !== "独立测试副本",
    "switch returns to untouched original workflow title",
  );
  await p.locator("#wf-rail .wf-item.active .wf-item-body").click({ button: "right" });
  await p.locator('#wf-menu [data-act="wf-ws-rename"]').click();
  await p.locator("#text-value").fill("重命名后的工作流");
  await p.locator('#modal[open] [data-act="text-submit"]').click();
  check(
    (await p.locator(".wm-title").inputValue()) === "重命名后的工作流",
    "context-menu rename updates the open workflow",
  );
  const hasPlan = await p.evaluate(() => !!templateBy(selectedPlan()?.templateId));
  if (hasPlan) {
    await p.locator("#wf-menu-button").click();
    await p.locator('#wf-menu [data-act="v3-preview-workflow"]').click();
    check((await p.locator("#modal[open]").count()) === 1, "submission preview opens");
    await p.locator('[data-act="close-modal"]').first().click();
  } else console.log("SKIP submission preview (fixture workspace ships no storyboard)");

  /* ---- semantic slots: detected from the blueprint, editable, persisted per workflow */
  check((await p.locator("[data-slot-row]").count()) === 2, "model and LoRA slot rows are listed above the bindings");
  await p.locator('[data-act="wm-select-slot"][data-id="model"]').click();
  check(await p.locator("#v3-slot-model-target").isVisible(), "model slot inspector opens");
  check(
    await p.evaluate(() => comfySlotsResolved().model.enabled && !!comfySlotsResolved().model.nodeId),
    "model slot is auto-detected without object_info",
  );
  await p.locator('[data-act="wm-select-slot"][data-id="lora"]').click();
  await p.locator("#v3-slot-lora-target").selectOption("off");
  check(
    await p.evaluate(() => state.settings.comfy.slots.lora.mode === "off" && comfySlotsResolved().lora.mode === "off"),
    "LoRA slot can be switched off and the choice is stored",
  );
  await p.locator("#v3-slot-lora-target").selectOption("auto");
  check(await p.evaluate(() => state.settings.comfy.slots.lora.auto === true), "LoRA slot returns to auto detection");
  check(
    await p.evaluate(() => {
      const preset = state.settings.comfy.presets.find((x) => x.id === state.settings.comfy.activeWorkflowId);
      return !!preset && JSON.stringify(preset.slots) === JSON.stringify(state.settings.comfy.slots);
    }),
    "slot choices are mirrored into the saved workflow preset",
  );

  /* ---- responsive */
  await p.setViewportSize({ width: 390, height: 844 });
  check(
    await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    "mobile has no horizontal overflow",
  );
  await p.locator("#ws-library-select").selectOption({ label: "独立测试副本" });
  check((await p.locator(".wm-title").inputValue()) === "独立测试副本", "mobile workflow switch works");
  await p.locator(".wm-row-select").first().click();
  check(await p.locator(".wm-inspector").isVisible(), "mobile selection exposes inspector");
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
  check(errors.length === 0, "no uncaught browser exceptions: " + errors.join("; "));
  console.log(`WORKFLOW WORKBENCH: ${count} assertions PASS`);
} finally {
  await browser?.close();
  server.kill();
  fs.rmSync(temp, { recursive: true, force: true });
}
