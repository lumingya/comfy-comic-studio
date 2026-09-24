// T2 / C5: the storyboard and preset editors save themselves. No save buttons; a status line says what autosave is doing.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {chromium} from 'playwright';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mio-workshop-autosave-'));
const base = 'http://127.0.0.1:18887';
const log = fs.openSync(path.join(dir, 'server.log'), 'w');
const server = spawn('python', ['tests/journey_fixture_server.py'], {
  env: {...process.env, MIO_HOST: '127.0.0.1', MIO_PORT: '18887', MIO_DATA_DIR: path.join(dir, 'data'), MIO_JOURNEY_PROVIDER_PORT: '18987'},
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
  const p = await browser.newPage({viewport: {width: 1280, height: 900}, reducedMotion: 'reduce'});
  const errors = [];
  p.on('pageerror', e => errors.push(e.message));
  await p.route(/^https?:\/\//, r => new URL(r.request().url()).origin === base ? r.continue() : r.abort());
  const boot = async () => {
    await p.goto(base);
    await p.waitForFunction(() => typeof rt !== 'undefined' && !rt.booting && backendRuntime.connected);
    await p.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()));
  };
  const openView = view => p.evaluate(v => { navigate(1); workshop.view = v; render(); }, view);
  const settled = () => p.waitForFunction(() => !backendRuntime.dirty && !backendRuntime.saving && !backendRuntime.error, null, {timeout: 15000});
  const status = () => p.locator('[data-autosave-status]').first();
  // Open the variable groups through the app itself, so a background re-render keeps them open.
  const expand = async () => {
    await p.waitForTimeout(300);
    for (let i = 0; i < 12; i++) {
      const closed = p.locator('#main .group-toggle[aria-expanded="false"]');
      if (!(await closed.count())) break;
      await closed.first().click();
    }
    await p.evaluate(() => document.querySelectorAll('#main details').forEach(d => { d.open = true; }));
  };
  await boot();

  // 1. Storyboard editor: no save button, a status line instead.
  await openView('stories');
  await p.locator('#workshop-story-select').waitFor();
  check(await p.getByRole('button', {name: '保存分镜', exact: true}).count() === 0, 'the storyboard editor has no “保存分镜” button');
  check(!(await p.evaluate(() => workshopStoryContextItems(workshopStory()).some(i => i && i.label === '保存分镜'))), 'the storyboard context menu has no save item');
  await p.waitForFunction(() => /^已自动保存/.test(document.querySelector('[data-autosave-status]')?.textContent || ''));
  check(/^已自动保存/.test(await status().innerText()), 'the status line reads “已自动保存”: ' + await status().innerText());

  // Editing a scene marks the line as saving, then saved “刚刚”, and the text survives a reload.
  const storyId = await p.evaluate(() => workshopStory().id);
  const prompt = p.locator('[data-workshop-frame="prompt"]').first();
  await prompt.fill('autosave check prompt');
  check(await p.evaluate(() => backendRuntime.dirty || backendRuntime.saving), 'right after typing, autosave is pending');
  check(await status().getAttribute('data-state') === 'pending' && /正在自动保存/.test(await status().innerText()), 'the status line shows “正在自动保存…” while pending');
  await settled();
  await p.waitForFunction(() => /已自动保存 · 刚刚/.test(document.querySelector('[data-autosave-status]')?.textContent || ''));
  check(await status().getAttribute('data-state') === 'saved', 'after saving, the line turns to “已自动保存 · 刚刚”');
  await boot();
  check(await p.evaluate(id => templateBy(id)?.frames.some(f => f.prompt === 'autosave check prompt'), storyId), 'the storyboard edit was saved without pressing anything');

  // 2. Preset editor: edits are committed to the preset a moment after typing.
  await openView('presets');
  await p.locator('#workshop-preset-select').waitFor();
  check(await p.getByRole('button', {name: '保存预设', exact: true}).count() === 0, 'the preset editor has no “保存预设” button');
  check(!(await p.evaluate(() => workshopPresetContextItems(workshopDraft()).some(i => i && i.label === '保存预设'))), 'the preset context menu has no save item');
  await expand();
  const field = p.locator('[data-art-setting]:is(textarea, input[type="text"]):visible').first();
  const key = await field.getAttribute('data-art-setting');
  await field.fill('autosave preset value');
  await p.waitForFunction(k => workshopPreset().entries.find(e => e.key === k)?.value === 'autosave preset value', key, {timeout: 5000});
  check(await p.evaluate(() => settingPresetDraft(workshopPreset().id, false)?.dirty === false), 'the preset draft is committed automatically');
  await settled();
  const presetId = await p.evaluate(() => workshopPreset().id);
  await boot();
  check(await p.evaluate(({id, k}) => setBy(id)?.entries.find(e => e.key === k)?.value === 'autosave preset value', {id: presetId, k: key}), 'the preset edit survives a reload');

  // 3. The node-binding form also lands in the preset without a save step.
  await openView('presets');
  await p.locator('#workshop-preset-select').waitFor();
  await expand();
  const before = await p.evaluate(() => (workshopPreset().bindings || []).length);
  await p.getByRole('button', {name: '添加节点绑定', exact: true}).click();
  await p.locator('#preset-binding-node').fill('9');
  await p.locator('#preset-binding-path').fill('strength_model');
  await p.locator('#preset-binding-type').selectOption('number');
  await p.locator('#preset-binding-value').fill('0.65');
  await p.getByRole('button', {name: '保存绑定', exact: true}).click();
  await p.waitForFunction(n => (workshopPreset().bindings || []).length === n + 1, before, {timeout: 5000});
  check(await p.evaluate(() => workshopPreset().bindings.at(-1).value === '0.65'), 'a node binding saved in the form reaches the preset by itself');

  // 4. Switching presets or leaving the page flushes a pending edit immediately.
  const second = await p.evaluate(() => {
    const first = workshopPreset(), copy = {id: 'autosave-second', projectId: first.projectId, title: '第二份预设', entries: [{id: 'v-autosave', key: 'mood', label: '氛围', type: 'text', value: 'calm'}], settingsGroups: []};
    state.creation.variableSets.push(copy); save(); render(); return copy.id;
  });
  await settled();
  await expand();
  await p.locator('[data-art-setting]:is(textarea, input[type="text"]):visible').first().fill('flushed on switch');
  await p.locator('#workshop-preset-select').selectOption(second);
  await expand();
  check(await p.evaluate(k => state.creation.variableSets.find(s => s.id !== 'autosave-second' && s.entries.some(e => e.key === k && e.value === 'flushed on switch')) !== undefined, key), 'changing the preset select commits the previous preset at once');
  await p.locator('[data-art-setting]:is(textarea, input[type="text"]):visible').first().fill('flushed on navigate');
  await p.evaluate(() => navigate(9));
  check(await p.evaluate(() => setBy('autosave-second').entries[0].value === 'flushed on navigate'), 'leaving the workshop commits a pending preset edit');

  // 5. Ctrl/⌘ S in the editors flushes instead of opening the browser's save dialog.
  await openView('stories');
  await p.locator('#workshop-story-select').waitFor();
  const prevented = await p.evaluate(() => { const e = new KeyboardEvent('keydown', {key: 's', ctrlKey: true, bubbles: true, cancelable: true}); document.body.dispatchEvent(e); return e.defaultPrevented; });
  check(prevented, 'Ctrl+S is taken over inside the workshop');
  await settled();

  // 6. Mobile editor: the primary button no longer says “保存并…”.
  check(await p.evaluate(() => { const html = workshopMobileEditorHTML(workshopStory()); return !html.includes('保存并') && /下一幕|新增一幕/.test(html); }), 'the mobile editor button reads “下一幕 / 新增一幕”');

  // 7. English.
  check(await p.evaluate(() => translateCurrentLocale('已自动保存 · 刚刚') === 'Saved automatically · just now' && translateCurrentLocale('已自动保存 · 12 分钟前') === 'Saved automatically · 12 min ago'), 'the status line has English text');

  check(errors.length === 0, 'no page errors: ' + errors.join(' | '));
  console.log(`workshop autosave: ${count} checks passed`);
} finally {
  await browser?.close();
  server.kill();
}
