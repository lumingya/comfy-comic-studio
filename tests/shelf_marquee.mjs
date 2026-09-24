// Shelf: a drag that starts on an album cover draws the selection marquee; only the ⠿ handle reorders.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {chromium} from 'playwright';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mio-shelf-'));
const base = 'http://127.0.0.1:18882';
const log = fs.openSync(path.join(dir, 'server.log'), 'w');
const server = spawn('python', ['tests/journey_fixture_server.py'], {
  env: {...process.env, MIO_HOST: '127.0.0.1', MIO_PORT: '18882', MIO_DATA_DIR: path.join(dir, 'data'), MIO_JOURNEY_PROVIDER_PORT: '18982'},
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
  const p = await browser.newPage({viewport: {width: 1440, height: 1000}, reducedMotion: 'reduce'});
  const errors = [];
  p.on('pageerror', e => errors.push(e.message));
  await p.route(/^https?:\/\//, r => new URL(r.request().url()).origin === base ? r.continue() : r.abort());
  await p.goto(base);
  await p.waitForFunction(() => typeof rt !== 'undefined' && !rt.booting);
  await p.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()));

  // Six albums in the grid layout of the active collection.
  await p.evaluate(() => {
    const source = state.books.find(b => b.projectId === state.activeProjectId) || state.books[0];
    for (let i = 0; i < 5; i++) state.books.push({...clone(source), id: 'shelf-fixture-' + i, title: '框选测试 ' + (i + 1), projectId: state.activeProjectId, createdAt: Date.now() - i * 1000});
    state.settings.presentation.homeLayout = 'grid';
    ui.sort = 'manual';
    navigate(0);
  });
  await p.waitForFunction(() => document.querySelectorAll('#gallery-results .shelf-item[data-sort-book]').length >= 6);
  const cards = p.locator('#gallery-results .shelf-item[data-sort-book]');
  const order = () => p.evaluate(() => getShelfBooks().map(b => b.id).join());
  const before = await order();

  // Drag from the middle of the first cover to the middle of the third card.
  const a = await cards.nth(0).locator('.shelf-cover').boundingBox();
  const c = await cards.nth(2).boundingBox();
  await p.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await p.mouse.down();
  await p.mouse.move(c.x + c.width / 2, c.y + c.height / 2, {steps: 12});
  check(await p.locator('.desktop-marquee').count() === 1, 'dragging from a cover draws the marquee');
  check(await p.evaluate(() => !document.body.classList.contains('shelf-reordering') && !document.querySelector('.shelf-drag-ghost')), 'dragging from a cover does not start reordering');
  await p.mouse.up();
  check(await p.evaluate(() => ui.selected.size) >= 3, 'the marquee selects every album it touches');
  check(await order() === before, 'a marquee never changes the album order');
  check(await p.evaluate(() => !document.querySelector('#reader').open), 'finishing a marquee does not open an album');
  await p.keyboard.press('Escape');
  check(await p.evaluate(() => ui.selected.size === 0), 'Esc clears the shelf selection');

  // The ⠿ handle appears on hover and reorders.
  await cards.nth(0).hover();
  const handle = cards.nth(0).locator('.shelf-drag-handle');
  check(await handle.evaluate(e => getComputedStyle(e).opacity === '1'), 'the drag handle shows on hover');
  const h = await handle.boundingBox();
  const target = await cards.nth(2).boundingBox();
  await p.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
  await p.mouse.down();
  await p.mouse.move(target.x + target.width * 0.75, target.y + target.height / 2, {steps: 12});
  check(await p.evaluate(() => document.body.classList.contains('shelf-reordering')), 'dragging the handle starts reordering');
  check(await p.locator('.desktop-marquee').count() === 0, 'dragging the handle does not draw a marquee');
  await p.mouse.up();
  await p.waitForFunction(b => getShelfBooks().map(x => x.id).join() !== b, before);
  const moved = (await order()).split(',');
  check(moved.indexOf(before.split(',')[0]) === 2, 'the dragged album lands after the drop target');
  check(await p.evaluate(() => ui.selected.size === 0), 'reordering does not select anything');

  // A plain click on a cover still opens the album (the seeded one; fixture copies have no stored pages).
  const original = await p.evaluate(() => state.books.find(b => !b.id.startsWith('shelf-fixture-') && b.projectId === state.activeProjectId).id);
  await p.locator(`#gallery-results [data-sort-book="${original}"] .shelf-cover`).click();
  await p.waitForFunction(() => document.querySelector('#reader').open);
  check(true, 'a single click on a cover still opens the album');
  check(errors.length === 0, 'no browser exceptions: ' + errors.join(';'));
  console.log('SHELF MARQUEE: ' + count + ' checks PASS');
} finally {
  await browser?.close();
  if (server.exitCode === null) { const done = new Promise(r => server.once('exit', r)); server.kill(); await done; }
  fs.closeSync(log);
  fs.rmSync(dir, {recursive: true, force: true});
}
