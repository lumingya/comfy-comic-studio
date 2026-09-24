// T4 · the command palette is an action centre: typing “新建” finds the create actions, everyday actions run from it
// (theme, language, collection switch, connection test, backup), resources open in the current workshop, and scenes are
// found by the words in their caption or prompt.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {chromium} from 'playwright';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mio-command-'));
const base = 'http://127.0.0.1:18890';
const log = fs.openSync(path.join(dir, 'server.log'), 'w');
const server = spawn('python', ['tests/journey_fixture_server.py'], {
  env: {...process.env, MIO_HOST: '127.0.0.1', MIO_PORT: '18890', MIO_DATA_DIR: path.join(dir, 'data'), MIO_JOURNEY_PROVIDER_PORT: '18990'},
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
  const p = await browser.newPage({viewport: {width: 1440, height: 1000}, reducedMotion: 'reduce', acceptDownloads: true});
  const errors = [];
  p.on('pageerror', e => errors.push(e.message));
  await p.route(/^https?:\/\//, r => new URL(r.request().url()).origin === base ? r.continue() : r.abort());
  await p.goto(base);
  await p.waitForFunction(() => typeof rt !== 'undefined' && !rt.booting);
  await p.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()));

  const palette = p.locator('#command-dialog'), input = p.locator('#command-input'), results = p.locator('#command-results .command-item');
  const search = async q => {
    if (!(await palette.evaluate(d => d.open))) { await p.keyboard.press('Control+K'); await palette.waitFor(); }
    await input.fill(q);
    await p.waitForTimeout(80);
    return (await results.allInnerTexts()).map(t => t.replace(/\s+/g, ' ').trim());
  };
  const run = async (q, title) => { await search(q); await results.filter({hasText: title}).first().click(); };

  check((await p.locator('#command-input').getAttribute('placeholder')).includes('例如“新建”'), 'the placeholder mentions actions');
  const created = await search('新建');
  check(['新建分镜', '新建预设', '新建生成任务', '新建画册集'].every(t => created.some(x => x.startsWith(t) && x.includes('动作'))), 'typing 新建 lists the create actions: ' + created.join(' | '));
  const everything = await search('');
  check(['按顺序开始生成', '全局暂停', '继续生成', '测试 ComfyUI 连接', '导出完整备份（ZIP）', '切换到浅色主题', 'Switch to English'].every(t => everything.some(x => x.startsWith(t))), 'the everyday actions are in the palette');
  check(!everything.some(x => x.includes('已生成画册')) && everything.filter(x => x.startsWith('海风与未寄出的信')).length === 1, 'each album is listed once');

  // Create a storyboard from the palette
  await p.keyboard.press('Enter');
  await p.locator('#modal[open]').waitFor();
  check(await p.evaluate(() => ui.workspace === 1 && workshop.view === 'stories') && (await p.locator('#modal').innerText()).includes('新建分镜'), 'Enter runs the first action: the storyboard workshop asks for a name');
  await p.locator('#modal input').first().fill('命令面板新建');
  await p.locator('#modal input').first().press('Enter');
  await p.waitForFunction(() => projectTemplates().some(t => t.title === '命令面板新建'));
  check(await p.evaluate(() => workshopStory()?.title === '命令面板新建'), 'the new storyboard is created and opened');

  // New generation task
  await run('新建生成任务', '新建生成任务');
  await p.locator('#modal.assembly-designer').waitFor();
  check(true, '新建生成任务 opens the assembly wizard');
  await p.evaluate(() => closeModal());

  // English keywords find Chinese titles; theme toggles both ways
  const themes = await search('theme');
  check(themes.length === 1 && themes[0].startsWith('切换到浅色主题'), 'an English keyword finds the theme action');
  await results.first().click();
  await p.waitForFunction(() => document.documentElement.dataset.theme === 'light');
  check(await p.evaluate(() => state.settings.studio.appearance.theme === 'light'), 'the theme switches to light and is saved in settings');
  check((await search('主题'))[0].startsWith('切换到深色主题'), 'the palette now offers the way back');
  await results.first().click();
  await p.waitForFunction(() => document.documentElement.dataset.theme === 'dark');

  // Language
  await run('english', 'Switch to English');
  await p.waitForFunction(() => document.documentElement.lang === 'en');
  const englishItems = await search('');
  check(englishItems.some(x => x.startsWith('Switch to light theme')) && englishItems.some(x => x.includes('Action')), 'in English the palette reads in English');
  await run('中文', '切换到中文');
  await p.waitForFunction(() => document.documentElement.lang === 'zh-CN');
  check(true, 'and switches back to Chinese');

  // Content search: a caption word finds the scene and opens it with the caption focused
  const coast = await search('海岸');
  check(coast.length === 1 && coast[0].startsWith('第 4 幕 · 通往海岸的小路') && coast[0].includes('台词：'), 'a caption word finds its scene: ' + coast.join(' | '));
  await results.first().click();
  await p.waitForFunction(() => document.activeElement?.dataset?.workshopFrame === 'caption', null, {timeout: 3000});
  check(await p.evaluate(() => workshop.view === 'stories' && workshop.frame === 3 && workshopStory().title === '远行与归来 · 十二幕'), 'running it opens scene 4 with the caption focused');
  check((await search('海')).every(x => !x.startsWith('第 ')), 'content search starts from two characters');

  // Resources open in the current workshop
  await run('七海', '七海 · 标准角色设定');
  await p.waitForFunction(() => ui.workspace === 1 && workshop.view === 'presets');
  check(await p.evaluate(() => workshopPreset()?.title === '七海 · 标准角色设定'), 'a preset opens in the preset workshop');
  await run('Anime', 'Anime · 基础图像管线');
  await p.waitForFunction(() => ui.workspace === 5 || ui.workspace === 3 || document.querySelector('#wf-rail'));
  check(await p.evaluate(() => state.settings.comfy.activeWorkflowId === state.settings.comfy.presets.find(w => w.title === 'Anime · 基础图像管线')?.id), 'a workflow opens in the workflow page');

  // Collections
  await p.evaluate(() => { state.projects.push({id: 'collection-palette', title: '第二个画册集', createdAt: Date.now()}); save(); });
  await run('第二个', '切换到画册集「第二个画册集」');
  await p.waitForFunction(() => state.activeProjectId === 'collection-palette');
  check(true, 'switching collection works from the palette');
  await p.evaluate(() => changeProject('collection_summer'));

  // Queue actions follow the production toolbar: with nothing to pause, the palette opens the queue and gives the reason
  const pauseRequests = [];
  p.on('request', r => { if (/\/api\/production\/pause/.test(r.url())) pauseRequests.push(r.url()); });
  await run('暂停', '全局暂停');
  await p.locator('.toast').filter({hasText: '没有正在运行或排队的任务'}).first().waitFor();
  check(await p.evaluate(() => ui.workspace === 1 && workshop.view === 'production') && pauseRequests.length === 0, 'with nothing running, 全局暂停 opens the queue and says why instead of pausing');

  // Connection test and backup
  await run('连接', '测试 ComfyUI 连接');
  await p.locator('.toast').filter({hasText: /ComfyUI 连接成功|连接失败/}).first().waitFor();
  check(true, 'the connection test reports its result');
  // Headless Chromium reports non-ASCII download names as “download”, so the name is read from the link the page clicks and
  // the file itself is checked for the ZIP signature.
  await p.evaluate(() => { const click = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () { if (this.download) window.__lastDownloadName = this.download; return click.call(this); }; });
  const download = p.waitForEvent('download', {timeout: 20000});
  await run('备份', '导出完整备份（ZIP）');
  const archive = path.join(dir, 'backup.zip');
  await (await download).saveAs(archive);
  const signature = fs.readFileSync(archive).subarray(0, 4).toString('latin1');
  check(signature === 'PK\x03\x04' && (await p.evaluate(() => window.__lastDownloadName || '')).toLowerCase().endsWith('.zip'), 'the full backup downloads as a ZIP');

  check(errors.length === 0, 'no page errors: ' + errors.join(' | '));
  console.log(`command palette actions: ${count} checks passed`);
} finally {
  await browser?.close();
  server.kill();
}
