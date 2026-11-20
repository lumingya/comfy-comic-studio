# Upgrade acceptance and review index

The task source is the user-provided `ai_studio_code.txt`. The implementation base is `0c948c5`. The tables below retain the requested three waves and distinguish implementation evidence from execution limits. Later dated reports supersede earlier review findings only when a regression or independent recheck is named.

## Wave 1

| Task | Current implementation and evidence |
|---|---|
| 01 · Slot extension contract | `workflow_slot_adapter` contract v1; five generic codecs in `comfy/builtin_slot_adapters.py`, common dispatch, registration/removal, stable keys and independent enabled state; `test_core_slot_dispatch.py`, `test_workflow_slot_adapters.py` |
| 02 · Compile, control surface, freeze | Detail/import/PATCH/inspection/compile/query expose controls. Default → task → panel merging reaches multi-stage/local/hybrid/final/edit and secondary profiles. UI-format errors share `ui_format`. Tests: workflow format, slot lifecycle, backend review and fresh recheck |
| 03 · Cloud plug-in base | Bounded JSON options, discoverable metadata and safe channel-ID catalog, frozen ordinary parameters with current credentials, retry/unknown-result behavior retained. Tests: providers, generation tasks, security review and channel discovery |
| 04 · Backend adversarial matrix | Five shapes, duplicate names, native-off rows, Switch/Mute/Bypass, custom codec lifecycle, 14 graph topologies and source immutability: topology/core/adapter suites; two offline extension examples |
| 05 · Album engine | Existing v1 format and seven templates retained; six layouts added; frame index/total/progress, cover/synopsis/signature/palette variables escape HTML and braces. All 13 templates × eight extreme datasets in `test_album_matrix.py` |
| 06 · Offline reader | Single nonce script, no external dependency, paged/spread/zoom/directory/progress/immersive/ambient/fullscreen/keyboard/swipe/reduced motion and parent protocol. Reader suites and actual Chrome 12-combination visual check |
| 07 · Album safety | Structural HTML parser, trusted nonce runtime, inert metadata, malformed-comment/meta-refresh rejection, image/multi-book/missing-image roundtrip. Album matrix, security fresh recheck, lightbox wrapper tests |
| 08 · Generic resource API | Workflow LoRA summary/query, paged storyboard summaries/detail/create/PATCH, preset list/detail/create/PATCH; shared local/v2 operations and scope. API/workshop tests and permission audit |
| 09 · Task and deliverable API | One-shot idempotent assembly/start/adopt; write/render conditional permission before mutation; readiness query and four async formats, existing synchronous download paths. `test_workshop_flow.py` |
| 10 · Full caller lifecycle | Real isolated FastAPI, fake execution, scoped tokens, concurrent replay/conflicts and all four outputs in workshop-flow and SDK-flow integration suites |

## Wave 2

| Task | Current implementation and evidence |
|---|---|
| 01 · Storyboard modules | Main editor 168 lines; frame list, menus, draft/selection/reorder hook, frame editor and variables separated. Search/status/drag, autosave flush, progress and assembly entry preserved; storyboard and stress suites |
| 02 · Reusable LoRA UI | Shared keyed controls in trial, workflow defaults editor and summaries; model/CLIP values retained while off, saved-default reset and provenance. UI defaults/trial/inspection tests |
| 03 · Task/panel and dynamic channels | Task controls and panel inherit/on/off overrides; schema-driven extension parameters with JSON fallback, nested sentinel preservation, cancel reset and invalid-save blocking. Assemble/storyboard/channel tests |
| 04 · Interaction/i18n | English/Chinese entries and i18n consistency; 120-frame filter, save race, keyboard sensor, selection/delete/undo and panel isolation. Test instrumentation was optimized without changing timeouts or assertions |
| 05 · ATELIER/FOLIO/CINEMA | Dark gallery, warm book-spread, dark screening room; standalone files and gallery/folio/cinema reader modes. Matrix and actual desktop/mobile visual checks |
| 06 · EDITORIAL/CONTACT/CHROMATIC | Magazine, contact-sheet and long-scroll treatments; zero external assets, responsive/print styles. Same automated and actual-browser evidence |
| 07 · Template/export preview | Visual cards with layout/palette, sandboxed full-screen trial and template-studio expansion. Reopening fetches current content; export preview freshness regression |
| 08 · Python SDK helpers | Resource discovery includes full workflow LoRA controls and selectable channel IDs, one-shot task/wait, synchronous or async four-format save. Generated client stays generated; SDK-flow tests |
| 09 · Extension examples | `comfy-slot-codec` and `offline-cloud-adapter`; isolated/MockTransport tests and static CTK pass; neither requires a core edit for registration |
| 10 · Integration documentation | Generic clients and extension contracts, bilingual offline chapters, original external-consumer example retained. No new platform-named core files or special endpoints |

