# R3 fixed-corpus final read-only retest

Run: 2026-11-25T17:26:15.216932+00:00 to 2026-11-25T17:26:30.306336+00:00. PID 11788; affinity 0x1; BelowNormal priority 16384. The guard was read back before any Mio import. One Python process ran both copied probes serially; no child process was started.

| Existing check | Current result |
|---|---:|
| current75 directed retained whole-graph checks | 230/230 |
| original R1 directed retained whole-graph checks | 67/70 |
| R1 prewritten explicit core mappings | 20/20 |
| Independently prewritten true active LoRA items | 7/7 |
| LoRA negative-weight/disable exact whole graphs | 14/14 |

Public corpus multiset/check deltas: {"50bb3fa": {"available_samples_compared": 90, "binding_target_multiset_changes": 5, "other_check_changes": 2, "raw_binding_order_changes": 5}, "6f9bdf2": {"available_samples_compared": 90, "binding_target_multiset_changes": 5, "other_check_changes": 2, "raw_binding_order_changes": 40}}. A sorted list preserves target duplicate counts; binding array order is reported separately. Full current binding identities also record qualifier, part and source. Historical probes only recorded kind/pointer, so no claim of historical provenance-field equivalence is made.

The current75 remains exactly the fixed 50 recovered original files plus 25 preselected supplements (46 API + 29 UI-only); the original R1 is 14 API + 1 UI-only. The 25 unavailable historical originals are not retested or substituted. API handlers use the existing in-memory store and empty offline schema. The 300 directed checks include automatic writes and safe manual/absent no-ops; they are not 300 automatic bindings.

## Private138: three automatic withdrawals are observed

Current binding counts: {"output": 1, "seed": 2}. Existing 6f9bdf2 and 50bb3fa results each included width=1, height=1 and batch=1; current code withdraws all three. Width/height stop at an unknown numeric helper. The additional batch withdrawal occurs outside a provable primary canvas lineage at an unknown bundle route, as detailed below. This is three observed automatic-binding withdrawals, not a blanket no-regression claim. Seed/output counts are retained.

Input names do not establish a helper output's identity or calibration. Automatic traversal requires a trusted output-port contract. A valid explicit JSON Pointer mapping or mio tag expresses user intent without claiming that an unknown helper is an identity node. The original document configuration is retained; two in-memory mappings to the historical literal targets are checked separately and do not count as automatic recovery.

Full private compile remains False; exception type BindingError, missing_frontend_state=True. No synthetic state was installed. Inspection importable=True, compilable=False. The actual document has 0 mio tags, so tag equality is empty-multiset coverage only.

## Preservation and limits

Preservation: {"all_90_original_files_unchanged": true, "all_backend_python_sources_unchanged": true, "all_old_artifacts_unchanged": true, "old_artifact_count": 128, "original_file_count": 90}. All backend Python modules, including newly introduced modules, are hashed by relative filename and raw bytes before/after; aggregate SHA256 d1d65b8cfa05ee4f7c5ae84a69e90a6fecb65524b4d753a5fb012f6f497a1988.

Unexpected failures: ["directed_whole_graph_check_failure", "public_corpus_behavior_changed", "private_additional_batch_binding_withdrawal"]. Missing frontend state remains a pre-existing full-compile limitation. No new collection, unit suite, frontend test, build, restart, database write, model/GPU/paid call, or commit was performed. Fixed-corpus success does not replace independent R3 counterexample audits or remote gates.

publish.json contains public sample IDs/sources, hashes, pointer-only targets, sanitized private counts, before/after comparison and resource/source provenance. It contains no raw graph, source prompt, asset/model value, or private filesystem/database path.

## Concrete public deltas against original truth

| Public sample | Original truth / 6f9bdf2 / 50bb3fa | Current | Interpretation |
|---|---|---|---|
| noisy_latents_3_subjects.png, prompt | [] / [] / [] (manual) | /71/inputs/text; incorrect; whole graph false | Unsafe regression: LatentComposite samples_to/samples_from omitted from canvas ancestry; downstream sampler58 promoted over distinct upstream prompt branches. |
| helper/hf-lora-stack.json, width | /134/inputs/width in all three | []; missing; whole graph false | Safety withdrawal at ColorMatch225 source/target without trusted canvas contract; old automatic truth remains failing. |
| helper/hf-lora-stack.json, height | /134/inputs/height in all three | []; missing; whole graph false | Same boundary; do not substitute manual success for automatic success. |

All five sample pointer-multiset changes, including unannotated controls, are listed completely in delta-summary.json. Structural link facts without literal input values are in delta-evidence.json. Three supplement samples 7b2a5c320f0b, e160259f512e and 7c4ec6c02960 each withdraw node30 steps/cfg/denoise/sampler/scheduler because node30 supplies IterativeLatentUpscale14.upscaler configuration; sampler6 feeds14.samples. Their five independent core truth checks stay exact, but these unannotated provider controls are not automatically labeled PASS.

The noisy output path is Save9 -> Decode8 -> Sampler58 -> LatentComposite75; compositor75/69/61 samples_to/samples_from carry upstream samplers. The hf output path is Save229 -> ColorEnhance227 -> ColorMatch225, whose source136 and target213 contain the generation and upscale paths. This static attribution performed no new product calls or truth edits.

## Additional private batch boundary and visible warnings

The scope owner's read-only committed-fixture attribution follows output -> ifElse -> ImpactIfNone through A or B/in and signal/any_input bundle fields. No declared identity route establishes a primary canvas beyond that boundary. The unique literal EmptyLatentImage batch control remains behind Context latent/base_ctx/ctx_02 dependencies. This explains a conservative bundle/canvas withdrawal independently of the numeric-helper width/height stop. No class-name exception or automatic restoration was introduced. The private payload was not exported and the terminal result did not record full graph equality to the fixture, so this is explicitly fixture/source attribution, not a new private engine measurement.

Actual private inspection issue codes are ambiguous, compile_error, dependencies_unchecked and unbound. There is no demonstrated batch-specific inspect warning: inspection.py computes missing only for CORE_KINDS, which excludes batch. Source compile.py has an ignored requested-value warning recommending tag/mapping/trusted adapter, but this run did not request batch through full compile and that compile still fails at required frontend state. A returned batch warning or batch mapping success was not newly tested.

Terminal verdict remains REQUEST CHANGES for the observed unsafe prompt regression and unmet original truth, with additional batch withdrawal explicitly retained. The single product measurement process11788 exited; report-only processes do not import Mio.
