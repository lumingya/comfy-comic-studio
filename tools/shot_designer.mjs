/* Dev helper: open the "新建生成任务" wizard against a running server and screenshot each step.
   Usage: node tools/shot_designer.mjs [outDir] [baseUrl] */
import fs from 'node:fs';
import path from 'node:path';
import {chromium} from 'playwright';

const out = process.argv[2] || '/home/user/shots';
const url = process.argv[3] || 'http://127.0.0.1:8777';
const light = process.argv.includes('--light');
fs.mkdirSync(out, {recursive: true});

const browser = await chromium.launch({args: ['--no-sandbox']});
const page = await browser.newPage({viewport: {width: 1440, height: 1000}, reducedMotion: 'reduce', deviceScaleFactor: 1});
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
await page.goto(url);
await page.waitForFunction(() => globalThis.Mio && typeof state !== 'undefined' && state.templates && state.templates.length);
if (light) await page.evaluate(() => { state.settings.studio.appearance.theme = 'light'; document.documentElement.dataset.theme = 'light'; });
await page.evaluate(async () => {
  try { await connectPythonBackend(); } catch (e) { console.warn('backend', e.message); }
  const w = document.querySelector('#welcome-dialog'); if (w && w.open) w.close();
  // A second collection, so the collection selector has something to switch to.
  if (!state.projects.some(p => p.id === 'shot-collection-b')) state.projects.push({id: 'shot-collection-b', title: '番外与设定集', createdAt: Date.now()});
  // A realistic ComfyUI blueprint (checkpoint + two chained LoRAs + prompts + sampler) so the
  // model / LoRA panel is populated like a real studio, plus a synced model catalog.
  const wf = {
    '4': {class_type: 'CheckpointLoaderSimple', inputs: {ckpt_name: 'anikawaxl_v4.safetensors'}, _meta: {title: 'Load Checkpoint'}},
    '10': {class_type: 'LoraLoader', inputs: {lora_name: 'QAQv2p2-150.safetensors', strength_model: 0.58, strength_clip: 0.58, model: ['4', 0], clip: ['4', 1]}},
    '11': {class_type: 'LoraLoader', inputs: {lora_name: 'QAQv5p2_IL-40.safetensors', strength_model: 0.75, strength_clip: 0.75, model: ['10', 0], clip: ['10', 1]}},
    '6': {class_type: 'CLIPTextEncode', inputs: {text: 'masterpiece, best quality', clip: ['11', 1]}},
    '7': {class_type: 'CLIPTextEncode', inputs: {text: 'lowres, bad anatomy', clip: ['11', 1]}},
    '5': {class_type: 'EmptyLatentImage', inputs: {width: 1024, height: 1024, batch_size: 1}},
    '3': {class_type: 'KSampler', inputs: {seed: 3699, steps: 28, cfg: 6, sampler_name: 'euler_ancestral', scheduler: 'normal', denoise: 1, model: ['11', 0], positive: ['6', 0], negative: ['7', 0], latent_image: ['5', 0]}},
    '8': {class_type: 'VAEDecode', inputs: {samples: ['3', 0], vae: ['4', 2]}},
    '9': {class_type: 'SaveImage', inputs: {filename_prefix: 'mio', images: ['8', 0]}}
  };
  const binding = (id, nodeId, path, source, value = '') => ({id: 'binding_' + id, nodeId, path, label: source, source, type: 'text', value, enabled: true});
  if (!state.settings.comfy.presets.some(p => p.id === 'wf-shot-lora')) {
    state.settings.comfy.presets.push({id: 'wf-shot-lora', title: 'Illustrious · 角色立绘（无种子映射）', workflow: wf, mapping: {}, bindings: [binding('p', '6', 'text', 'positive'), binding('n', '7', 'text', 'negative')], outputNodeId: '9', randomizeSeeds: false, slots: {}});
    state.settings.comfy.presets.push({id: 'wf-shot-seeded', title: 'Illustrious · 角色立绘（含种子映射）', workflow: JSON.parse(JSON.stringify(wf)), mapping: {}, bindings: [binding('p2', '6', 'text', 'positive'), binding('n2', '7', 'text', 'negative'), {...binding('s2', '3', 'seed', 'sceneParameter', 'seed'), type: 'number'}], outputNodeId: '9', randomizeSeeds: false, slots: {}});
  }
  state.settings.comfy.objectInfo = state.settings.comfy.objectInfo || {};
  state.settings.comfy.objectInfo.CheckpointLoaderSimple = {input: {required: {ckpt_name: [['anikawaxl_v4.safetensors', 'illustrijEVO_lvl2.safetensors', 'oneObsession_1424DNsfw.safetensors', 'oneObsession_v16Noobai.safetensors', 'waiNSFWIllustrious_v140.safetensors']]}}};
  state.settings.comfy.objectInfo.LoraLoader = {input: {required: {lora_name: [['748cmSDXL.safetensors', '菲比 鸣潮.safetensors', '海瑟音.safetensors', '卡提西亚.safetensors', '坎特蕾拉.safetensors', '柯莱塔2.safetensors', 'QAQv2p2-150.safetensors', 'QAQv5p2_IL-40.safetensors', 'styles/watercolor_soft.safetensors', 'detail_tweaker_xl.safetensors']]}}};
  state.settings.comfy.modelCatalog = {checkpoints: ['anikawaxl_v4.safetensors', 'illustrijEVO_lvl2.safetensors', 'oneObsession_1424DNsfw.safetensors', 'oneObsession_v16Noobai.safetensors', 'waiNSFWIllustrious_v140.safetensors', 'sdxl/juggernautXL_v9.safetensors', 'sdxl/animagineXL_v31.safetensors', 'pony/ponyDiffusionV6XL.safetensors'], unets: [], loras: ['748cmSDXL.safetensors', '菲比 鸣潮.safetensors', '海瑟音.safetensors', '卡提西亚.safetensors', '坎特蕾拉.safetensors', '柯莱塔2.safetensors', 'QAQv2p2-150.safetensors', 'QAQv5p2_IL-40.safetensors', 'styles/watercolor_soft.safetensors', 'detail_tweaker_xl.safetensors', 'styles/inkwash.safetensors', 'chars/nanami_v2.safetensors'], vaes: [], fetchedAt: Date.now(), nodeClasses: 412};
  state.settings.productionAssembly = {channelId: 'comfyui', workflowId: 'wf-shot-lora'};
  // A second preset so step 2 shows a real choice.
  if (!state.creation.variableSets.some(s => s.id === 'shot-set-style')) state.creation.variableSets.push({id: 'shot-set-style', projectId: state.activeProjectId, title: '水彩 · 柔光画风', category: 'scenes', entries: [{id: 'e1', key: 'style', type: 'text', value: 'watercolor, soft light'}, {id: 'e2', key: 'scene', type: 'text', value: 'seaside town'}], settingsGroups: [], bindings: [], createdAt: Date.now()});
  ui.workspace = 1; workshop.view = 'production'; render();
});
await page.getByRole('button', {name: '新建生成任务', exact: true}).click();
await page.waitForSelector('#modal[open]');
await page.waitForTimeout(300);
const shot = async (name, full = true) => {
  await page.screenshot({path: path.join(out, name + '.png'), fullPage: false});
  if (full) {
    const modal = page.locator('#modal');
    await modal.screenshot({path: path.join(out, name + '-modal.png')});
    // Also capture the scrolled modal body so long steps are visible in full.
    const body = page.locator('#modal-body');
    const h = await body.evaluate(el => el.scrollHeight);
    if (h > 900) {
      await body.evaluate(el => el.scrollTop = el.scrollHeight);
      await page.waitForTimeout(150);
      await modal.screenshot({path: path.join(out, name + '-modal-bottom.png')});
      await body.evaluate(el => el.scrollTop = 0);
    }
  }
};
await shot('step1');
// Cloud channel: no workflow, facts card instead.
await page.locator('#designer-channel').selectOption('novelai');
await page.waitForTimeout(200);
await shot('step1-novelai');
await page.locator('#designer-channel').selectOption('comfyui');
await page.waitForTimeout(200);
await page.getByRole('button', {name: '下一步', exact: true}).click();
await page.waitForTimeout(200);
await shot('step2');
// No preset → step 3 must surface undefined prompt variables as an advisory (not a blocker).
await page.getByRole('button', {name: '下一步', exact: true}).click();
await page.waitForTimeout(200);
await shot('step3-nopreset');
const badge0 = page.locator('.preflight-badge').first();
if (await badge0.count()) { await badge0.hover(); await page.waitForTimeout(700); await shot('step3-nopreset-hover', false); }
await page.getByRole('button', {name: '上一步', exact: true}).click();
await page.waitForTimeout(200);
const preset = page.locator('[data-designer-preset]').first();
if (await preset.count()) await preset.check();
await page.waitForTimeout(150);
await shot('step2-selected');
await page.getByRole('button', {name: '下一步', exact: true}).click();
await page.waitForTimeout(200);
await shot('step3');
// Hover the warning badge if present.
const badge = page.locator('.preflight-badge').first();
if (await badge.count()) { await badge.hover(); await page.waitForTimeout(700); await shot('step3-hover', false); }
// Pick another collection: the help text explains, the summary flags it, and the choice is remembered.
await page.locator('#designer-project').selectOption('shot-collection-b');
await page.waitForTimeout(250);
await shot('step3-collection');
const remembered = await page.evaluate(() => state.settings.productionAssembly.projectId);
console.log('remembered collection:', remembered);
// Blocking issue: a caption that references a variable nobody defines.
await page.evaluate(() => { const s = templateBy(assemblyDesign.storyId); s.frames[0].caption = (s.frames[0].caption || '') + ' {hero}'; renderAssemblyDesigner(); });
await page.waitForTimeout(250);
await shot('step3-blocked');
await page.evaluate(() => { const s = templateBy(assemblyDesign.storyId); s.frames[0].caption = s.frames[0].caption.replace(' {hero}', ''); renderAssemblyDesigner(); });
await page.getByRole('button', {name: '画布连线', exact: true}).click();
await page.waitForTimeout(200);
await shot('canvas');
await page.setViewportSize({width: 420, height: 860});
await page.getByRole('button', {name: '分步向导', exact: true}).click();
await page.waitForTimeout(200);
await shot('mobile-step1', false);
console.log(JSON.stringify({errors}, null, 1));
await browser.close();
