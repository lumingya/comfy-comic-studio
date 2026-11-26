# R3 compile repair retest

**Outcome: REPAIR_RETEST_PASS_FOR_RECORDED_CASES.** This is a repair retest of the recorded findings and original probes, not a fresh independent final audit or a full repository gate verdict.

## Execution and freeze

The product calls recorded here completed before the request to stop testing for CPU pressure. After that request, no product code, test, browser or plugin was invoked. Only previously written JSON was read, this report was assembled and local file hashes were compared. The own-probe PID check returned an empty list; no unrelated process was stopped.

- HEAD during completed probe runs: `50bb3fad2189b54f45f4cc0e0c6d2071d2e73090` with frozen repair edits present.
- Current committed HEAD: `eb876cfbb8cf14de34a99b6544469460c11acc24`.
- Current Git status: clean.
- Backend content fingerprint before and after the commit: `60a60f5f80be9e58add7ecb4a0a29850921f65d3ffa6859cb0421b8fef9bb8f2`.
- Backend files fingerprinted: **455**, including the new `binding_scope.py` that was untracked at the pre-commit capture. Per-file SHA-256 and byte counts are in `freeze-before.json` and `freeze-after.json`.
- Backend contents unchanged across the commit: **True**. No post-commit product rerun is claimed; the recorded run applies by unchanged file content.

## Original oracles and counts

All **23 original cases were actually rerun** before the stop: **22 exact-output passes and 1 expected safe linked-mapping rejection**. No original case remains unexecuted or failed. The 10 core expected deltas are checked against the original saved expected deltas; the LoRA copy preserves all 13 original oracle definitions. Warnings are listed separately and do not turn a mismatching graph into a pass.

Core full-graph comparisons and snapshot immutability are recursively type-sensitive, distinguishing `bool`, `int`, `float`, strings, lists and dictionaries. The LoRA slice additionally records canonical typed input/document/expected/actual hashes and typed deltas. All 23 input-immutability checks pass; all 13 LoRA controls remain unchanged. Core per-document hashes were not collected; their type-sensitive snapshots, complete historical-file hashes and backend manifests are the recorded evidence.

| Original finding | Severity | Retest state | Recorded evidence |
| --- | --- | --- | --- |
| C1 | High | CLOSED_IN_RECORDED_CASES | Both generated-control and generated-style cases now match the unchanged main-only exact graph oracle; auxiliary branches untouched. |
| C2 | Medium | CLOSED_IN_RECORDED_CASES | Both partial-text mirror cases match their original exact expected graph; no unrelated tag additions. |
| C3 | Medium | CLOSED_IN_RECORDED_CASES | Clip-only change preserves model strength string and all other fields; controls read 0.7/0.2 in the complete-chain cross-check. |
| C4 | Medium | CLOSED_WITH_CONSERVATIVE_BOUNDARY | Undeclared auxiliary output produces no prompt/width delta, warnings and missing bindings; no LoRA is falsely dead. Both groups remain read-only without a trusted route contract. |
| C5 | Low | CLOSED_IN_RECORDED_BOUNDARY | Inspection returns slot_error/compilable=false; discovery and requested-LoRA compilation safely raise LibraryError. Compilation without a LoRA request remains an unchanged passthrough, not an unconditional reject-all validator. |
| C6 | Medium | CLOSED_WITH_CONSERVATIVE_BOUNDARY | Real and synthetic fixed-preset sources retain original literals/preset and have empty automatic width/height bindings with ignored-value warnings. Effective size is not claimed to become the requested size; mapping the same ignored literals is not a valid remedy. |

## Preserved manual boundaries

The fixed-preset source now leaves both automatic dimension bindings empty. Its original width/height literals and preset remain unchanged in both the restricted real-graph check and the minimal synthetic reproduction. Inspection includes width/height in `missing` and exposes the ignored-value warnings. This is a conservative refusal to promise arbitrary dimensions, **not** a claim that the requested 768 by 640 size executes.

The retained upstream contract predicts the preset's existing 1152 by 896 output; no plugin was executed during this retest. Manually mapping the same preset-ignored literals would still not establish effective control. A supported preset selection, an actually effective canvas input or a trusted adapter contract is the remaining user-control boundary. The retest records generic manual-mapping/adapter guidance, not preset-specific execution certification.

