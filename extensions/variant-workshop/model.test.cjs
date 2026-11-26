const { readFileSync } = require("node:fs");
const vm = require("node:vm");
const { test } = require("node:test");
const assert = require("node:assert/strict");
vm.runInThisContext(readFileSync(`${__dirname}/model.js`, "utf8"));

const work = () => ({
  variables: { character: "original", outfit: "original outfit", scene: "original scene", style: "original style" },
  bible: {
    styles: [{ id: "ink", name: "Ink" }, { id: "paper", name: "Paper" }],
    characters: [
      { id: "hero", name: "Hero", age: 24, tag_description: ["black hair"], outfits: { default: ["coat"], party: ["suit"] } },
      { id: "other", name: "Other", age: 30, tag_description: ["silver hair"], outfits: { default: ["jacket"] } },
    ],
    locations: [{ id: "room", name: "Room", tags: ["room"] }, { id: "park", name: "Park", tags: ["trees"] }],
  },
});
const board = (raw = true) => ({ panels: [{ id: "p", overrides: { raw_prompt: raw ? "{character}, {outfit}, {scene}, {style}" : null }, characters: [{ character_id: "hero", outfit: "default" }], location_id: "room" }], takes: [] });
const presets = () => ["a", "b"].map((id) => ({ id, title: `Preset ${id}`, entries: variantModel.axes.map((axis) => ({ key: axis, value: `${axis}-${id}` })) }));
const selection = () => ({ mode: "presets", character: ["a", "b"], outfit: ["a", "b"], scene: ["a", "b"], style: ["a", "b"], prefix: "Batch" });
const derive = (source = work(), episode = board(), config = selection(), choices = presets()) => {
  let index = 0;
  return variantModel.derive(source, episode, choices, config, () => `v${index++}`);
};

test("real preset entries create a distinct four-axis Cartesian matrix without changing frozen work", () => {
  const series = work(), episode = board(), choices = presets();
  const before = structuredClone([series, episode, choices]);
  const variants = derive(series, episode, selection(), choices);
  assert.equal(variants.length, 16);
  assert.equal(new Set(variants.map((variant) => variant.id)).size, 16);
  assert.equal(new Set(variants.map((variant) => JSON.stringify(variant.variables))).size, 16);
  for (const variant of variants) {
    assert.deepEqual(Object.keys(variant.variables).sort(), variantModel.axes.slice().sort());
    assert.deepEqual(variant.characters, {});
    assert.deepEqual(variant.locations, {});
  }
  variants[0].variables.outfit = "modified";
  assert.deepEqual([series, episode, choices], before);
});

test("each Bible axis affects its actual native field and outfit never comes from the character axis", () => {
  const variants = derive(work(), board(false), { mode: "bible", character: ["hero", "other"], outfit: [JSON.stringify(["hero", "default"]), JSON.stringify(["other", "default"])], scene: ["room", "park"], style: ["ink", "paper"], targetCharacter: "hero", targetOutfit: "default", targetLocation: "room" });
  assert.equal(variants.length, 16);
  assert.deepEqual(variants[0].outfits, { hero: { default: ["coat"] } });
  assert.equal("outfits" in variants[0].characters.hero, false);
  assert.equal("id" in variants[0].characters.hero, false);
  assert.equal("age" in variants[0].characters.hero, false);
  assert.deepEqual(variants[2].locations.room.tags, ["trees"]);
  assert.equal(variants[1].style_id, "paper");
});

test("empty values clear, unselected axes inherit, duplicate IDs and equal combinations do not multiply", () => {
  const choices = presets();
  choices[0].entries.find((entry) => entry.key === "outfit").value = "";
  let variants = derive(work(), board(), { mode: "presets", outfit: ["a", "a"] }, choices);
  assert.equal(variants.length, 1);
  assert.deepEqual(variants[0].variables, { outfit: "" });
  choices[1].entries = structuredClone(choices[0].entries);
  variants = derive(work(), board(), { mode: "presets", outfit: ["a", "b"] }, choices);
  assert.equal(variants.length, 1);
  assert.throws(() => derive(work(), board(), { mode: "presets" }), /at least/);
});

