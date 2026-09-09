/* Python contract adapter: same-origin GET/POST /api/config, flat payload only. */
'use strict';

function createConfigConverters(contract) {
  const { object, copy, collection, replaceCollection, requiredFields } = contract;

  function fromApi(config, defaults) {
    if (!contract.plain(config)) throw new Error('/api/config must return a flat JSON object.');
    if (Object.hasOwn(config, 'state') && !requiredFields.some(key => Object.hasOwn(config, key))) throw new Error('Wrapped {state: ...} responses are not the /api/config contract.');
    const missing = requiredFields.filter(key => !Object.hasOwn(config, key));
    if (missing.length) throw new Error('Incomplete /api/config response: ' + missing.join(', ') + '. Existing local state was retained.');
    const result = copy(defaults);
    const uiConfig = object(config.uiConfig);
    const meta = object(uiConfig.comfyStudio);
    const priorSettings = object(meta.settings);
    result.templates = collection(config.templates, ['templates', 'items']);
    result.books = collection(config.savedGalleries, ['books', 'galleries', 'items']);
    result.rows = collection(config.batchMatrix, ['rows', 'items']);
    result.projects = copy(meta.projects ?? uiConfig.projects ?? result.projects);
    result.activeProjectId = meta.activeProjectId ?? uiConfig.activeProjectId ?? result.projects?.[0]?.id;
    result.creation = copy(meta.creation);
    result.exportTemplates = copy(meta.exportTemplates ?? result.exportTemplates);
    result.installedPackages = copy(meta.installedPackages ?? []);
    result.customColumns = copy(meta.customColumns ?? object(config.batchMatrix).customColumns ?? []);
    result.drafts = copy(meta.drafts ?? {});
    result.workspaceId = meta.workspaceId ?? result.workspaceId;
    result.settings = { ...result.settings, ...priorSettings };
    result.settings.comfy = { ...defaults.settings.comfy, ...object(config.comfyConfig) };
    const workflows = collection(config.comfyWorkflows, ['workflows', 'presets', 'items']);
    result.settings.comfy.presets = copy(workflows);
    const comfyConfig = object(config.comfyConfig);
    const selected = workflows.find(item => item.id === comfyConfig.activeWorkflowId || item.id === comfyConfig.workflowId) || workflows[0];
    const workflow = comfyConfig.workflow ?? meta.workflow ?? selected?.workflow ?? selected?.prompt;
    if (workflow && Object.keys(workflow).length) result.settings.comfy.workflow = copy(workflow);
    else result.settings.comfy.workflow = copy(defaults.settings.comfy.workflow);
    const mapping = { ...defaults.settings.comfy.mapping, ...object(comfyConfig.mapping) };
    for (const kind of ['positive', 'negative', 'output']) {
      if (comfyConfig[kind + 'NodeId'] !== undefined) mapping[kind] = String(comfyConfig[kind + 'NodeId']);
    }
    result.settings.comfy.mapping = mapping;
    if (!Array.isArray(comfyConfig.bindings)) delete result.settings.comfy.bindings;
    result.settings.llm = { ...defaults.settings.llm, ...object(config.llmConfig) };
    result.settings.xml = { ...defaults.settings.xml, ...object(config.xmlConfig) };
    result.settings.studio = copy(meta.studio ?? priorSettings.studio ?? uiConfig.studio ?? defaults.settings.studio);
    const chat = object(config.chatConfig);
    result.chats = copy(chat.sessions ?? chat.chats ?? meta.chats ?? []);
    result.activeChatId = chat.activeChatId ?? meta.activeChatId;
    const run = object(config.batchRunState);
    result.queue = copy(Array.isArray(config.batchRunState) ? config.batchRunState : run.queue ?? run.tasks ?? []);
    result.updatedAt = Number(config.updatedAt) || Date.now();
    result.settings.backend = { enabled: true, baseUrl: '', loadPath: '/api/config', savePath: '/api/config', method: 'POST', payloadField: '', responseField: '' };
    return contract.normalize(result);
  }

  function toApi(studio, previous = {}, forceWrite = false) {
    const settings = copy(studio.settings);
    if (!settings.disk?.includeKeys) {
      for (const key of ['llm', 'xml', 'critic']) if (settings[key]) settings[key].key = '';
    }
    if (settings.github) { delete settings.github.token; delete settings.github.key; }
    const comfy = { ...object(previous.comfyConfig), ...settings.comfy };
    delete comfy.presets;
    const payload = {
      ...copy(previous),
      templates: replaceCollection(previous.templates, studio.templates || [], ['templates', 'items'], 'templates'),
      savedGalleries: replaceCollection(previous.savedGalleries, studio.books || [], ['books', 'galleries', 'items'], 'books'),
      batchMatrix: replaceCollection(previous.batchMatrix, studio.rows || [], ['rows', 'items'], 'rows'),
      comfyWorkflows: replaceCollection(previous.comfyWorkflows, settings.comfy.presets || [], ['workflows', 'presets', 'items'], 'workflows'),
      comfyConfig: comfy,
      llmConfig: { ...object(previous.llmConfig), ...settings.llm },
      xmlConfig: { ...object(previous.xmlConfig), ...settings.xml },
      chatConfig: { ...object(previous.chatConfig), sessions: copy(studio.chats || []), activeChatId: studio.activeChatId },
      uiConfig: {
        ...object(previous.uiConfig),
        comfyStudio: {
          ...object(object(previous.uiConfig).comfyStudio),
          projects: copy(studio.projects), activeProjectId: studio.activeProjectId,
          workspaceId: studio.workspaceId, creation: copy(studio.creation),
          exportTemplates: copy(studio.exportTemplates), customColumns: copy(studio.customColumns),
          installedPackages: copy(studio.installedPackages), drafts: copy(studio.drafts),
          settings, studio: copy(settings.studio)
        }
      },
      batchRunState: { ...object(previous.batchRunState), queue: copy(studio.queue || []) },
      updatedAt: Date.now()
    };
    delete payload.state;
    delete payload.forceWrite;
    if (forceWrite) payload.forceWrite = true;
    for (const key of requiredFields) if (!Object.hasOwn(payload, key)) throw new Error('Missing required API field: ' + key);
    return payload;
  }

  return { fromApi, toApi };
}

