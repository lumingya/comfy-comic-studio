/* Development module. Run `node js/build.js extract` to include the preserved legacy declarations. */
'use strict';

function createStudioStateContract() {
  const MAX_FRAMES = 512;
  const requiredFields = Object.freeze([
    'templates', 'savedGalleries', 'batchMatrix', 'comfyWorkflows',
    'comfyConfig', 'llmConfig', 'xmlConfig', 'chatConfig', 'uiConfig', 'batchRunState'
  ]);
  const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const copy = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  const object = value => plain(value) ? value : {};

  function collection(value, keys = []) {
    if (Array.isArray(value)) return value;
    if (!plain(value)) return [];
    for (const key of keys) if (Array.isArray(value[key])) return value[key];
    return Object.values(value).filter(plain);
  }

  function replaceCollection(original, items, keys, defaultKey) {
    if (Array.isArray(original) || original === undefined || original === null) return copy(items);
    for (const key of keys) {
      if (Array.isArray(original[key])) return { ...copy(original), [key]: copy(items) };
    }
    if (Object.keys(original).length && Object.values(original).every(plain)) {
      return Object.fromEntries(items.map(item => [item.id, copy(item)]));
    }
    return { ...copy(object(original)), [defaultKey]: copy(items) };
  }

  function assertFrameCount(frames, label = 'frames') {
    if (!Array.isArray(frames)) throw new Error(label + ' must be an array.');
    if (frames.length > MAX_FRAMES) throw new Error(label + ' exceeds ' + MAX_FRAMES + ' frames.');
    return frames;
  }

  function safeId(value, prefix, index) {
    const candidate = String(value ?? '');
    if (/^[a-zA-Z0-9_-]{1,150}$/.test(candidate) && !['__proto__', 'constructor', 'prototype'].includes(candidate)) return candidate;
    let digest = 2166136261;
    for (const char of candidate) digest = Math.imul(digest ^ char.charCodeAt(0), 16777619);
    return prefix + '_' + index + '_' + (digest >>> 0).toString(36);
  }

  function frame(value, index) {
    const source = object(value);
    return {
      ...copy(source), id: safeId(source.id, 'frame', index),
      name: String(source.name ?? source.title ?? 'Scene ' + (index + 1)),
      prompt: String(source.prompt ?? source.positivePrompt ?? ''),
      caption: String(source.caption ?? source.text ?? ''),
      negative: String(source.negative ?? source.negativePrompt ?? ''),
      renderOverride: source.renderOverride === true,
      nodeOverrides: copy(object(source.nodeOverrides)),
      width: Number(source.width ?? 768), height: Number(source.height ?? 1024),
      steps: Number(source.steps ?? 24), cfg: Number(source.cfg ?? 7),
      denoise: Number(source.denoise ?? 1), seed: Number(source.seed ?? -1)
    };
  }

  function normalize(studio) {
    const s = studio;
    s.schemaVersion = '2.2';
    s.templates = Array.isArray(s.templates) ? s.templates : collection(s.templates, ['templates', 'items']);
    s.rows = Array.isArray(s.rows) ? s.rows : collection(s.rows, ['rows']);
    s.books = Array.isArray(s.books) ? s.books : collection(s.books, ['books', 'galleries']);
    s.queue = Array.isArray(s.queue) ? s.queue : [];
    s.projects = Array.isArray(s.projects) ? s.projects : [];
    if (!s.projects.length) s.projects = [{ id: 'project_default', title: 'My project', createdAt: Date.now() }];
    s.projects = s.projects.map((p, i) => ({ ...object(p), id: safeId(p?.id, 'project', i), title: String(p?.title ?? p?.name ?? 'Project'), createdAt: Number(p?.createdAt) || Date.now() }));
    const defaultProject = s.projects.some(p => p.id === s.activeProjectId) ? s.activeProjectId : s.projects[0].id;
    s.activeProjectId = defaultProject;
    const projectId = value => s.projects.some(p => p.id === value) ? value : defaultProject;
    const now = Date.now();
    s.templates = s.templates.map((t, index) => {
      const source = object(t);
      const frames = source.frames ?? [];
      assertFrameCount(frames, 'template.frames');
      return { ...copy(source), id: safeId(source.id, 'template', index), projectId: projectId(source.projectId), title: String(source.title ?? source.name ?? 'Untitled storyboard'), outline: String(source.outline ?? source.synopsis ?? ''), frames: frames.map(frame), createdAt: Number(source.createdAt) || now };
    });
    s.rows = s.rows.map((r, index) => {
      const source = object(r);
      const versions = copy(object(source.storyVersions));
      const active = copy(object(source.activeStoryVersionIds));
      for (const [templateId, values] of Object.entries(versions)) {
        versions[templateId] = (Array.isArray(values) ? values : []).map((v, i) => ({ ...object(v), id: safeId(v?.id, 'story', i), templateId, title: String(v?.title ?? 'Story'), source: ['manual', 'preset', 'llm'].includes(v?.source) ? v.source : 'manual', captions: (Array.isArray(v?.captions) ? v.captions : []).map(String), createdAt: Number(v?.createdAt) || now, updatedAt: Number(v?.updatedAt) || now }));
        if (!versions[templateId].some(v => v.id === active[templateId])) delete active[templateId];
      }
      return { ...copy(source), id: safeId(source.id, 'row', index), projectId: projectId(source.projectId), active: source.active === true, bookTitle: String(source.bookTitle ?? source.title ?? ''), character: String(source.character ?? ''), style: String(source.style ?? ''), outfit: String(source.outfit ?? ''), storyVersions: versions, activeStoryVersionIds: active, references: copy(object(source.references)) };
    });
    s.books = s.books.map((b, index) => {
      const source = object(b);
      const rawSteps = source.steps ?? source.frames ?? [];
      assertFrameCount(rawSteps, 'book.steps');
      const steps = rawSteps.map((step, i) => ({ ...object(step), stepIndex: Number.isInteger(step?.stepIndex) ? step.stepIndex : i, name: String(step?.name ?? 'Scene ' + (i + 1)), prompt: String(step?.prompt ?? ''), caption: String(step?.caption ?? ''), image: String(step?.image ?? '') }));
      const implied = steps.reduce((n, step) => Math.max(n, step.stepIndex + 1), 0);
      const total = Math.max(Number.isInteger(source.totalSteps) ? source.totalSteps : 0, implied);
      if (total > MAX_FRAMES) throw new Error('A book exceeds the 512-frame limit.');
      return { ...copy(source), id: safeId(source.id, 'book', index), projectId: projectId(source.projectId), title: String(source.title ?? 'Untitled book'), characterName: String(source.characterName ?? source.character ?? ''), rowId: safeId(source.rowId, 'source_row', index), templateId: safeId(source.templateId, 'source_template', index), templateTitle: String(source.templateTitle ?? ''), synopsis: String(source.synopsis ?? ''), tags: (Array.isArray(source.tags) ? source.tags : []).map(String), steps, totalSteps: total, generatedSteps: steps.filter(step => step.image).length, status: ['complete', 'generating', 'failed', 'canceled'].includes(source.status) ? source.status : 'complete', inProgress: false, createdAt: Number(source.createdAt) || now, updatedAt: Number(source.updatedAt) || now };
    });
    s.queue = s.queue.map((task, index) => {
      const source = object(task);
      const indices = Array.isArray(source.indices) ? source.indices : [];
      if (indices.some(i => !Number.isInteger(i) || i < 0 || i >= MAX_FRAMES)) throw new Error('Queue frame index is outside 0..511.');
      const book = s.books.find(b => b.id === String(source.bookId));
      return { ...copy(source), id: safeId(source.id, 'task', index), bookId: safeId(source.bookId, 'book_ref', index), rowId: source.rowId ?? book?.rowId, templateId: source.templateId ?? book?.templateId, indices, done: Math.max(0, Math.min(indices.length, Number(source.done) || 0)), status: ['running', 'paused'].includes(source.status) ? 'pending' : source.status || 'pending' };
    });
    s.chats = Array.isArray(s.chats) ? s.chats : [];
    if (!s.chats.length) s.chats = [{ id: 'chat_default', title: 'New conversation', messages: [] }];
    if (!s.chats.some(c => c.id === s.activeChatId)) s.activeChatId = s.chats[0].id;
    s.customColumns = Array.isArray(s.customColumns) ? s.customColumns : [];
    s.installedPackages = Array.isArray(s.installedPackages) ? s.installedPackages : [];
    return s;
  }

  return Object.freeze({ MAX_FRAMES, requiredFields, plain, object, copy, collection, replaceCollection, assertFrameCount, normalize });
}

