const { readFileSync } = require("node:fs");
const vm = require("node:vm");
const { test } = require("node:test");
const assert = require("node:assert/strict");
vm.runInThisContext(readFileSync(`${__dirname}/model.js`, "utf8"));

const work = () => ({
  bible: {
    styles: [
      { id: "ink", name: "墨" },
      { id: "paper", name: "纸" },
    ],
    characters: [
      { id: "hero", name: "主角", age: 24, description: "原版" },
      {
        id: "blue",
        name: "蓝衣",
        age: 30,
        appearance: ["blue coat"],
        tag_description: ["blue"],
        loras: [],
      },
    ],
  },
});

test("cross product creates native variants without changing source or character identity", () => {
  const series = work(),
    before = structuredClone(series);
  let count = 0;
  const variants = variantModel.derive(
    series,
    ["ink", "paper"],
    ["hero", "blue"],
    "hero",
    "本轮",
    () => `var_${++count}`,
  );
  assert.equal(variants.length, 4);
  assert.equal(new Set(variants.map((v) => v.id)).size, 4);
  assert.equal(variants[1].style_id, "ink");
  assert.deepEqual(variants[1].characters.hero.appearance, ["blue coat"]);
  assert.equal("id" in variants[1].characters.hero, false);
  assert.equal("name" in variants[1].characters.hero, false);
  assert.equal("age" in variants[1].characters.hero, false);
  variants[1].characters.hero.appearance.push("changed");
  assert.deepEqual(series, before);
});

test("unknown preset or target is rejected; omitted choices inherit", () => {
  assert.throws(
    () => variantModel.derive(work(), ["missing"], [], "", ""),
    /重新读取/,
  );
  assert.throws(
    () => variantModel.derive(work(), [], ["missing"], "hero", ""),
    /重新读取/,
  );
  assert.throws(
    () => variantModel.derive(work(), [], ["blue"], "", ""),
    /替换外观/,
  );
  const [variant] = variantModel.derive(
    work(),
    [],
    [],
    "",
    "",
    () => "var_plain",
  );
  assert.deepEqual(variant, {
    id: "var_plain",
    name: "新版本",
    characters: {},
    style_id: null,
    profile_id: null,
  });
});

test("candidate comparison never mixes another frame or variant with the original", () => {
  const episode = {
    takes: [
      { id: "original", panel_id: "p" },
      { id: "variant", panel_id: "p", variant_id: "v" },
      { id: "other", panel_id: "q", variant_id: "v" },
    ],
  };
  assert.deepEqual(
    variantModel.candidates(episode, "p", null).map((v) => v.id),
    ["original"],
  );
  assert.deepEqual(
    variantModel.candidates(episode, "p", "v").map((v) => v.id),
    ["variant"],
  );
  assert.deepEqual(
    variantModel.candidates(episode, "p", "*").map((v) => v.id),
    ["original", "variant"],
  );
});

test("render estimate reports exact matrix volume and validates limits", () => {
  assert.equal(variantModel.estimate(12, 4, 3), 144);
  assert.equal(variantModel.estimate(0, 4, 3), 0);
  assert.throws(() => variantModel.estimate(12, 4, 17), /无效/);
  assert.throws(() => variantModel.estimate(1.5, 4, 1), /整数/);
});

test("comparison dimension selects style and character-look variants", () => {
  const variants = [
    { id: "base", style_id: null, characters: {} },
    { id: "style", style_id: "ink", characters: {} },
    { id: "look", style_id: null, characters: { hero: { appearance: "coat" } } },
    { id: "both", style_id: "paper", characters: { hero: { appearance: "hat" } } },
  ];
  assert.deepEqual(variantModel.variantsForDimension(variants, "style").map((v) => v.id), ["style", "both"]);
  assert.deepEqual(variantModel.variantsForDimension(variants, "appearance").map((v) => v.id), ["look", "both"]);
  assert.deepEqual(variantModel.variantsForDimension(variants, "all").map((v) => v.id), ["base", "style", "look", "both"]);
  assert.throws(() => variantModel.variantsForDimension(variants, "unknown"), /未知/);
});
