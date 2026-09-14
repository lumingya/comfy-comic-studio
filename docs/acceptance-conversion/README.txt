Independent-file conversion verification — 2026-09-13

Scope: storage, offline converter, domain readback, and preserved existing import behavior.
NOT a release acceptance report for the new GUI/API architecture.

Executed:
- 17 controlled converter / passive SVG tests.
- 38 pre-existing file-library/settings/CLI regression tests.
- Full Python discovery: 264 total, 260 passed, 4 native-Windows launcher skips.
  Existing full-suite SQLite ResourceWarnings remain in the log; a passing result
  is not a claim that all existing code is warning-free.
- Delivered-baseline Chromium workflow: 9 checks, using the SHA-256-verified actual
  1.2.1 ZIP; old UI creates a plan, uploads an image variable and saves, then stops.
  Conversion preserves domain contents, original five layouts, image bytes and
  all source data file hashes.
- JS/HTML lint passed; 54 JavaScript contract checks passed.
- Current source storyboard import: 13 Chromium checks passed, including the
  previously fixed old-editor/new-template ownership regression.
- Build passed; 41 offline documentation pages generated.

No generation request was submitted. A real worker opened the converted
execution database and remained held, without executing its provider callback.

Not verified: native Windows/macOS conversion, physical phones, real paid
providers, full new-format GUI startup/save/reader/editor/export integration.
No new complete application ZIP has been delivered. Keep the old data directory.
