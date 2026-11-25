const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "mio-extension.json"), "utf8"));
assert.equal(manifest.id, "panel-retouch");
assert.equal(manifest.main, undefined, "the sandbox package must not execute Python");
assert.equal(manifest.workspace, undefined, "the package must not request a same-origin workspace");
assert.equal(manifest.contributes.panels.length, 1);
const panel = manifest.contributes.panels[0];
assert.equal(panel.id, "retouch");
assert.equal(panel.entry, "index.html");
assert.equal(panel.slot, "episode");
assert.equal(panel.title, "单格精修");
assert.deepEqual(panel.requests, [
  { id: "series", method: "GET", path: "/series", scope: "read" },
  { id: "episodes", method: "GET", path: "/series/{series_id}/episodes", scope: "read" },
  { id: "episode", method: "GET", path: "/episodes/{episode_id}", scope: "read" },
  { id: "profiles", method: "GET", path: "/profiles", scope: "read" },
  { id: "image", method: "GET", path: "/episodes/{episode_id}/takes/{take_id}/image", scope: "read", response: "image" },
  { id: "edit", method: "POST", path: "/episodes/{episode_id}/edit", scope: "render" },
  { id: "jobs", method: "GET", path: "/jobs", scope: "read" },
  { id: "job", method: "GET", path: "/jobs/{job_id}", scope: "read" },
  { id: "cancel", method: "POST", path: "/jobs/{job_id}/cancel", scope: "render" },
  { id: "adopt", method: "POST", path: "/episodes/{episode_id}/takes/{take_id}/adopt", scope: "write" },
  { id: "upload-mask", method: "POST", path: "/assets", scope: "write", input: "image" },
]);
for (const file of [panel.entry, "workspace.js", "logic.js", "mask.js", "jobs.js", "app.js", "panel.css"]) {
  assert.ok(fs.statSync(path.join(root, file)).isFile(), `${file} is required by the package`);
}
const source = ["app.js", "jobs.js", "workspace.js"].map((file) => fs.readFileSync(path.join(root, file), "utf8")).join("\n");
assert.doesNotMatch(source, /\bfetch\s*\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon/, "the sandbox must use declared panel requests");
const html = fs.readFileSync(path.join(root, panel.entry), "utf8");
assert.doesNotMatch(html, /<script\b(?![^>]*\bsrc=)[^>]*>/i, "the package uses local script assets");
assert.doesNotMatch(html, /https?:\/\//i, "the sandbox must not load remote assets");
console.log("panel-retouch: declarative sandbox manifest, eleven reviewed requests and local assets passed");
