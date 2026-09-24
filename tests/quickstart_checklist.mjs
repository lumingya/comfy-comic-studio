// T9 · the setup checklist on Home and next to the production start buttons, the offline three-scene practice back on
// the main path (it opens the reader when done), and a quick start that shows real progress instead of static steps.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {chromium} from 'playwright';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mio-quickstart-'));
const base = 'http://127.0.0.1:18894';
const provider = 'http://127.0.0.1:18994';
const log = fs.openSync(path.join(dir, 'server.log'), 'w');
const server = spawn('python', ['tests/journey_fixture_server.py'], {
  env: {...process.env, MIO_HOST: '127.0.0.1', MIO_PORT: '18894', MIO_DATA_DIR: path.join(dir, 'data'), MIO_JOURNEY_PROVIDER_PORT: '18994'},
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
  const context = await browser.newContext({viewport: {width: 1440, height: 1000}, reducedMotion: 'reduce'});
  const p = await context.newPage();
  const errors = [], probes = [];
  p.on('pageerror', e => errors.push(e.message));
  p.on('request', r => { if (new URL(r.url()).pathname.startsWith('/api/image/comfy')) probes.push(new URL(r.url()).pathname); });
  await p.route(/^https?:\/\//, r => new URL(r.request().url()).origin === base ? r.continue() : r.abort());
  await p.goto(base);
  await p.waitForFunction(() => typeof rt !== 'undefined' && !rt.booting);
  await p.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()));
  // The default ComfyUI address has nothing listening: settle the start-up check so every list starts from a known state.
  await p.evaluate(async () => { for (let i = 0; i < 20 && !(rt.engineChecked && rt.engineOk === false); i++) { await testEngine(true); await new Promise(r => setTimeout(r, 100)); } });
  await p.evaluate(() => navigate(9));

  const guide = p.locator('#guide-dialog');
  const guideOpen = () => guide.evaluate(d => d.open);
  const homeItem = id => p.locator(`#home-checklist [data-check="${id}"]`);
  const guideItem = id => p.locator(`#guide-dialog [data-check="${id}"]`);
  const checklistIds = () => p.evaluate(() => setupChecklist().map(i => i.id));

  // Home hero: the offline practice sits on the main path
  const hero = await p.locator('.home-hero-actions [data-act]').evaluateAll(es => es.map(e => [e.textContent.trim(), e.dataset.act]));
  check(hero.map(h => h[0]).join('|') === '从一幕开始|先用离线练习体验|浏览我的画册' && hero[1][1] === 'guide-practice', 'the offline practice sits between 从一幕开始 and 浏览我的画册');
  check(await p.locator('.home-hero-actions [data-act="guide-practice"]').evaluate(e => tooltipText(e)) === '用本地示意图生成一本三幕画册，完成后直接打开阅读器。', 'its tooltip says what it makes and that the reader opens');

  // Home GET STARTED: the same checklist as the help drawer, without probing anything
  const before = probes.length;
  for (let i = 0; i < 3; i++) await p.evaluate(() => { navigate(0); navigate(9); });
  await p.waitForTimeout(300);
  check(probes.length === before, 'rendering Home sends no ComfyUI check');
  check(JSON.stringify(await p.locator('#home-checklist [data-check]').evaluateAll(es => es.map(e => e.dataset.check))) === JSON.stringify(await checklistIds()), 'Home lists the checklist items in the drawer’s order');
  check((await p.locator('#home-checklist .checklist-progress').innerText()) === '已完成 2 / 5' && (await p.locator('#home-checklist-title').innerText()) === '开箱检查', 'the Home card counts finished items: 已完成 2 / 5');
  check((await homeItem('service').getAttribute('class')).includes('is-todo') && (await homeItem('service').innerText()).includes('连不上 ComfyUI') && (await homeItem('model').innerText()).includes('your-anime-model'), 'problems show their cause on Home');
  check(await p.locator('#home-checklist').evaluate(e => e.closest('.first-run') !== null), 'the checklist is part of the first-run guidance');

  // In-place fix on Home: the card updates without leaving the page
  await p.evaluate(u => { state.settings.comfy.baseUrl = u; save(); }, provider);
  await homeItem('service').locator('[data-act="help-test-engine"]').click();
  await p.waitForFunction(() => document.querySelector('#home-checklist [data-check="service"]')?.classList.contains('is-done'), null, {timeout: 10000});
  check(await p.evaluate(() => ui.workspace === 9) && (await homeItem('service').innerText()).includes('ComfyUI 已连接') && (await p.locator('#home-checklist .checklist-progress').innerText()) === '已完成 3 / 5', '测试连接 on Home turns the item done and the count follows, on the same page');
  check(await p.evaluate(() => !!document.activeElement?.closest('#home-checklist')), 'focus stays in the Home card after the refresh');
  check(!(await p.evaluate(() => document.getElementById('help-drawer')?.open)), 'the in-place fix does not open the drawer');

  // 收起指引 hides it together with the provider cards
  await p.locator('[data-act="first-run-hide"]').click();
  check(await p.locator('#home-checklist').count() === 0 && await p.locator('[data-act="first-run-show"]').isVisible(), '收起指引 hides the checklist with the rest of the guidance');
  await p.locator('[data-act="first-run-show"]').click();
  check(await p.locator('#home-checklist').count() === 1, '首次使用指引 brings it back');

  // Everything done: one line with a way to look at the details
  await p.evaluate(() => { window.__realChecklist = setupChecklist; setupChecklist = () => window.__realChecklist().map(i => ({...i, state: 'done', fix: null})); render(); });
  check((await p.locator('#home-checklist.is-complete').innerText()).includes('开箱检查已全部完成 · 5 / 5') && await p.locator('#home-checklist [data-check]').count() === 0, 'when every item is done Home shows a single line');
  await p.locator('#home-checklist [data-act="help-drawer-checklist"]').click();
  await p.locator('#help-drawer[open]').waitFor();
  check(await p.evaluate(() => document.activeElement?.id === 'help-checklist-title'), '查看 opens the help drawer at the checklist');
  await p.keyboard.press('Escape');
  await p.waitForFunction(() => !document.getElementById('help-drawer').open);

  // Production page: remaining items next to 按顺序开始生成
  await p.evaluate(async () => { workshop.view = 'production'; navigate(1); await refreshProduction(); });
  check(await p.locator('.setup-remaining').count() === 0, 'nothing is shown next to the start buttons when the checklist is complete');
  await p.evaluate(async () => { setupChecklist = window.__realChecklist; delete window.__realChecklist; render(); });
  const chip = p.locator('.production-controls .setup-remaining');
  check((await chip.innerText()) === '开箱检查还差 2 项', 'the production page says how many checklist items are left: 开箱检查还差 2 项');
  await chip.click();
  await p.locator('#help-drawer[open]').waitFor();
  check(await p.evaluate(() => document.activeElement?.id === 'help-checklist-title'), 'the chip opens the help drawer at the checklist');
  await p.keyboard.press('Escape');
  await p.waitForFunction(() => !document.getElementById('help-drawer').open);
  await p.evaluate(() => navigate(9));

  // Quick start: real progress, one source for its text
  await p.evaluate(() => { state.settings.comfy.baseUrl = 'http://127.0.0.1:9'; save(); });
  await p.evaluate(async () => { rt.engineChecked = false; await testEngine(true); });
  await p.evaluate(() => handleAction('guide-open', {}));
  await p.locator('#guide-dialog[open]').waitFor();
  const rows = await guide.locator('[data-check]').evaluateAll(es => es.map(e => e.dataset.check));
  check(JSON.stringify(rows) === JSON.stringify(['practice', ...await checklistIds()]), 'the quick start is the offline practice followed by the checklist items: ' + rows.join(', '));
  check((await guide.locator('.service-status').innerText()) === '已完成 2 / 5' && await guide.locator('[data-act="guide-step"],[data-act="guide-next"]').count() === 0, 'its progress is the checklist’s, not a page counter');
  check((await guide.locator('.modal-head p').innerText()).includes('右上角的“?”') && !(await guide.innerText()).includes('侧栏'), 'the header points at the “?” to reopen it');
  check((await guideItem('practice').innerText()).includes('可选') && (await guideItem('practice').getAttribute('class')).includes('is-optional'), 'the practice is marked optional and is not counted');
  check(await p.evaluate(() => { const copy = new Map(guideSteps.map(s => [s.id, s])); return [...document.querySelectorAll('#guide-dialog [data-check]')].every(r => r.querySelector('.help-check-intro')?.textContent === copy.get(r.dataset.check)?.intro); }), 'every row takes its line from guideSteps');
  check(JSON.stringify(await guide.locator('.quickstart-more [data-act]').evaluateAll(es => es.map(e => e.dataset.act))) === JSON.stringify(['guide-reader', 'guide-export', 'guide-github']), '阅读 / 导出 / 分享 moved to 进阶');
  check((await guideItem('service').locator('.btn').getAttribute('class')).includes('primary'), 'the next unfinished step carries the primary button');
  check(await p.evaluate(() => setupChecklist().every(i => guideSteps.some(s => s.id === i.id && s.intro)) && guideSteps.filter(s => s.more).every(s => Object.hasOwn(releaseActions, s.action))), 'the release self-check for the quick start holds');

  // A fix that works in place keeps the quick start open; one that goes elsewhere closes it first
  await p.evaluate(u => { state.settings.comfy.baseUrl = u; save(); }, provider);
  await guideItem('service').locator('[data-act="help-test-engine"]').click();
  await p.waitForFunction(() => document.querySelector('#guide-dialog [data-check="service"]')?.classList.contains('is-done'), null, {timeout: 10000});
  check(await guideOpen() && (await guide.locator('.service-status').innerText()) === '已完成 3 / 5', '测试连接 runs inside the quick start and its progress follows');
  check(await p.evaluate(() => document.querySelector('#guide-dialog').contains(document.activeElement)), 'focus stays inside the quick start');
  await guideItem('trial').locator('[data-act="assembly-new"]').click();
  await p.locator('#modal.assembly-designer[open]').waitFor();
  check(!(await guideOpen()), '新建生成任务 closes the quick start and opens the assembly wizard');
  await p.evaluate(() => closeModal());

  // The practice runs from the quick start and opens the reader
  await p.evaluate(() => handleAction('guide-open', {}));
  await guideItem('practice').locator('[data-act="guide-practice"]').click();
  await p.waitForFunction(() => document.querySelector('#guide-dialog [data-check="practice"]')?.classList.contains('is-checking'));
  check((await guideItem('practice').innerText()).includes('正在生成三幕练习'), 'while it runs the practice row shows its progress');
  await p.waitForFunction(() => document.getElementById('reader').open, null, {timeout: 15000});
  const practice = await p.evaluate(() => { const b = bookBy(guidePreferences().practiceBookId); return {open: ui.bookId === b?.id, status: b?.status, pages: b?.steps.length, title: b?.title}; });
  check(practice.open && practice.status === 'complete' && practice.pages === 3 && !(await guideOpen()), 'when the practice is done the quick start closes and the reader opens the three-scene book');
  check(await p.evaluate(() => setupChecklist().find(i => i.id === 'trial').state === 'todo'), 'the offline practice does not count as a trial run of the image service');
  await p.evaluate(() => closeArtReader());
  await p.evaluate(() => navigate(9));
  check((await p.locator('.home-hero-actions [data-act="guide-practice"]').innerText()).trim() === '打开离线练习画册', 'after the practice the Home button reads 打开离线练习画册');
  await p.locator('.home-hero-actions [data-act="guide-practice"]').click();
  await p.waitForFunction(() => document.getElementById('reader').open);
  check(await p.evaluate(() => ui.bookId === guidePreferences().practiceBookId), 'it opens the practice book directly');
  await p.evaluate(() => closeArtReader());
  await p.evaluate(() => handleAction('guide-open', {}));
  check((await guideItem('practice').getAttribute('class')).includes('is-done') && (await guideItem('practice').innerText()).includes('已生成「' + practice.title + '」') && (await guideItem('practice').locator('.btn').innerText()) === '打开练习画册', 'the quick start marks the practice done and offers to open it');
  await guide.locator('header [data-act="guide-close"]').click();
  check(!(await guideOpen()), 'the close button closes the quick start');

  // From Home, a new practice also ends in the reader
  await p.evaluate(() => { guidePreferences().practiceBookId = null; navigate(9); });
  await p.locator('.home-hero-actions [data-act="guide-practice"]').click();
  await p.waitForFunction(() => document.getElementById('reader').open, null, {timeout: 15000});
  check(await p.evaluate(() => ui.bookId === guidePreferences().practiceBookId && bookBy(ui.bookId)?.status === 'complete'), 'the Home button generates the practice and opens it in the reader');
  await p.evaluate(() => closeArtReader());

  // English
  await p.evaluate(() => changeInterfaceLanguage('en'));
  await p.waitForFunction(() => document.documentElement.lang === 'en');
  await p.evaluate(() => { guidePreferences().practiceBookId = null; changeProject('collection_summer'); navigate(9); });
  const [doneEn, totalEn] = await p.evaluate(() => { const l = setupChecklist(); return [l.filter(i => i.state === 'done').length, l.length]; });
  const heroEn = await p.locator('.home-hero-actions [data-act="guide-practice"]').innerText();
  const homeEn = await p.locator('#home-checklist').innerText();
  check(heroEn.trim() === 'Try the offline practice' && homeEn.includes('Setup checklist') && homeEn.includes(`Done ${doneEn} / ${totalEn}`), 'the Home button and card are translated: ' + heroEn.trim());
  await p.evaluate(async () => { workshop.view = 'production'; navigate(1); await refreshProduction(); });
  check((await p.locator('.setup-remaining').innerText()) === `Setup checklist: ${totalEn - doneEn} left`, 'the production chip is translated');
  await p.evaluate(() => { navigate(9); handleAction('guide-open', {}); });
  const guideEn = await guide.innerText();
  check(['Offline practice', 'Optional', 'Try the offline practice', 'reopen it later', 'Next steps', `Done ${doneEn} / ${totalEn}`].every(t => guideEn.includes(t)) && !/[\u4e00-\u9fff]/.test(await guide.locator('.modal-head, .quickstart-more, .service-footer').allInnerTexts().then(t => t.join(' '))), 'the quick start is translated');
  await guide.locator('header [data-act="guide-close"]').click();
  await p.evaluate(() => changeInterfaceLanguage('zh-CN'));
  await p.waitForFunction(() => document.documentElement.lang === 'zh-CN' && !backendRuntime.dirty && !backendRuntime.saving);

  check(errors.length === 0, 'no page errors: ' + errors.join(' | '));
  console.log(`quickstart checklist: ${count} checks passed`);
} finally {
  await browser?.close();
  server.kill();
}