For an undeclared selector auxiliary output, prompt and width are likewise unbound with warnings; the original graph is retained and neither candidate LoRA is falsely classified as dead. The groups remain read-only until a trusted route is supplied. This is a safe boundary, not automatic compatibility for every auxiliary output.

Malformed object names now produce a structured inspection error and safe discovery/requested-LoRA refusal. A plain compile with no LoRA request still passes the original graph through unchanged; this report does not claim unconditional malformed-input rejection by that passthrough path.

## Original case results

| Case | Recorded result | Input unchanged |
| --- | --- | --- |
| ordinary_exact_types_and_metadata | EXACT_PASS | yes |
| sequential_refinement_preserves_second_stage | EXACT_PASS | yes |
| generated_control_reference_is_not_generation_stage | EXACT_PASS | yes |
| generated_style_reference_is_not_generation_stage | EXACT_PASS | yes |
| multiple_reference_mask_control_exact_targets | EXACT_PASS | yes |
| coupled_selector_final_state_exact_delta | EXACT_PASS | yes |
| dynamic_selector_conservative_manual_boundary | EXACT_PASS | yes |
| nested_json_pointer_types_escaping | EXACT_PASS | yes |
| mapping_link_rejection | EXPECTED_SAFE_REJECTION | yes |
| output_variant_keeps_actual_closure | EXACT_PASS | yes |
| object-partial-mirror-unrelated-tag-injection | EXACT_PASS | yes |
| object-two-text-mirrors-must-not-copy-cross-field-tags | EXACT_PASS | yes |
| object-tag-already-duplicated-extra-preserved | EXACT_PASS | yes |
| object-unrelated-tag-only-untouched | EXACT_PASS | yes |
| flat-zero-index-negative-duplicate-pin | EXACT_PASS | yes |
| flat-sparse-removal-keeps-later-place | EXACT_PASS | yes |
| power-clip-only-preserves-neighbor-types | EXACT_PASS | yes |
| object-wrapped-no-mirror-partial-precise | EXACT_PASS | yes |
| chain-modelonly-partial-precise | EXACT_PASS | yes |
| chain-model-clip-only-preserves-model-typed-value | EXACT_PASS | yes |
| chain-numeric-string-weight-clip-only-preserves-model | EXACT_PASS | yes |
| flat-numeric-string-neighbor-remains-exact | EXACT_PASS | yes |
| advanced-mode-only-edits-active-weights | EXACT_PASS | yes |

The six additional compile cross-check records, the real/synthetic preset check and the malformed-name boundary are retained separately in `results-safe.json`; they are not added to the 23-case denominator. New ignored-value warnings are retained verbatim in that JSON and kept separate from exact-output verdicts.

## Integrity and artifacts

- Historical `audits/r3/compile` files checked: **10**; combined SHA-256 `42be349355510a186a1f8317cae1086b4764114dae64cc6eb9c72bbd8121f36c`; unchanged: **True**. No historical file, result, report or truth was overwritten.
- New untracked-at-capture module SHA-256: `0894e62ef823241be6e6f22387766c3594da65eac1ccd43da8f949908a4dab16`.
- The real blind graph remained outside this retest directory. Only a restricted connection/dimension summary and SHA-256 are retained, with no original prompt, model name, full external graph or credential.
- `results-safe.json`: all per-finding states, original cases, typed deltas, warning differences and integrity references.
- `freeze-before.json`, `freeze-after.json`: complete Git-visible backend and historical-audit file manifests; ignored runtime/cache files are excluded.
- Copied/adapted `probe_compile.py`, `cross_checks.py`, `aspect_ratio_crosscheck.py` and `lora/probe_retest.py`: historical oracle values retained; changes are restricted to new output locations, type-sensitive verification and evaluating the original conservative preset oracle rather than asserting the old bug signature.
- `lora/results-safe.json` retains the independently collected LoRA evidence. All temporary output stays in this retest directory and its `lora/` child; no product/golden/source file was changed or committed by this retest.

## Not executed after the CPU stop

No post-commit probe rerun, further repeated/expanded targeted probe, test module, full repository gate or fresh Wave-4 independent final audit was run. The main agent owns any separate gate evidence and paused it in response to the same resource request. Those activities are **not proven by this report** and were not silently replaced with a pass. No remaining original case required execution when the stop arrived; only evidence consolidation remained.

All original C1-C6 findings and the Low observation have the recorded closure state above. This report establishes the limited repair retest result and leaves final independent acceptance to the separately coordinated review.
