# Wave 4 / round 2: independent compilation correctness audit

Result: **REQUEST CHANGES**. Snapshot `6f9bdf2c56994397754f4ec2c782f1ab63bc75a0`; comparison base `38838ab`.

Severity totals: Blocker 0; High 0; Medium 4; Low 1. C2 has two independently reproduced manifestations, counted as one root cause. C1/C2 concern the new inference/effective-state paths. C3/C4/C5 predate this diff, but remain in the accepted LoRA forms and are in scope for the requested lossless compilation acceptance. No GPU execution failure is asserted.

## C1 / Medium: generation dimensions also overwrite an independent reference-image canvas

Locations: `server/mio_server/comfy/binding_inference.py:375-390`, `:391-410`, `:454-474`.

Reproduce with `python probe_compile_r2.py`, case `reference_canvas_is_not_generation_canvas` / test `test_reference_image_canvas_must_not_resize_with_generation`. A neutral synthetic graph has a standard KSampler using EmptyLatentImage 640x960. Its model passes through an IPAdapter-shaped node; the adapter image comes from an independent EmptyImage 256x256. Request width=832, height=1216 through `compile_workflow` without any manual mapping.

Observed: both the generation latent and the reference EmptyImage become 832x1216. The original WorkflowDoc remains unchanged, but the submitted reference input is changed without a request to resize the reference. `inspect` returns `compilable=true` and reports both dimension targets without an ambiguity warning (`inspection_results.json`).

Cause: the dimension domain walks all ancestors of the model input, including reference images, masks, and their generators. The unequal-size guard inspects only latent/image canvas dependencies of the primary sampler, so it does not notice the different reference size on the model branch. Merely having width/height inputs does not establish that an ancestor belongs to the generation canvas.

Expected: preserve reference/control/mask canvas producers. Follow relevant model calibration inputs through a declared semantic relationship, or require an explicit mapping when one shared generation size cannot be proved. Keep the intentional generation-latent/model-resolution calibration coupling covered by existing tests.

## C2 / Medium: an inferred scalar write changes selection after effective-route inference and LoRA validation

Locations: `server/mio_server/comfy/compile.py:234-254`, `:303-309`, `:329-334`.

Reproduce with `python probe_compile_r2.py`, cases `heuristic_seed_changes_selector_after_inference` and `heuristic_seed_bypasses_lora_route_validation`.

Prompt manifestation: one PrimitiveNode value=1 feeds both KSampler.seed and a numbered Switch.select. The switch selects encoder p for input1 and encoder q for input2; KSampler.positive consumes its payload output0. Request seed=2 and prompt="requested scene". The compiler infers seed at Primitive.value and prompt at p.text. It then writes the seed, so the final graph selects q, but only p.text is changed; q keeps its original text. `inspect` returns `compilable=true`, reports p as the prompt binding, and gives only the ordinary dependencies-unchecked issue.

LoRA manifestation: use the same shared seed/selector Primitive to choose between two model-only LoRA branches a and b. Discovery marks a active. Request a stable-key strength change .7 -> .3 and seed=2. Compilation succeeds, modifies a to .3, then the final graph selects b, whose weight remains .7. The added `_validate_slot_routes` check runs before the inferred seed is applied, so it misses this final activity change.

Expected: infer/validate against the actual final scalar state, or reject the unstable shared control with a clear mapping/selector error. A bounded stable-state computation or explicit routing-control ownership may be appropriate; a silent stale-target rewrite is not. Pointers and explicitly mapped selector values already work and must remain authoritative.

## C3 / Medium: a discovered object LoRA control crashes when another row is a null placeholder

Location: `server/mio_server/comfy/workflow_slot_writers.py:227-230`; `_is_empty_name` and `_pinned` in `workflow_slot_values.py` explicitly treat null names as empty placeholders.

Reproduce with `python lora/probe.py`, case `object_null_placeholder`. A raw object-list LoRA input contains a disabled `{name:null,strength:1,active:false,marker:"vacancy"}` row and an active ink(.7) row. Discovery succeeds and exposes ink's stable key. Editing ink alone to .4 raises uncaught `AttributeError: 'NoneType' object has no attribute 'replace'`. `probe_lora_diagnostics_r2.py` independently confirms the same failure for a `__value__` wrapper. Source documents remain unchanged.

Companion case `object_blank_placeholder` succeeds, but deletes the empty row and its unrelated marker. The writer rebuilds the list from pins rather than preserving native vacancies.

Expected: safely retain/skip native vacancies and apply the requested valid pin edit. If an encoding is unsupported, reject it at discovery using a structured library/binding error, rather than exposing a control that crashes compilation. This is an existing writer defect, not attributed as newly introduced in this diff.

## C4 / Medium: changing one flat LoRA weight converts untouched integer gates into strings

Locations: `server/mio_server/comfy/workflow_slot_writers.py:153-154`, `:181-182`.

Reproduce with `python lora/probe.py`, case `flat_integer_switch`. The generic recognizer accepts two slots with `lora_name_N`, `strength_N`, `enabled_N=1`. Discovery marks both active and independently toggleable. A stable-key strength-only change to slot1 converts both enabled_1 and untouched enabled_2 from int1 into string "On".