## Wave 3

| Task | Evidence |
|---|---|
| 01 · Complex workflows | 14 synthetic topologies plus the user's actual 138-node graph. Actual neutral base-branch generation completed; original file and seven parameter states unchanged |
| 02 · Durable fidelity | Slot lifecycle covers kit import/export/remapping, clone, panel rerun, trial, close/reopen, complete default-redacted backup/startup restore and receipts; per-profile cloud recipes preserve source model/options under destination rebinding |
| 03 · 120 frames | Five stress cases plus normal editor suites; full frontend run passed after eliminating quadratic test geometry work |
| 04 · 13-template extreme matrix | 104 combinations plus explicit nonce/variable contracts; metadata/image roundtrip and XSS text stay inert |
| 05 · Reader matrix | 27 reader/lightbox cases, embed restore/report, touch and reduced-motion checks; actual Chrome template matrix also exercised controls/focus |
| 06 · API abuse and permission | Anonymous plus four scope groups across 65 route cases; bounded deep JSON/URL credentials, idempotency and concurrent presets, unsafe imports, revoked-token race regressions |
| 07 · SDK caller integration | Four scenarios and eight sync/async format combinations through the generated MioClient and real FastAPI, fake generation only for automated tests |
| 08 · Offline handbook | English/Chinese chapter updates and seven handbook tests |
| 09 · Actual browser | Existing Chrome, isolated workspace, 1280×800 and 390×844; search/filter/real keyboard drag, LoRA values, export sandbox and six HTML templates; see [live acceptance](live-acceptance.md) |
| 10 · Hygiene/release | Generated contracts/API/client checks, Ruff/Prettier/typecheck, server/Spike/frontend/assistant tests, three extension CTKs and theme CTK. Final clean-data release package evidence is recorded below after completion |

## Review sequence

Implementation was integrated in overlapping increments rather than ten atomic merges per wave. The traceable commit groups are:

| Wave | Commits | Integration |
|---|---|---|
| 1 · Contracts, runtime and generic API | `10126d6`, `8a52749`, `880af38`, `c839bae` | Discoverable cloud adapters, versioned slot codecs, structured controls, task/deliverable endpoints and hardened album engine |
| 2 · Creator UI, templates and SDK | `898449f`, `a6cd6d8`, `920b96b`, `d123b3c`, `e48a51b`, `29c4caa`, `c839bae` | Storyboard split/drag/search, reusable LoRA controls, six templates, full-screen preview and generated SDK helpers |
| 3 · Acceptance and repairs | `8b14e33`, `26a5a7c`, `6ad7e1b`, `622e03d`, `89e54ae`, `a5d180a`, `4709022`, `f39e643`, `0e710ff`, `d44a294`, `43a4b86` | Matrix/lifecycle/SDK/stress/precision regressions, three adversarial reviews, independent rechecks and the other-file review |

Subsequent repairs include `267be1c` (tested schema stack and dependency ordering), `fc62363`/`2648236` (ordinary Windows short paths), `8ba6829` (canonical fixtures and actual Python 3.11 launcher selection), and `4ac2ae5`/`375fcc5` (owned export paths and their independent review). Each wave used the available three active child slots. Review reports name their exact ownership and evidence; source and generated artifacts were consolidated by the root agent.

Three final adversarial reviewers covered today's backend, frontend and security changes. Findings were repaired with reproductions, then different reviewers checked the repaired backend/security boundaries. The frontend author of each repair did not author its reviewer tests. The shared handoffs are:

