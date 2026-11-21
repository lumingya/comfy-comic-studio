const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "mio-extension.json"), "utf8"));
assert.equal(manifest.id, "panel-retouch");
assert.equal(manifest.workspace.entry, "index.html");
assert.equal(manifest.workspace.title, "单格精修");
assert.equal(manifest.contributes, undefined);
for (const file of [manifest.main, manifest.workspace.entry, "workspace.js", "logic.js", "mask.js", "jobs.js", "app.js", "panel.css"]) {
  assert.ok(fs.statSync(path.join(root, file)).isFile(), `${file} is required by the package`);
}
const source = ["app.js", "jobs.js", "workspace.js"].map((file) => fs.readFileSync(path.join(root, file), "utf8")).join("\n");
for (const endpoint of [
  "series/", "profiles", "takes/", "/edit", "/adopt", "jobs?owner=", "/cancel", "/api/assets?filename=",
]) assert.ok(source.includes(endpoint), `API contract must include ${endpoint}`);
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
assert.doesNotMatch(html, /<script\b(?![^>]*\bsrc=)[^>]*>/i, "workspace CSP forbids inline scripts");
assert.doesNotMatch(html, /https?:\/\//i, "the workspace must not load remote assets");
console.log("panel-retouch: workspace manifest, local assets, and API contract passed");
