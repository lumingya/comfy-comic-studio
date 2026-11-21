const assert = require("node:assert/strict");
globalThis.window = globalThis;
require("../logic.js");
const logic = globalThis.MioRetouchLogic;
const base = { take_id: "take-a", profile_id: "profile-a", kind: "inpaint", mask_asset_id: "asset-mask", feather: "8", invert: false, denoise: "0.7", seed: "42", prompt: " details ", negative: " blur " };

assert.deepEqual(logic.body(base), {
  take_id: "take-a", profile_id: "profile-a", kind: "inpaint",
  params: { mask_asset_id: "asset-mask", feather: 8, invert: false, prompt: "details", negative: "blur", denoise: 0.7, seed: 42 },
});
assert.throws(() => logic.body({ ...base, mask_asset_id: "" }), /emptyMask/);
assert.throws(() => logic.body({ ...base, feather: "129" }), /feather/);
assert.throws(() => logic.body({ ...base, denoise: "NaN" }), /denoise/);
assert.throws(() => logic.body({ ...base, seed: "1.5" }), /seed/);
assert.deepEqual(logic.body({ ...base, kind: "outpaint", direction: "left", padding: "64" }).params.pads, [64, 0, 0, 0]);
assert.deepEqual(logic.body({ ...base, kind: "outpaint", direction: "horizontal", padding: "128" }).params.pads, [128, 0, 128, 0]);
assert.deepEqual(logic.body({ ...base, kind: "outpaint", direction: "all", padding: "16" }).params.pads, [16, 16, 16, 16]);
assert.throws(() => logic.body({ ...base, kind: "outpaint", direction: "bad", padding: "32" }), /direction/);
assert.throws(() => logic.body({ ...base, kind: "outpaint", direction: "left", padding: "0" }), /padding/);
assert.deepEqual(logic.body({ ...base, kind: "edit", instruction: "  preserve the composition  ", channel: "  local  " }).params, { instruction: "preserve the composition", channel: "local", prompt: "details", negative: "blur", denoise: 0.7, seed: 42 });
assert.throws(() => logic.body({ ...base, kind: "edit", instruction: "  " }), /instruction/);
assert.equal(logic.workflow({ id: "ok", edits: { inpaint: { enabled: true } } }, "inpaint"), true);
assert.equal(logic.workflow({ id: "disabled", edits: { inpaint: { enabled: false } } }, "inpaint"), false);
assert.equal(logic.workflow({ id: "cloud", edits: {} }, "edit"), true);
assert.equal(logic.workflow({ id: "unbound", binding_required: true, edits: { inpaint: { enabled: true } } }, "inpaint"), false);
assert.deepEqual(logic.results({ takes: [
  { id: "source", parent_take_id: null },
  { id: "candidate", parent_take_id: "source", edits: [{ kind: "inpaint" }] },
  { id: "other", parent_take_id: "source", edits: [{ kind: "qa" }] },
] }).map((take) => take.id), ["candidate"]);
console.log("panel-retouch: edit payload, outpaint directions, profiles, and validation passed");