function installNativeStateModule() {
  const ns = globalThis.ComfyComic = globalThis.ComfyComic || {};
  ns.stateContract = createStudioStateContract();
  ns.MAX_FRAMES = ns.stateContract.MAX_FRAMES;
  ns.getState = () => state;
  ns.replaceState = value => { state = ns.stateContract.normalize(value); ensureStudioState(); };
  ns.modules = { ...(ns.modules || {}), state: true };
}

/* Author syntax stays untouched; only declared, single-brace placeholders are tokens. */
function createFreePromptPolicy() {
  const own = (object, key) => Object.prototype.hasOwnProperty.call(object || {}, key);
  function tokens(value, definitions = []) {
    const text = String(value ?? '');
    const known = definitions instanceof Set ? definitions : new Set(definitions);
    const parts = [];
    let cursor = 0;
    for (const match of text.matchAll(/\{([a-zA-Z0-9_]+)\}/g)) {
      const start = match.index, end = start + match[0].length;
      if (!known.has(match[1]) || text[start - 1] === '{' || text[end] === '}' || text[start - 1] === '\\') continue;
      if (start > cursor) parts.push({ type: 'text', value: text.slice(cursor, start) });
      parts.push({ type: 'variable', key: match[1], value: match[0], start, end });
      cursor = end;
    }
    if (cursor < text.length) parts.push({ type: 'text', value: text.slice(cursor) });
    return parts;
  }
  function collapseEmptyPunctuation(text) {
    let output = '', ordinary = '', quote = '';
    const stack = [], close = { '{': '}', '[': ']', '(': ')' };
    const flush = last => {
      let value = ordinary.replace(/[,，](?:[ \t]*[,，])+/g, ',').replace(/[,，][ \t]+/g, ', ').replace(/[ \t]{2,}/g, ' ');
      if (!output) value = value.replace(/^[ \t,，]+/, '');
      if (last) value = value.replace(/[ \t,，]+$/, '');
      output += value;
      ordinary = '';
    };
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      if (quote) {
        output += char;
        if (char === '\\' && i + 1 < text.length) output += text[++i];
        else if (char === quote) quote = '';
        continue;
      }
      if (char === '"' || char === "'") { flush(false); quote = char; output += char; continue; }
      if (close[char]) { flush(false); stack.push(close[char]); output += char; continue; }
      if (stack.length) { output += char; if (char === stack[stack.length - 1]) stack.pop(); continue; }
      ordinary += char;
    }
    flush(true);
    return output;
  }
  function interpolate(value, values = {}, definitions = Object.keys(values || {})) {
    const known = new Set([...(definitions || []), ...Object.keys(values || {})]);
    let removedEmpty = false;
    const output = tokens(value, known).map(part => {
      if (part.type !== 'variable') return part.value;
      const item = own(values, part.key) ? values[part.key] : '';
      if (item === undefined || item === null || item === '') { removedEmpty = true; return ''; }
      if (typeof item === 'object') { try { return JSON.stringify(item); } catch (error) { return String(item); } }
      return String(item);
    }).join('');
    return removedEmpty ? collapseEmptyPunctuation(output) : output;
  }
  function hasUnclosedBrace(value) {
    let open = 0;
    for (const char of String(value ?? '')) {
      if (char === '{') open++;
      else if (char === '}' && open > 0) open--;
    }
    return open > 0;
  }
  return Object.freeze({ tokens, interpolate, collapseEmptyPunctuation, hasUnclosedBrace });
}

