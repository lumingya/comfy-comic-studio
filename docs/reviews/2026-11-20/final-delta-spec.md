# Final delta requirement-completeness review - 2026-11-20

Reviewer: `backend_gap_audit`. Review input was HEAD `29c4caa` plus the current uncommitted
integration and `docs/reviews/2026-11-20/README.md`. The requirement source is the user's
`ai_studio_code.txt`: three waves of ten deliverables covering the extensible generation base,
storyboard and LoRA controls, six album templates and reader, generic API/SDK, and acceptance.

This pass reviewed requirement completeness, emphasizing the latest saved workflow defaults,
SDK catalog additions, inspection behavior and recorded live acceptance. Production remained
read-only. This reviewer owns only this report for this pass. No personal data, network,
running services, real generation or full test suite was accessed or invoked.

## Standards axis

No new actionable documented-standard violation was established in the inspected delta. The
saved-default component edits keyed configuration rather than the workflow graph; the SDK
continues to separate handwritten helpers from generated operations. Discovery exposes public
channel identifiers without endpoints, credentials or extension options. The inspection change
retains pure offline analysis and does not execute a workflow to discover controls.

The acceptance index explicitly records the actual limit of three simultaneous child agents
and the later use of exclusive file ownership. It does not claim ten-way concurrency or ten
worktree merges. This operational difference is already disclosed and is not a new product-code
finding.

## Spec axis

No material missing product deliverable was established by this bounded final review. The
30-task matrix identifies implementations and relevant regressions for all three waves. Focused
source checks support the latest additions and representative cross-feature requirements:

| Requirement | Observed implementation and evidence |
| --- | --- |
| Persist workflow-level LoRA defaults and retain values while off | `WorkflowEditor.tsx` mounts `WorkflowDefaultLoras`; edits preserve unrelated slot settings and save through the existing workflow PATCH. The three independent-run UI regressions verify keyed on/off plus model/CLIP values, saved-response cancel behavior, saved-default reset, graph immutability and returning to a clean draft. |
| Discover everything an external caller needs | `_runtime.py:discover_studio` returns paged storyboard summaries, presets, workflows, full per-workflow LoRA controls, templates, image adapters and selectable configured channel IDs. `/image-channels` supplies the missing IDs with read scope and omits endpoints/options/secrets. The SDK integration creates resources, selects a LoRA control, starts/adopts a task and saves all four formats synchronously and asynchronously. |
| Inspect imported controls even when execution needs frontend state | `inspection.py:inspect` calls `slot_adapters.describe` before compilation. Its focused regression imports a graph requiring an absent parameter-panel snapshot, retains `importable=True`, reports the compile error and still returns the discovered LoRA row. |
| Stable, pluggable LoRA behavior | `slot_adapters.py` dispatches extension codecs before generic built-ins and describes stable row keys, provenance, independent-toggle support and ranges. SDK validation proves an individual off selection reaches frozen compilation without modifying the saved graph. The matrix names separate five-codec, topology and lifecycle suites rather than presenting one generic mock as all those cases. |
| Storyboard daily controls | The editor delegates the sortable frame list, selection/draft coordination, frame editor and variable preview. Focused reads confirm pointer/keyboard drag sensors, empty/variable filters and keyword search, progress, and marked missing/empty variable values. The index references normal/stress suites and actual keyboard-drag evidence. |
| Six templates and the common offline reader | The template contract contains six new layouts and retains formatVersion 1. Runtime code includes idle controls, directory, spread mode, palette changes, fullscreen, keyboard, touch, reduced-motion and parent messages. The index distinguishes the automated 13-by-eight matrix from actual browser execution of the six new templates. |
| Generic resource/task/deliverable closure | Shared local/v2 operations expose resource CRUD, idempotent task creation and conditional render authorization. Deliverables report adopted/generated readiness and submit the four async export kinds; the SDK also uses existing synchronous routes. Existing platform-specific client files remain consumers, rather than new specialized core endpoints. |

The live-acceptance document records actual Chrome at 1280x800 and 390x844, six templates at
both sizes, keyboard drag, LoRA value retention and the export-preview sandbox. It records
one neutral selected base output from the 138-node ComfyUI workflow, all 43 user LoRAs disabled,
and unchanged original graph and parameter states. This pass reviewed that evidence document
without reopening its private temporary artifacts or re-running the service. The report does
not extend those observations to full upscaling, every branch, paid channels or GPU execution
of user LoRAs.

## Earlier repair handoff

Focused current reads and the existing independent probes show no regression of OF1-OF3:
bundle members still map decompressor errors to domain client errors inside one outer store
transaction; restore/purge still use operation-lock-before-store ordering; and legacy album
and complete-import batches still use composable outer transactions. The token activity path
still performs a conditional existing-row update by ID and secret hash, rather than replacing
or recreating the token record. Its scope-change/rotated-credential regression passes.

## Verification and boundary

- Seven focused Python test methods passed in 8.376 seconds: image-channel discovery,
  inspection with missing frontend state, the SDK complete workflow, three independent
  OF1-OF3 boundary probes, and conditional token activity updates. The SDK method includes
  eight synchronous/asynchronous format combinations; the boundary probes include three
  compression backends and four restore-first concurrency combinations.
- `npm --prefix web test -- --run src/pages/settings/WorkflowDefaultLoras.test.tsx` passed
  all three tests; Vitest reported 3.29 seconds total.
- No new production or test changes were needed for this pass.

The root owns the final clean-data release/package gate and the final ledger/commit/push
update, which were explicitly still pending in the reviewed acceptance index. These pending
integration actions are not reported as product-code bugs. This review does not claim a
second independent execution of every historical matrix entry or absence of defects outside
the inspected paths.
