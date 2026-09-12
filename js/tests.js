#!/usr/bin/env node
'use strict';

/* Pure contract tests. No API credentials, ComfyUI instance or browser is needed. */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const context = vm.createContext({ console, setTimeout, clearTimeout, structuredClone });
for (const file of ['state.js', 'sync.js', 'engine.js', 'ui-presentation.js', 'ui-reader.js', 'ui-templates.js', 'ui-export.js', 'ui-editors.js', 'ui-locale.js', 'ui-assistant.js', 'ui-storyboard.js', 'ui-gallery.js', 'ui-settings.js', 'ui.js']) {
  const source = fs.readFileSync(path.join(__dirname, file), 'utf8');
  new vm.Script(source, { filename: file }).runInContext(context);
}
const contract = context.createStudioStateContract();
const converters = context.createConfigConverters(contract);
const nodes = context.createTextNodeContract();
const tests = [];
const add = (name, run) => tests.push({ name, run });
const plain = value => JSON.parse(JSON.stringify(value));

function defaults() {
  return {
    schemaVersion: '2.2', workspaceId: 'workspace_test',
    projects: [{ id: 'p1', title: 'Project', createdAt: 1 }], activeProjectId: 'p1',
    templates: [], books: [], rows: [], queue: [], chats: [],
    customColumns: [], installedPackages: [], exportTemplates: [], drafts: {},
    settings: {
      comfy: { mode: 'mock', workflow: { '6': { class_type: 'CLIPTextEncode', inputs: { text: '' } } }, mapping: {}, presets: [] },
      llm: { mode: 'mock', key: 'private-llm-key', baseUrl: 'https://example.invalid/v1' },
      xml: { key: 'private-xml-key' }, critic: { key: 'private-critic-key' },
      github: { token: 'private-github-token' }, studio: {}, disk: { includeKeys: false }
    }
  };
}

function apiConfig() {
  return {
    templates: [], savedGalleries: { books: [], title: 'Gallery metadata' },
    batchMatrix: { rows: [], columns: ['weapon'] }, comfyWorkflows: [],
    comfyConfig: {}, llmConfig: {}, xmlConfig: {}, chatConfig: {},
    uiConfig: { theme: 'dark', vendorExtension: 123 },
    batchRunState: { queue: [], paused: true }, updatedAt: 42
  };
}

add('all 10 native fields are flat and present', () => {
  const raw = apiConfig();
  const state = converters.fromApi(raw, defaults());
  const payload = converters.toApi(state, raw);
  contract.requiredFields.forEach(key => assert.ok(Object.hasOwn(payload, key), key));
  assert.equal(Object.hasOwn(payload, 'state'), false);
  assert.equal(payload.uiConfig.vendorExtension, 123);
  assert.equal(payload.batchMatrix.columns[0], 'weapon');
  assert.equal(payload.savedGalleries.title, 'Gallery metadata');
});

add('empty collections stay empty instead of restoring demo assets', () => {
  const result = converters.fromApi(apiConfig(), defaults());
  assert.equal(result.templates.length, 0);
  assert.equal(result.books.length, 0);
  assert.equal(result.rows.length, 0);
});

add('undefined frames normalize to an empty list', () => {
  const api = apiConfig();
  api.templates = [{ id: 'template_empty', title: 'Empty' }];
  assert.equal(converters.fromApi(api, defaults()).templates[0].frames.length, 0);
});

add('65 and 512 frames are allowed, 513 is rejected', () => {
  contract.assertFrameCount(new Array(65).fill({}));
  contract.assertFrameCount(new Array(512).fill({}));
  assert.throws(() => contract.assertFrameCount(new Array(513).fill({})));
});

add('an empty book has zero frames and can be normalized', () => {
  const api = apiConfig();
  api.savedGalleries = { books: [{ id: 'empty_book', title: 'Empty book', steps: [] }] };
  const book = converters.fromApi(api, defaults()).books[0];
  assert.equal(book.totalSteps, 0);
  assert.equal(book.generatedSteps, 0);
});

