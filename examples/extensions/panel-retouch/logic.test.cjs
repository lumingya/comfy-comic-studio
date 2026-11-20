const assert = require("node:assert/strict");
require("./logic.js");
const logic = globalThis.MioRetouchLogic;
const base = {
  take_id: "take-a",
  profile_id: "profile-a",
  kind: "inpaint",
  mask: {
    boxes: [[0.1, 0.2, 0.5, 0.7]],
    polygons: [
      [
        [0.2, 0.2],
        [0.4, 0.2],
        [0.3, 0.4],
      ],
    ],
  },
  feather: "12",
  denoise: "",
  seed: "",
};
assert.deepEqual(logic.body(base), {
  take_id: "take-a",
  profile_id: "profile-a",
  kind: "inpaint",
  params: { ...base.mask, feather: 12 },
});
assert.throws(
  () => logic.body({ ...base, mask: { boxes: [], polygons: [] } }),
  /至少/,
);
assert.throws(
  () => logic.body({ ...base, mask: { boxes: [[0, 0, 2, 1]], polygons: [] } }),
  /坐标/,
);
assert.throws(
  () =>
    logic.body({ ...base, mask: { boxes: [[0.5, 0, 0.2, 1]], polygons: [] } }),
  /正的/,
);
assert.throws(
  () =>
    logic.body({
      ...base,
      mask: {
        boxes: [],
        polygons: [
          [
            [0, 0],
            [1, 1],
          ],
        ],
      },
    }),
  /顶点/,
);
assert.throws(
  () => logic.body({ ...base, kind: "outpaint", pads: [0, 0, 0, 0] }),
  /至少/,
);
assert.throws(
  () => logic.body({ ...base, kind: "outpaint", pads: [8, -1, 8, 0] }),
  /外扩/,
);
assert.deepEqual(
  logic.body({
    ...base,
    kind: "outpaint",
    pads: ["8", "0", "16", "0"],
    denoise: "0.7",
    seed: "42",
  }).params,
  { pads: [8, 0, 16, 0], denoise: 0.7, seed: 42 },
);
assert.deepEqual(
  logic.body({
    ...base,
    kind: "edit",
    instruction: "  preserve the quiet room  ",
    channel: "local",
  }).params,
  { instruction: "preserve the quiet room", channel: "local" },
);
assert.throws(
  () => logic.body({ ...base, kind: "edit", instruction: " " }),
  /修改指令/,
);
assert.throws(() => logic.body({ ...base, seed: "1.5" }), /整数/);
assert.throws(() => logic.body({ ...base, denoise: "NaN" }), /重绘强度/);
console.log(
  "panel-retouch: mask, outpaint, instruction and parameter validation passed",
);

async function testProfileSelection() {
  const vm = require("node:vm");
  const fs = require("node:fs");
  const elements = new Map();
  class Element {
    constructor() {
      this.value = "";
      this.options = [];
      this.listeners = {};
    }
    addEventListener(name, handler) {
      this.listeners[name] = handler;
    }
    toggleAttribute() {}
    replaceChildren(...options) {
      this.options = options;
      this.value = options[0]?.value ?? "";
    }
    add(option) {
      this.options.push(option);
      if (!this.value) this.value = option.value;
    }
  }
  const element = (id) => {
    if (!elements.has(id)) elements.set(id, new Element());
    return elements.get(id);
  };
  const stages = (enabled) =>
    Object.fromEntries(
      ["edit", "inpaint", "outpaint"].map((kind) => [
        kind,
        { kind, workflow_id: "test", enabled },
      ]),
    );
  const profiles = [
    { id: "enabled", name: "Enabled", edits: stages(true) },
    { id: "disabled", name: "Disabled", edits: stages(false) },
    { id: "missing", name: "Cloud fallback", edits: {} },
    {
      id: "implicit",
      name: "Enabled by default",
      edits: { edit: { kind: "edit", workflow_id: "test" } },
    },
    {
      id: "unbound",
      name: "Unbound",
      binding_required: true,
      edits: stages(true),
    },
  ];
  const context = { episode_id: "episode" };
  const api = {
    context,
    status() {},
    async episode() {
      return { takes: [], panels: [] };
    },
    async request() {
      return profiles;
    },
    async image() {},
    connect(callback) {
      callback(context);
    },
  };
  element("kind").value = "inpaint";
  vm.runInNewContext(fs.readFileSync(__dirname + "/panel.js", "utf8"), {
    document: { getElementById: element },
    Option: class {
      constructor(text, value) {
        this.text = text;
        this.value = value;
      }
    },
    window: {
      MioPanel: api,
      MioJobs: { onComplete() {}, async recent() {} },
      MioMaskEditor: class {
        clear() {}
      },
    },
  });
  await element("load").listeners.click();
  assert.deepEqual(
    element("profile").options.map((option) => option.value),
    ["enabled"],
  );
  element("kind").value = "edit";
  element("kind").listeners.change();
  assert.deepEqual(
    element("profile").options.map((option) => option.value),
    ["enabled", "missing", "implicit"],
  );
  element("kind").value = "outpaint";
  element("kind").listeners.change();
  assert.deepEqual(
    element("profile").options.map((option) => option.value),
    ["enabled"],
  );
  console.log(
    "panel-retouch: actual profile chooser rejects disabled local stages and preserves absent-edit cloud fallback",
  );
}
testProfileSelection().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
