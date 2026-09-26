// T7 · 设置分为 常用 / 高级 / 开发者（开发者默认隐藏），内部代号换成用途名称（LLM / XML / CRITIC → 文本模型 / 结构化解析服务 / 视觉审校），
// 每项配置只有一个入口：ComfyUI 地址只在「工作流与 API 配置」里改，设置里只放跳转。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {chromium} from 'playwright';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mio-tiers-'));
const base = 'http://127.0.0.1:18893';
const log = fs.openSync(path.join(dir, 'server.log'), 'w');
const server = spawn('python', ['tests/journey_fixture_server.py'], {
  env: {...process.env, MIO_HOST: '127.0.0.1', MIO_PORT: '18893', MIO_DATA_DIR: path.join(dir, 'data'), MIO_JOURNEY_PROVIDER_PORT: '18993'},
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
  const errors = [];
  p.on('pageerror', e => errors.push(e.message));
  await p.route(/^https?:\/\//, r => new URL(r.request().url()).origin === base ? r.continue() : r.abort());
  await p.goto(base);
  await p.waitForFunction(() => typeof rt !== 'undefined' && !rt.booting);
  await p.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()));
  const openTab = tab => p.evaluate(t => { studioUI.settingsTab = t; navigate(5); }, tab).then(() => p.waitForTimeout(250));
  const navGroups = () => p.evaluate(() => { const out = []; for (const el of document.querySelector('.settings-nav').children) { if (el.classList.contains('settings-nav-label')) out.push([el.textContent, []]); else if (el.dataset.tab) out.at(-1)[1].push(el.dataset.tab); } return JSON.stringify(out); });
  const headings = () => p.evaluate(() => [...document.querySelectorAll('#studio-settings-content > section > h2, #studio-settings-content > section > header h2')].map(h => h.textContent.trim()).join(' / '));
  const saved = () => p.waitForFunction(() => !backendRuntime.dirty && !backendRuntime.saving);

  // ---- tiers
  await openTab('general');
  check(await navGroups() === JSON.stringify([['常用', ['general', 'appearance', 'connections', 'about']], ['高级', ['modules', 'themes', 'extensions', 'resources']]]), 'the settings navigation is grouped into 常用 and 高级; 开发者 is hidden by default: ' + await navGroups());
  check(await p.evaluate(() => state.settings.studio.visibility.developer === false), 'developer options default to off');

  // ---- 数据与备份: backup, file library, saved keys and a link to the image services
  await p.locator('.settings-nav [data-tab="connections"]').click(); await p.waitForTimeout(250);
  check(await p.locator('.settings-nav [data-tab="connections"]').innerText() === '数据与备份' && await headings() === '数据目录与完整备份 / 独立文件库 / 已保存密钥 / 图像服务', '数据与备份 holds backup, the file library, saved keys and the image-service link: ' + await headings());
  const data = await p.locator('#studio-settings-content').innerText();
  check(!/Python 原生配置同步|GET \/api\/config|运行模式|真实服务默认值|素材索引|服务端任务|workspace\.json/.test(data), 'developer material (config API, run mode, live defaults, asset index, directory tree) is not on the everyday page');
  check(!/\b(LLM|XML|CRITIC)\b/.test(data) && !data.includes('不在普通分享包中'), 'no internal code names and no reassurance line about share packages');
  const forget = await p.locator('[data-act="native-forget"]').evaluateAll(els => els.map(e => e.dataset.scope + ':' + e.textContent.trim()).join());
  check(forget === 'llm:忘记文本模型密钥,xml:忘记结构化解析服务密钥,critic:忘记视觉审校密钥', 'saved keys are named by what they are for: ' + forget);
  check(await p.locator('#studio-settings-content [data-act="v3-connect-backend"]').count() === 1 && await p.locator('#studio-settings-content [data-act="disk-archive"]').count() === 1, 'rescanning the file library and the full backup stay on this page');
  await p.locator('[data-act="native-forget"][data-scope="critic"]').click();
  await p.waitForSelector('#confirm-dialog[open], dialog[open] [data-confirm], dialog.confirm-dialog[open]', {timeout: 5000}).catch(() => {});
  const confirmText = await p.evaluate(() => document.querySelector('dialog[open]')?.innerText || '');
  check(confirmText.includes('忘记已保存的视觉审校密钥？'), 'the forget confirmation names the key by purpose: ' + confirmText.split('\n')[0]);
  await p.keyboard.press('Escape'); await p.waitForTimeout(200);
  check(await p.evaluate(() => !document.querySelector('dialog[open]')), 'cancelling leaves the key alone');

  // ---- one entry point for the ComfyUI address
  const addressInputs = {};
  for (const tab of ['general', 'appearance', 'connections', 'about', 'modules', 'resources', 'developer']) {
    await openTab(tab);
    const n = await p.locator('#studio-settings-content [data-setting="comfy.baseUrl"], #studio-settings-content #setup-comfy-url, #studio-settings-content [data-setting="comfy.mode"]').count();
    if (n) addressInputs[tab] = n;
  }
  check(Object.keys(addressInputs).length === 0, 'no settings page edits the ComfyUI address or run mode: ' + JSON.stringify(addressInputs));
  await openTab('connections');
  await p.getByRole('button', {name: '打开工作流与 API 配置'}).click(); await p.waitForTimeout(400);
  await p.evaluate(() => { const d = document.querySelector('.wf-connection'); if (d && d.tagName === 'DETAILS') d.open = true; });
  check(await p.evaluate(() => ui.workspace === 3) && await p.locator('#setup-comfy-url').count() === 1, '“打开工作流与 API 配置” goes to the one place where the address is edited');
  await p.evaluate(() => { navigate(9); handleAction('go-engine'); }); await p.waitForTimeout(300);
  check(await p.evaluate(() => ui.workspace === 3), 'old “engine” shortcuts also lead to 工作流与 API 配置');

  // ---- developer tier
  await openTab('modules');
  const devSwitch = p.locator('[data-studio-pref="visibility.developer"]');
  check(await devSwitch.count() === 1 && !(await devSwitch.isChecked()) && (await devSwitch.evaluate(el => el.closest('.settings-row').innerText)).startsWith('开发者选项'), '功能开关 has an off-by-default 开发者选项 switch');
  await devSwitch.evaluate(el => el.click()); await p.waitForTimeout(250); await saved();
  check(await navGroups() === JSON.stringify([['常用', ['general', 'appearance', 'connections', 'about']], ['高级', ['modules', 'themes', 'extensions', 'resources']], ['开发者', ['developer']]]) && await p.evaluate(() => state.settings.studio.visibility.developer === true && studioUI.settingsTab === 'modules'), 'turning it on adds the 开发者 group and keeps you on 功能开关');
  await p.locator('.settings-nav [data-tab="developer"]').click(); await p.waitForTimeout(250);
  check(await headings() === 'Python 原生配置同步 / 真实服务默认值 / 数据目录结构 / 服务端任务与素材' && await p.locator('#studio-settings-content pre.backend-code').count() === 1, 'the developer page holds the config API, live defaults, directory layout and server tasks: ' + await headings());
  await p.reload(); await p.waitForFunction(() => typeof rt !== 'undefined' && !rt.booting);
  await p.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()));
  await openTab('general');
  check((await navGroups()).includes('"开发者"'), 'the developer switch is saved');
  await openTab('developer');
  await p.evaluate(() => changeStudioPreference({dataset: {studioPref: 'visibility.developer'}, type: 'checkbox', checked: false})); await p.waitForTimeout(250); await saved();
  check(await p.evaluate(() => studioUI.settingsTab === 'modules' && state.settings.studio.visibility.developer === false) && !(await navGroups()).includes('开发者'), 'turning it off from the developer page returns to 功能开关 and hides the group');
  await p.evaluate(() => { navigate(9); backupModal(); });
  await p.locator('#modal [data-act="v3-settings-tab"][data-tab="developer"]').click(); await p.waitForTimeout(300);
  check(await p.evaluate(() => ui.workspace === 5 && studioUI.settingsTab === 'developer') && (await navGroups()).includes('"开发者"') && (await headings()).startsWith('Python 原生配置同步'), 'a direct link (工程备份与恢复 → 配置 Python 保存服务) still opens the developer page');

  // ---- 工作室 links to the renamed page; the help drawer explains the tiers
  await openTab('general');
  check(await p.locator('#studio-settings-content [data-act="v3-settings-tab"][data-tab="connections"]').innerText() === '数据与备份', '工作室 → 当前保存方式 links to 数据与备份');
  await p.evaluate(() => openHelpDrawer()); await p.waitForTimeout(250);
  const help = await p.locator('#help-drawer').innerText();
  check(help.includes('常用：工作室、通用偏好') && help.includes('开发者选项默认隐藏'), 'the settings help explains the three tiers');
  await p.keyboard.press('Escape'); await p.waitForTimeout(200);

  // ---- AI 写故事: the XML tab has a purpose name
  await p.evaluate(() => { state.settings.studio.visibility.llm = true; navigate(4); }); await p.waitForTimeout(400);
  check(await p.locator('[data-act="llm-tab"][data-tab="xml"]').innerText() === '从想法生成分镜', 'AI 写故事 names the XML tab by what it does (从想法生成分镜)');
  await p.evaluate(() => { state.settings.studio.visibility.llm = false; navigate(9); save(); }); await saved();

  // ---- English
  await p.evaluate(() => changeInterfaceLanguage('en'));
  await p.waitForFunction(() => document.documentElement.lang === 'en');
  await openTab('connections');
  const nav = await p.locator('.settings-nav').innerText();
  const en = await p.locator('#studio-settings-content').innerText();
  check(nav.includes('Common') && nav.includes('Advanced') && nav.includes('Data & backup') && en.includes('Forget visual review key') && en.includes('Open Workflows & APIs'), 'English: ' + nav.replace(/\s+/g, ' '));
  await p.evaluate(() => changeInterfaceLanguage('zh-CN'));
  await p.waitForFunction(() => document.documentElement.lang === 'zh-CN');
  await saved();

  // ---- phone: group labels give way to the horizontal tab strip
  await p.setViewportSize({width: 390, height: 844});
  await openTab('connections');
  const phone = await p.evaluate(() => ({labels: [...document.querySelectorAll('.settings-nav-label')].filter(l => getComputedStyle(l).display !== 'none').length, overflow: document.documentElement.scrollWidth - innerWidth, tabs: document.querySelectorAll('.settings-nav [data-tab]').length}));
  check(phone.labels === 0 && phone.overflow <= 0 && phone.tabs === 8, 'on a phone the tab strip shows no group labels and nothing overflows: ' + JSON.stringify(phone));

  check(errors.length === 0, 'no page errors: ' + errors.join(' | '));
  console.log(`settings tiers: ${count} checks passed`);
} finally {
  await browser?.close();
  server.kill();
}
