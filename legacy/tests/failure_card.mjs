// Failed task cards: category, one-line reason, the fixes that apply, and technical details with copy.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {chromium} from 'playwright';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mio-failure-card-'));
const base = 'http://127.0.0.1:18884';
const log = fs.openSync(path.join(dir, 'server.log'), 'w');
const server = spawn('python', ['tests/journey_fixture_server.py'], {
  env: {...process.env, MIO_HOST: '127.0.0.1', MIO_PORT: '18884', MIO_DATA_DIR: path.join(dir, 'data'), MIO_JOURNEY_PROVIDER_PORT: '18984'},
  stdio: ['ignore', log, log],
});
let browser, count = 0;
const check = (value, label) => { assert.ok(value, label); console.log('PASS ' + label); count++; };
const REFUSED = '1/3 幕失败：连接被拒绝：这个地址上没有正在运行的图像服务。请确认服务已启动，地址和端口正确（ComfyUI 默认 http://127.0.0.1:8188）。\n已停止：其余 2 幕没有发出。修好后点“开始生成”，会接着生成未完成的分幕。';

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
  let checks = 0;
  p.on('pageerror', e => errors.push(e.message));
  p.on('request', r => { if (r.url().endsWith('/api/image/comfy-check')) checks++; });
  await p.route(/^https?:\/\//, r => new URL(r.request().url()).origin === base ? r.continue() : r.abort());
  await p.goto(base);
  await p.waitForFunction(() => typeof rt !== 'undefined' && !rt.booting);
  await p.evaluate(() => { document.querySelectorAll('dialog[open]').forEach(d => d.close()); clearTimeout(workshop.pollTimer); });
  await p.waitForFunction(() => !workshop.loading);

  // A controlled queue: the server's own queue must not overwrite it while the test looks at the card.
  const show = (error, provider = 'comfyui') => p.evaluate(({error, provider}) => {
    clearTimeout(workshop.pollTimer); refreshProduction = async () => {};
    const page = (index, state, attempt) => ({index, state, attempts: attempt ? [attempt] : [], attemptCount: attempt ? 1 : 0, result: null});
    adoptProductionQueue({tasks: [{id: 'card-1', title: '失败示例', albumId: 'no-album', status: 'failed', error,
      sources: {story: '分镜', presets: [], channel: provider === 'comfyui' ? 'ComfyUI' : 'NovelAI', provider},
      pages: [page(0, 'failed', {status: 'failed', error: error.split('：').slice(1).join('：')}), page(1, 'standby'), page(2, 'standby')]}],
      lane: [], active: [], paused: false, concurrency: 1});
    workshop.view = 'production'; navigate(1); render();
  }, {error, provider});
  const panel = p.locator('.production-card[data-production-task="card-1"] .production-error-panel');
  const buttons = async () => (await panel.locator('.production-error-actions button').allInnerTexts()).map(s => s.trim());

  // 1. Connection refused on ComfyUI.
  await show(REFUSED);
  await panel.waitFor();
  check(await panel.getAttribute('data-error-kind') === 'connection', 'a refused connection is classified as a connection problem');
  check((await panel.locator('.production-error-head strong').innerText()).trim() === '连接被拒绝', 'the card leads with the category');
  check((await panel.locator('.production-error-head span').innerText()).trim() === '1/3 幕失败', 'the scene count sits beside it');
  check((await panel.locator('.production-error').innerText()).startsWith('这个地址上没有正在运行的图像服务'), 'one plain line says why');
  check(/其余 2 幕没有发出/.test(await panel.locator('.production-error-tail').innerText()), 'the stopped scenes are explained on their own line');
  check((await buttons()).join('|') === '测试连接|图像服务设置|技术详情', 'connection fixes: test connection, image service settings, technical details');
  const before = checks;
  await panel.getByRole('button', {name: '测试连接'}).click();
  await p.waitForFunction(() => document.querySelector('#toasts')?.textContent.includes('连接'));
  check(checks > before, 'test connection really checks ComfyUI');

  // 2. A rejected key on NovelAI: no ComfyUI test, straight to settings.
  await show('1/3 幕失败：服务拒绝了密钥：请检查 API 密钥是否有效、过期或绑定了错误的服务。', 'novelai');
  check(await panel.getAttribute('data-error-kind') === 'credentials', 'a rejected key is a credentials problem');
  check((await buttons()).join('|') === '图像服务设置|技术详情', 'credentials fixes: image service settings, technical details');
  await panel.getByRole('button', {name: '图像服务设置'}).click();
  await p.waitForFunction(() => ui.workspace === 3);
  check(true, 'image service settings opens the image service page');

  // 3. Moderation: open the scenes to edit and rerun just that one.
  await show('1/3 幕失败：触发内容安全审核：服务拒绝生成这一幕。请修改提示词后仅重跑本幕。');
  await panel.getByRole('button', {name: '查看分幕'}).click();
  await p.waitForFunction(() => workshop.openTasks.has('card-1') && document.querySelector('[data-task-details="card-1"]')?.open);
  check(true, 'moderation offers the scene list for a single rerun');

  // 4. Technical details: raw record, with copy.
  await show(REFUSED);
  await p.evaluate(() => {
    const original = productionRequest;
    productionRequest = async (route, body) => route === 'tasks/card-1' ? {id: 'card-1', title: '失败示例', pages: [
      {index: 0, attempts: [{status: 'failed', error: '连接被拒绝：…', rawError: '<urlopen error [Errno 111] Connection refused>'}]},
      {index: 1, attempts: []}]} : original(route, body);
  });
  await panel.getByRole('button', {name: '技术详情'}).click();
  await p.waitForFunction(() => document.querySelector('#modal[open] .production-diagnostics'));
  check(await p.locator('#modal pre').first().textContent() === '<urlopen error [Errno 111] Connection refused>', 'technical details show the raw error');
  await p.locator('#modal').getByRole('button', {name: '复制全部'}).click();
  const copied = await p.evaluate(() => workshop.diagnosticsText);
  check(copied.includes('Errno 111') && copied.includes('第 2 幕') && copied.includes('尚未请求图像服务'), 'copy includes every scene, even collapsed ones');

  // 5. English interface strings exist for the new parts.
  const en = await p.evaluate(() => [translateCurrentLocale('1/3 幕失败'), translateCurrentLocale('已停止：其余 2 幕没有发出。修好后点“开始生成”，会接着生成未完成的分幕。')]);
  check(en[0] === '1/3 scenes failed' && en[1].startsWith('Stopped: the other 2 scenes were not sent'), 'the count and the stop line are translated');

  check(errors.length === 0, 'no page errors: ' + errors.join(' | '));
  console.log(`failure card: ${count} checks passed`);
} finally {
  await browser?.close();
  server.kill();
}
