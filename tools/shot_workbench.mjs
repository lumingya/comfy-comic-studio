// Screenshot helper for the workflow workbench (dev only).
import fs from "node:fs";
import { chromium } from "playwright";
const url = process.env.MIO_URL || "http://127.0.0.1:18831";
const out = process.env.SHOT_DIR || "/tmp/shots";
const tag = process.env.SHOT_TAG || "before";
fs.mkdirSync(out, { recursive: true });
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
const browser = await chromium.launch({ args: ["--no-sandbox"] });
const p = await browser.newPage({ viewport: { width: Number(process.env.W || 1568), height: Number(process.env.H || 1000) }, reducedMotion: "reduce" });
const errors = [];
p.on("pageerror", (e) => errors.push(e.message));
p.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });
await p.goto(url);
await p.waitForFunction(() => typeof rt !== "undefined" && !rt.booting && backendRuntime.connected, null, { timeout: 60000 });
await p.evaluate((fx) => {
  document.querySelectorAll("dialog[open]").forEach((d) => d.close());
  state.settings.identity.onboarded = true;
  guidePreferences().seen = true;
  for (const key of Object.keys(state.settings.studio.features || {}))
    if (!Object.hasOwn(studioDefaults.features, key)) delete state.settings.studio.features[key];
  const c = state.settings.comfy;
  c.workflow = fx.workflow; c.bindings = fx.bindings; c.outputNodeId = fx.outputNodeId; c.workflowTitle = fx.title;
  storeActiveWorkflow();
  navigate(3);
}, FIXTURE);
await p.waitForTimeout(600);
const settle = async (ms = 350) => p.waitForTimeout(ms);
const closeDrawer = async () => { await p.mouse.move(1200, 700); await p.keyboard.press("Escape"); await settle(500); };
await p.screenshot({ path: `${out}/${tag}-01-page.png` });
// inspector on first binding
await p.click('[data-act="wm-select"][data-id="bind_pos"]').catch(() => {});
await settle();
await p.screenshot({ path: `${out}/${tag}-02-inspector.png` });
// connection body (idle, then after a failed probe against a dead port, then a fake ok record)
await p.click('[data-act="wf-connection-toggle"]').catch(() => {});
await settle();
await p.screenshot({ path: `${out}/${tag}-03-connection.png` });
await p.evaluate(() => { state.settings.comfy.baseUrl = "http://127.0.0.1:1"; save(); });
await p.click('[data-act="wf-check-connection"]').catch(() => {});
await p.waitForFunction(() => !connectionUI.checking && connectionUI.results.size > 0, null, { timeout: 20000 }).catch(() => {});
await settle();
await p.screenshot({ path: `${out}/${tag}-03b-connection-failed.png` });
await p.evaluate(() => { state.settings.comfy.baseUrl = "http://127.0.0.1:8188"; connectionUI.results.set("http://127.0.0.1:8188", { ok: true, message: "服务可读", latencyMs: 38, vramPercent: 12, device: "NVIDIA GeForce RTX 4090", at: Date.now() - 120000 }); save(); render(); });
await settle();
await p.screenshot({ path: `${out}/${tag}-03c-connection-ok.png` });
await p.click('[data-act="wf-connection-toggle"]').catch(() => {});
await settle();
// node browser
await p.click('[data-act="wm-nodes"]').catch(() => {});
await settle();
await p.screenshot({ path: `${out}/${tag}-04-nodes.png` });
await p.click('[data-act="wm-nodes"]').catch(() => {});
// menu (hover the second item to prove no tooltip covers it)
await p.click('#wf-menu-button').catch(() => {});
await settle();
await p.hover('#wf-menu [role="menuitem"]:nth-of-type(2)').catch(() => {});
await settle(700);
await p.screenshot({ path: `${out}/${tag}-05-menu.png` });
await p.keyboard.press("Escape");
// rail open
await p.hover('.wf-rail-handle').catch(() => {});
await settle(800);
await p.screenshot({ path: `${out}/${tag}-06-rail.png` });
await closeDrawer();
// slot inspector
await p.click('[data-act="wm-select-slot"][data-id="model"]').catch(() => {});
await settle();
await p.screenshot({ path: `${out}/${tag}-07-slot.png` });
// output inspector
await p.click('[data-act="wm-select-output"]').catch(() => {});
await settle();
await p.screenshot({ path: `${out}/${tag}-08-output.png` });
// advice: disable the positive prompt + seed mapping and open the health list
await p.evaluate(() => { const c = state.settings.comfy; c.bindings.find((b) => b.id === "bind_pos").enabled = false; c.bindings.find((b) => b.id === "bind_seed").enabled = false; mapperUI.healthOpen = true; save(); render(); });
await settle();
await p.screenshot({ path: `${out}/${tag}-08b-advice.png` });
await p.evaluate(() => { const c = state.settings.comfy; c.bindings.find((b) => b.id === "bind_pos").enabled = true; c.bindings.find((b) => b.id === "bind_seed").enabled = true; mapperUI.healthOpen = false; save(); render(); });
// import sheet with a mixed batch of files
await p.click('[data-act="ws-open-unified-import"]').catch(() => {});
await settle();
await p.setInputFiles('#wf-unified-file-input', [
  { name: "anime_api.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(FIXTURE.workflow)) },
  { name: "editor_format.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({ nodes: [], links: [] })) },
  { name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hello") },
]).catch(() => {});
await settle(600);
await p.screenshot({ path: `${out}/${tag}-08c-import.png` });
await p.locator('#modal [data-act="close-modal"]').first().click().catch(() => {});
await p.waitForFunction(() => !document.querySelector("#modal").open).catch(() => {});
await settle();
// light theme
await p.evaluate(() => { state.settings.studio.appearance.theme = "light"; applyStudioPreferences(); });
await p.click('[data-act="wm-select"][data-id="bind_width"]').catch(() => {});
await settle();
await p.screenshot({ path: `${out}/${tag}-09-light.png` });
await p.click('[data-act="wf-connection-toggle"]').catch(() => {});
await settle();
await p.screenshot({ path: `${out}/${tag}-09b-light-connection.png` });
await p.click('[data-act="wf-connection-toggle"]').catch(() => {});
await p.evaluate(() => { state.settings.studio.appearance.theme = "dark"; applyStudioPreferences(); });
// cloud provider view
await p.evaluate(() => { const g = ensureImageProviders(); let o = g.profiles.find((x) => x.provider === "openai"); if (!o) { o = { id: "provider_test_openai", title: "OpenAI 兼容", provider: "openai", keyMode: "none", baseUrl: "https://api.openai.com/v1", model: "gpt-image-1", protocol: "images", sendSize: false, sendQuality: false, sendAspectHint: true, size: "1024x1024", quality: "auto" }; g.profiles.push(o); } g.active = o.id; render(); });
await settle(400);
await p.screenshot({ path: `${out}/${tag}-10-cloud.png`, fullPage: true });
await p.evaluate(() => { const g = ensureImageProviders(); g.active = g.profiles.find((x) => x.provider === "comfyui").id; render(); });
// blank blueprint
await p.evaluate(() => { const c = state.settings.comfy; c.presets.push({ id: "wf_blank_shot", title: "新工作流", workflow: {}, bindings: [], outputNodeId: "", slots: {} }); selectLibraryWorkflow("wf_blank_shot"); });
await settle(400);
await p.screenshot({ path: `${out}/${tag}-10b-blank.png` });
await p.evaluate(() => { const c = state.settings.comfy; const first = c.presets.find((x) => x.id !== "wf_blank_shot"); selectLibraryWorkflow(first.id); c.presets = c.presets.filter((x) => x.id !== "wf_blank_shot"); save(); render(); });
// narrow viewport
await p.setViewportSize({ width: 900, height: 1000 });
await settle(400);
await p.screenshot({ path: `${out}/${tag}-11-narrow.png`, fullPage: true });
await p.click('[data-act="wf-connection-toggle"]').catch(() => {});
await settle(400);
await p.screenshot({ path: `${out}/${tag}-11b-narrow-connection.png`, fullPage: true });
await p.click('[data-act="wf-connection-toggle"]').catch(() => {});
await p.setViewportSize({ width: 430, height: 900 });
await settle(400);
await p.screenshot({ path: `${out}/${tag}-12-mobile.png`, fullPage: true });
console.log("errors:", errors);
await browser.close();