add('forceWrite is explicit and does not leak from a previous save', () => {
  const state = converters.fromApi(apiConfig(), defaults());
  assert.equal(converters.toApi(state, apiConfig(), true).forceWrite, true);
  assert.equal(Object.hasOwn(converters.toApi(state, { ...apiConfig(), forceWrite: true }), 'forceWrite'), false);
});

add('API credentials are not silently added to normal config backups', () => {
  const payload = converters.toApi(defaults(), apiConfig());
  const text = JSON.stringify(payload);
  for (const key of ['private-llm-key', 'private-xml-key', 'private-critic-key', 'private-github-token']) assert.equal(text.includes(key), false, key);
});

add('wrapped abstract REST payload is rejected on read', () => {
  assert.throws(() => converters.fromApi({ state: defaults() }, defaults()));
});

add('an incomplete API object is rejected instead of clearing work', () => {
  assert.throws(() => converters.fromApi({}, defaults()), /Incomplete/);
});

add('legacy workflow selection and node IDs are mapped without a text assumption', () => {
  const api = apiConfig();
  api.comfyConfig = { activeWorkflowId: 'w1', positiveNodeId: '1832' };
  api.comfyWorkflows = [{ id: 'w1', title: 'WeiLin', workflow: { '1832': { class_type: 'WeiLinPromptUI', inputs: { positive: 'hello' } } } }];
  const s = converters.fromApi(api, defaults());
  assert.equal(s.settings.comfy.workflow['1832'].inputs.positive, 'hello');
  assert.equal(s.settings.comfy.mapping.positive, '1832');
  assert.equal(Object.hasOwn(s.settings.comfy, 'bindings'), false);
});

add('WeiLinPromptUI #1832 selects its actual positive input', () => {
  const node = { class_type: 'WeiLinPromptUI', inputs: { positive: 'hero', text: ['6', 0] } };
  assert.equal(nodes.detect(node).field, 'positive');
  const healed = nodes.healBinding({ enabled: true, source: 'positive', nodeId: '1832', path: 'text', allowLink: true }, { '1832': node });
  assert.equal(healed.path, 'positive');
  assert.deepEqual(plain(node.inputs.text), ['6', 0]);
});

add('SDXL text_g/text_l follow deterministic actual-string priority', () => {
  assert.equal(nodes.detect({ inputs: { text_l: 'local', text_g: 'global' } }).field, 'text_g');
  assert.equal(nodes.detect({ inputs: { text_g: ['8', 0], text_l: 'local' } }).field, 'text_l');
});

add('negative binding picks the negative field when the node has both', () => {
  assert.equal(nodes.detect({ inputs: { positive: 'yes', negative: 'no' } }, 'negative').field, 'negative');
});

add('a link-only node cannot be overwritten even with allowLink', () => {
  const workflow = { '1832': { inputs: { text: ['6', 0] } } };
  assert.throws(() => nodes.healBinding({ enabled: true, source: 'positive', nodeId: '1832', path: 'text', allowLink: true }, workflow));
  assert.throws(() => nodes.healBinding({ enabled: true, source: 'literal', nodeId: '1832', path: '/text/0', allowLink: true }, workflow));
  assert.deepEqual(plain(workflow['1832'].inputs.text), ['6', 0]);
});

function fakeResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => body === undefined ? '' : JSON.stringify(body) };
}

add('reads GET then writes POST /api/config, never PUT or {state}', async () => {
  const calls = [];
  let local = defaults();
  const sync = context.createNativeConfigSync({ contract, convert: converters, defaults, getState: () => local, validate: () => true, enabled: () => true, fetch: async (url, options) => {
    calls.push({ url, ...options });
    return options.method === 'GET' ? fakeResponse(200, apiConfig()) : fakeResponse(200, { ok: true, status: 'success', files: ['config.json'] });
  } });
  local = await sync.read();
  sync.markDirty();
  assert.equal(await sync.save(), true);
  assert.equal(calls[0].method, 'GET');
  assert.equal(calls[1].method, 'POST');
  assert.equal(calls[1].url, '/api/config');
  const payload = JSON.parse(calls[1].body);
  assert.equal(Object.hasOwn(payload, 'state'), false);
  contract.requiredFields.forEach(key => assert.ok(Object.hasOwn(payload, key)));
});