test("missing targets, invalid bindings, unused variables and overlarge matrices fail closed", () => {
  assert.throws(() => derive(work(), board(), { mode: "presets", character: ["missing"] }), /changed/);
  assert.throws(() => derive(work(), board(false), { mode: "bible", character: ["other"] }), /character/);
  assert.throws(() => derive(work(), board(false), { mode: "bible", scene: ["park"] }), /location/);
  assert.throws(() => derive(work(), board(false), { mode: "bible", outfit: [JSON.stringify(["hero", "default"])], targetCharacter: "hero", targetOutfit: "missing" }), /slot/);
  assert.throws(() => derive(work(), board(false), { mode: "presets", style: ["a"] }), /not used/);
  assert.throws(() => derive(work(), board(), { mode: "presets", character: ["a"], outfit: ["a"], bindings: { ...variantModel.keys, outfit: "character" } }), /different/);
  const many = Array.from({ length: 3 }, (_, i) => ({ id: `${i}`, title: `${i}`, entries: variantModel.axes.map((axis) => ({ key: axis, value: `${axis}-${i}` })) }));
  assert.throws(() => derive(work(), board(), { mode: "presets", character: ["0", "1", "2"], outfit: ["0", "1", "2"], scene: ["0", "1", "2"] }, many), /24/);
  assert.equal(derive(work(), board(), { mode: "presets", character: ["0", "1", "2"], outfit: ["0", "1"], scene: ["0", "1"], style: ["0", "1"] }, many).length, 24);
});

test("custom preset variables follow nested references and local overrides are visibly excluded", () => {
  const series = work(), episode = board();
  series.variables.composite = "{costume}";
  episode.panels[0].overrides.raw_prompt = "{composite}";
  const choices = [{ id: "custom", title: "Custom", entries: [{ key: "costume", value: "silk" }] }];
  const config = { mode: "presets", outfit: ["custom"], bindings: { ...variantModel.keys, outfit: "costume" } };
  assert.deepEqual(derive(series, episode, config, choices)[0].variables, { costume: "silk" });
  episode.panels[0].overrides.values = { $costume: "local" };
  assert.throws(() => derive(series, episode, config, choices), /not used/);
  episode.panels[0].overrides.values = {};
  episode.panels[0].overrides.raw_prompt = "{{costume}}";
  assert.throws(() => derive(series, episode, config, choices), /not used/);
});

test("axis comparison fixes the other three axes instead of filtering all patched variants", () => {
  const variants = derive();
  for (const axis of variantModel.axes) {
    const matching = variantModel.variantsForDimension(variants, axis, variants[0]);
    assert.equal(matching.length, 2);
    for (const variant of matching) for (const other of variantModel.axes.filter((item) => item !== axis)) assert.equal(variant.variables[other], variants[0].variables[other]);
  }
  assert.equal(variantModel.variantsForDimension(variants, "all").length, 16);
  assert.throws(() => variantModel.variantsForDimension(variants, "unknown"), /Unknown/);
});

test("candidate selection and estimates preserve panel/variant isolation and exact bounds", () => {
  const episode = { takes: [{ id: "original", panel_id: "p" }, { id: "variant", panel_id: "p", variant_id: "v" }, { id: "other", panel_id: "q", variant_id: "v" }] };
  assert.deepEqual(variantModel.candidates(episode, "p", null).map((item) => item.id), ["original"]);
  assert.deepEqual(variantModel.candidates(episode, "p", "v").map((item) => item.id), ["variant"]);
  assert.equal(variantModel.estimate(12, 16, 3), 576);
  assert.equal(variantModel.estimate(0, 4, 3), 0);
  assert.throws(() => variantModel.estimate(12, 4, 17), /Invalid/);
  assert.throws(() => variantModel.estimate(1.5, 4, 1), /integers/);
  assert.throws(() => variantModel.estimate(Number.MAX_SAFE_INTEGER, 2, 1), /Invalid/);
});
