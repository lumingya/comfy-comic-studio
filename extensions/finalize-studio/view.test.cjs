const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

function harness() {
  const styleValues = new Map();
  const nodes = [
    { dataset: { i18n: "heading" }, textContent: "" },
    { dataset: { i18n: "submit" }, textContent: "" },
    { dataset: { i18nAlt: "beforeAlt" }, alt: "" },
    { dataset: { i18nPlaceholder: "jobPlaceholder" }, placeholder: "" },
  ];
  const document = {
    documentElement: {
      lang: "",
      style: {
        colorScheme: "",
        setProperty(key, value) {
          styleValues.set(key, value);
        },
        removeProperty(key) {
          styleValues.delete(key);
        },
      },
    },
    querySelectorAll(selector) {
      if (selector === "[data-i18n]") return nodes.filter((node) => node.dataset.i18n);
      if (selector === "[data-i18n-alt]") return nodes.filter((node) => node.dataset.i18nAlt);
      if (selector === "[data-i18n-placeholder]")
        return nodes.filter((node) => node.dataset.i18nPlaceholder);
      return [];
    },
  };
  const window = {};
  vm.runInNewContext(fs.readFileSync(__dirname + "/view.js", "utf8"), {
    document,
    window,
  });
  return { view: window.MioFinalizeView, document, nodes, styleValues };
}

const { view, document, nodes, styleValues } = harness();
view.apply({
  locale: "en",
  theme: "dark",
  tokens: { accent: "#abcdef", "--text": "#fefefe" },
});
assert.equal(document.documentElement.lang, "en");
assert.equal(document.documentElement.style.colorScheme, "dark");
assert.equal(nodes[0].textContent, "Finalize selected drafts");
assert.equal(nodes[1].textContent, "Finalize selected images");
assert.equal(nodes[2].alt, "Original draft before finalization");
assert.equal(nodes[3].placeholder, "Paste an existing job ID to resume tracking");
assert.equal(styleValues.get("--accent"), "#abcdef");
assert.equal(styleValues.get("--text"), "#fefefe");
view.apply({ locale: "zh-CN", theme: "light", tokens: { accent: "#123456" } });
assert.equal(document.documentElement.lang, "zh-CN");
assert.equal(nodes[0].textContent, "成品精修");
assert.equal(styleValues.get("--accent"), "#123456");
assert.equal(styleValues.has("--text"), false);
console.log("finalize-studio view: locale and live theme appearance passed");