add('a new edit clears errors and retries a failed save with forceWrite intact', async () => {
  const writes = [];
  let attempt = 0;
  const local = defaults();
  const sync = context.createNativeConfigSync({ contract, convert: converters, defaults, getState: () => local, validate: () => true, enabled: () => true, fetch: async (_, options) => {
    if (options.method === 'GET') return fakeResponse(200, apiConfig());
    writes.push(JSON.parse(options.body));
    return ++attempt === 1 ? fakeResponse(503, { error: 'offline' }) : fakeResponse(204);
  } });
  await sync.read();
  sync.markDirty(true);
  assert.equal(await sync.save(), false);
  assert.ok(sync.runtime.error);
  sync.markDirty();
  assert.equal(sync.runtime.error, '');
  assert.equal(await sync.save(), true);
  assert.equal(writes[0].forceWrite, true);
  assert.equal(writes[1].forceWrite, true);
  assert.equal(sync.runtime.forceSerial, 0);
  assert.equal(sync.runtime.dirty, false);
});

add('an uninitialized client cannot flush demo data over the backend', async () => {
  const calls = [];
  const sync = context.createNativeConfigSync({ contract, convert: converters, defaults, getState: defaults, validate: () => true, enabled: () => true, fetch: async (_, request) => { calls.push(request.method); return fakeResponse(200, {}); } });
  sync.markDirty();
  assert.equal(await sync.save(), false);
  assert.deepEqual(calls, ['GET']);
});

add('initial network failure can recover without silently replacing existing work', async () => {
  const api = apiConfig();
  api.templates = [{ id: 'existing', title: 'Existing', frames: [] }];
  let attempts = 0;
  const calls = [];
  const sync = context.createNativeConfigSync({ contract, convert: converters, defaults, getState: defaults, validate: () => true, enabled: () => true, fetch: async (_, request) => {
    calls.push(request.method);
    if (++attempts === 1) throw new Error('offline');
    return fakeResponse(200, api);
  } });
  await assert.rejects(sync.read());
  sync.markDirty();
  assert.equal(await sync.save(), false);
  assert.deepEqual(calls, ['GET', 'GET']);
  assert.match(sync.runtime.error, /existing work/);
});

