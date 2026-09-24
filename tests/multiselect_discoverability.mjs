// T10 · multi-select can be discovered: a one-time line explains the gestures on the shelf, the scene rail and the task list
// (gone once dismissed or once two items have been selected, remembered across reloads, never on touch screens), and a
// selection's status line carries the common batch actions from the right-click menu plus 更多… for the rest.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {chromium} from 'playwright';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mio-multiselect-'));
const base = 'http://127.0.0.1:18889', provider = 'http://127.0.0.1:18989';
const log = fs.openSync(path.join(dir, 'server.log'), 'w');
const server = spawn('python', ['tests/journey_fixture_server.py'], {
  env: {...process.env, MIO_HOST: '127.0.0.1', MIO_PORT: '18889', MIO_DATA_DIR: path.join(dir, 'data'), MIO_JOURNEY_PROVIDER_PORT: '18989'},
  stdio: ['ignore', log, log],
});
let browser, count = 0;
const check = (value, label) => { assert.ok(value, label); console.log('PASS ' + label); count++; };
const HINT = '框选或 Ctrl / ⌘ 点击可多选，右键批量操作';

try {
  let ready = false;
  for (let i = 0; i < 150; i++) {
    try { if ((await fetch(base + '/api/content')).ok) { ready = true; break; } } catch {}
    await new Promise(r => setTimeout(r, 100));
  }
  assert.ok(ready, 'fixture startup');
  browser = await chromium.launch({args: ['--no-sandbox']});
  const context = await browser.newContext({viewport: {width: 1440, height: 1000}, reducedMotion: 'reduce'});
  const p = await context.newPage();
  const errors = [];
  p.on('pageerror', e => errors.push(e.message));
  await p.route(/^https?:\/\//, r => new URL(r.request().url()).origin === base ? r.continue() : r.abort());
  const boot = async () => {
    await p.goto(base);
    await p.waitForFunction(() => typeof rt !== 'undefined' && !rt.booting);
    await p.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()));
  };
  const hint = p.locator('.multiselect-hint');
  const forget = () => p.evaluate(() => localStorage.removeItem('cc-hint-multiselect'));
  const seen = () => p.evaluate(() => localStorage.getItem('cc-hint-multiselect') === 'seen');
  await boot();

  // Shelf: a second album so there is something to select several of.
  await p.evaluate(() => { const copy = {...clone(state.books[0]), id: 'shelf-copy', title: '第二本画册', starred: false}; state.books.push(copy); navigate(0); });
  await p.locator('#gallery-results [data-sort-book="shelf-copy"]').waitFor();
  check(await hint.count() === 1 && (await hint.innerText()).includes(HINT), 'the shelf explains how to select several albums');
  const books = p.locator('#gallery-results [data-sort-book]');
  await books.nth(0).click({modifiers: ['Control']});
  check(await hint.isHidden(), 'the hint steps aside while something is selected');
  const shelfStatus = p.locator('#gallery-results .shelf-selection-status');
  check((await shelfStatus.innerText()).includes('已选 1 本'), 'one selected album is counted');
  await books.nth(1).click({modifiers: ['Control']});
  check(await seen(), 'selecting two albums counts as having learned it');
  check(await hint.count() === 0, 'so the hint is gone');
  const shelfText = (await shelfStatus.innerText()).replace(/\s+/g, ' ');
  check(shelfText.includes('已选 2 本') && !shelfText.includes('右键操作'), 'the status line counts instead of pointing at the right-click menu');
  const exportButton = shelfStatus.locator('[data-act="org-context-export"]'), deleteButton = shelfStatus.locator('[data-act="org-context-delete"]');
  check(await exportButton.innerText() === '导出离线画册…' && JSON.parse(await exportButton.getAttribute('data-ids')).length === 2, 'export acts on both selected albums');
  check(await deleteButton.innerText() === '批量删除…' && await deleteButton.evaluate(e => e.classList.contains('danger')), 'delete is there, in the danger colour');
  await shelfStatus.locator('[data-act="selection-more"]').click();
  const menu = p.locator('.context-menu, [role="menu"]').filter({hasText: '对这 2 本画册'}).first();
  await menu.waitFor();
  check(await menu.isVisible(), '更多… opens the same right-click menu for the selection');
  await p.keyboard.press('Escape');
  await deleteButton.click();
  await p.locator('#confirm-dialog[open]').waitFor();
  check((await p.locator('#confirm-dialog').innerText()).includes('2'), 'batch delete asks for confirmation first');
  await p.locator('#confirm-no').click();
  check(await p.evaluate(() => state.books.some(b => b.id === 'shelf-copy')), 'and cancelling keeps the albums');
  await p.evaluate(() => { exitBookSelection(); syncSelectionView(); });

  // Scene rail: dismissing with 知道了 is remembered across reloads and everywhere.
  await forget();
  await p.evaluate(() => { ui.workspace = 1; workshop.view = 'stories'; render(); });
  const railHint = p.locator('.workshop-frames .multiselect-hint');
  await railHint.waitFor();
  check((await railHint.innerText()).includes(HINT), 'the scene rail shows the hint too');
  await railHint.getByRole('button', {name: '知道了', exact: true}).click();
  check(await hint.count() === 0 && await seen(), '知道了 dismisses it');
  await boot();
  await p.evaluate(() => { ui.workspace = 1; workshop.view = 'stories'; render(); });
  check(await hint.count() === 0, 'and it stays dismissed after a reload');
  await p.evaluate(() => navigate(0));
  check(await hint.count() === 0, 'on the shelf as well');

  // Scene rail actions
  await p.evaluate(() => { ui.workspace = 1; workshop.view = 'stories'; render(); });
  const frames = p.locator('.workshop-frames-list button[data-index]');
  const before = await frames.count();
  await frames.nth(1).click({modifiers: ['Control']});
  await frames.nth(2).click({modifiers: ['Control']});
  const railStatus = p.locator('.workshop-frames-status');
  const railText = (await railStatus.innerText()).replace(/\s+/g, ' ');
  check(railText.includes('已选 2 幕') && railText.includes('复制所选分幕') && railText.includes('删除选中的 2 幕…') && railText.includes('更多…'), 'the scene rail offers copy, delete and more for the selection');
  await railStatus.getByRole('button', {name: '复制所选分幕', exact: true}).click();
  await p.waitForFunction(n => document.querySelectorAll('.workshop-frames-list button[data-index]').length === n + 2, before);
  check(true, 'copy duplicates the two selected scenes');
  await p.evaluate(() => { workshop.pickedFrames.clear(); render(); });

  // Task list: two standby tasks, selected with Ctrl-click.
  await p.evaluate(async provider => {
    const openai = ensureImageProviders().profiles.find(x => x.provider === 'openai');
    Object.assign(openai, {baseUrl: provider + '/v1', model: 'fixture-image', title: '本机图像接口'}); save();
    for (let i = 0; i < 2; i++) { openAssemblyDesigner(); Object.assign(assemblyDesign, {channelId: 'openai', step: 2, title: '多选任务 ' + i}); renderAssemblyDesigner(); await submitAssemblyDesigner(); }
  }, provider);
  await p.waitForFunction(() => workshop.queue.tasks.length === 2);
  await forget();
  await p.evaluate(() => { ui.workspace = 1; workshop.view = 'production'; render(); });
  await p.locator('.production-card').nth(1).waitFor();
  check((await hint.innerText()).includes(HINT), 'the task list shows the hint while it has two or more tasks');
  const cards = p.locator('article.production-card');
  await cards.nth(0).click({modifiers: ['Control'], position: {x: 12, y: 12}});
  await cards.nth(1).click({modifiers: ['Control'], position: {x: 12, y: 12}});
  const taskStatus = p.locator('.production-selection-status');
  const taskText = (await taskStatus.innerText()).replace(/\s+/g, ' ');
  check(taskText.includes('已选 2 个生成任务') && taskText.includes('同时开始生成 2 本') && taskText.includes('克隆 2 本') && taskText.includes('移除 2 条任务记录…'), 'the task list offers start, clone and remove for the selection: ' + taskText);
  check(await taskStatus.locator('[data-act="production-remove"]').evaluate(e => e.classList.contains('danger')), 'remove is in the danger colour');
  await taskStatus.getByRole('button', {name: '克隆 2 本', exact: true}).click();
  await p.waitForFunction(() => workshop.queue.tasks.length === 4);
  check(true, 'clone copies both selected tasks');

  // English
  await p.evaluate(() => { localStorage.removeItem('cc-hint-multiselect'); if (!state.books.some(b => b.id === 'shelf-copy')) state.books.push({...clone(state.books[0]), id: 'shelf-copy', title: '第二本画册', starred: false}); state.settings.presentation.language = 'en'; applyDisplayAttributes(); navigate(0); });
  await p.waitForFunction(() => document.documentElement.lang === 'en');
  check((await hint.innerText()).includes('Drag a box or Ctrl / ⌘-click to select several; right-click for batch actions'), 'the hint is translated');
  await books.nth(0).click({modifiers: ['Control']});
  check((await shelfStatus.innerText()).replace(/\s+/g, ' ').includes('1 selected'), 'and so is the status line');
  await p.evaluate(() => { exitBookSelection(); state.settings.presentation.language = 'zh-CN'; applyDisplayAttributes(); render(); });

  // Touch screens have no marquee or Ctrl-click, so the hint never shows there.
  const touch = await browser.newContext({viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true});
  const t = await touch.newPage();
  await t.route(/^https?:\/\//, r => new URL(r.request().url()).origin === base ? r.continue() : r.abort());
  await t.goto(base);
  await t.waitForFunction(() => typeof rt !== 'undefined' && !rt.booting);
  await t.evaluate(() => { document.querySelectorAll('dialog[open]').forEach(d => d.close()); ui.workspace = 1; workshop.view = 'production'; render(); });
  const touchHint = t.locator('.multiselect-hint');
  check(!(await touchHint.count()) || await touchHint.first().isHidden(), 'no gesture hint on a touch screen');
  await touch.close();

  check(errors.length === 0, 'no page errors: ' + errors.join(' | '));
  console.log(`multi-select discoverability: ${count} checks passed`);
} finally {
  await browser?.close();
  server.kill();
}
