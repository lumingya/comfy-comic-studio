// Destructive confirmations use the danger colour on the confirm button; others keep the primary colour.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {chromium} from 'playwright';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mio-confirm-danger-'));
const base = 'http://127.0.0.1:18886';
const log = fs.openSync(path.join(dir, 'server.log'), 'w');
const server = spawn('python', ['tests/journey_fixture_server.py'], {
  env: {...process.env, MIO_HOST: '127.0.0.1', MIO_PORT: '18886', MIO_DATA_DIR: path.join(dir, 'data'), MIO_JOURNEY_PROVIDER_PORT: '18986'},
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
  await p.goto(base);
  await p.waitForFunction(() => typeof rt !== 'undefined' && !rt.booting);
  await p.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()));

  // Open a confirmation, read its look, then answer with the keyboard or a click.
  const ask = async (title, label, options, answer = 'Escape') => {
    await p.evaluate(({title, label, options}) => { window.__answer = confirmAction(title, '说明', label, options); }, {title, label, options});
    await p.locator('#confirm-dialog[open]').waitFor();
    const look = await p.evaluate(() => {
      const d = document.querySelector('#confirm-dialog'), yes = document.querySelector('#confirm-yes'), css = getComputedStyle(document.documentElement);
      const probe = document.createElement('i'); document.body.append(probe);
      const paint = v => { probe.style.color = v; return getComputedStyle(probe).color; };
      const out = {danger: d.classList.contains('is-danger'), bg: getComputedStyle(yes).backgroundColor, red: paint(css.getPropertyValue('--red')), accent: paint(css.getPropertyValue('--accent')), focus: document.activeElement?.id};
      probe.remove(); return out;
    });
    if (answer === 'Escape') await p.keyboard.press('Escape'); else await p.locator('#confirm-yes').click();
    return {...look, result: await p.evaluate(() => window.__answer)};
  };

  const del = await ask('删除这份工作流？', '删除');
  check(del.danger && del.bg === del.red, 'a delete confirmation paints the confirm button red');
  check(del.focus === 'confirm-no', 'Cancel has the initial focus, so Enter does not delete');
  check(del.result === false, 'Esc still cancels');
  const add = await ask('确认批量装配？', '添加待命');
  check(!add.danger && add.bg === add.accent, 'a harmless confirmation keeps the primary colour');
  check((await ask('放弃尚未保存的修改？', '还原')).danger, 'discarding unsaved edits counts as destructive (from the title)');
  check((await ask('覆盖所有分幕的负向提示词？', '应用到所有分幕')).danger, 'overwriting every scene counts as destructive');
  check((await ask('Delete collection?', 'Delete collection')).danger, 'English labels are recognised');
  check(!(await ask('移入回收目录？', '移入回收目录')).danger, 'moving to the recycle folder is not painted red');
  check(!(await ask('删除？', '删除', {danger: false})).danger, 'options.danger overrides the guess');
  const yes = await ask('清空 3 条已完成的任务记录？', '清空', null, 'click');
  check(yes.danger && yes.result === true, 'confirming a red button still resolves true');
  check(!(await ask('确认批量装配？', '添加待命')).danger, 'the danger class does not stick to the next dialog');

  check(errors.length === 0, 'no page errors: ' + errors.join(' | '));
  console.log(`confirm danger: ${count} checks passed`);
} finally {
  await browser?.close();
  server.kill();
}