const prompts = context.createFreePromptPolicy();
add('irregular braces and empty weights never block prompt text', () => {
  for (const value of ['{{{{', '}}}}', '{}', '{char', '{', '}', 'one {two', '']) assert.equal(prompts.interpolate(value, {}), value);
});
add('NovelAI weights and unknown braces stay byte-for-byte unchanged', () => {
  const text = '{{knees up}}, {mouth mask}, {{{style}}}, [[mood]], {unregistered}';
  assert.equal(prompts.interpolate(text, { style: 'anime', mood: 'calm' }), text);
});
add('only known, isolated placeholders become highlight tokens', () => {
  const tokens = prompts.tokens('{character}, {unknown}, {{character}}, {mouth mask}', ['character']);
  assert.equal(tokens.filter(t => t.type === 'variable').length, 1);
  assert.equal(tokens.find(t => t.type === 'variable').key, 'character');
});
add('empty declared variables collapse duplicate commas and edge commas', () => {
  assert.equal(prompts.interpolate('{character}, {outfit}, {style}, {weapon}, ', { character: 'nahida', outfit: '', style: '', weapon: '' }), 'nahida');
  assert.equal(prompts.interpolate(', {outfit}, {character}, ,', { character: 'Mio', outfit: '' }), 'Mio');
  assert.equal(prompts.interpolate('{character}   {outfit}   at sea', { character: 'Mio', outfit: '' }), 'Mio at sea');
});
add('declared but absent values are omitted, unknown names stay literal', () => {
  assert.equal(prompts.interpolate('{character}, {outfit}, {weapon}', { character: 'Mio' }, ['character', 'outfit', 'weapon']), 'Mio');
  assert.equal(prompts.interpolate('{unknown}', {}), '{unknown}');
});
add('comma cleanup does not rewrite weight groups or JSON strings', () => {
  assert.equal(prompts.interpolate('{{knees,,up}}, {outfit}, ', { outfit: '' }), '{{knees,,up}}');
  assert.equal(prompts.interpolate('"a,,b", {outfit}, ', { outfit: '' }), '"a,,b"');
});
add('zero and false remain meaningful prompt values', () => {
  assert.equal(prompts.interpolate('{amount}, {enabled}', { amount: 0, enabled: false }), '0, false');
});
add('brace suggestions are informational only', () => {
  assert.equal(prompts.hasUnclosedBrace('{char'), true);
  assert.equal(prompts.hasUnclosedBrace('{{knees up}}'), false);
  assert.equal(prompts.interpolate('{char', {}), '{char');
});
add('prompt highlights escape HTML without changing the author text', () => {
  const result = context.highlightedPromptHTML('<img onerror=x> {character}', ['character'], { character: 'Mio' });
  assert.equal(result.includes('<img'), false);
  assert.equal(result.includes('data-prompt-variable="character"'), true);
});
add('odd-page spreads use a blank right leaf without array overflow', () => {
  const reader = context.createReaderPresentationModel(5);
  reader.seek(4);
  assert.deepEqual(plain(reader.spread()), [4, null]);
  assert.equal(reader.next(), 4);
  reader.setMode('gallery');
  assert.equal(reader.previous(), 3);
});
add('empty reader remains valid and has no out-of-range pages', () => {
  const reader = context.createReaderPresentationModel(0);
  assert.deepEqual(plain(reader.spread()), [null, null]);
  assert.equal(reader.next(), 0);
});

const display = context.createCollectionDisplayModel();
add('collection layouts are explicitly selected rather than inferred from book count', () => {
  assert.equal(display.mode('showcase'), 'showcase');
  assert.equal(display.mode('grid'), 'grid');
  assert.equal(display.mode('invalid'), 'showcase');
});
add('grid pagination handles large collections and clamps stale page indices', () => {
  const page = display.page(100, 99);
  assert.equal(page.pages, 5);
  assert.equal(page.index, 4);
  assert.equal(page.start, 96);
  assert.equal(page.end, 100);
  assert.equal(display.page(0, 4).index, 0);
  assert.equal(display.page(0, 4).end, 0);
});
add('mixed aspect-ratio covers fit without cropping or distortion', () => {
  const wide = display.fit(1920, 1080, 600, 600);
  assert.equal(wide.width, 600);
  assert.equal(wide.height, 337.5);
  const tall = display.fit(800, 2400, 320, 560);
  assert.equal(tall.height, 560);
  assert.ok(Math.abs(tall.width / tall.height - 1 / 3) < 0.000001);
  assert.equal(display.fit(0, 0, 320, 500).scale, 0);
});
add('reading opens in the scroll view by default', () => {
  const reader = context.createReaderPresentationModel(8);
  assert.equal(reader.state.mode, 'webtoon');
  assert.equal(reader.next(), 1);
  reader.setMode('spread');
  assert.equal(reader.next(), 3);
});
add('native Chinese and English UI labels use an in-memory catalog', () => {
  const locale = context.createStudioLocaleCatalog('en');
  assert.equal(locale.text('画册集'), 'Collections');
  assert.equal(locale.text('{count} 本画册', { count: 28 }), '28 books');
  assert.equal(locale.translate('  紧凑网格  '), '  Grid  ');
  locale.setLanguage('zh-CN');
  assert.equal(locale.text('画册集'), '画册集');
  assert.equal(locale.translate('海风与未寄出的信'), '海风与未寄出的信');
});
add('UI localization does not translate unknown authored content', () => {
  const locale = context.createStudioLocaleCatalog('en');
  const authored = '海风与未寄出的信 / {character}, {{{quality}}}';
  assert.equal(locale.translate(authored), authored);
});
add('demo cleanup removes only untouched extra pages and preserves the first image', () => {
  const first = { stepIndex: 0, image: 'keep-this-image' };
  const book = { curatedDemo: true, totalSteps: 3, generatedSteps: 3, steps: [first, { stepIndex: 1, image: 'placeholder' }, { stepIndex: 2, image: 'placeholder' }] };
  assert.equal(context.trimUntouchedDemoBook(book, step => step.image === 'placeholder'), true);
  assert.equal(book.steps.length, 1);
  assert.equal(book.steps[0], first);
  assert.equal(book.totalSteps, 1);
  assert.equal(book.generatedSteps, 1);
  assert.equal(book.status, 'complete');
});
add('modified and non-demo books are never erased by demo cleanup', () => {
  const edited = { curatedDemo: true, steps: [{ stepIndex: 0, image: 'cover' }, { stepIndex: 1, image: 'my-art' }] };
  const ordinary = { steps: [{ stepIndex: 0, image: 'cover' }, { stepIndex: 1, image: 'placeholder' }] };
  assert.equal(context.trimUntouchedDemoBook(edited, step => step.image === 'placeholder'), false);
  assert.equal(context.trimUntouchedDemoBook(ordinary, () => true), false);
  assert.equal(edited.steps.length, 2);
  assert.equal(ordinary.steps.length, 2);
});

