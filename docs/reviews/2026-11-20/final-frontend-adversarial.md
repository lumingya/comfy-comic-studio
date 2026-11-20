# Final independent frontend adversarial review

Reviewed baseline `0c948c5` against current `main` (`622e03d`) plus the staged,
unstaged and new frontend/reader files present on 2026-11-20. This is a fresh
source review, not a repetition of the earlier review conclusions. Ownership is
this report and the three new regression files named below; no production code,
generated artifacts or personal data were modified by this reviewer. The root
agent owns fixes and the final combined verification run.

Final status: **all three reported P2 issues were repaired by the root agent and
verified with six new regressions. No unresolved P0-P2 issue remains in this
review's inspected paths.** The original triggers and evidence remain below.

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

### P2: Reopening export preview can show artwork from before the latest adoption

- Source: `web/src/pages/works/ExportDrawer.tsx:39-64`.
- Trigger: open and close the new full-window export preview; adopt a different
  image in the same episode; reopen the preview within five minutes with the same
  template and export settings.
- Evidence: `ExportPreviewDialog` keys its query by the request body only and
  sets `staleTime: 5 * 60_000`. That body has no episode revision, and the parent
  drawer supplies no revision prop. Re-enabling a fresh query therefore reuses
  the previous exported HTML. By contrast, the existing main `TemplatePreview`
  includes the episode revision in its query key expressly to handle adoption.
- Effect: the export-before-download preview can disagree with the current
  artwork and the actual export. The taskbook requires a useful preview of the
  selected final album, not a previously rendered image set.
- Minimal fix: revalidate whenever this preview opens, or pass the episode
  revision through the drawer and include it in the query key. A regression
  should close the preview, change the mocked artwork response without changing
  body parameters, reopen it and require the new HTML.

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

## Repair verification

- Root made lightbox `open()` return immediately when the dialog is already
  open. `web/src/test/album-lightbox-wrapper.test.ts` contains two regressions:
  the actual image click bubbles through the wrapping button, then either the
  close button or Escape must restore the original overflow, non-inert reader
  and controls, original inert sibling and trigger focus. It also reopens and
  closes the lightbox a second time.
- Root added the workflow-LoRA, workflow-detail and workflow-summary query
  families to extension-action invalidation. `web/src/api/adapterCache.test.ts`
  contains three regressions using the real mutation hook and an inactive
  TanStack Query cache with `staleTime: Infinity`. Enable, disable and remove
  each require new requests and updated adapter-derived controls/metadata.
- Root changed export-preview freshness to `staleTime: 0`.
  `web/src/pages/works/ExportPreviewFreshness.test.tsx` mounts the real drawer,
  opens and closes the preview, changes the synthetic server artwork, then
  reopens with identical body parameters. It requires a second request and the
  updated iframe document.
- The first five regressions were run before the production patches and all
  failed on their exact reported conditions. After the three fixes, the full
  set of **3 files / 6 regressions passed** with:

  ```text
  npm --prefix web test -- --run src/test/album-lightbox-wrapper.test.ts src/api/adapterCache.test.ts src/pages/works/ExportPreviewFreshness.test.tsx
  ```

  New test files also pass their focused Prettier and whitespace checks. The
  root remains responsible for the final whole-repository test/type/build gates.

Findings at review time: **Standards 0 P0-P2; Spec 3 P2, all fixed and verified**.
