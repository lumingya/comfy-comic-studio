/* Frame lifecycle boundaries shared by UI, XML import, and assistant tools. */
'use strict';

function ensureFrameCapacity(frames, additional = 1) {
  const limit = globalThis.ComfyComic.MAX_FRAMES;
  if (!Array.isArray(frames) || !Number.isInteger(additional) || additional < 0) throw new Error('Invalid frame operation.');
  if (frames.length + additional > limit) throw new Error('This operation would exceed ' + limit + ' frames.');
  return true;
}

function isEmptyCreativeSetting(value) {
  return value === undefined || value === null || (typeof value === 'string' && value.trim() === '');
}

function installNativeCreationModule() {
  const ns = globalThis.ComfyComic;
  if (typeof indexSchema !== 'undefined') indexSchema.maximum = ns.MAX_FRAMES - 1;
  if (typeof assistantTools !== 'undefined') {
    for (const tool of assistantTools) {
      const frames = tool.function?.parameters?.properties?.frames;
      if (frames?.type === 'array') frames.maxItems = ns.MAX_FRAMES;
    }
  }
  const enqueuePrevious = enqueuePlanSnapshot;
  enqueuePlanSnapshot = function(plan, existing = null) {
    const template = templateBy(plan?.templateId);
    if (!template) throw new Error('Select a storyboard before generating.');
    ns.stateContract.assertFrameCount(template.frames);
    if (template.frames.length === 0) throw new Error('This storyboard is empty. Add a frame before generating.');
    return enqueuePrevious(plan, existing);
  };
  const assistantPrevious = assistantToolDraft;
  assistantToolDraft = function(template, name, args = {}) {
    template.frames ??= [];
    if (name === 'add_new_frame') ensureFrameCapacity(template.frames);
    if (name === 'batch_update_prompts_and_captions') ns.stateContract.assertFrameCount(args.frames || []);
    return assistantPrevious(template, name, args);
  };
  const packagePrevious = selectedPublishPackage;
  selectedPublishPackage = function(id) {
    const value = packagePrevious(id);
    if (value.value?.frames) ns.stateContract.assertFrameCount(value.value.frames);
    return value;
  };
  ns.modules.creation = true;
}