- [Backend adversarial](final-backend-adversarial.md) → [fresh backend recheck](backend-fresh-recheck.md)
- [Security adversarial](final-security-adversarial.md) → [fresh security recheck](security-fresh-recheck.md)
- [Frontend adversarial](final-frontend-adversarial.md), including six fresh regressions

The requested second stage inspected other project files in three areas. It found and repaired token resurrection, malformed/corrupted ZIP failures, busy-work deletion, restore/purge races, non-atomic legacy import and stale scheduler claims:

- [Other API](other-api-final.md), [other engine](other-engine-final.md), [other storage](other-storage-final.md)
- [Fresh other-file recheck](other-fresh-recheck.md) → [final independent recheck](other-final-independent.md)
- The final Windows compatibility repair was independently checked in [Windows recheck](windows-fresh-recheck.md): 47 passed and three permission/platform skips, including actual ordinary short paths and an actual junction rejection. The later export/restore path repair and opaque provider identifiers were independently verified in [export path review](export-path-independent.md).

The environment allowed the root plus three active children, so actual parallel child count was three; the requested ten simultaneous agents were unavailable. Most feature work used separate worktrees, while later test/review integration used exclusive file ownership in the shared checkout. These execution differences are not represented as ten-agent concurrency or ten atomic worktree merges.

## Final gate ledger

Local fixed-checkout server gate: 1,309 methods passed, one launcher/environment skip. The last LoRA precision correction then passed the five-shape/tiny-value/finite-bound matrix and all 43 workflow cases plus six core dispatch and 12 lifecycle cases. Frontend: 838 tests in 93 files passed, including the precision form-validity regression; typecheck, formatting and production build passed. Spike: 80 passed. Standalone assistant: 22 passed, its build and committed-dist check passed. Generated client/extension contracts have zero drift; Ruff passes after the later path repairs too. All three extension CTKs and the wallpaper-theme CTK passed. The clean checkout verified all 64 distribution files, `build_distribution.py --check`, and a 13-template package with 239-route extracted-application startup.

The last local full server attempt initially hit the existing update test's nondeterministic ZIP timestamps: the fixture regenerated archive bytes separately for the signed manifest and download. It now reuses one archive per version. Its 12-case module and the subsequent 1,309-method full run passed. An earlier live-edit full run hit a newly generated route before the already imported app had it; the final gate uses a fixed checkout. Neither failure was treated as a product pass or fixed by weakening an assertion.

Production integration was pushed as `c839bae`; the first remote run revealed CI installed Spike's Pillow dependency too late and resolved newer FastAPI/Pydantic versions than the checked-in schema generator environment. `267be1c` installs Python dependencies first and pins the tested schema stack. Its Ubuntu Python 3.11 job passed all 1,314 tests. Its Windows launcher selected the machine's Python 3.15 rather than the matrix's 3.11; CI now explicitly sets the launcher version. Normal short path aliases are accepted while actual link/reparse ancestors remain rejected; canonical test paths retain the original security assertions. Gate time budgets are 30 minutes to accommodate the observed roughly 13-minute Python 3.11 backend run and the remaining frontend/package checks.

Final production commit `4ac2ae5` was pushed; later commits add independent regression evidence and this acceptance record. The authoritative final gate is the [latest main CI run](https://github.com/lumingya/comfy-comic-studio/actions/workflows/ci.yml?query=branch%3Amain); final delivery identifies its exact run and observed result. The final unsigned smoke package is `%TEMP%/mio-release-smoke-4ac2ae5/mio-studio-4.0.0.zip`, 4,888,394 bytes, SHA-256 `1832e925d6bfb8d9c3ae2a90a3c12f3a2439e8212e114ec6b802f63ceb321c11`. It verified 64 shipped files and passed extracted startup with 239 routes. It was not published or installed over the user's application.

ComfyUI testing covered one selected neutral base output, 512×512 and four steps, with all 43 user LoRAs disabled. It did not exercise production-quality upscaling, every optional branch, or paid cloud APIs. Review conclusions cover the inspected paths and reproduced boundaries; they do not establish that every possible defect in the whole repository has been eliminated.