function resolveCharacterNames(values = {}) {
  const promptName = String(values?.character ?? '');
  // A missing display field keeps legacy behavior; an explicitly empty one stays empty.
  const displayName = Object.hasOwn(values || {}, 'character_display_name')
    ? String(values.character_display_name ?? '') : promptName;
  return { promptName, displayName };
}

function curatedAdventureSpec() {
  return {
    identity: { character_display_name: '七海', character: 'nanami' },
    names: ['风起的日常','未署名的来信','决定出发','通往海岸的小路','第一个线索','旅途中的同行者','走错的方向','风雨将至','独自做出的选择','灯光下的答案','终于重逢','风抵达的地方'],
    captions: ['夏日的风经过窗边，故事还没有名字。','{character_display_name}收到一封没有署名的信，信纸上留着海的气息。','有些答案，需要亲自走到远方。','小路穿过山野，通向记忆里的海岸。','旧车站的钟，停在我们约定的时刻。','她遇见一位旅人，也听见了一段熟悉的往事。','错过的岔路，原来也有自己的风景。','云层渐渐聚拢，风替她收起了迟疑。','这一次，{character_display_name}决定不再等待。','远处的灯光亮起，信里的一切终于有了答案。','那个熟悉的身影，仍站在夏日的光里。','我们把重逢写进风里，下一段故事从这里开始。'],
    shots: ['a quiet seaside town, distant train tracks, calm summer morning','holding an old letter, close portrait, delicate eyes','standing at an open station gate, a journey begins','cinematic wide landscape, mountain path above the sea','an abandoned train platform, warm faded signs','two travelers meeting by a harbor, soft light','a fork in a green mountain path, reflective atmosphere','wind rises over the coast, dramatic soft clouds','determined expression, wind in hair, dramatic composition','warm lantern at a seaside station, dusk','a quiet reunion, silhouette in warm sunset','ocean horizon, gentle wind, hopeful ending']
  };
}