Independent declared-type check: `python probe_lora_diagnostics_r2.py` supplies an INT[0,1] contract for the two gates. `diagnose` finds no baseline invalid inputs and finds two `expected INT` errors in the compiled graph (`lora_diagnostic_results.json`). This is static evidence of incorrect serialization for an accepted generic contract, without requiring plugin or GPU execution.

Expected: retain native fields of unchanged pins. A requested toggle must use a supported native encoding or be refused with a clear boundary; all non-boolean encodings cannot safely default to On/Off strings. This assumption predates the diff.

## C5 / Low: untouched enabled object LoRAs lose raw numeric representation and optional-field shape

Location: `server/mio_server/comfy/workflow_slot_writers.py:244-250`, receiving normalized pins from `_pinned` / `_num`.

Reproduce with `python lora/probe.py`, cases `object_enabled_integral_float` and `object_enabled_numeric_strings`. Editing only ink changes an untouched wash row's float1.0/-2.0 into int1/-2. Numeric strings become floats, and a row with only on=true gains active=true. Disabled native rows now have an unchanged-row shortcut; enabled native rows do not.

Expected: preserve untouched raw enabled rows as exactly as disabled rows. No immediate execution failure is demonstrated; integral float/int conversion is commonly accepted. Reported as lossless representation limitation, not as a wrong-image claim.

## Review and validation scope

- Read AGENTS.md, README.md, ROADMAP.md and the complete supplied original task text. Read the previous compile audit as a list of claims to independently challenge, not as a passing oracle.
- Reviewed the complete relevant production diff and call context: bindings, compile, binding_inference, workflow_graph, workflow_slot_graph, shapes, plan, plan_groups, writers, inspection, workflow_import, and API library entry points. Reviewed the corresponding effective-binding, semantic, route, LoRA-structure, mode, wild-contract, and inspection test changes. Contract fixture changes were checked for revision updates and intentional prose-preserving expectations.
- New compiler script: 8 test methods, 9 recorded graph cases; 5 methods pass and 3 fail, representing C1 and the two C2 manifestations. Every successfully compiled case keeps source immutable. The comparison records types as well as values. Successful result payloads serialize with `json.dumps(..., allow_nan=False)`.
- Passing independent coverage: simultaneous prompt/negative/seed/width/height/batch/steps/CFG/denoise/sampler/scheduler/reference asset writes; source metadata with booleans, integer/float distinctions, nested dictionaries and nulls; all unrelated links/values; integer seed above JavaScript's 2^53 boundary inside Python compilation; image upload placeholder discovery; config/variant/stage/panel value precedence and final pointer precedence for both selector states; second-stage reference-conditioning prompt/size/steps/CFG protection; distinct regional text protection; unresolved transform/nonzero selector outputs; shared width/height origin rejection; bool inputs excluded from numeric inference.
- Five additional type-sensitive whole-graph LoRA comparisons pass: sparse repeated dictionaries, sparse flat duplicates with disabled saved-weight neighbor, wrapped disabled object numeric-string neighbor, simple-mode dormant advanced values, and advanced-mode dormant simple values. Stable keys remain distinct on repeated discovery (`lora/positive_results.json`).
- Existing relevant tests: `python -m unittest tests.test_workflow_effective_bindings tests.test_workflow_graph_routes tests.test_workflow_semantic_bindings tests.test_workflow_lora_structures tests.test_workflow_stack_modes -q` from server: **63 tests passed**. Those passes do not cover the above counterexamples. This suite includes two API-harness cases, which automatically created and cleaned fully isolated disposable temporary SQLite stores; no existing or runtime database was opened or changed. The parent confirmed these isolated test fixtures are within scope.
- Parent supplied product CI run45630099226 with three successful jobs. Full gates and the known local Git-empty-config environment issue were not repeated. No paid API, real ComfyUI endpoint, GPU generation, model download, browser automation, or service restart was used.
- No repository source was edited and no commits were made. At audit start there were parent-owned compatibility-document changes and an untracked 138-node retest artifact; by audit end an additional parent-owned retest Markdown modification was present. These were left untouched. The frozen product commit remained the supplied SHA.

Static compilability means the compiler emitted a JSON graph, not that arbitrary plugin code will validate or run. The probes demonstrate target/route/type defects in the serialized graph. They do not certify installed models, custom VALIDATE_INPUTS, browser-state plugins, GPU capacity, generated image quality, or every possible plugin output protocol.

## Temporary artifacts and cleanup ownership

All authored scripts and retained evidence are synthetic and reside under the permitted external audit root. No external workflow or image was downloaded for this compilation audit.

Directories created/used by this audit:

1. `<task-temp>\audits\r2\compile`
2. Its `lora` subdirectory (narrow independent writer audit).
3. Its `__pycache__` subdirectory (Python import cache).

Main artifacts: `report.md`, `probe_compile_r2.py`, `probe_results.json`, `probe_inspection_r2.py`, `inspection_results.json`, `probe_lora_diagnostics_r2.py`, `lora_diagnostic_results.json`; narrow audit artifacts: `lora/probe.py`, `lora/results.json`, `lora/positive.py`, `lora/positive_results.json`, `lora/report.md`. The existing unittest harness's short-lived OS temporary directories were automatically cleaned and are not retained audit materials. Retained evidence is for the parent to collect before final task cleanup.

This report is fixed to the failing round-2 snapshot. Later repairs require fresh independent review and do not convert this result into VERIFIED PASS.