const chromePolicy = context.createWorkspaceChromePolicy();
add('the log switch controls the final sidebar navigation', () => {
  const enabled = chromePolicy.navigation({ logs: true, llm: false });
  const disabled = chromePolicy.navigation({ logs: false, llm: false });
  assert.equal(enabled.filter(item => item[0] === 6).length, 1);
  assert.equal(enabled.find(item => item[0] === 6)[2], '运行日志');
  assert.equal(disabled.some(item => item[0] === 6), false);
  assert.equal(enabled.some(item => item[0] === 4), false);
  assert.equal(chromePolicy.navigation({ logs: true, llm: true }).some(item => item[0] === 4), true);
});
add('display preferences have a single owner, not workspace identity', () => {
  assert.equal(chromePolicy.ownsDisplayPreferences('general'), false);
  assert.equal(chromePolicy.ownsDisplayPreferences('appearance'), true);
  assert.equal(chromePolicy.ownsDisplayPreferences('modules'), false);
});
add('wide artistic brand fonts shrink to the available sidebar width', () => {
  const preferred = 22, available = 116, measured = 160;
  const size = chromePolicy.brandFontSize(preferred, available, measured);
  assert.ok(size > 0 && size < preferred);
  assert.ok(measured * size / preferred <= available - 1);
  assert.equal(chromePolicy.brandFontSize(24, 130, 110), 24);
  assert.equal(chromePolicy.brandFontSize(24, 0, 140), 0);
});
add('renamed workflow and extension labels have English translations', () => {
  const locale = context.extendStudioLocaleCatalog(context.createStudioLocaleCatalog('en'));
  assert.equal(locale.text('工作流配置'), 'Workflow configuration');
  assert.equal(locale.text('扩展功能'), 'Extensions');
  assert.equal(chromePolicy.navigation({ logs: true, extensions: true }).find(item => item[0] === 7)[2], '扩展功能');
  locale.setLanguage('zh-CN');
  assert.equal(locale.text('工作流配置'), '工作流配置');
});

