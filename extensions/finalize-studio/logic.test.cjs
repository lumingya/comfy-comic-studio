const assert = require("node:assert/strict");
require("./logic.js");
const logic = globalThis.MioFinalizeLogic;
const draft = { id: "draft", stage: "draft", status: "adopted" };
const episode = {
  takes: [
    draft,
    { id: "candidate", stage: "draft", status: "candidate" },
    { id: "final", stage: "final", status: "adopted", parent_take_id: "draft" },
  ],
};
const profile = {
  id: "profile",
  final: [
    { kind: "upscale", workflow_id: "up", enabled: true },
    { kind: "face", workflow_id: "face" },
  ],
};
assert.deepEqual(logic.eligible(episode), [draft]);
assert.deepEqual(logic.body(episode, ["draft", "draft"], profile, true), {
  take_ids: ["draft"],
  profile_id: "profile",
});
assert.throws(() => logic.body(episode, [], profile, true), /明确选择/);
assert.throws(
  () => logic.body(episode, ["candidate"], profile, true),
  /已采用/,
);
assert.throws(() => logic.body(episode, ["final"], profile, true), /已采用/);
assert.throws(() => logic.body(episode, ["draft"], profile, false), /确认/);
assert.throws(
  () =>
    logic.body(
      episode,
      ["draft"],
      { ...profile, binding_required: true },
      true,
    ),
  /已绑定/,
);
assert.throws(
  () =>
    logic.body(
      episode,
      ["draft"],
      { ...profile, final: [{ enabled: false }] },
      true,
    ),
  /有效/,
);
assert.equal(logic.comparisons(episode)[0].id, "final");
assert.deepEqual(
  logic.comparisons({
    takes: [{ id: "lost", stage: "final", parent_take_id: "absent" }],
  }),
  [],
);
assert.equal(logic.rollbackSource(episode, "final"), draft);
assert.equal(logic.rollbackSource(episode, "candidate"), null);
assert.equal(
  logic.rollbackSource(
    { takes: [{ id: "orphan", parent_take_id: "missing", stage: "final" }] },
    "orphan",
  ),
  null,
);
console.log(
  "finalize-studio: explicit selection, stages, consent, comparisons and rollback passed",
);
