import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
const context = vm.createContext({ console });
vm.runInContext(fs.readFileSync("js/workflow-slots.js", "utf8") + "\nglobalThis.core=WorkflowSlots;", context);
const core = context.core, plain = (x) => JSON.parse(JSON.stringify(x));
const fixtures = JSON.parse(fs.readFileSync("tests/fixtures/workflow_slots_contract.json"));
const pick = (s) => ({ model: { enabled: s.model.enabled, nodeId: s.model.nodeId, path: s.model.path, kind: s.model.kind }, lora: { mode: s.lora.mode, nodeId: s.lora.nodeId, path: s.lora.path, assumed: s.lora.assumed } });
for (const f of fixtures) {
  const before = JSON.stringify(f.workflow), options = { positive: f.positive || null, objectInfo: f.objectInfo || {} };
  const run = () => core.apply(f.workflow, f.slots || {}, f.overrides, options);
  if (f.error) assert.throws(run, undefined, f.name);
  else {
    const result = plain(run());
    assert.deepEqual(pick(result.slots), f.expectedSlots, f.name + " slots");
    assert.deepEqual(result.workflow, f.expectedWorkflow, f.name + " workflow");
    assert.equal(result.notices.length, f.expectedNotices, f.name + " notices");
    assert.deepEqual({ model: core.currentModel(f.workflow, result.slots), loras: plain(core.currentLoras(f.workflow, result.slots)) }, f.expectedCurrent, f.name + " current values");
  }
  assert.equal(JSON.stringify(f.workflow), before, f.name + " never mutates blueprint");
  console.log("PASS " + f.name);
}
/* Catalog extraction from /object_info: unions every ckpt_name / unet_name / lora_name enum. */
const catalog = plain(core.catalogFromObjectInfo({
  CheckpointLoaderSimple: { input: { required: { ckpt_name: [["b.safetensors", "a.safetensors"]] } } },
  "Checkpoint Loader with Name (Image Saver)": { input: { required: { ckpt_name: [["c.safetensors", "a.safetensors"]] } } },
  UNETLoader: { input: { required: { unet_name: [["flux.safetensors"]], weight_dtype: [["default", "fp8"]] } } },
  LoraLoader: { input: { required: { lora_name: [["None", "x.safetensors"]] } } },
  Broken: { input: { required: { lora_name: ["STRING"] } } },
}));
assert.deepEqual(catalog, { checkpoints: ["a.safetensors", "b.safetensors", "c.safetensors"], unets: ["flux.safetensors"], loras: ["x.safetensors"], vaes: [] });
assert.equal(core.formatTag({ name: "sub\\Cool Style.safetensors", strength: 0.85 }, "stem"), "<lora:Cool Style:0.85>");
assert.equal(core.formatTag({ name: "x.safetensors", strength: 1, clip: 0.5 }, "stem"), "<lora:x:1:0.5>");
assert.deepEqual(plain(core.parseLoraSyntax("hello <lora:a:0.5> world, <lora:b:1:0.7>").loras), [{ name: "a", strength: 0.5 }, { name: "b", strength: 1, clip: 0.7 }]);
assert.equal(core.parseLoraSyntax("hello <lora:a:0.5> world").text, "hello world");
console.log(`${fixtures.length} shared slot fixtures + catalog checks PASS`);
