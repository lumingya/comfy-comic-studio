/* Ordered initialization after the preserved application declarations. */
'use strict';

function installNativeApplication() {
  installNativeStateModule();
  installNativeSyncModule();
  installNativeEngineModule();
  installFreePromptEngine(scope => typeof definedPromptNames === 'function' ? definedPromptNames(scope) : Object.keys(scope || {}));
  installNativeCreationModule();
  installNativeUIModule();
  const ns = globalThis.ComfyComic;
  const previousEnsure = ensureStudioState;
  const normalizedStates = new WeakSet();
  ensureStudioState = function(value = state) {
    if (!normalizedStates.has(value)) {
      ns.stateContract.normalize(value);
      normalizedStates.add(value);
    }
    previousEnsure(value);
    value.settings.backend = { enabled: /http/.test(location.protocol), baseUrl: '', loadPath: '/api/config', savePath: '/api/config', method: 'POST', payloadField: '', responseField: '' };
    return value;
  };
  const previousAction = handleAction;
  handleAction = async function(action, data = {}, element) {
    if (action === 'native-diagnostics') return nativeContractDiagnostics();
    if (action === 'clone-frame') ensureFrameCapacity(currentTemplate()?.frames || []);
    if (action === 'v3-save-backend') {
      flushEditor();
      if (await ns.sync.save()) toast('POST /api/config 已由后端确认。');
      return;
    }
    if (action === 'v3-connect-backend') return connectPythonBackend();
    const result = await previousAction(action, data, element);
    if (['diagnostics', 'v3-diagnostics', 'release-diagnostics'].includes(action) && document.getElementById('modal-body')) {
      document.getElementById('modal-body').insertAdjacentHTML('beforeend', '<div class="modal-footer">' + btn('Native API / 512 / Node Tests', 'shield', 'native-diagnostics', '', 'primary') + '</div>');
    }
    return result;
  };
  ns.modules.app = true;
  ns.convertApiConfigToStudioState = (config, defaults = state) => ns.converters.fromApi(config, defaults);
  ns.convertStudioStateToApiPayload = (value = state, previous = ns.sync.runtime.previous, forceWrite = false) => ns.converters.toApi(value, previous, forceWrite);
}

async function nativeContractDiagnostics() {
  const ns = globalThis.ComfyComic;
  const results = [];
  const test = async (name, check) => {
    try {
      if (await check() === false) throw new Error('Assertion failed.');
      results.push({ name, passed: true });
    } catch (error) { results.push({ name, passed: false, message: error.message }); }
  };
  const empty = { templates: [], savedGalleries: { books: [] }, batchMatrix: { rows: [] }, comfyWorkflows: [], comfyConfig: {}, llmConfig: {}, xmlConfig: {}, chatConfig: {}, uiConfig: {}, batchRunState: {}, updatedAt: 1 };
  await test('Native flat 10-field config contract', () => {
    const payload = ns.converters.toApi(ns.converters.fromApi(empty, state), empty);
    return !Object.hasOwn(payload, 'state') && ns.stateContract.requiredFields.every(key => Object.hasOwn(payload, key));
  });
  await test('Empty templates, rows and books remain empty', () => {
    const value = ns.converters.fromApi(empty, state);
    return value.templates.length === 0 && value.rows.length === 0 && value.books.length === 0;
  });
  await test('512 frames accepted, 513 rejected', () => {
    ns.stateContract.assertFrameCount(new Array(512).fill({}));
    try { ns.stateContract.assertFrameCount(new Array(513).fill({})); return false; } catch (error) { return true; }
  });
  await test('WeiLin positive field and SDXL text_g detected', () => ns.textNodes.detect({ inputs: { positive: '', text: ['6', 0] } }).field === 'positive' && ns.textNodes.detect({ inputs: { text_g: '', text_l: '' } }).field === 'text_g');
  await test('Topology links cannot be overwritten', () => {
    try { ns.textNodes.healBinding({ enabled: true, source: 'literal', nodeId: '1', path: 'text', allowLink: true }, { '1': { inputs: { text: ['6', 0] } } }); return false; } catch (error) { return true; }
  });
  await test('New edit retries POST and retains forceWrite', async () => {
    let attempts = 0;
    const sent = [];
    const mock = createNativeConfigSync({ contract: ns.stateContract, convert: ns.converters, defaults: () => state, getState: () => state, validate: () => true, enabled: () => true, fetch: async (_, request) => {
      if (request.method === 'GET') return { ok: true, status: 200, json: async () => empty };
      sent.push(JSON.parse(request.body));
      return ++attempts === 1 ? { ok: false, status: 503 } : { ok: true, status: 204 };
    } });
    await mock.read(); mock.markDirty(true); await mock.save();
    mock.markDirty();
    if (mock.runtime.error) return false;
    return await mock.save() && sent.length === 2 && sent.every(payload => payload.forceWrite === true);
  });
  modal('Native Contract Diagnostics', '<div class="notice">These checks use isolated fake HTTP responses. They do not contact the Python backend.</div>' + results.map(r => '<div class="template-check-row"><span class="' + (r.passed ? 'accent' : 'danger') + '">' + icon(r.passed ? 'check' : 'close') + '</span><div class="grow">' + esc(r.name) + (r.message ? '<small>' + esc(r.message) + '</small>' : '') + '</div></div>').join('') + '<div class="modal-footer">' + btn('Close', '', 'close-modal', '', 'primary') + '</div>', '', true);
  return results;
}