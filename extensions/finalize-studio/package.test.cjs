const assert = require("node:assert/strict");
const fs = require("node:fs");

const root = __dirname;
const manifest = JSON.parse(fs.readFileSync(`${root}/mio-extension.json`, "utf8"));
assert.equal(manifest.id, "finalize-studio");
assert.equal(manifest.main, undefined);
assert.equal(manifest.contributes.panels.length, 1);
const panel = manifest.contributes.panels[0];
assert.equal(panel.slot, "episode");
assert.equal(panel.entry, "panel.html");
const requests = new Map(panel.requests.map((request) => [request.id, request]));
for (const [id, method, path, scope, response] of [
  ["episode", "GET", "/episodes/{episode_id}", "read"],
  ["profiles", "GET", "/profiles", "read"],
  ["image", "GET", "/episodes/{episode_id}/takes/{take_id}/image", "read", "image"],
  ["finalize", "POST", "/episodes/{episode_id}/finalize", "render"],
  ["adopt", "POST", "/episodes/{episode_id}/takes/{take_id}/adopt", "write"],
  ["jobs", "GET", "/jobs", "read"],
  ["job", "GET", "/jobs/{job_id}", "read"],
  ["cancel", "POST", "/jobs/{job_id}/cancel", "render"],
]) {
  assert.deepEqual(requests.get(id), {
    id,
    method,
    path,
    scope,
    ...(response ? { response } : {}),
  });
}
const html = fs.readFileSync(`${root}/panel.html`, "utf8");
for (const id of ["load", "all", "submit", "job-progress", "result", "compare-range", "rollback"])
  assert.match(html, new RegExp(`id="${id}"`));
assert.match(html, /id="compare-range"[^>]*type="range"/);
assert.match(html, /aria-live="polite"/);
const logic = fs.readFileSync(`${root}/logic.js`, "utf8");
const panelScript = fs.readFileSync(`${root}/panel.js`, "utf8");
assert.match(logic, /status === "adopted" && take\.stage === "draft"/);
assert.match(panelScript, /logic\.rollbackSource/);
assert.match(panelScript, /api\.request\("adopt"/);
const css = fs.readFileSync(`${root}/panel.css`, "utf8");
assert.match(css, /var\(--accent,/);
assert.match(css, /@media \(max-width: 700px\)/);
assert.match(fs.readFileSync(`${root}/bridge.js`, "utf8"), /mio:panel:appearance/);
console.log("finalize-studio package: manifest, API scopes, responsive controls and rollback contract passed");