function upgradeCuratedCharacterIdentity(studio, makeId) {
  const list = value => Array.isArray(value) ? value : [];
  const spec = curatedAdventureSpec();
  const identityKey = entry => ['character', 'character_display_name'].includes(entry?.key);
  let upgraded = 0;
  for (const template of list(studio.templates)) {
    if (!/^story_journey12(?:_demo_[a-zA-Z0-9_-]+)?$/.test(template.id || '') || template.characterIdentityVersion === 1) continue;
    if (template.title !== '远行与归来 · 十二幕' || !Array.isArray(template.frames) || template.frames.length !== 12) continue;
    const untouched = template.frames.every((frame, i) => frame.name === spec.names[i] && frame.prompt === '{character}, {outfit}, {style}, {scene}, {weapon}, ' + spec.shots[i] && frame.caption === spec.captions[i].replaceAll('{character_display_name}', '{character}'));
    if (!untouched) continue;
    const suffix = template.id.slice('story_journey12'.length);
    const set = list(studio.creation?.variableSets).find(s => s.id === 'setting_nanami' + suffix && s.projectId === template.projectId);
    const row = list(studio.rows).find(r => r.id === 'character_nanami' + suffix && r.projectId === template.projectId);
    const names = list(set?.entries).filter(identityKey);
    if (names.length !== 1 || names[0].key !== 'character' || names[0].value !== '七海 Nanami' || names[0].type !== 'text') continue;
    if (!row || row.character !== '七海 Nanami' || Object.hasOwn(row, 'character_display_name')) continue;
    const users = list(studio.creation?.plans).filter(p => p.templateId === template.id || list(p.variableSetIds).includes(set.id));
    if (users.some(p => p.templateId !== template.id || p.rowId !== row.id || p.storyVersionId || list(p.variableSetIds).length !== 1 || p.variableSetIds[0] !== set.id || list(p.variables).some(identityKey) || list(p.excludedSettingKeys).some(k => ['character', 'character_display_name'].includes(k)) || Object.values(p.sceneOverrides || {}).some(o => Object.hasOwn(o, 'caption') || list(o.variables).some(identityKey)))) continue;
    if (list(studio.queue).some(q => q.templateId === template.id && ['pending','running','paused'].includes(q.status))) continue;
    // Upgrade only recognizable built-in source data. Generated books and snapshots are historical.
    names[0].value = spec.identity.character;
    set.entries.unshift({ id: makeId ? makeId() : 'display_name_' + set.id, key: 'character_display_name', type: 'text', value: spec.identity.character_display_name });
    Object.assign(row, spec.identity);
    template.frames.forEach((frame, i) => { frame.caption = spec.captions[i]; });
    template.characterIdentityVersion = 1;
    template.updatedAt = set.updatedAt = Date.now();
    upgraded++;
  }
  return upgraded;
}

function trimUntouchedDemoBook(book, isOriginalDemoPage) {
  if (!book || book.curatedDemo !== true || book.demoContentRevision === 2 || !Array.isArray(book.steps)) return false;
  if (book.steps.length < 2) { book.demoContentRevision = 2; return false; }
  if (!book.steps.slice(1).every(step => isOriginalDemoPage(step))) return false;
  const first = book.steps.find(step => step.stepIndex === 0);
  if (!first) return false;
  book.steps = [first];
  book.totalSteps = 1;
  book.generatedSteps = first.image ? 1 : 0;
  book.status = first.image ? 'complete' : 'canceled';
  book.demoContentRevision = 2;
  book.updatedAt = Date.now();
  return true;
}

