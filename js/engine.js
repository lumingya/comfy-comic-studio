/* Workflow input discovery and topology-preserving binding adapter. */
'use strict';

function createTextNodeContract() {
  const fields = Object.freeze(['positive', 'positive_prompt', 'negative', 'negative_prompt', 'prompt', 'text', 'opt_text', 'text_g', 'text_l']);
  const own = (object, key) => Object.prototype.hasOwnProperty.call(object || {}, key);

  function isLink(value) {
    return Array.isArray(value) && value.length === 2 &&
      ['string', 'number'].includes(typeof value[0]) && Number.isInteger(value[1]);
  }

  function detect(node, role = 'positive') {
    const inputs = node?.inputs || {};
    const ordered = role === 'negative'
      ? ['negative', 'negative_prompt', ...fields.filter(key => !['negative', 'negative_prompt'].includes(key))]
      : fields;
    const field = ordered.find(key => own(inputs, key) && typeof inputs[key] === 'string');
    if (field) return { field, resolved: true, warning: '', candidates: ordered.filter(key => typeof inputs[key] === 'string') };
    const strings = Object.keys(inputs).filter(key => typeof inputs[key] === 'string' && !['ckpt_name', 'lora_name', 'filename_prefix', 'image', 'sampler_name', 'scheduler'].includes(key));
    if (strings.length === 1) return { field: strings[0], resolved: true, warning: 'Using the only actual string input: ' + strings[0], candidates: strings };
    return { field: 'text', resolved: false, warning: 'No unambiguous string input was found. text is only a suggestion; links will not be overwritten.', candidates: strings };
  }

  function pathParts(path) {
    if (typeof path !== 'string' || !path) throw new Error('A node input path is required.');
    const parts = path.startsWith('/') ? path.slice(1).split('/').map(p => p.replace(/~1/g, '/').replace(/~0/g, '~')) : path.split('.');
    if (parts.some(p => !p || ['__proto__', 'constructor', 'prototype'].includes(p))) throw new Error('Unsafe node input path.');
    return parts;
  }

  function inspectPath(node, path) {
    let value = node?.inputs;
    for (const part of pathParts(path)) {
      if (isLink(value)) return { linked: true, exists: true, value };
      if (value === null || typeof value !== 'object' || !own(value, part)) return { linked: false, exists: false };
      value = value[part];
    }
    return { linked: isLink(value), exists: true, value };
  }

  function healBinding(binding, workflow) {
    const next = { ...binding };
    if (!next.enabled || next.source === 'inherit') return next;
    const node = own(workflow, next.nodeId) ? workflow[next.nodeId] : null;
    if (!node) throw new Error('Node #' + next.nodeId + ' does not exist.');
    const textSource = next.source === 'positive' || next.source === 'negative';
    let target;
    try { target = inspectPath(node, next.path); } catch (error) { target = { exists: false, linked: false }; }
    if (textSource && (target.linked || !target.exists || typeof target.value !== 'string')) {
      const inferred = detect(node, next.source);
      if (!inferred.resolved) throw new Error('Node #' + next.nodeId + ' has no safe string input. Its upstream connections are preserved.');
      next.path = inferred.field;
      next.warning = 'Self-healed node #' + next.nodeId + ': ' + binding.path + ' -> ' + inferred.field + '. Upstream links were preserved.';
      target = inspectPath(node, next.path);
    }
    if (target.linked) throw new Error('Refusing to overwrite a topology link at #' + next.nodeId + '/' + next.path + '. Bind the upstream text node instead.');
    next.allowLink = false;
    return next;
  }

  return Object.freeze({ fields, isLink, detect, inspectPath, healBinding });
}

function detectTextField(nodeOrInputs, role = 'positive') {
  const node = nodeOrInputs?.inputs ? nodeOrInputs : { inputs: nodeOrInputs || {} };
  return globalThis.ComfyComic.textNodes.detect(node, role).field;
}

function installNativeEngineModule() {
  const ns = globalThis.ComfyComic;
  ns.textNodes = createTextNodeContract();
  const buildPrevious = buildMappedWorkflow;
  inferTextInput = function(nodeId, config = state.settings.comfy, role = 'positive') {
    const node = config.workflow?.[String(nodeId)];
    return ns.textNodes.detect(node, role);
  };
  initialWorkflowBindings = function(config) {
    const mapping = config.mapping || {};
    const rules = [];
    for (const source of ['positive', 'negative']) {
      const nodeId = mapping[source];
      if (nodeId === undefined || nodeId === null || nodeId === '') continue;
      const inferred = inferTextInput(String(nodeId), config, source);
      rules.push({ id: uid('binding'), nodeId: String(nodeId), path: inferred.field, label: source, source, type: 'text', value: '', enabled: true, autoField: true, warning: inferred.warning, allowCreate: false, allowLink: false });
    }
    return rules;
  };
  buildMappedWorkflow = function(frame, row, options = {}) {
    const execution = options.execution || frame._execution || {};
    const workflow = execution.workflow || state.settings.comfy.workflow;
    const bindings = (execution.bindings || state.settings.comfy.bindings || []).map(binding => {
      if (binding.source === 'sceneParameter' && !frame.renderOverride) return { ...binding, enabled: false };
      return ns.textNodes.healBinding(binding, workflow);
    });
    const result = buildPrevious(frame, row, { ...options, execution: { ...execution, workflow, bindings } });
    result.healedBindings = bindings.filter((binding, index) => binding.path !== (execution.bindings || state.settings.comfy.bindings || [])[index]?.path);
    return result;
  };
  ns.modules.engine = true;
}

function installFreePromptEngine(resolveDefinitions = scope => Object.keys(scope || {})) {
  const ns = globalThis.ComfyComic;
  ns.promptPolicy = ns.promptPolicy || createFreePromptPolicy();
  validatePrompt = value => String(value ?? '');
  scopeText = (value, scope = {}) => ns.promptPolicy.interpolate(value, scope, resolveDefinitions(scope));
  interpolate = (value, row = {}, frame = {}) => scopeText(value, frame._scope || row._scope || row);
  interpolateBoundValue = function(value, scope = {}) {
    if (typeof value !== 'string') return value;
    const tokens = ns.promptPolicy.tokens(value, resolveDefinitions(scope));
    if (tokens.length === 1 && tokens[0].type === 'variable' && Object.hasOwn(scope, tokens[0].key)) return scope[tokens[0].key] ?? '';
    return scopeText(value, scope);
  };
  return ns.promptPolicy;
}