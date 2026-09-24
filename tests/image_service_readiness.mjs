// Image service readiness: key requirements, the top-bar service chip, and ComfyUI checks only when ComfyUI is the active service.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {chromium} from 'playwright';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mio-readiness-'));
const base = 'http://127.0.0.1:18883';
const upstream = 'http://127.0.0.1:18983';
const log = fs.openSync(path.join(dir, 'server.log'), 'w');
const server = spawn('python', ['tests/journey_fixture_server.py'], {
  env: {...process.env, MIO_HOST: '127.0.0.1', MIO_PORT: '18883', MIO_DATA_DIR: path.join(dir, 'data'), MIO_JOURNEY_PROVIDER_PORT: '18983'},
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
  const errors = [], checks = [];
  p.on('pageerror', e => errors.push(e.message));
  p.on('response', r => { if (r.url().endsWith('/api/image/comfy-check')) checks.push(r.status()); });
  await p.route(/^https?:\/\//, r => new URL(r.request().url()).origin === base ? r.continue() : r.abort());
  const boot = async () => {
    await p.waitForFunction(() => typeof rt !== 'undefined' && !rt.booting);
    await p.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()));
  };
  const saved = () => p.waitForFunction(() => rt.saved && !rt.saving);
  const chip = p.locator('#topbar .image-service-chip');

  // 1. Seeded ComfyUI address with nothing listening: the backend answers 502 (upstream), the chip says so.
  await p.goto(base); await boot();
  await p.waitForFunction(() => document.querySelector('#topbar .image-service-chip.tone-bad'));
  check((await chip.innerText()).trim() === 'ComfyUI · 未连接', 'top bar names the active service and its state');
  check(checks.length >= 1 && checks.every(s => s === 502), 'an unreachable ComfyUI is reported as HTTP 502, not 400');
  check(/127\.0\.0\.1:8188/.test(await chip.getAttribute('title')), 'the chip tooltip names the address it tried');

  // 2. A reachable ComfyUI turns the chip green; clicking it opens the image service page.
  await p.evaluate(async url => { state.settings.comfy.baseUrl = url; await testEngine(true); }, upstream);
  await p.waitForFunction(() => document.querySelector('#topbar .image-service-chip.tone-ok'));
  check((await chip.innerText()).trim() === 'ComfyUI · 已连接', 'a reachable ComfyUI shows as connected');
  await chip.click();
  await p.waitForFunction(() => ui.workspace === 3);
  check(true, 'the chip opens the image service settings');

  // 3. Key requirements follow the service.
  const rules = await p.evaluate(() => {
    const g = ensureImageProviders(), nai = g.profiles.find(x => x.provider === 'novelai'), oa = g.profiles.find(x => x.provider === 'openai');
    const keyIssue = profile => providerSetupIssues(profile).some(i => /密钥/.test(i));
    return {
      nai: keyIssue(nai), naiStored: keyIssue({...nai, keyMode: 'stored', keyIds: ['k1']}),
      openai: keyIssue(oa), local: keyIssue({...oa, baseUrl: 'http://127.0.0.1:18983/v1'}),
      publicOther: keyIssue({...oa, baseUrl: 'https://images.example.com/v1'}),
      need: [providerKeyRequirement(nai), providerKeyRequirement({...oa, baseUrl: 'https://images.example.com/v1'}), providerKeyRequirement({...oa, baseUrl: 'http://192.168.1.20:8000/v1'})].join(),
    };
  });
  check(rules.nai && !rules.naiStored, 'NovelAI without a stored key is a blocking setup issue');
  check(rules.openai && !rules.local && !rules.publicOther, 'api.openai.com needs a key; local and other endpoints are not blocked');
  check(rules.need === 'required,recommended,optional', 'other public endpoints get a reminder, LAN endpoints none');

  // 4. NovelAI active without a key: the chip and the readiness card both say what is missing.
  await p.evaluate(() => { ensureImageProviders().active = 'novelai'; save(); render(); });
  await saved();
  await p.waitForFunction(() => document.querySelector('#topbar .image-service-chip.tone-warn'));
  check((await chip.innerText()).trim() === 'NovelAI · 待配置', 'a cloud service with missing setup shows 待配置');
  check(/添加 NovelAI API 密钥/.test(await chip.getAttribute('title')), 'the tooltip names the first missing item');
  const card = await p.evaluate(() => ({
    title: document.querySelector('.wf-status-card .wf-section-label')?.textContent,
    key: [...document.querySelectorAll('.wf-status-card .wf-checklist li')].find(li => /API Key/.test(li.textContent))?.className,
  }));
  check(card.title === '还差几步' && card.key === 'is-todo', 'the readiness card lists the missing key as a to-do');

  // 5. With a cloud service active, booting does not poll ComfyUI.
  checks.length = 0;
  await p.reload(); await boot();
  await p.waitForTimeout(2500);
  check(checks.length === 0, 'no ComfyUI check while another image service is active');
  check((await chip.innerText()).trim() === 'NovelAI · 待配置', 'the chip survives a reload');

  // 6. Switching back to ComfyUI checks it right away instead of waiting for the 30 s poll.
  await p.evaluate(() => navigate(3));
  await p.locator('[data-act="wf-channel-switch"][data-id="comfyui"]').first().click();
  await p.waitForFunction(() => document.querySelector('#topbar .image-service-chip.tone-ok, #topbar .image-service-chip.tone-bad'));
  check(checks.length >= 1, 'switching to ComfyUI triggers a connection check');

  check(errors.length === 0, 'no page errors: ' + errors.join(' | '));
  console.log(`image service readiness: ${count} checks passed`);
} finally {
  await browser?.close();
  server.kill();
}