/* Compute deletion before committing it, retaining assets referenced by other collections. */
function planCollectionRemoval(studio, collectionId, replacement) {
  const list = value => Array.isArray(value) ? value : [];
  const target = list(studio.projects).find(item => item.id === collectionId);
  if (!target) throw new Error('Collection does not exist.');
  const remainingProjects = list(studio.projects).filter(item => item.id !== collectionId);
  const lastCollection = remainingProjects.length === 0;
  if (lastCollection) {
    if (!replacement?.id || replacement.id === collectionId) throw new Error('An empty replacement collection is required.');
    remainingProjects.push({ ...replacement });
  }
  const books = list(studio.books).filter(item => item.projectId !== collectionId);
  const plans = list(studio.creation?.plans).filter(item => item.projectId !== collectionId);
  const removedBookIds = new Set(list(studio.books).filter(item => item.projectId === collectionId).map(item => item.id));
  const removedPlanIds = new Set(list(studio.creation?.plans).filter(item => item.projectId === collectionId).map(item => item.id));
  let sharedAssets = 0;
  const retainReferenced = (items, findOwner) => list(items).flatMap(item => {
    if (item.projectId !== collectionId) return [item];
    const owner = findOwner(item);
    if (!owner) return [];
    sharedAssets++;
    const projectId = remainingProjects.some(p => p.id === owner.projectId) ? owner.projectId : remainingProjects[0].id;
    return [{ ...item, projectId }];
  });
  const rows = retainReferenced(studio.rows, row => plans.find(p => p.rowId === row.id) || books.find(b => b.rowId === row.id));
  const templates = retainReferenced(studio.templates, template => plans.find(p => p.templateId === template.id) || books.find(b => b.templateId === template.id) || rows.find(r => list(r.storyVersions?.[template.id]).length));
  const variableSets = retainReferenced(studio.creation?.variableSets, set => plans.find(p => list(p.variableSetIds).includes(set.id)));
  const removedTemplateIds = new Set(list(studio.templates).filter(t => !templates.some(kept => kept.id === t.id)).map(t => t.id));
  const removedAssetIds = new Set([
    ...removedBookIds, ...removedPlanIds, ...removedTemplateIds,
    ...list(studio.rows).filter(r => !rows.some(kept => kept.id === r.id)).map(r => r.id),
    ...list(studio.creation?.variableSets).filter(s => !variableSets.some(kept => kept.id === s.id)).map(s => s.id)
  ]);
  const queue = list(studio.queue).filter(task => task.projectId !== collectionId && !removedBookIds.has(task.bookId) && !removedPlanIds.has(task.planId));
  const chats = list(studio.chats).filter(chat => chat.projectId !== collectionId && !removedTemplateIds.has(chat.templateId) && !removedBookIds.has(chat.bookId));
  const removedChats = list(studio.chats).length - chats.length;
  if (!chats.length) chats.push({ id: 'chat_collection_default', title: 'New conversation', messages: [] });
  const settings = { ...studio.settings };
  const tutorial = settings.tutorial;
  if (tutorial?.practiceProjectId === collectionId || removedBookIds.has(tutorial?.practiceBookId)) {
    settings.tutorial = { ...tutorial };
    for (const key of ['practiceProjectId', 'practiceBookId', 'practiceTemplateId']) delete settings.tutorial[key];
  }
  const next = {
    ...studio, projects: remainingProjects, books, rows, templates, queue, chats, settings,
    activeProjectId: studio.activeProjectId === collectionId || !remainingProjects.some(p => p.id === studio.activeProjectId) ? remainingProjects[0].id : studio.activeProjectId,
    activeChatId: chats.some(chat => chat.id === studio.activeChatId) ? studio.activeChatId : chats[0].id,
    creation: { ...studio.creation, plans, variableSets },
    installedPackages: list(studio.installedPackages).flatMap(pkg => {
      if (!Array.isArray(pkg.assetIds) || !pkg.assetIds.length) return [pkg];
      const assetIds = pkg.assetIds.filter(id => !removedAssetIds.has(id));
      return assetIds.length ? [{ ...pkg, assetIds }] : [];
    }),
    updatedAt: Date.now()
  };
  return {
    next,
    summary: {
      title: target.title, books: removedBookIds.size, plans: removedPlanIds.size,
      templates: list(studio.templates).length - templates.length,
      rows: list(studio.rows).length - rows.length,
      variableSets: list(studio.creation?.variableSets).length - variableSets.length,
      chats: removedChats, tasks: list(studio.queue).length - queue.length, sharedAssets, lastCollection
    }
  };
}