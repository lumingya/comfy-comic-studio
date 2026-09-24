// T3 · the assembly wizard picks sensible defaults and reports problems in the step that owns them:
// a preset that defines every variable is preselected, the album name follows 分镜名 · 角色名, each step lists its own
// problems with buttons that fix or jump to them, the primary button is disabled while something blocks (with the reason
// next to it), advisories open on click instead of hover, and concurrency sits under 高级选项.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {chromium} from 'playwright';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mio-wizard-defaults-'));
const base = 'http://127.0.0.1:18888', provider = 'http://127.0.0.1:18988';
const log = fs.openSync(path.join(dir, 'server.log'), 'w');
const server = spawn('python', ['tests/journey_fixture_server.py'], {
  env: {...process.env, MIO_HOST: '127.0.0.1', MIO_PORT: '18888', MIO_DATA_DIR: path.join(dir, 'data'), MIO_JOURNEY_PROVIDER_PORT: '18988'},
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
  await p.goto(base);
  await p.waitForFunction(() => typeof rt !== 'undefined' && !rt.booting);
  await p.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()));

  // ComfyUI points at a closed port, so the wizard has an unreachable service to talk about.
  await p.evaluate(async () => { state.settings.comfy.baseUrl = 'http://127.0.0.1:18989'; save(); for (let i = 0; i < 5 && !(rt.engineChecked && rt.engineOk === false); i++) await testEngine(true); });
  check(await p.evaluate(() => rt.engineChecked && rt.engineOk === false), 'the fixture ComfyUI address is unreachable');
  const wizard = p.locator('#modal.assembly-designer');
  const next = p.locator('#modal [data-act="designer-next"]'), submit = p.locator('#modal [data-act="designer-submit"]');
  const reason = p.locator('#designer-footer-reason');
  const issues = p.locator('#designer-step-issues');
  const fix = label => p.locator('#modal .designer-fix', {hasText: label}).first();
  const text = async loc => (await loc.innerText()).replace(/\s+/g, ' ').trim();

  await p.evaluate(() => { ui.workspace = 1; workshop.view = 'production'; render(); openAssemblyDesigner(); });
  await wizard.waitFor();

  // Smart defaults
  check(await p.evaluate(() => [...assemblyDesign.presets].join() === 'setting_nanami'), 'the one preset that defines every variable is preselected');
  check(await p.evaluate(() => assemblyDesign.title === '远行与归来 · 十二幕 · 七海'), 'the album name defaults to 分镜名 · 角色名 (the display name variable)');
  check(await p.evaluate(() => assemblyDesign.channelId === 'comfyui'), 'the image service still follows Settings (B10)');

  // Step 1: problems of this step, in a list at its bottom, each with a button
  check(await issues.isVisible(), 'step 1 lists its problems at the bottom');
  const step1 = await text(issues);
  check(step1.includes('ComfyUI 当前连不上（http://127.0.0.1:18989）'), 'an unreachable ComfyUI is reported in step 1');
  check(step1.includes('是占位名'), 'the placeholder model is reported in step 1');
  check(await fix('测试连接').isVisible() && await fix('选择模型').isVisible(), 'both problems carry a fix button');
  check(!(await next.isDisabled()) && await reason.isHidden(), 'warnings alone leave 下一步 enabled');
  await fix('选择模型').click();
  check(await p.locator('details.designer-advanced').evaluate(el => el.open), '选择模型 opens the Model & LoRA panel');

  // A service that is set up appears as a one-click alternative while ComfyUI is down
  await p.evaluate(provider => {
    const openai = ensureImageProviders().profiles.find(x => x.provider === 'openai');
    Object.assign(openai, {baseUrl: provider + '/v1', model: 'fixture-image', title: '本机图像接口'}); save(); refreshDesignerChecks();
  }, provider);
  check(await fix('改用「本机图像接口」').isVisible(), 'a ready image service is offered while ComfyUI is unreachable');
  await fix('改用「本机图像接口」').click();
  check(await p.locator('#designer-channel').inputValue() === 'openai', 'one click switches the wizard to it');
  check(!(await text(issues).catch(() => '')).includes('ComfyUI'), 'and the ComfyUI problems leave the list');

  // Step 2: an undefined caption variable blocks right here, not two steps later
  await next.click();
  check(await p.evaluate(() => assemblyDesign.step === 1), '下一步 moves on');
  check((await text(p.locator('.designer-step-head p'))).startsWith('单击选择预设；Ctrl / ⌘ 点击加选'), 'the hint says a single click selects a preset');
  check((await text(p.locator('#designer-auto-note'))).includes('已自动选中「七海 · 标准角色设定」'), 'the automatic choice is explained');
  await p.locator('.designer-preset').first().click({modifiers: ['Control']});
  check(await p.evaluate(() => assemblyDesign.presets.size === 0), 'Ctrl-click removes the preset');
  check(await p.locator('#designer-auto-note').isHidden(), 'the automatic-choice note goes away once the creator decides');
  const step2 = await text(issues);
  check(step2.includes('第 2、9 幕的台词引用了未定义的变量 {character_display_name}。'), 'the caption problem names the scenes and the undefined variable');
  check(await next.isDisabled(), 'a blocking problem disables 下一步');
  check((await reason.innerText()).trim() === '先处理 1 个问题' && await reason.isVisible(), 'the reason is shown next to the button');
  check(await p.evaluate(() => assemblyDesign.title === '远行与归来 · 十二幕'), 'the default name follows the preset choice');
  await p.evaluate(() => handleAction('designer-next', {}));
  check(await p.evaluate(() => assemblyDesign.step === 1), 'the action itself refuses to skip a blocked step');
  await reason.click();
  check(await p.evaluate(() => document.activeElement?.matches('#designer-step-issues .designer-fix')), 'the reason jumps to the first fix');
  await fix('选中「七海 · 标准角色设定」').click();
  check(await p.evaluate(() => assemblyDesign.presets.has('setting_nanami')) && !(await next.isDisabled()), 'the preset fix resolves the problem and re-enables 下一步');
  check(await p.evaluate(() => assemblyDesign.title === '远行与归来 · 十二幕 · 七海'), 'the default name follows again');

  // A fix that needs the storyboard leaves the wizard and comes back to the same place
  await p.locator('.designer-preset').first().click({modifiers: ['Control']});
  await fix('去第 2 幕修改').click();
  await p.waitForFunction(() => !document.querySelector('#modal')?.open);
  await p.waitForFunction(() => document.activeElement?.dataset?.workshopFrame === 'caption', null, {timeout: 3000});
  check(await p.evaluate(() => ui.workspace === 1 && workshop.view === 'stories' && workshop.frame === 1), '去第 2 幕修改 opens scene 2 in the storyboard workshop');
  check(true, 'with its caption focused');
  await p.getByRole('button', {name: '去装配此分镜', exact: true}).click();
  await wizard.waitFor();
  check(await p.evaluate(() => assemblyDesign.step === 1 && assemblyDesign.presets.size === 0 && assemblyDesign.channelId === 'openai'), 'reopening the wizard resumes the step and the choices');
  await p.locator('.designer-preset').first().click();
  check(await p.evaluate(() => assemblyDesign.presets.has('setting_nanami')), 'a plain click selects the preset');
  await next.click();

  // Step 3: name, recap, advanced options
  check(await p.locator('#designer-title').inputValue() === '远行与归来 · 十二幕 · 七海', 'step 3 shows the default album name in the field');
  check(await p.locator('.preflight-badge').count() === 0 && !(await text(wizard)).includes('悬停查看'), 'nothing is hover-only any more');
  check((await text(p.locator('#designer-recap'))).includes('输入检查通过'), 'a clean book reads 输入检查通过');
  // A brace no preset defines is an advisory: listed (not hidden behind hover) and collapsed until clicked.
  await p.evaluate(() => { const s = templateBy(assemblyDesign.storyId); s.frames[0].prompt += ', {sparkle_fx}'; refreshDesignerChecks(); });
  const notes = p.locator('#designer-recap details.preflight-notes');
  check(await notes.count() === 1 && !(await notes.evaluate(el => el.open)), 'advisories start collapsed');
  check((await text(p.locator('#designer-recap'))).includes('可以生成') && !(await submit.isDisabled()), 'an advisory does not block');
  await notes.locator('summary').first().click();
  check(await notes.evaluate(el => el.open) && (await text(p.locator('#designer-recap .designer-issue').first())).includes('提示词里的 {sparkle_fx} 没有任何预设定义，会按原文保留在提示词里（第 1 幕）。'), 'a click opens the advisory list');
  check(await fix('去第 1 幕修改').isVisible() && await fix('返回选择预设').isVisible(), 'the advisory offers its fix and the way back to its step');
  await p.evaluate(() => refreshDesignerChecks());
  check(await notes.evaluate(el => el.open), 'the opened list survives a refresh');
  await p.evaluate(() => { const s = templateBy(assemblyDesign.storyId); s.frames[0].prompt = s.frames[0].prompt.replace(', {sparkle_fx}', ''); refreshDesignerChecks(); });
  const more = p.locator('details.designer-more');
  check(await more.count() === 1 && !(await more.evaluate(el => el.open)), 'scene concurrency sits under a closed 高级选项');
  await p.locator('#designer-title').fill('');
  check(await submit.isDisabled(), 'an empty name disables 添加待命任务');
  check((await text(p.locator('#designer-recap'))).includes('请填写画册名称。'), 'the recap says why');
  await fix('使用「远行与归来 · 十二幕 · 七海」').click();
  check(await p.locator('#designer-title').inputValue() === '远行与归来 · 十二幕 · 七海' && !(await submit.isDisabled()), 'one click restores the default name');
  await more.locator('summary').click();
  await p.locator('#designer-concurrency').fill('0');
  check(await submit.isDisabled() && (await text(p.locator('#designer-recap'))).includes('分幕并发需为 1–'), 'an invalid concurrency blocks with its own message');
  await p.locator('#designer-concurrency').fill('');
  check(!(await submit.isDisabled()), 'clearing it follows the global default again');
  await p.locator('#designer-title').fill('向导默认值');
  await submit.click();
  await p.waitForFunction(() => workshop.queue.tasks.length === 1);
  check(await p.evaluate(() => JSON.stringify(state.settings.productionAssembly.storyPresets[templateBy(assemblyDesign.storyId).id]) === '["setting_nanami"]'), 'the presets queued with the storyboard are remembered');
  await p.evaluate(() => openAssemblyDesigner());
  await p.evaluate(() => { assemblyDesign.step = 1; renderAssemblyDesigner(); });
  check((await text(p.locator('#designer-auto-note'))).includes('已沿用上次为这个分镜选择的预设。'), 'next time they are the default, and the wizard says so');

  // Canvas mode: nothing to queue, nothing to click
  await p.locator('[data-act="designer-mode"][data-mode="canvas"]').click();
  check(await submit.isDisabled() && (await reason.innerText()).trim() === '先调入一个分镜', 'the canvas with no storyboard node disables 批量生成');
  await p.locator('[data-act="designer-add-story"]').click();
  check(!(await submit.isDisabled()), 'adding a storyboard node enables it');
  await p.evaluate(() => closeModal());

  // Settings' service is not set up but the last used one is: preselect the last used one and say so
  await p.evaluate(() => { const providers = ensureImageProviders(); providers.active = 'novelai'; state.settings.productionAssembly.channelId = 'openai'; save(); openAssemblyDesigner(); });
  check(await p.evaluate(() => assemblyDesign.channelId === 'openai'), 'an enabled service that is not set up falls back to the last used one');
  check((await text(p.locator('.designer-channel-notice'))).includes('设置中启用的「NovelAI」还没配置好，已改选上次装配使用的「本机图像接口」。'), 'with a notice naming both');
  await p.evaluate(() => closeModal());

  // English
  await p.evaluate(() => { state.settings.presentation.language = 'en'; applyDisplayAttributes(); render(); openAssemblyDesigner(); assemblyDesign.presets = new Set(); assemblyDesign.presetsTouched = true; assemblyDesign.step = 1; renderAssemblyDesigner(); });
  await p.waitForFunction(() => document.documentElement.lang === 'en');
  await p.waitForFunction(() => /issue to fix/.test(document.querySelector('#designer-step-issues')?.innerText || ''));
  const english = await text(issues);
  check(english.includes('Scenes 2, 9: the caption uses the undefined variable {character_display_name}.'), 'the problem list is translated: ' + english.slice(0, 120));
  check((await reason.innerText()).trim() === 'Fix 1 issue first', 'and so is the reason next to the button');
  const leftover = english.replaceAll('七海 · 标准角色设定', '').match(/[\u4e00-\u9fff]+/g);
  check(!leftover, 'no Chinese left in the list apart from the preset name: ' + (leftover || []).join(' '));
  await p.evaluate(() => { closeModal(); state.settings.presentation.language = 'zh-CN'; applyDisplayAttributes(); render(); });

  check(errors.length === 0, 'no page errors: ' + errors.join(' | '));
  console.log(`assembly wizard defaults: ${count} checks passed`);
} finally {
  await browser?.close();
  server.kill();
}