function createNativeConfigSync(options) {
  const runtime = { loading: false, saving: false, loaded: false, error: '', dirty: false, previous: {}, serial: 0, committed: 0, forceSerial: 0, savedAt: null, timer: null, tail: Promise.resolve() };
  const notify = () => options.onStatus?.(runtime);
  const getFetch = () => options.fetch || globalThis.fetch.bind(globalThis);

  async function read() {
    runtime.loading = true;
    runtime.error = '';
    notify();
    try {
      const response = await getFetch()('/api/config', { method: 'GET', credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error('GET /api/config: HTTP ' + response.status);
      const config = await response.json();
      const converted = options.convert.fromApi(config, options.defaults());
      runtime.previous = options.contract.copy(config);
      runtime.loaded = true;
      runtime.savedAt = Number(config.updatedAt) || null;
      return converted;
    } catch (error) { runtime.error = error.message; throw error; }
    finally { runtime.loading = false; notify(); }
  }

  function markDirty(force = false) {
    runtime.serial++;
    runtime.dirty = true;
    runtime.error = ''; // New edits must re-arm saving after a network failure.
    if (force) runtime.forceSerial = runtime.serial;
    clearTimeout(runtime.timer);
    if (options.enabled()) runtime.timer = setTimeout(() => save(), options.debounce ?? 700);
    notify();
  }

  function save(force = false) {
    clearTimeout(runtime.timer);
    if (force) { runtime.serial++; runtime.forceSerial = runtime.serial; runtime.dirty = true; }
    runtime.tail = runtime.tail.catch(() => false).then(async () => {
      if (!options.enabled()) return false;
      if (!runtime.loaded) {
        try {
          const recovered = await read();
          if (recovered.templates.length || recovered.books.length || recovered.rows.length) {
            runtime.loaded = false;
            runtime.error = 'Connection recovered, but the backend contains existing work. Reload it explicitly before saving local edits.';
            notify();
            return false;
          }
        } catch (error) { notify(); return false; }
      }
      const serial = runtime.serial;
      const forceSerial = runtime.forceSerial;
      runtime.saving = true;
      runtime.error = '';
      notify();
      try {
        const studio = options.getState();
        options.validate(studio);
        const payload = options.convert.toApi(studio, runtime.previous, forceSerial > 0);
        const response = await getFetch()('/api/config', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(payload) });
        if (!response.ok) throw new Error('POST /api/config: HTTP ' + response.status);
        if (response.status !== 204) {
          const text = await response.text();
          if (text.trim()) {
            let data;
            try { data = JSON.parse(text); } catch (error) { throw new Error('The config endpoint returned non-JSON content.'); }
            if (data.ok === false || data.status === 'error' || data.success === false) throw new Error(data.message || data.error || 'The backend rejected the save.');
          }
        }
        runtime.previous = payload;
        runtime.committed = serial;
        if (runtime.forceSerial === forceSerial) runtime.forceSerial = 0;
        runtime.dirty = runtime.serial !== serial;
        runtime.savedAt = payload.updatedAt;
        return true;
      } catch (error) {
        runtime.error = error.message;
        runtime.dirty = true;
        options.onError?.(error);
        return false;
      } finally {
        runtime.saving = false;
        notify();
      }
    });
    return runtime.tail;
  }

  return { runtime, read, save, markDirty };
}

function installNativeSyncModule() {
  const ns = globalThis.ComfyComic;
  ns.converters = createConfigConverters(ns.stateContract);
  ns.sync = createNativeConfigSync({
    contract: ns.stateContract,
    convert: ns.converters,
    defaults: () => state,
    getState: () => state,
    validate: value => validateState(value),
    enabled: () => /http/.test(location.protocol),
    onStatus: runtime => {
      backendRuntime.connected = runtime.loaded;
      backendRuntime.loading = runtime.loading;
      backendRuntime.saving = runtime.saving;
      backendRuntime.dirty = runtime.dirty;
      backendRuntime.error = runtime.error;
      backendRuntime.savedAt = runtime.savedAt;
      rt.saved = runtime.loaded && !runtime.dirty && !runtime.error;
      if (document.getElementById('statusbar')) renderStatus();
    },
    onError: error => { log(error.message, 'error'); }
  });
  save = function(force = false) { if (!rt.booting) ns.sync.markDirty(force); };
  flushDiskSave = async function() { flushEditor(); return ns.sync.save(); };
  readPythonWorkspace = async function() { return { state: await ns.sync.read(), revision: null, etag: null }; };
  savePythonWorkspace = force => ns.sync.save(force);
  connectPythonBackend = async function() {
    if (activeJobs()) throw new Error('Finish active jobs before reloading the config.');
    if (ns.sync.runtime.dirty && !await confirmAction('Reload backend config?', 'Unsaved in-memory edits will be replaced.', 'Reload')) return;
    state = await ns.sync.read();
    ensureStudioState();
    ns.sync.runtime.dirty = false;
    backendRuntime.dirty = false;
    rt.saved = true;
    ui.selected.clear(); ui.templateId = projectTemplates()[0]?.id; ui.frameIndex = 0;
    createUI.planId = projectPlans()[0]?.id || null;
    render(); toast('GET /api/config loaded. Saving uses POST /api/config.');
  };
  loadState = async function() {
    ensureStudioState();
    if (/http/.test(location.protocol)) {
      try { state = await ns.sync.read(); }
      catch (error) { log('Config load failed: ' + error.message, 'error'); }
    }
    ensureStudioState();
    rt.booting = false;
    ui.templateId = projectTemplates()[0]?.id;
    ui.storyTemplateId = ui.templateId;
    ui.storyRowId = projectRows()[0]?.id;
    ui.frameIndex = 0;
    createUI.planId = projectPlans()[0]?.id || null;
    render();
    if (!state.settings.identity.workspaceName || !state.settings.identity.onboarded) showWorkspaceWelcome();
  };
  ns.modules.sync = true;
}

function convertApiConfigToStudioState(config, defaults = state) {
  return globalThis.ComfyComic.converters.fromApi(config, defaults);
}

function convertStudioStateToApiPayload(studio = state, previous, forceWrite = false) {
  return globalThis.ComfyComic.converters.toApi(studio, previous ?? globalThis.ComfyComic.sync.runtime.previous, forceWrite);
}