# R5 blind cross-review and final role decision

**REQUEST CHANGES.** The two original Medium findings remain unresolved on the fixed candidate. This cross-review does not modify the initial report, raw results, sample selection or pre-product oracle, and does not issue a conditional pass.

## Evidence reviewed and execution boundary

The four peer first reports and their public machine evidence were read after the controller opened same-round cross-review. Exact hashes are recorded in `cross-results.json`. This reviewer did not need peer private graphs, old oracles or later peer final signatures. Cross-review used only file and source inspection: new product imports, HTTP, browser operations, tests and builds were all zero. The product lease remains released.

All files in the blind initial seal were independently rehashed and still match. `cross-evidence.json` is an additional public projection of the already sealed blind cache: it contains only known candidate fields, typed empty-string facts, hashes, neutral operation categories and port pointers. It is sufficient for peers to corroborate the two findings without reading private source graphs.

## Deduplicated unresolved findings

- **R5-BLIND-M1, Medium:** candidate recovery excludes valid empty text fields, and the paired negative field alias is separately absent from the candidate text set. The source filter is at `bindings.py:424`, and the candidate use is at `inspection.py:231-233`. Simply removing the empty-string test would not fix both causes. C03's frozen exact mappings work, with only the requested scalar target changed. This concerns the recovery recommendations: `WorkflowMappings.tsx:108-135` still includes empty non-connection literals in the generic manual dropdown, so the entire UI is not unable to recover manually.
- **R5-BLIND-M2, Medium:** role discovery at `inspection.py:269-277` looks only at immediate consumers. C05's base/control source reaches both encoded base data and a control branch through transforms, while a distinct style source feeds a separate adapter. Public candidates retain both node identities but offer only generic reference roles. C02 has the same resized-base loss. The frozen exact base and style edits independently preserve the other source and every connection. Because base/control roles are not default core rows, users must also know the custom semantic key; candidate-role loss is a practical manual-guidance gap. Potential or uncertain roles should be exposed without assuming that unknown transforms are identity operations.

The compile reviewer independently corroborated both source and per-request facts, and the generality reviewer independently confirmed both source mechanisms. These are the same two root causes, not additional findings for each reviewer.

## Effect of the peer evidence

The generality layering is sound within its stated scope: graph dependencies, automatic ownership and actual execution closure are separate. Conservative unknown-stage, unknown-transform and image-derived-size handling must remain safe. Neither candidate-guidance finding requires a plugin-class whitelist or speculative automatic writes. Historical strict mismatches, the private workflow's incomplete runtime state and old/new candidate identity limits remain as originally reported.

The compile machine result contains 27 cases, all passing, with 173 typed deltas and unchanged full source-document hashes. Explicit multi-role attachments, stage ownership, stable adapter controls, neighbors and native structures have direct synthetic evidence. This does not prove complete candidate role discovery. Its execution-seed fanout policy is distinct from primary-stage controls; blind C10 did not exercise a conflicting automatic seed policy because default output selection failed and its explicit-output path was tested separately.

All 12 Web exports were checked directly in the public analysis artifact. Each has exactly two numeric representation changes: an integral floating CFG and an integral floating denoise value become integer representations with the same numeric values. Thus the 24 raw strict failures stay failures. The inspected browser JSON parse/stringify boundary and server numeric constraint code support the Web report's Low classification for these measured inputs. They do not establish byte-preserving persistence or universal native-type compatibility. The five original Web files remain separately byte-unchanged.

This does not relax the blind backend typed oracle. The C08 disabled-weight integer zero was accepted only because numeric zero tolerance was sealed before product use; the strict int/float delta remains visible. Every other unrequested native type, boolean, string, dictionary, adjacent field and connection still requires exact preservation. The C04 empty-name adapter oracle mistake and the seven scalar no-op requests remain disclosed limitations, not retroactive successes.

The privacy Low is a publication-hygiene correction to three old reports retaining one synthetic asset name. Mechanical anonymization should preserve their counts, hashes and history. It does not change blind source identity or typed evidence. The disclosed fixture tool-output event is retained as a real process limitation; it neither supports a claim of whole-process zero raw output nor proves a new credential leak. This reviewer did not reproduce that literal or private data in the cross files.

## Final decision and remaining limits

Both Medium findings remain unmodified and unresolved. The required round decision is **REQUEST CHANGES**. Safe manual mapping success cannot erase missing recovery guidance, and corroboration by more reviewers does not multiply the defect count. No `VERIFIED PASS` signature is issued.

The fresh set still covers small API graphs, one real named model-only adapter and two editor-only boundaries. It does not establish giant graph, long real stack, native nested subgraph, WebP, live provider, plugin execution or GPU compatibility. Root cleanup, original workspace preservation, final publication corrections, clean commits/push and final-HEAD CI remain delivery-phase evidence, not completed work inferred from this review.
