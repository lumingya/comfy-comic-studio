// T6 · readable type: UI font sizes are rem with a 12px floor (body copy 13px), 设置 → 通用偏好 → 界面字号 scales the
// whole interface (标准 / 大 / 特大), the “?” hints open on click, and touch never pops hover tooltips.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {chromium} from 'playwright';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mio-fontscale-'));
const base = 'http://127.0.0.1:18892';
const log = fs.openSync(path.join(dir, 'server.log'), 'w');
const server = spawn('python', ['tests/journey_fixture_server.py'], {
  env: {...process.env, MIO_HOST: '127.0.0.1', MIO_PORT: '18892', MIO_DATA_DIR: path.join(dir, 'data'), MIO_JOURNEY_PROVIDER_PORT: '18992'},
  stdio: ['ignore', log, log],
});
let browser, count = 0;
const check = (value, label) => { assert.ok(value, label); console.log('PASS ' + label); count++; };

// ---- stylesheets: no px font sizes, nothing below 12px
const pxLeft = [], belowFloor = [];
for (const file of ['styles.css', 'js/workflow-workbench.css', 'js/reading-stage.css']) {
  const css = fs.readFileSync(file, 'utf8');
  for (const m of css.matchAll(/[{;]\s*(font(?:-size)?)\s*:([^;}]*)/g)) {
    const value = m[2];
    if (/\d(?:\.\d+)?px/.test(value) && !value.includes('--sidebar-brand-font-size')) pxLeft.push(file + ': ' + m[0].trim());
    if (/clamp\(/.test(value)) continue;
    const size = value.match(/(?:^|\s)(\d*\.?\d+)rem/);
    if (size && parseFloat(size[1]) < 0.75) belowFloor.push(file + ': ' + m[0].trim());
  }
}
check(pxLeft.length === 0, 'stylesheets set font sizes in rem so 界面字号 can scale them: ' + pxLeft.slice(0, 3).join(' | '));
check(belowFloor.length === 0, 'no font size below 12px (.75rem): ' + belowFloor.slice(0, 3).join(' | '));
const styles = fs.readFileSync('styles.css', 'utf8');
check(/html\[data-font-scale=large\]\{font-size:112\.5%\}/.test(styles) && /html\[data-font-scale=xlarge\]\{font-size:125%\}/.test(styles), 'the 大 / 特大 steps scale the root font size');

const PAGES = {
  home: () => navigate(9), gallery: () => navigate(0),
  stories: () => { workshop.view = 'stories'; navigate(1); }, presets: () => { workshop.view = 'presets'; navigate(1); },
  production: () => { workshop.view = 'production'; navigate(1); }, workflow: () => navigate(3),
  settings: () => { studioUI.settingsTab = 'appearance'; navigate(5); }, connections: () => { studioUI.settingsTab = 'connections'; navigate(5); },
  wizard: () => { navigate(9); openAssemblyDesigner(); }, palette: () => { navigate(9); openCommand(); }, help: () => { navigate(9); openHelpDrawer(); },
};
const smallText = () => [...document.querySelectorAll('body *')].filter(el => {
  if (el.closest('svg,script,style,template') || ![...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) return false;
  const r = el.getBoundingClientRect(), cs = getComputedStyle(el), size = parseFloat(cs.fontSize);
  return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && size > 0 && size < 11.99;
}).map(el => el.tagName.toLowerCase() + '.' + [...el.classList].join('.') + ' ' + getComputedStyle(el).fontSize + ' “' + el.textContent.trim().slice(0, 16) + '”');

try {
  let ready = false;
  for (let i = 0; i < 150; i++) {
    try { if ((await fetch(base + '/api/content')).ok) { ready = true; break; } } catch {}
    await new Promise(r => setTimeout(r, 100));
  }
  assert.ok(ready, 'fixture startup');
  browser = await chromium.launch({args: ['--no-sandbox']});
  const context = await browser.newContext({viewport: {width: 1440, height: 900}, reducedMotion: 'reduce'});
  await context.addInitScript(() => document.addEventListener('DOMContentLoaded', () => { window.__earlyFontScale = document.documentElement.dataset.fontScale || ''; }));
  const p = await context.newPage();
  const errors = [];
  p.on('pageerror', e => errors.push(e.message));
  await p.route(/^https?:\/\//, r => new URL(r.request().url()).origin === base ? r.continue() : r.abort());
  await p.goto(base);
  await p.waitForFunction(() => typeof rt !== 'undefined' && !rt.booting);
  await p.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()));
  const metrics = () => p.evaluate(() => ({scale: document.documentElement.dataset.fontScale, root: getComputedStyle(document.documentElement).fontSize, body: getComputedStyle(document.body).fontSize, nav: Math.round(document.querySelector('#sidebar').getBoundingClientRect().width)}));

  // ---- 标准: nothing under 12px on the main pages and dialogs
  check((await metrics()).scale === 'standard' && (await metrics()).root === '16px' && (await metrics()).body === '13px', 'standard: root 16px, body copy 13px');
  const tiny = {};
  for (const [key, open] of Object.entries(PAGES)) {
    await p.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()));
    await p.evaluate(open); await p.waitForTimeout(350);
    const found = await p.evaluate(smallText);
    if (found.length) tiny[key] = found.slice(0, 4);
  }
  await p.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()));
  check(Object.keys(tiny).length === 0, 'no visible text below 12px on home, 画册集, the three workshop tabs, 工作流, 设置, the wizard, ⌘K and the help drawer: ' + JSON.stringify(tiny));

  await p.evaluate(() => { workshop.view = 'stories'; navigate(1); }); await p.waitForTimeout(300);
  const editor = await p.evaluate(() => { const t = document.querySelector('.prompt-surface>textarea'), paint = document.querySelector('.prompt-paint'); return {t: t && getComputedStyle(t).fontSize, paint: paint && getComputedStyle(paint).fontSize, lh: t && paint && getComputedStyle(t).lineHeight === getComputedStyle(paint).lineHeight}; });
  check(editor.t === '13px' && editor.paint === '13px' && editor.lh, 'the prompt editor is 13px and its highlight layer keeps the same metrics: ' + JSON.stringify(editor));
  check(await p.evaluate(() => { const n = document.createElement('div'); n.className = 'notice'; n.textContent = 'x'; document.body.append(n); const s = getComputedStyle(n).fontSize; n.remove(); return s === '13px'; }), 'notices are body copy (13px)');

  // ---- the setting
  await p.evaluate(() => { studioUI.settingsTab = 'appearance'; navigate(5); }); await p.waitForTimeout(300);
  const select = p.locator('[data-studio-pref="appearance.fontScale"]');
  const row = await select.evaluate(el => ({section: el.closest('[data-preference-category]')?.dataset.preferenceCategory, text: el.closest('.settings-row').innerText.replace(/\s+/g, ' '), options: [...el.options].map(o => o.value + ':' + o.textContent)}));
  check(row.section === 'display' && row.text.startsWith('界面字号') && row.options.join() === 'standard:标准,large:大,xlarge:特大', '通用偏好 → 字体与界面显示 has 界面字号 with 标准 / 大 / 特大: ' + JSON.stringify(row));
  await select.selectOption('large'); await p.waitForTimeout(150);
  check(JSON.stringify(await metrics()) === JSON.stringify({scale: 'large', root: '18px', body: '14.625px', nav: 221}), '大 scales text by 112.5% and widens the sidebar with it: ' + JSON.stringify(await metrics()));
  await select.selectOption('xlarge'); await p.waitForTimeout(150);
  check(JSON.stringify(await metrics()) === JSON.stringify({scale: 'xlarge', root: '20px', body: '16.25px', nav: 245}), '特大 scales text by 125%: ' + JSON.stringify(await metrics()));
  await p.waitForFunction(() => !backendRuntime.dirty && !backendRuntime.saving);
  check(await p.evaluate(() => state.settings.studio.appearance.fontScale === 'xlarge' && localStorage.getItem('cc-font-scale') === 'xlarge'), 'the choice is saved with the studio settings and mirrored for the next page load');
  const overflow = {};
  for (const key of ['home', 'workflow', 'stories', 'wizard']) {
    await p.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()));
    await p.evaluate(PAGES[key]); await p.waitForTimeout(350);
    const o = await p.evaluate(() => ({page: document.documentElement.scrollWidth - innerWidth, search: (s => s.scrollWidth - s.clientWidth)(document.querySelector('.side-search .grow')), brand: Math.round(document.querySelector('.brand-sub span').getBoundingClientRect().right - document.querySelector('#sidebar').getBoundingClientRect().right)}));
    if (o.page > 0 || o.search > 0 || o.brand > 0) overflow[key] = o;
  }
  await p.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()));
  check(Object.keys(overflow).length === 0, 'at 特大 nothing overflows horizontally and the sidebar search and version stay inside the sidebar: ' + JSON.stringify(overflow));
  await p.reload();
  await p.waitForFunction(() => typeof rt !== 'undefined' && !rt.booting);
  check(await p.evaluate(() => window.__earlyFontScale === 'xlarge' && document.documentElement.dataset.fontScale === 'xlarge'), 'after a reload the size applies before the app boots (no flash of small text)');
  const rejected = await p.evaluate(() => {
    const out = [];
    try { changeStudioPreference({dataset: {studioPref: 'appearance.fontScale'}, type: 'select-one', value: 'huge'}); out.push('accepted'); } catch (e) { out.push(e.message); }
    try { validateStudioData({settings: {studio: {appearance: {fontScale: 'huge'}}}}); out.push('accepted'); } catch (e) { out.push(e.message); }
    return out;
  });
  check(rejected.every(m => m === '界面字号不合法。') && await p.evaluate(() => state.settings.studio.appearance.fontScale === 'xlarge'), 'unknown sizes are rejected on change and in saved data: ' + rejected.join(' | '));
  await p.evaluate(() => { studioUI.settingsTab = 'appearance'; navigate(5); }); await p.waitForTimeout(300);
  await select.selectOption('standard'); await p.waitForTimeout(150);
  check((await metrics()).root === '16px' && (await metrics()).nav === 196, 'back to 标准');
  await p.waitForFunction(() => !backendRuntime.dirty && !backendRuntime.saving);

  // ---- 样式工坊 template “放大界面文字” follows the rem sizes instead of shrinking them
  check(await p.evaluate(() => { const r = SS_RECIPES.find(x => x.id === 'bigger-text'), layer = MioPlatform.layer('user-snippets'), before = layer.textContent; layer.textContent = r.css; const size = getComputedStyle(document.documentElement).fontSize; layer.textContent = before; return size === '19px'; }), 'the 样式工坊 template “放大界面文字” enlarges the root size (19px) instead of shrinking rem text');

  // ---- “?” hints open on click
  const tip = () => p.evaluate(() => { const t = document.getElementById('ui-tooltip'); return t && !t.hidden ? t.textContent : ''; });
  await p.evaluate(() => { navigate(9); handleAction('book-menu', {id: state.books[0].id}); });
  await p.waitForSelector('#modal[open] .hint-button');
  const menu = await p.locator('#modal').innerText();
  check(!(await p.locator('#modal-subtitle').innerText()).trim() && menu.includes('点 ? 查看每项操作的完整说明。') && !menu.includes('悬停') && !menu.includes('仅在本地收藏'), 'the book menu says to click “?” and drops the reassurance lines');
  const hintButton = p.locator('#modal .hint-button').nth(1);
  await hintButton.click(); await p.waitForTimeout(100);
  check((await tip()) === '添加或取消星标。' && await hintButton.getAttribute('aria-expanded') === 'true', 'clicking “?” shows its description');
  await p.mouse.move(700, 120); await p.waitForTimeout(150);
  check((await tip()) === '添加或取消星标。', 'a clicked description stays while the pointer moves on');
  await hintButton.click(); await p.waitForTimeout(100);
  check((await tip()) === '' && await hintButton.getAttribute('aria-expanded') === 'false', 'clicking “?” again closes it');
  await hintButton.click(); await p.waitForTimeout(100);
  await p.mouse.click(700, 120); await p.waitForTimeout(100);
  check((await tip()) === '', 'clicking elsewhere closes it');
  await hintButton.focus(); await p.keyboard.press('Enter'); await p.waitForTimeout(300);
  const byKey = await tip();
  await p.keyboard.press('Enter'); await p.waitForTimeout(300);
  check(byKey === '添加或取消星标。' && (await tip()) === '', 'Enter toggles it from the keyboard');
  await p.evaluate(() => closeModal());
  for (let i = 0; i < 20; i++) {
    await p.keyboard.press('Tab');
    if (await p.evaluate(() => { const el = document.activeElement?.closest?.('[data-tip],[data-act],[title]'); return !!el && !!tooltipText(el); })) break;
  }
  await p.waitForTimeout(400);
  check((await tip()) !== '', 'keyboard focus still shows button descriptions: ' + await tip());
  await p.mouse.move(5, 895);

  // ---- touch: no hover tooltips, short bottom-nav label, hints still open on tap
  const phone = await browser.newContext({viewport: {width: 390, height: 844}, hasTouch: true, isMobile: true, reducedMotion: 'reduce'});
  const m = await phone.newPage();
  m.on('pageerror', e => errors.push('phone: ' + e.message));
  await m.route(/^https?:\/\//, r => new URL(r.request().url()).origin === base ? r.continue() : r.abort());
  await m.goto(base);
  await m.waitForFunction(() => typeof rt !== 'undefined' && !rt.booting);
  await m.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()));
  const mtip = () => m.evaluate(() => { const t = document.getElementById('ui-tooltip'); return t && !t.hidden ? t.textContent : ''; });
  await m.locator('#sidebar .nav-item[data-route="0"]').tap(); await m.waitForTimeout(500);
  check(await m.evaluate(() => ui.workspace === 0) && (await mtip()) === '', 'tapping the bottom navigation switches pages without popping a tooltip');
  const wf = await m.locator('#sidebar .nav-item[data-route="3"]').evaluate(el => { const s = el.querySelector('.nav-short'), full = el.querySelector('span:not(.nav-short)'); return {short: s && getComputedStyle(s).display !== 'none' ? s.textContent : '', fits: s && s.scrollWidth <= s.clientWidth, fullHidden: getComputedStyle(full).display === 'none', name: el.getAttribute('aria-label')}; });
  check(wf.short === '工作流' && wf.fits && wf.fullHidden && wf.name === '工作流与 API 配置', 'the bottom navigation shows “工作流” in full; the accessible name stays “工作流与 API 配置”: ' + JSON.stringify(wf));
  await m.evaluate(() => { navigate(9); openReader(state.books[0].id); }); await m.waitForTimeout(600);
  check((await mtip()) === '', 'opening the reader on a phone does not pop a tooltip on the focused close button');
  await m.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()));
  await m.evaluate(() => { navigate(9); handleAction('book-menu', {id: state.books[0].id}); });
  await m.waitForSelector('#modal[open] .hint-button');
  const tapHint = m.locator('#modal .hint-button').first();
  await tapHint.tap(); await m.waitForTimeout(300);
  const tapped = await mtip();
  await tapHint.tap(); await m.waitForTimeout(300);
  check(tapped.startsWith('打开阅读器') && (await mtip()) === '', 'on touch “?” opens on tap and closes on the next tap');
  await phone.close();
  await p.evaluate(() => { navigate(9); });

  // ---- desktop sidebar keeps the full label
  check(await p.evaluate(() => { const el = document.querySelector('#sidebar .nav-item[data-route="3"]'); return getComputedStyle(el.querySelector('.nav-short')).display === 'none' && el.innerText.includes('工作流与 API 配置'); }), 'the desktop sidebar keeps the full “工作流与 API 配置”');

  // ---- English
  await p.evaluate(() => changeInterfaceLanguage('en'));
  await p.waitForFunction(() => document.documentElement.lang === 'en');
  await p.evaluate(() => { studioUI.settingsTab = 'appearance'; navigate(5); }); await p.waitForTimeout(400);
  const en = await p.locator('[data-studio-pref="appearance.fontScale"]').evaluate(el => el.closest('.settings-row').innerText.replace(/\s+/g, ' '));
  check(en === 'Text size Scales all interface text proportionally. Standard Large Extra large', 'English: ' + en);
  await p.evaluate(() => changeInterfaceLanguage('zh-CN'));
  await p.waitForFunction(() => document.documentElement.lang === 'zh-CN');

  check(errors.length === 0, 'no page errors: ' + errors.join(' | '));
  console.log(`font scale: ${count} checks passed`);
} finally {
  await browser?.close();
  server.kill();
}