function collectionDeletionFixture() {
  return {
    projects: [{ id: 'a', title: 'First collection' }, { id: 'b', title: 'Second collection' }],
    activeProjectId: 'a',
    books: [{ id: 'book_a', projectId: 'a', rowId: 'row_a', templateId: 'template_a' }, { id: 'book_b', projectId: 'b', rowId: 'row_b', templateId: 'template_b' }],
    rows: [{ id: 'row_a', projectId: 'a' }, { id: 'row_b', projectId: 'b' }],
    templates: [{ id: 'template_a', projectId: 'a' }, { id: 'template_b', projectId: 'b' }],
    queue: [{ id: 'task_a', bookId: 'book_a', planId: 'plan_a', status: 'pending' }, { id: 'task_b', bookId: 'book_b', status: 'pending' }],
    chats: [{ id: 'chat_a', projectId: 'a', templateId: 'template_a', messages: [] }, { id: 'chat_b', projectId: 'b', templateId: 'template_b', messages: [] }],
    activeChatId: 'chat_a',
    creation: {
      version: 1,
      plans: [{ id: 'plan_a', projectId: 'a', rowId: 'row_a', templateId: 'template_a', variableSetIds: ['set_a'] }, { id: 'plan_b', projectId: 'b', rowId: 'row_b', templateId: 'template_b', variableSetIds: ['set_b'] }],
      variableSets: [{ id: 'set_a', projectId: 'a' }, { id: 'set_b', projectId: 'b' }]
    },
    exportTemplates: [{ id: 'global_export' }],
    settings: { comfy: { workflow: { preserved: true } }, tutorial: { practiceProjectId: 'a', practiceBookId: 'book_a', practiceTemplateId: 'template_a', completed: true } },
    installedPackages: [{ id: 'pack_a', type: 'templates', assetIds: ['template_a'] }, { id: 'global_rules', type: 'rules', assetIds: [] }]
  };
}

add('deleting a collection removes its scoped records without mutating the source', () => {
  const source = collectionDeletionFixture(), before = JSON.stringify(source);
  const { next, summary } = context.planCollectionRemoval(source, 'a');
  assert.equal(JSON.stringify(source), before);
  assert.equal(next.projects.length, 1);
  assert.equal(next.activeProjectId, 'b');
  assert.deepEqual(plain(next.books.map(b => b.id)), ['book_b']);
  assert.deepEqual(plain(next.queue.map(q => q.id)), ['task_b']);
  assert.deepEqual(plain(next.creation.plans.map(p => p.id)), ['plan_b']);
  assert.deepEqual(plain(next.creation.variableSets.map(s => s.id)), ['set_b']);
  assert.equal(next.activeChatId, 'chat_b');
  assert.equal(summary.books, 1);
  assert.equal(summary.templates, 1);
  assert.equal(next.settings.tutorial.practiceBookId, undefined);
  assert.equal(next.settings.tutorial.completed, true);
  assert.equal(next.settings.comfy, source.settings.comfy);
  assert.equal(next.exportTemplates, source.exportTemplates);
});

add('assets referenced from another collection are retained and reassigned', () => {
  const source = collectionDeletionFixture();
  source.books[1].rowId = 'row_a';
  source.books[1].templateId = 'template_a';
  source.creation.plans[1].variableSetIds.push('set_a');
  const { next, summary } = context.planCollectionRemoval(source, 'a');
  assert.equal(next.rows.find(r => r.id === 'row_a').projectId, 'b');
  assert.equal(next.templates.find(t => t.id === 'template_a').projectId, 'b');
  assert.equal(next.creation.variableSets.find(s => s.id === 'set_a').projectId, 'b');
  assert.equal(summary.sharedAssets, 3);
  assert.equal(source.rows[0].projectId, 'a');
});

add('deleting the last collection creates an empty replacement without demo data', () => {
  const source = collectionDeletionFixture();
  const first = context.planCollectionRemoval(source, 'a').next;
  const { next, summary } = context.planCollectionRemoval(first, 'b', { id: 'fresh', title: 'Untitled collection', createdAt: 1 });
  assert.equal(summary.lastCollection, true);
  assert.equal(next.activeProjectId, 'fresh');
  assert.equal(next.projects.length, 1);
  assert.equal(next.books.length, 0);
  assert.equal(next.templates.length, 0);
  assert.equal(next.rows.length, 0);
  assert.equal(next.creation.plans.length, 0);
  assert.equal(next.chats.length, 1);
  assert.equal(next.chats[0].messages.length, 0);
});

