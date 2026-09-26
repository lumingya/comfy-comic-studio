// T5 · the “?” in the top bar opens a help drawer: page context with actions and terms, the setup checklist with fixes
// that report back in place, tutorials, shortcuts (“?” opens them) and copyable diagnostics.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {chromium} from 'playwright';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mio-help-'));
const base = 'http://127.0.0.1:18891';
const log = fs.openSync(path.join(dir, 'server.log'), 'w');
const server = spawn('python', ['tests/journey_fixture_server.py'], {
  env: {...process.env, MIO_HOST: '127.0.0.1', MIO_PORT: '18891', MIO_DATA_DIR: path.join(dir, 'data'), MIO_JOURNEY_PROVIDER_PORT: '18991'},
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
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], {origin: base});
  const p = await context.newPage();
  const errors = [];
  p.on('pageerror', e => errors.push(e.message));
  await p.route(/^https?:\/\//, r => new URL(r.request().url()).origin === base ? r.continue() : r.abort());
  await p.goto(base);
  await p.waitForFunction(() => typeof rt !== 'undefined' && !rt.booting);
  await p.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()));
  // The default ComfyUI address has nothing listening: settle the check so the checklist starts from a known state.
  await p.evaluate(async () => { for (let i = 0; i < 20 && !(rt.engineChecked && rt.engineOk === false); i++) { await testEngine(true); await new Promise(r => setTimeout(r, 100)); } });

  const drawer = p.locator('#help-drawer');
  const isOpen = () => drawer.evaluate(d => d.open).catch(() => false);
  const item = id => p.locator(`#help-checklist [data-check="${id}"]`);
  const openFromTopbar = async () => { await p.locator('#topbar [data-act="help-drawer"]').click(); await p.locator('#help-drawer[open]').waitFor(); };
  const close = async () => { if (await isOpen()) { await p.keyboard.press('Escape'); await p.waitForFunction(() => !document.getElementById('help-drawer').open); } };

  // Top bar entry and page context on Home
  const button = p.locator('#topbar [data-act="help-drawer"]');
  check((await button.getAttribute('aria-label')) === '帮助与快捷键' && (await button.getAttribute('aria-haspopup')) === 'dialog', 'the top bar “?” is labelled 帮助与快捷键 and announces a dialog');
  await openFromTopbar();
  const home = await drawer.innerText();
  check((await p.locator('#help-drawer-title').innerText()) === '首页' && home.includes('从这里开始') && home.includes('画册集') && (await drawer.locator('.help-context [data-act="help-new-story"]').count()) === 1 && (await drawer.locator('.help-context [data-act="assembly-new"]').count()) === 1, 'on Home the drawer explains the page, offers its actions and explains its terms');
  check(await p.evaluate(() => document.activeElement?.id === 'help-drawer-title'), 'focus starts on the drawer title');
  check(['开箱检查', '教程', '快捷键', '诊断信息'].every(t => home.includes(t)), 'the drawer holds the checklist, tutorials, shortcuts and diagnostics');

  // Checklist: real state, fixes report back in place
  check((await item('service').getAttribute('class')).includes('is-todo') && (await item('service').innerText()).includes('连不上 ComfyUI'), 'an unreachable ComfyUI is listed as a problem');
  check((await item('workflow').getAttribute('class')).includes('is-done') && (await item('workflow').innerText()).includes('提示词与种子已映射'), 'the bundled workflow has its prompt and seed mapped');
  check((await item('model').getAttribute('class')).includes('is-todo') && (await item('model').innerText()).includes('your-anime-model'), 'the placeholder model is flagged');
  check((await item('material').getAttribute('class')).includes('is-done') && (await item('trial').getAttribute('class')).includes('is-todo') && (await item('trial').innerText()).includes('新建生成任务'), 'storyboards and presets are ready; no trial run yet');
  check((await p.locator('.help-progress').innerText()) === '已完成 2 / 5', 'the progress counts the finished items');
  await p.evaluate(() => { state.settings.comfy.baseUrl = 'http://127.0.0.1:18991'; save(); });
  await item('service').locator('[data-act="help-test-engine"]').click();
  await p.waitForFunction(() => document.querySelector('#help-checklist [data-check="service"]')?.classList.contains('is-done'), null, {timeout: 10000});
  check(await isOpen() && (await item('service').innerText()).includes('ComfyUI 已连接'), '测试连接 runs inside the drawer and the item turns done');
  check((await p.locator('.help-progress').innerText()) === '已完成 3 / 5', 'the progress follows');

  await p.evaluate(() => { const c = state.settings.comfy, w = c.presets.find(x => x.id === c.activeWorkflowId); w.bindings = w.bindings.filter(b => !isSeedBinding(b)); c.bindings = clone(w.bindings); save(); openHelpDrawer(); });
  check((await item('workflow').innerText()).includes('没有种子映射') && (await item('workflow').locator('[data-act="help-add-seed"]').count()) === 1, 'a workflow without a seed mapping offers the one-click fix');
  await item('workflow').locator('[data-act="help-add-seed"]').click();
  await p.waitForFunction(() => document.querySelector('#help-checklist [data-check="workflow"]')?.classList.contains('is-done'));
  check(await isOpen() && await p.evaluate(() => workflowSeedReady(state.settings.comfy.presets.find(x => x.id === state.settings.comfy.activeWorkflowId))), 'the seed mapping is added and the drawer stays open');

  await p.evaluate(() => { const c = state.settings.comfy; state.settings.productionAssembly = {...(state.settings.productionAssembly || {}), overrides: {[c.activeWorkflowId]: {model: 'installed-model.safetensors'}}}; openHelpDrawer(); });
  check((await item('model').getAttribute('class')).includes('is-checking') && (await item('model').locator('[data-act="help-sync-models"]').count()) === 1, 'a model chosen in the wizard replaces the placeholder; the installed list still has to be synced');
  await p.evaluate(() => { delete state.settings.productionAssembly.overrides; openHelpDrawer(); });
  await item('model').locator('[data-act="assembly-new"]').click();
  await p.locator('#modal.assembly-designer[open]').waitFor();
  check(!(await isOpen()), '选择模型 closes the drawer and opens the assembly wizard');
  await p.evaluate(() => closeModal());

  check(await p.evaluate(() => { state.books.push({id: 'help-trial', title: '试跑画册', projectId: state.activeProjectId, generatedSteps: 1, totalSteps: 1, updatedAt: Date.now(), steps: [{image: '/images/trial.png'}]}); const trial = setupChecklist().find(i => i.id === 'trial'); state.books.pop(); return trial.state === 'done' && trial.detail.includes('试跑画册') && trial.image.includes('/images/trial.png'); }), 'a generated book completes the trial run, with its cover');
  await p.evaluate(() => { state.projects.push({id: 'collection-empty', title: '空画册集', createdAt: Date.now()}); changeProject('collection-empty'); openHelpDrawer(); });
  check((await item('material').innerText()).includes('当前画册集还没有分镜') && (await item('material').locator('[data-act="help-new-story"]').count()) === 1, 'an empty collection asks for a storyboard');
  await close();
  await p.evaluate(() => changeProject('collection_summer'));

  // Tutorials
  await openFromTopbar();
  const links = await drawer.locator('.help-doc-list a').evaluateAll(as => as.map(a => [a.textContent.replace('↗', '').trim(), a.getAttribute('href'), a.target]));
  check(links.some(([t, h]) => t === '快速开始' && h === '/docs/guide/QUICKSTART.html') && links.some(([t, h]) => t === '教程中心' && h === '/docs/index.html') && links.every(([, , target]) => target === '_blank'), 'the tutorials link to the guide pages in a new tab');
  check((await fetch(base + '/docs/guide/QUICKSTART.html')).ok && (await fetch(base + '/docs/guide/CHANNELS_AND_KEYS.html')).ok, 'the linked guide pages are served');

  // Shortcuts
  const keys = await drawer.locator('#help-keys').innerText();
  check(keys.includes('搜索与快速操作') && keys.includes('Alt') && keys.includes('工作流与 API 配置') && !keys.includes('AI 写故事') && keys.includes('打开右键菜单'), 'the shortcut list shows the real shortcuts, without hidden pages');

  // Diagnostics
  await drawer.locator('[data-act="help-copy-diagnostics"]').click();
  await p.locator('.toast').filter({hasText: '已复制到剪贴板'}).first().waitFor();
  const copied = await p.evaluate(() => navigator.clipboard.readText());
  check(copied.startsWith('Mio ') && copied.includes('页面：首页') && copied.includes('图像服务：ComfyUI · http://127.0.0.1:18991 · 已连接') && copied.includes('开箱检查：') && await isOpen(), 'diagnostics are copied and the drawer stays open: ' + copied.split('\n').slice(0, 3).join(' / '));
  const shown = (await drawer.locator('#help-diagnostics-text').textContent()).split('\n'), line = key => copied.split('\n').find(l => l.startsWith(key));
  check(['图像服务：', '工作流：', '开箱检查：'].every(key => shown.includes(line(key))), 'the copied text matches what 查看内容 shows');

  // Esc returns focus to the “?”; the backdrop closes without clicking what lies under it
  await p.keyboard.press('Escape');
  await p.waitForFunction(() => !document.getElementById('help-drawer').open);
  check(await p.evaluate(() => document.activeElement?.dataset?.act === 'help-drawer'), 'Esc closes the drawer and focus returns to the “?”');
  await openFromTopbar();
  const nav = await p.locator('#sidebar [data-act="art-nav"]').nth(1).boundingBox();
  await p.mouse.click(nav.x + nav.width / 2, nav.y + nav.height / 2);
  await p.waitForFunction(() => !document.getElementById('help-drawer').open);
  await p.waitForTimeout(150);
  check(await p.evaluate(() => ui.workspace === 9), 'a click on the backdrop closes the drawer and does not reach the sidebar under it');

  // “?” on the keyboard
  await p.evaluate(() => document.activeElement?.blur());
  await p.keyboard.press('Shift+Slash');
  await p.locator('#help-drawer[open]').waitFor();
  check(await p.evaluate(() => document.activeElement?.id === 'help-keys-title'), '“?” opens the drawer at the shortcuts');
  await p.keyboard.press('Shift+Slash');
  await p.waitForFunction(() => !document.getElementById('help-drawer').open);
  await p.evaluate(() => { workshop.view = 'stories'; navigate(1); });
  const caption = p.locator('[data-workshop-frame="caption"]').first();
  await caption.click();
  await p.keyboard.press('End');
  await p.keyboard.type('?');
  check(!(await isOpen()) && (await caption.inputValue()).endsWith('?'), 'typing “?” in a field stays in the field');
  await p.keyboard.press('Backspace');
  await p.evaluate(() => navigate(9));

  // From the command palette
  await p.keyboard.press('Control+K');
  await p.locator('#command-input').fill('帮助');
  await p.locator('#command-results .command-item').filter({hasText: '帮助与快捷键'}).first().click();
  await p.locator('#help-drawer[open]').waitFor();
  check(true, 'the command palette opens the help drawer');
  await close();

  // Context follows the page; page actions close the drawer and run
  await p.evaluate(async () => { workshop.view = 'production'; navigate(1); await refreshProduction(); });
  await openFromTopbar();
  check((await p.locator('#help-drawer-title').innerText()) === '装配与队列' && (await drawer.innerText()).includes('点「开始」才会请求图像服务'), 'in the queue the drawer explains assembly and tasks');
  await close();
  await p.evaluate(() => navigate(3));
  await openFromTopbar();
  check((await p.locator('#help-drawer-title').innerText()) === '工作流与 API 配置' && (await drawer.locator('.help-context [data-act="help-test-engine"]').count()) === 1 && (await drawer.locator('.help-doc-list a[href="/docs/guide/WORKFLOW.html"]').count()) === 1, 'on the workflow page it offers the connection test and the workflow guide');
  await close();
  await p.evaluate(() => { workshop.view = 'stories'; navigate(1); });
  await openFromTopbar();
  await drawer.locator('.help-context [data-act="help-new-story"]').click();
  await p.locator('#modal[open]').waitFor();
  check(!(await isOpen()) && (await p.locator('#modal').innerText()).includes('新建分镜'), '新建分镜 closes the drawer and asks for the storyboard name');
  await p.evaluate(() => closeModal());

  // Alt + digit follows the key position, so layouts where Alt changes the character (macOS Option) still switch pages
  await p.evaluate(() => { navigate(9); document.body.dispatchEvent(new KeyboardEvent('keydown', {key: '¡', code: 'Digit1', altKey: true, bubbles: true, cancelable: true})); });
  check(await p.evaluate(() => ui.workspace === 0), 'Alt + 1 opens 画册集 by key position');
  await p.evaluate(() => navigate(9));

  // English
  await p.evaluate(() => changeInterfaceLanguage('en'));
  await p.waitForFunction(() => document.documentElement.lang === 'en');
  await openFromTopbar();
  const english = await drawer.innerText();
  check((await p.locator('#help-drawer-title').innerText()) === 'Home' && english.includes('Setup checklist') && english.includes('Shortcuts') && english.includes('Diagnostics') && (await drawer.locator('.help-doc-list a[href="/docs/en/GUIDE.html#start"]').count()) === 1 && !/[\u4e00-\u9fff]/.test(english.replace(/「[^」]*」|“[^”]*”/g, '')), 'in English the drawer reads in English and links the English guide');
  await close();
  await p.evaluate(() => changeInterfaceLanguage('zh-CN'));
  await p.waitForFunction(() => document.documentElement.lang === 'zh-CN');

  // Phone width: full-width drawer
  await p.setViewportSize({width: 390, height: 844});
  await p.evaluate(() => openHelpDrawer());
  const box = await drawer.boundingBox();
  check(Math.round(box.width) === 390 && Math.round(box.x) === 0, 'on a phone the drawer takes the full width');
  await close();

  check(errors.length === 0, 'no page errors: ' + errors.join(' | '));
  console.log(`help drawer: ${count} checks passed`);
} finally {
  await browser?.close();
  server.kill();
}
