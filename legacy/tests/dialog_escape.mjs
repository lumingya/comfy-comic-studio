// Esc closes dialogs through the same path as their close buttons. Isolated fixture; no provider calls.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {chromium} from 'playwright';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mio-esc-'));
const base = 'http://127.0.0.1:18881';
const log = fs.openSync(path.join(dir, 'server.log'), 'w');
const server = spawn('python', ['tests/journey_fixture_server.py'], {
  env: {...process.env, MIO_HOST: '127.0.0.1', MIO_PORT: '18881', MIO_DATA_DIR: path.join(dir, 'data'), MIO_JOURNEY_PROVIDER_PORT: '18981'},
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
  const p = await browser.newPage({viewport: {width: 1440, height: 900}, reducedMotion: 'reduce'});
  const errors = [];
  p.on('pageerror', e => errors.push(e.message));
  await p.route(/^https?:\/\//, r => new URL(r.request().url()).origin === base ? r.continue() : r.abort());
  await p.goto(base);
  await p.waitForFunction(() => typeof rt !== 'undefined' && !rt.booting);
  const isOpen = selector => p.evaluate(s => !!document.querySelector(s)?.open, selector);

  // The first-run welcome dialog is a required step: Esc must not skip it.
  if (await isOpen('#welcome-dialog')) {
    await p.keyboard.press('Escape');
    check(await isOpen('#welcome-dialog'), 'Esc keeps the required welcome dialog open');
    await p.getByRole('button', {name: '先用默认名称', exact: true}).click();
    await p.waitForFunction(() => !document.querySelector('#welcome-dialog').open);
  }
  await p.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()));

  // Command palette.
  await p.keyboard.press('Control+k');
  await p.waitForFunction(() => document.querySelector('#command-dialog').open);
  await p.keyboard.press('Escape');
  check(!await isOpen('#command-dialog'), 'Esc closes the command palette');

  // Generic modal (text prompt for a new collection).
  await p.locator('#project-switch-button').click();
  await p.locator('[data-act="new-project"]').click();
  await p.waitForFunction(() => document.querySelector('#modal').open);
  await p.keyboard.press('Escape');
  check(!await isOpen('#modal'), 'Esc closes the generic modal');
  check(await p.evaluate(() => !document.querySelector('#modal').contains(document.querySelector('#toasts'))), 'toasts return to the page after the modal closes');

  // Collection switcher popover.
  await p.locator('#project-switch-button').click();
  await p.waitForFunction(() => detailUI.projectOpen);
  await p.keyboard.press('Escape');
  check(await p.evaluate(() => !detailUI.projectOpen), 'Esc closes the collection switcher');

  // Confirm dialog resolves as "cancel".
  await p.evaluate(() => { window.__esc = 'pending'; confirmAction('测试确认', '按 Esc 应视为取消').then(v => { window.__esc = v; }); });
  await p.waitForFunction(() => document.querySelector('#confirm-dialog').open);
  await p.keyboard.press('Escape');
  await p.waitForFunction(() => window.__esc !== 'pending');
  check(!await isOpen('#confirm-dialog') && await p.evaluate(() => window.__esc === false), 'Esc cancels the confirm dialog and resolves false');

  // Tutorial / quick start.
  await p.evaluate(() => handleAction('guide-open', {}));
  await p.waitForFunction(() => document.querySelector('#guide-dialog').open);
  await p.keyboard.press('Escape');
  await p.waitForFunction(() => !document.querySelector('#guide-dialog').open);
  check(true, 'Esc closes the quick-start guide');

  // Assembly wizard lives in the generic modal.
  await p.evaluate(() => openAssemblyDesigner());
  await p.waitForFunction(() => document.querySelector('#modal').open);
  await p.keyboard.press('Escape');
  check(!await isOpen('#modal'), 'Esc closes the assembly wizard');

  // Nothing is left intercepting clicks.
  await p.locator('#sidebar [data-act="art-nav"][data-route="0"]').click();
  await p.waitForFunction(() => ui.workspace === 0);
  check(await p.evaluate(() => !document.querySelector('dialog[open]')), 'no dialog stays open after Esc');
  check(errors.length === 0, 'no browser exceptions: ' + errors.join(';'));
  console.log('DIALOG ESCAPE: ' + count + ' checks PASS');
} finally {
  await browser?.close();
  if (server.exitCode === null) { const done = new Promise(r => server.once('exit', r)); server.kill(); await done; }
  fs.closeSync(log);
  fs.rmSync(dir, {recursive: true, force: true});
}
