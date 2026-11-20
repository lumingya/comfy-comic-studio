# Final independent frontend adversarial review

Reviewed baseline `0c948c5` against current `main` (`622e03d`) plus the staged,
unstaged and new frontend/reader files present on 2026-11-20. This is a fresh
source review, not a repetition of the earlier review conclusions. Ownership is
this report only; no production code, generated artifacts or personal data were
modified. The root agent owns fixes and the final combined verification run.

## Standards

No additional P0-P2 documented-standard violation was found in the inspected
frontend modules. Storyboard responsibilities are split into the editor,
frame-list, frame editor, menus and mutation hook; the existing autosave and
selection primitives remain in use. LoRA patches are keyed and sparse, and
extension options preserve JSON structure. Tool-enforced formatting, types and
whole-repository file-size cleanup were not re-run or reclassified as review
findings while the root's full verification was running.

## Spec

### P2: A wrapping artwork button opens the lightbox twice and leaves the reader inert

- Source: `server/mio_server/album/runtime_lightbox.js:63-81,85-101`.
- Trigger: a valid third-party template wraps its artwork in an explicit trigger,
  for example `<button data-ag-view><img src="{{image}}"></button>` inside a
  `data-cc-frame`. The image listener calls `open()`, and the same click bubbles
  to the explicit trigger listener and calls `open()` again.
- Effect: the second call records the already locked `overflow: hidden` and
  replaces `background` with an empty array because the first call already made
  every background element inert. Closing the lightbox leaves the whole album
  and control bar inert and scrolling locked. This breaks the taskbook's generic
  third-party-template support and reversible immersive lightbox requirement.
- Evidence: an isolated, read-only Node/jsdom probe loaded the actual current
  `runtime_lightbox.js` and `runtime.js`, clicked this wrapping image, then clicked
  close. Its final state was
  `{"hidden":true,"articleInert":true,"controlsInert":true,"overflow":"hidden"}`.
  The existing shipped afterglow trigger is a sibling button, so that fixture
  does not exercise the wrapping-trigger path.
- Minimal fix: make `open()` idempotent while already open, or prevent duplicate
  image/ancestor-trigger handling. Add a wrapper-trigger regression that closes
  the lightbox and checks background inertness, scroll restoration and focus.

### P2: Extension lifecycle changes leave trial LoRA controls permanently cached

- Sources: `web/src/api/open.ts:281-316` and
  `web/src/pages/settings/WorkflowTrial.tsx:73-90`.
- Trigger: open a workflow trial once, close it, enable or disable an extension
  contributing `comfy_lora_adapter`, then return and open the same trial. This
  changes slot recognition or control capabilities without saving the workflow.
- Evidence: the trial's `keys.workflowLoras(workflowId)` query uses
  `staleTime: Infinity`. `useExtensionAction()` invalidates the registry, image
  adapter discovery, templates and extension lists, but does not invalidate the
  `['workflow-loras']` family. A remounted or re-enabled trial therefore reuses
  its fresh cached controls. The workflow-save path does invalidate that query;
  extension lifecycle is a separate, currently omitted path.
- Effect: the trial can keep showing and submitting a disabled adapter's old
  stable keys or hide a newly enabled adapter's controls. This conflicts with
  the taskbook requirement that adapters be installable and removable without
  core edits and that disabling restores the core control surface.
- Minimal fix: invalidate `['workflow-loras']` when extension lifecycle actions
  finish; also invalidate workflow detail/summary queries whose responses embed
  adapter-derived control metadata. Add an enable/disable-to-trial regression
  that requires a new control request and the updated keys/capabilities.

## Inspected boundaries and limits

- Read current drag/drop ordering, filtering, autosave serialization, batch
  delete/undo, and the 120-frame stress acceptance cases. The order mutation
  flushes drafts, uses all IDs and rejects an intervening order change. No new
  P0-P2 issue was confirmed in those paths.
- Read task and frame LoRA controls, sparse inheritance patches, workflow
  trial request retention, workflow-save invalidation, the split channel fields
  and JSON option editor, and the corresponding regression cases. Earlier
  invalid-JSON and cancel/reset findings are fixed in current source.
- Read export cards, preview dialogs, template studio, reader keyboard/mobile
  controls, chapter boundaries, reduced motion, focus restoration and parent-only
  synchronization. The old report saying directory/swipe/fullscreen/progress
  are absent is obsolete: those implementations and DOM matrix tests now exist.
- The lightbox reproduction used synthetic markup and the already installed
  jsdom package. No browser, local service, provider call, paid API, real touch
  device or personal data was used. Existing acceptance reports were read as
  evidence, not claimed as newly executed tests. Visual quality, real pointer
  dragging and the final all-suite status remain with the root agent.

Findings at review time: **Standards 0 P0-P2; Spec 2 P2**.
