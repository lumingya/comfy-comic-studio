# R5 privacy cross review — REQUEST CHANGES

Observation UTC: 2026-11-26T07:34:48.162961+00:00  
Fixed candidate: `fa6308384826fad7629b2c727d70230cc7951d05`  
Complete-task base: `38838ab43cf3d056951f2fc6c52afb737d34e3c6`

The frozen R5 candidate is **REQUEST CHANGES**. The two open Medium candidate-discovery findings are supported by the blind evidence and source review. This decision is an archival verdict for the fixed candidate, not a claim that final cleanup, documentation commit or push has happened. The initial privacy report and its 20-file manifest remain unchanged; their hashes still match the initial seal.

## Blocking candidate findings

1. **R5-BLIND-M1 — Medium, C03.** Valid empty positive and negative text fields are missing from manual candidates. `server/mio_server/comfy/bindings.py:415-424` requires a nonempty stripped string, and candidate discovery at `server/mio_server/comfy/inspection.py:229-234` reuses that source set. The frozen C03 record has two zero-character valid fields; both explicit manual edits are exact, while automatic candidates omit them. This is an actual candidate experience gap, not an unsafe automatic write. Evidence: `cross-blind-evidence-review.json`, blind initial report and results.
2. **R5-BLIND-M2 — Medium, C02/C05.** Image init and control purposes disappear when a resize or preprocessing node separates the source from the purpose-defining consumer. `server/mio_server/comfy/inspection.py:248-281` examines immediate consumers; the frozen topology has relevant consumers two or three edges downstream. Existing manual edits are exact and preserve edges, so compiler success does not establish candidate completeness. Evidence: `cross-blind-evidence-review.json`, blind initial report and results.

No new product execution was used for this cross review. The narrow frozen source/topology reads were completed before the instruction to stop private reads; no further private graph or private oracle reads are authorized by this report.

## Evidence integrity and limits

All four peer initial manifests were rehashed: blind 40 files, generality 4, compile 10, Web 72; all match. Their report and seal hashes are in `cross-peer-seal-review.json`. Blind retains its pre-product source/oracle freeze, twelve pinned source files from eight repositories, source hash checks and explicit limitations. The generality evidence distinguishes static source identity and historical measurements from new product execution, including the limited large private sample and frontend-state boundary.

Compile reports 27/27 expected outcomes: 26 normal compiles and one expected binding rejection. I independently counted 173 typed deltas, verified the expected and actual graph hashes for all normal cases, and verified unchanged source hash pairs for all 27 cases. This establishes the tested explicit bindings, not every candidate discovery path. The expected rejection remains a rejection rather than an invented successful compile.

Web retains **112/136 raw assertions**, including **24 strict hash failures**. I rehashed the four original cell result files, recounted 28/34 in each, and independently compared all twelve saved/exported neutral graphs with their frozen sources. Each has exactly two type-only changes: integral floating-point values for cfg and denoise become integers with equal numeric values. No other graph difference was found in those twelve comparisons, and all five frozen source fixture hashes still match. This does not wash the failed assertions into passes. Forty screenshot views are the Web reviewer's recorded activity; I verified their sealed artifacts, but did not independently open the screenshots. The 1125.23 ms mobile-dark filter action is a single wait-inclusive observation, not a percentile or pressure benchmark; twelve preview records were not claimed cleaned. See `cross-web-evidence-review.json`.

CI remains six successful jobs with **actual per-job checkout**, emitted shell-command and final step-state evidence. The push runs 1,823 backend tests on the fixed candidate; the PR runs 1,969 on merge `8b9318a7ceba2e37f1f24e6d113cf39d49510d2a`, whose ordered parents are `e7a4eac44bacb64f6d74dd5a028d0380b0aa69f8` and the fixed candidate. Fourteen required emitted commands and the documented extra commands were verified from the already acquired raw logs. Linux has exactly three Windows-only skips, Windows has zero; the pinned TLS source and count constraint do not show an added TLS skip. This attribution is source anchored, not a verbose per-test timing claim. The CI scope differences are retained. Green jobs do not remove either Medium finding. No new query, download or CI rerun was performed.

## Public projection and actual output events

The explicit 28-file peer public whitelist passes the restricted structural-key, private-path, model-asset-label and strong credential pattern scan. This is a finite whitelist, not permission to publish entire audit directories. Parameter-pointer strings are allowed evidence and do not turn the public artifact into a raw graph dictionary. Raw graphs, private oracles, complete product returns and scripts were outside this public projection scan.

The initial **R5-PRIV-L1 Low** is still open: three historical audit reports repeat one declared synthetic 43-character asset label. Its hash, length, source Git blobs and report locations are already frozen in `publication-low.json`; the value is not repeated here. Mechanical anonymization belongs after this failed-round archive, with the measurements, verdicts and source provenance retained.

Three separate review-output handling events must remain visible:

- Privacy initial review: a masking pattern missed extensionless baseline fixture identifiers in a displayed repository diff. The reviewer stopped raw display, disclosed it, and moved to type/length/hash projections.
- Generality initial review: a direct complete-task diff displayed baseline fixture identifiers and text fragments; terminal output was truncated. The initial report discloses this event and does not independently establish those identifiers' real-world origin.
- Generality cross review: an incorrect nested-request serialization displayed three prefrozen neutral request blocks for C02/C03/C05, including neutral text, synthetic image labels, sampling items and pointers. The reviewer disclosed it and stopped all private sample/oracle reads. The reviewer reports that this was not an actual source-graph dictionary or original author-prompt display.

No credential was observed in the visible output reported for those events. That is not a clearance of unknown truncated text. These are distinct process Low events; they are not the three historical documentation occurrences, not automatically three new product privacy defects, and not evidence that no raw output ever occurred. No private-original-graph or credential leak is asserted without evidence.

## Protection and delivery evidence still required

The private before-delivery workspace record is frozen at 2026-11-26T07:08:17.154509+00:00. It records only the then-current metadata and pure hashes: the original workspace has five untracked records and 65 tracked data entries with 64 skip markers; the task workspace also has 65/64. No earlier original-workspace content baseline was located, so this proves neither historical nonmodification nor attribution of the existing untracked files to this task. Existing state must be preserved, with no reset or content display. No new protected-workspace observation was substituted during cross review.

The coordinator still needs to archive this failed candidate, repair the two Medium defects in a new candidate, mechanically anonymize the three Low labels with provenance, run the required fresh multi-role verification, and supply final cleanup/documentation commit/push evidence. After final authorized cleanup, compare the task/original workspace metadata and hashes with the private frozen record and explain drift. Final remote evidence must identify the real final checkout and PR parents, every required gate and any claimed extra command; the present green fixed-candidate CI is not a final-delivery substitute.

No actual GPU generation, model download, paid operation, giant-workflow pressure result, signed-update acceptance, personal-workflow full acceptance or final delivery completion is claimed. Detailed source hashes, counts, boundaries and pending evidence are in `cross-review.json`.
