// The shipped workflow maps the seed; a placeholder or missing model is flagged before generating;
// a workflow without a seed mapping gets a one-click fix in the wizard and in the workflow page.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {chromium} from 'playwright';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mio-seed-model-'));
const base = 'http://127.0.0.1:18885';
const log = fs.openSync(path.join(dir, 'server.log'), 'w');
const server = spawn('python', ['tests/journey_fixture_server.py'], {
  env: {...process.env, MIO_HOST: '127.0.0.1', MIO_PORT: '18885', MIO_DATA_DIR: path.join(dir, 'data'), MIO_JOURNEY_PROVIDER_PORT: '18985'},
  stdio: ['ignore', log, log],
});
let browser, count = 0;
const check = (value, label) => { assert.ok(value, label); console.log('PASS ' + label); count++; };

try {
  let ready = false;
  for (let i = 0; i < 150; i++) {
    try { if ((await fetch(base + '/api/content')).ok) { ready = true; break; } } catch {}
    await new Promise(r => setTimeout(r, 100));
  }
  assert.ok(ready, 'fixture startup');
  browser = await chromium.launch({args: ['--no-sandbox']});
  const p = await browser.newPage({viewport: {width: 1440, height: 1000}, reducedMotion: 'reduce'});
  const errors = [];
  p.on('pageerror', e => errors.push(e.message));
  await p.route(/^https?:\/\//, r => new URL(r.request().url()).origin === base ? r.continue() : r.abort());
  const boot = async () => {
    await p.goto(base);
    await p.waitForFunction(() => typeof rt !== 'undefined' && !rt.booting);
    await p.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()));
  };
  const saved = () => p.waitForFunction(() => rt.saved && !rt.saving);
  const openWizard = () => p.evaluate(() => { openAssemblyDesigner(); renderAssemblyDesigner(); });
  const dropSeedMapping = () => p.evaluate(() => {
    const c = state.settings.comfy, entry = c.presets.find(x => x.id === c.activeWorkflowId);
    entry.bindings = entry.bindings.filter(b => !(b.source === 'sceneParameter' && b.value === 'seed'));
    entry.updatedAt = Date.now(); c.bindings = clone(entry.bindings); save();
  });
  await boot();

  // 1. The shipped workflow writes every scene's seed.
  await openWizard();
  check(await p.evaluate(() => designerWorkflow()?.title === 'Anime · 基础图像管线' && designerSeedReady()), 'the shipped workflow has a seed mapping');
  check(!(await p.locator('#designer-seed-enable').isDisabled()), 'so the reproducible-seed switch is available');
  check(await p.locator('.seed-setting-alert').count() === 0, 'and no same-seed warning is shown');

  // 2. Its placeholder model is flagged where the model is chosen.
  const alert = p.locator('#designer-model-alert .designer-model-alert');
  check(/模型「your-anime-model」是占位名/.test(await alert.innerText()), 'the placeholder model is flagged under the workflow picker');
  check(await p.locator('details.designer-advanced').evaluate(el => el.open), 'the Model & LoRA panel opens by itself');
  check((await p.locator('#designer-model-note').innerText()).trim() === '需要选择模型', 'its summary says a model has to be chosen');
  check((await p.locator('[data-designer-model-pick=""] small').innerText()).trim() === '占位名，请换一个', 'the blueprint default is marked as a placeholder');
  check(await p.evaluate(() => /占位名/.test(assemblyPreflightHTML())), 'the final check lists it too');
  await p.evaluate(() => {
    state.settings.comfy.modelCatalog = {checkpoints: ['anime/animagine-xl.safetensors'], unets: [], loras: [], vaes: [], fetchedAt: Date.now(), nodeClasses: 1};
    initDesignerOverrides(); renderAssemblyDesigner();
  });
  await p.locator('[data-designer-model-pick="anime/animagine-xl.safetensors"]').click();
  check(await alert.count() === 0, 'choosing an installed model clears the warning');
  check((await p.locator('#designer-model-note').innerText()).trim() === '可选覆写', 'and the summary returns to optional overrides');
  check(await p.evaluate(() => !/占位名/.test(assemblyPreflightHTML())), 'and the final check no longer lists it');

  // 3. After a model-list sync, any checkpoint ComfyUI does not have is flagged; paths compare across separators.
  const problems = await p.evaluate(() => {
    const synced = {checkpoints: ['sd/real.safetensors'], unets: [], fetchedAt: 1}, never = {checkpoints: [], unets: [], fetchedAt: 0};
    const wf = name => ({4: {class_type: 'CheckpointLoaderSimple', inputs: {ckpt_name: name}}});
    return [workflowModelProblems(wf('gone.safetensors'), synced), workflowModelProblems(wf('sd\\real.safetensors'), synced),
      workflowModelProblems(wf('gone.safetensors'), never), workflowModelProblems(wf('your-model.safetensors'), never)];
  });
  check(problems[0].length === 1 && problems[0][0].placeholder === false, 'a model missing from the synced list is flagged');
  check(problems[1].length === 0, 'a Windows path matches the same file in the list');
  check(problems[2].length === 0, 'without a synced list only placeholders are flagged');
  check(problems[3].length === 1 && problems[3][0].placeholder, 'a your-… name is always a placeholder');

  // 4. The workflow page: the model row is marked, and a missing seed mapping has a one-click fix.
  await p.evaluate(() => closeModal());
  await p.evaluate(async () => { navigate(3); await ensureWorkflowSlotPlan(state.settings.comfy); render(); });
  const modelRow = p.locator('[data-slot-row="model"]');
  await modelRow.waitFor();
  check(await modelRow.evaluate(el => el.classList.contains('has-issue')), 'the model row is marked as needing attention');
  check(/占位名/.test(await modelRow.locator('.wf-row-warning').innerText()), 'and says the model is a placeholder');
  const chip = p.locator('.wf-health-chip');
  check(/1\s*项待检查/.test(await chip.innerText()), 'the header counts it as one thing to check');
  await chip.click();
  check(/占位名/.test(await p.locator('.wm-issue', {hasText: '模型映射'}).innerText()), 'the check list explains it');
  check(await p.locator('.wm-advice', {hasText: '添加种子映射'}).count() === 0, 'no seed advice while the seed is mapped');
  await dropSeedMapping();
  await p.evaluate(() => { mapperUI.healthOpen = true; render(); });
  const advice = p.locator('.wm-advice', {hasText: '添加种子映射'});
  check(await advice.count() === 1, 'without a seed mapping the page offers to add one');
  await advice.click();
  check(await p.evaluate(() => state.settings.comfy.bindings.some(b => b.nodeId === '3' && b.path === 'seed' && b.source === 'sceneParameter' && b.value === 'seed' && b.enabled)), 'the advice adds a seed mapping on the sampler');
  check(await advice.count() === 0, 'and disappears');
  await saved();

  // 5. The wizard shows the same-seed problem in place and fixes it in one click; the fix is saved.
  await dropSeedMapping();
  await saved();
  await openWizard();
  const seedAlert = p.locator('.seed-setting-alert');
  check((await seedAlert.innerText()).includes('这 12 幕会使用同一个种子，画面可能几乎一样。'), 'the wizard says all 12 scenes would share one seed');
  check(await p.locator('#designer-seed-enable').isDisabled(), 'the reproducible-seed switch is unavailable meanwhile');
  await seedAlert.getByRole('button', {name: '一键添加种子映射'}).click();
  check(await seedAlert.count() === 0 && !(await p.locator('#designer-seed-enable').isDisabled()), 'one click maps the seed and enables the switch');
  await saved();
  const file = fs.readdirSync(path.join(dir, 'data', 'workflows')).find(name => name.includes('9399e1242916'));
  const onDisk = JSON.parse(fs.readFileSync(path.join(dir, 'data', 'workflows', file), 'utf8'));
  check(onDisk.bindings.some(b => b.nodeId === '3' && b.path === 'seed' && b.value === 'seed'), 'the mapping is written to the workflow file');
  await boot();
  await openWizard();
  check(await p.evaluate(() => designerSeedReady()), 'and is still there after a reload');

  // 6. English interface.
  const en = await p.evaluate(() => [
    translateCurrentLocale('这 12 幕会使用同一个种子，画面可能几乎一样。'),
    translateCurrentLocale('模型「your-anime-model」是占位名，ComfyUI 里没有这个文件，直接生成会失败。请在「模型与 LoRA」里选一个已安装的模型。'),
  ]);
  check(en[0].startsWith('These 12 scenes will all use the same seed'), 'the same-seed warning is translated');
  check(en[1].includes('“your-anime-model” is a placeholder') && en[1].endsWith('Pick an installed model under Model & LoRA.'), 'the placeholder warning is translated');

  check(errors.length === 0, 'no page errors: ' + errors.join(' | '));
  console.log(`seed and model setup: ${count} checks passed`);
} finally {
  await browser?.close();
  server.kill();
}