add('collection deletion remains a flat config write with explicit forceWrite', () => {
  const source = collectionDeletionFixture();
  source.settings = defaults().settings;
  const { next } = context.planCollectionRemoval(source, 'a');
  const payload = converters.toApi(next, apiConfig(), true);
  assert.equal(payload.forceWrite, true);
  assert.equal(Object.hasOwn(payload, 'state'), false);
  assert.equal(payload.savedGalleries.books.length, 1);
  assert.equal(payload.uiConfig.comfyStudio.projects[0].id, 'b');
});

add('default narration and image prompts use different character names', () => {
  const spec = context.curatedAdventureSpec();
  assert.equal(spec.identity.character, 'nanami');
  assert.equal(spec.identity.character_display_name, '七海');
  assert.equal(spec.captions.some(c => c.includes('{character}')), false);
  assert.ok(spec.captions.some(c => c.includes('{character_display_name}')));
  const prompt = prompts.interpolate('{character}, cinematic anime', spec.identity);
  const caption = prompts.interpolate(spec.captions[1], spec.identity);
  assert.equal(prompt, 'nanami, cinematic anime');
  assert.ok(caption.startsWith('七海收到'));
  assert.equal(caption.includes('nanami'), false);
});

add('changing a display name does not change image prompts', () => {
  const before = { character: 'nahida (genshin impact)', character_display_name: '纳西妲' };
  const after = { ...before, character_display_name: '小草神' };
  assert.equal(prompts.interpolate('{character}', before), prompts.interpolate('{character}', after));
  assert.equal(prompts.interpolate('{character_display_name}出发了。', after), '小草神出发了。');
  assert.equal(context.resolveCharacterNames(after).displayName, '小草神');
  assert.equal(context.resolveCharacterNames(after).promptName, 'nahida (genshin impact)');
});

add('changing a model character tag does not change narration', () => {
  const scope = { character: 'nanami, {{portrait}}', character_display_name: '七海' };
  const changed = { ...scope, character: 'nanami_v2, 1girl' };
  assert.equal(prompts.interpolate('{character_display_name}收到来信。', scope), prompts.interpolate('{character_display_name}收到来信。', changed));
  assert.equal(prompts.interpolate('{character}', changed), 'nanami_v2, 1girl');
});

add('legacy names remain compatible and explicitly empty display names remain empty', () => {
  assert.equal(context.resolveCharacterNames({ character: 'Legacy hero' }).displayName, 'Legacy hero');
  assert.equal(context.resolveCharacterNames({ character: 'model_tag', character_display_name: '' }).displayName, '');
  assert.equal(prompts.interpolate('{character_display_name}', { character: 'model_tag', character_display_name: '' }), '');
  assert.equal(prompts.interpolate('Custom narration: {character}', { character: 'Legacy hero' }), 'Custom narration: Legacy hero');
});

function legacyCharacterDemoFixture() {
  const studio = defaults(), spec = context.curatedAdventureSpec();
  studio.templates = [{ id: 'story_journey12', projectId: 'p1', title: '远行与归来 · 十二幕', outline: '', frames: spec.names.map((name, i) => ({ id: 'letter_frame_' + i, name, prompt: '{character}, {outfit}, {style}, {scene}, {weapon}, ' + spec.shots[i], caption: spec.captions[i].replaceAll('{character_display_name}', '{character}') })) }];
  studio.rows = [{ id: 'character_nanami', projectId: 'p1', character: '七海 Nanami' }];
  studio.creation = { version: 1, variableSets: [{ id: 'setting_nanami', projectId: 'p1', title: 'Default', entries: [{ id: 'name', key: 'character', value: '七海 Nanami', type: 'text' }] }], plans: [{ id: 'draft_letter', projectId: 'p1', rowId: 'character_nanami', templateId: 'story_journey12', variableSetIds: ['setting_nanami'], variables: [], sceneOverrides: {} }] };
  studio.books = [{ id: 'historical', projectId: 'p1', characterName: '七海 Nanami', steps: [{ prompt: '七海 Nanami, portrait', caption: '七海 Nanami出发。' }], sourceSnapshot: { row: { character: '七海 Nanami' } } }];
  return studio;
}

