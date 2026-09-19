import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
const context = vm.createContext({ console });
vm.runInContext(
  fs.readFileSync("js/workflow-mapping.js", "utf8") +
    "\nglobalThis.core=WorkflowMapping;",
  context,
);
const core = context.core,
  plain = (x) => JSON.parse(JSON.stringify(x));
const fixtures = JSON.parse(
  fs.readFileSync("tests/fixtures/workflow_mapping_contract.json"),
);
for (const f of fixtures) {
  const before = JSON.stringify(f.workflow),
    options = f.options || {};
  const run = () =>
    core.compile(
      f.workflow,
      f.bindings.filter(
        (b) => b.source !== "sceneParameter" || options.renderOverride,
      ),
      {
        objectInfo: options.objectInfo || {},
        outputNodeId: options.outputNodeId || "",
        resolve(b) {
          if (b.source === "variable")
            return options.variables?.[b.value] ?? core.SKIP;
          if (b.source === "sceneParameter") return options[b.value];
          if (b.source === "positive") return "prompt";
          return b.value;
        },
      },
    );
  if (f.error) assert.throws(run, undefined, f.name);
  else {
    const result = plain(run());
    if (f.unchangedWorkflow) assert.deepEqual(result.workflow, f.workflow);
    for (const [k, v] of Object.entries(f.expectedInputs))
      assert.deepEqual(result.workflow.n.inputs[k], v, f.name);
    assert.deepEqual(
      result.workflow.up,
      f.workflow.up,
      f.name + " preserves unknown nodes",
    );
  }
  assert.equal(
    JSON.stringify(f.workflow),
    before,
    f.name + " never mutates blueprint",
  );
  console.log("PASS " + f.name);
}
const schema = {
  CustomNode: {
    input: {
      required: {
        scalar: ["INT", { min: 1, max: 10 }],
        enabled: ["BOOLEAN"],
        text: ["STRING"],
        mode: [["a", "b"]],
      },
    },
  },
};
for (const [path, value] of [
  ["/scalar", 1.5],
  ["/scalar", 11],
  ["/scalar", "5"],
  ["/enabled", "true"],
  ["/text", 2],
  ["/mode", "c"],
])
  assert.throws(() =>
    core.validateSchema({ class_type: "CustomNode" }, path, value, schema),
  );
assert.equal(core.samePath("text", "/text"), true);
assert.equal(core.samePath("/a~1b", "/a/b"), false);
console.log(`${fixtures.length} shared mapping fixtures + schema checks PASS`);
