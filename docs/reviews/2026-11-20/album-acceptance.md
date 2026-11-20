# Album acceptance matrix · 2026-11-20

Ownership: `server/tests/test_album_matrix.py`,
`web/src/test/album-reader-matrix.test.ts`, and this report only. Production changes belong to
the integrating agent. Tests use synthetic neutral images and isolated jsdom iframe documents;
they do not read personal data, contact providers, or install browsers.

## Backend evidence

- 13 built-in templates × 8 datasets = 104 independent rendered cases: single frame, four frames,
  twelve frames, missing frames, mixed image ratios, long bilingual titles, hostile text, and
  two-book collections. The old seven and new six are selected from the real built-in loader.
- Every case checks the complete CSP, one policy, exactly two script elements (the exact trusted
  runtime with its matching nonce and inert metadata), no external resource URLs/event handlers,
  no raw injected SVG/script elements, no unresolved template loops, and unchanged input objects.
- `mio.album-html.v1` is parsed as JSON and images are resolved through the emitted asset keys.
  Text, dimensions, decoded image sizes, missing-image placeholders, step order and book boundaries
  must match the source. This proves exported interchange semantics, not a separate importer UI.
- Two additional cases verify fresh nonces and custom-template variables: cover, synopsis,
  signature, palettes, `frameIndex` (one-based), `total`, and `progress` (ratio in `(0, 1]`).

Command: `python -m unittest discover -s server/tests -t server -p test_album_matrix.py -q`.
Result: **106 passed**. Ruff check and formatting pass for the owned Python file.

## Reader evidence

The new jsdom suite exercises all ten layout identifiers. It checks odd chapter boundaries,
responsive single/double paging, template mode, keyboard boundaries and editable-control
exclusions; lazy directory creation, current marker and focus restoration; idle controls;
fullscreen entry/exit/denial; swipe thresholds, multitouch/vertical/interactive/cancel exclusions;
post-swipe click suppression; zoom and lightbox gesture isolation; inert-state restoration;
immersive captions; reduced motion; and parent-only message commands, bounded restoration and
state reports. Existing `album-reader.test.ts` remains an independent companion suite.

Command: `npm --prefix web test -- src/test/album-reader-matrix.test.ts`.
Result: **19 passed**. Frontend TypeScript strict checking passes; both new source files pass
their format checks, UTF-8 guard, and `git diff --check`.

An initial directory test expected the native `loading` property to reflect to an HTML attribute.
jsdom does not implement that reflection. The assertion now checks `HTMLImageElement.loading`
directly, which is the production operation, while still requiring all five lazy thumbnails.
This was a test-environment mismatch; no production defect was hidden or changed.

This suite verifies DOM behavior and contracts. It does not prove browser layout, real touch
hardware, fullscreen permissions in a live embed, image decode quality, or compositor motion.
Those remain part of the root agent's separate installed-browser visual acceptance.