add('only the unchanged built-in source preset is upgraded, exactly once', () => {
  const studio = legacyCharacterDemoFixture(), historical = JSON.stringify(studio.books);
  assert.equal(context.upgradeCuratedCharacterIdentity(studio, () => 'display_name'), 1);
  assert.equal(studio.rows[0].character, 'nanami');
  assert.equal(studio.rows[0].character_display_name, '七海');
  assert.equal(studio.creation.variableSets[0].entries[0].key, 'character_display_name');
  assert.ok(studio.templates[0].frames[1].caption.startsWith('{character_display_name}'));
  assert.ok(studio.templates[0].frames[1].prompt.startsWith('{character}'));
  assert.equal(JSON.stringify(studio.books), historical);
  assert.equal(context.upgradeCuratedCharacterIdentity(studio), 0);
  assert.equal(studio.creation.variableSets[0].entries.length, 2);
});

add('edited templates and custom character settings are not migrated', () => {
  const custom = legacyCharacterDemoFixture();
  custom.templates[0].frames[1].caption = 'My own text: {character}';
  const before = JSON.stringify(custom);
  assert.equal(context.upgradeCuratedCharacterIdentity(custom), 0);
  assert.equal(JSON.stringify(custom), before);
  const character = legacyCharacterDemoFixture();
  character.creation.variableSets[0].entries[0].value = 'my_custom_character';
  assert.equal(context.upgradeCuratedCharacterIdentity(character), 0);
  const overridden = legacyCharacterDemoFixture();
  overridden.creation.plans[0].variables.push({ key: 'character', value: 'my_override', type: 'text' });
  assert.equal(context.upgradeCuratedCharacterIdentity(overridden), 0);
});

add('pending rendering protects default character data and snapshots from migration', () => {
  const studio = legacyCharacterDemoFixture();
  studio.queue = [{ templateId: 'story_journey12', status: 'pending', rowSnapshot: { character: '七海 Nanami' } }];
  const before = JSON.stringify(studio);
  assert.equal(context.upgradeCuratedCharacterIdentity(studio), 0);
  assert.equal(JSON.stringify(studio), before);
});

add('display and prompt names survive the flat native API round trip independently', () => {
  const studio = legacyCharacterDemoFixture();
  context.upgradeCuratedCharacterIdentity(studio);
  studio.books = [];
  const payload = converters.toApi(studio, apiConfig());
  assert.equal(Object.hasOwn(payload, 'state'), false);
  assert.equal(payload.batchMatrix.rows[0].character, 'nanami');
  assert.equal(payload.batchMatrix.rows[0].character_display_name, '七海');
  const restored = converters.fromApi(payload, defaults());
  const settings = restored.creation.variableSets[0].entries;
  assert.equal(settings.find(e => e.key === 'character').value, 'nanami');
  assert.equal(settings.find(e => e.key === 'character_display_name').value, '七海');
});

add('name-setting labels and help describe their different purposes', () => {
  const locale = context.extendStudioLocaleCatalog(context.createStudioLocaleCatalog('en'));
  assert.equal(locale.text(context.settingLabel({ key: 'character_display_name' })), 'Display name / narration');
  assert.equal(locale.text(context.settingLabel({ key: 'character' })), 'Character name / prompt');
  assert.ok(context.characterSettingHelp('character_display_name').includes('旁白'));
  assert.ok(context.characterSettingHelp('character').includes('提示词'));
});

async function main() {
  let failed = 0;
  for (const test of tests) {
    try { await test.run(); console.log('PASS ' + test.name); }
    catch (error) { failed++; console.error('FAIL ' + test.name + '\n' + error.stack); }
  }
  console.log((tests.length - failed) + '/' + tests.length + ' tests passed.');
  if (failed) process.exitCode = 1;
}

main().catch(error => { console.error(error); process.exitCode = 1; });