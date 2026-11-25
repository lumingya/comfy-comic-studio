# Wave 4 independent compile correctness audit

Result: CHANGES REQUIRED (not VERIFIED PASS).

Snapshot: HEAD 71457f6; review baseline 38838ab. The parent supplied passing full CI run 44923800420; this audit did not rerun full gates. AGENTS.md, README.md, relevant ROADMAP architecture requirements, original requested Wave 4 acceptance spec, and current compatibility/truth reports were read. No repository files were edited. All new probes and evidence are under this report's temporary directory. Only neutral synthetic graphs and one newly collected official public sample were read; no private runtime graph, credentials, GPU, model download, or service restart was used.

## New defects in the reviewed implementation

### C1 - Medium - Inferring identity from node shape can silently write the wrong branch or output

Locations: `server/mio_server/comfy/workflow_graph.py:103`-105 (selector ignores requested output slot), :110-120 (matching declared type/name is treated as identity), :174-179 (one scalar literal is treated as its node's output); :44-49 reads that literal to decide selectors. `server/mio_server/comfy/binding_inference.py:96` constructs this graph without object_info.

Public API reproduction: `python <this-directory>/probe_compile.py`, cases `custom_switch_selected_index_output`, `custom_switch_selected_label_output`, and `transformed_boolean_selector`. `probe_results.json` records input changes and source immutability. `native_switch_result.json` additionally executes only the original upstream switch method, extracted through AST without importing the plugin or invoking ComfyUI/GPU.

Use actual Impact `ImpactInt` leaves with values 100/200, an `ImpactSwitch` with `select=2`, and sampler `seed=[switch,2]`. Request `seed=999` through compile_workflow. The compiler reports `index_b.value (heuristic)` and modifies payload 200 to 999; inspect reports compilable=true. But output 2 is the selected index, not the payload. Executing the upstream `GeneralSwitch.doit` method on compiled inputs returns selected_index=2. Thus the requested seed does not take effect, while an unrelated value is modified. A CLIP text link to output 1 similarly causes payload text to be rewritten even though output 1 is the slot label. These contracts are directly specified in the official [Impact implementation](https://github.com/ltdrdata/ComfyUI-Impact-Pack/blob/Main/modules/impact/util_nodes.py#L43) (outputs at 43-45 and return at 90).

The same identity assumption affects selector controls: an `ImpactNeg` node with literal `value=True` feeding a boolean conditioning switch is interpreted as True. Public compile rewrites the first encoder, while the actual negation produces False and selects the second encoder. The official [ImpactNeg implementation](https://github.com/ltdrdata/ComfyUI-Impact-Pack/blob/Main/modules/impact/logics.py#L230) explicitly negates its input at line 245. This is a valid API scalar input; it requires no evaluation of model nodes. A matching BOOLEAN input/output type does not establish identity either.

Required validation after repair: unknown transforming nodes should remain unresolved unless an explicit adapter/route contract declares the relevant output's identity mapping. Preserve known native reroute/primitive support and static selectors through explicit contracts; do not solve this using hundreds of plugin names. Test nonzero switch outputs and a unary negation both with/without declared object_info. For unsupported routes, offer manual mapping, do not silently write a guessed origin.

### C2 - Medium - Distinct latent composition canvases are all overwritten as one size

Locations: `server/mio_server/comfy/binding_inference.py:364`-379 collects dependencies of every primary sampling lane into one dimension domain; :423-433 binds every root width/height producer in that union.

Cross-check of blind auditor's new public sample: [official noisy latent composition](https://github.com/comfyanonymous/ComfyUI_examples/blob/master/noisy_latent_composition/noisy_latents_3_subjects.png). Original downloaded sample stays in the blind auditor's temporary directory; no third-party content is copied into the repository. Public compile case `public_latent_composition` independently reproduced the issue and recorded only sanitized dimension deltas in `probe_results.json`.

Node 62 is the 1920x1088 composition background, while nodes 5 and 65 provide distinct 384x768 subject patches. Requesting width=768,height=960 auto-binds all three producers and changes all three to 768x960. Placement offsets and composite structure remain unchanged. The subject patches are incorrectly made as large as the background, changing composition semantics. Graph source remains unchanged, but the submitted prompt is wrong. This is not a later refiner-size problem: all independent lanes are primary, and primary-stage classification cannot establish one shared canvas.

Required validation after repair: preserve separate canvas domains of compositor inputs. A known structural contract may choose the compositor destination/background; when that cannot be established, require manual size selection. Do not fan out one global size to unequal independent patches. Keep earlier primary/refiner and model-resolution calibration regression behavior.

## Supported-shape defects predating this diff

These two LoRA writer defects predate baseline 38838ab (blame c3e292b1). They are reported separately because the task explicitly requires lossless compiled overrides across these supported object shapes, not as regressions introduced in this diff.

### C3 - Medium - Object LoRA updates erase unrelated prompt prose

Locations: `server/mio_server/comfy/workflow_slot_plan_groups.py:97`-104 adds every `text` field and any string containing a LoRA tag to `textPaths`. `server/mio_server/comfy/workflow_slot_writers.py:226`-229 replaces every such string with only LoRA tags.

Public `slot_adapters.describe -> compile_workflow` reproduction: `lora/probe_lora.py`, case/evidence `lora/object_prompt_text_preserved.json`. Node contains an object-list LoRA `ink` (.7 model/.3 clip), ordinary `text="a quiet bookstore, morning light"`, and caption prose surrounding a LoRA tag. A keyed strength-only edit to .4 replaces both text/caption with `<lora:ink:0.4:0.3>`, deleting prose unrelated to the requested edit. Metadata and source document stay unchanged. Preserve prose and replace only owned LoRA syntax, or require an explicit mirrored-text adapter contract.

### C4 - Low - Editing a neighbor clears a disabled object pin's saved weights

Locations: `server/mio_server/comfy/workflow_slot_writers.py:219` and :223 unconditionally zero all disabled entries during object-list writing. The numbered-stack writer already avoids changing untouched disabled saved weights.

Public reproduction: `lora/probe_lora.py`, `lora/object_disabled_saved.json` and `lora/wrapped_disabled_saved.json`. Begin with active ink(.7/.3), inactive wash(-.6/.2, active=False), and change only keyed ink strength to .4. The unmodified wash entry becomes 0/0 in the compiled graph, for both the raw list and `__value__` wrapper. It stays disabled and the stored source is unchanged, so this is a compiled-value preservation issue rather than immediate wrong image output. Preserve unchanged disabled native entries exactly, including saved model/clip strengths.

## Independent cross-checks of other auditors

- Generality: confirmed bypassed/mode=4 CLIP encoder's own text is still auto-bound and rewritten (`probe_results.json`, `inactive_encoder`). The semantic contract treats that widget as inactive; no claim of ComfyUI runtime failure is made. Owner: `audits/r1-generality/report.md`.
- Generality: separate public inspect implementation confirms 200 nested selector controls / 210 total nodes succeed, while 250 controls / 260 nodes raise uncaught RecursionError (`nested_selectors_200/250`). The generality auditor's graph has one fewer encoder, hence their 209/259 node counts. Root cause remains recursive `selection -> _literal -> _origin -> _route -> selection`. Owner: generality report.
- Blind: C2 independently corroborated and sent back to the blind auditor and root.

## Validation completed

- Public compile and inspect probe cases all ran, including native upstream switch method execution. Sources stayed immutable for every successfully compiled case; original links remained intact.
- 17 relevant existing tests passed: effective bindings, LoRA structures, and slot adapters. Command from `server/`: `python -m unittest tests.test_workflow_effective_bindings tests.test_workflow_lora_structures tests.test_workflow_slot_adapters -q`.
- Explicit values plus stage/config values and pointer precedence behaved correctly: panel pointer seed44 won over value33, stage22 and config11; float CFG remained7.5. Raw pointers intentionally have explicit authority; no blanket implicit type preservation is claimed for arbitrary user-requested pointers.
- Heuristic numeric binding did not treat True/False as integer seed/steps; neither boolean field was overwritten.
- Narrow LoRA probes verified sparse numbered dictionaries, duplicate occurrence stable keys, high precision negative model weight, metadata, empty slot preservation, model-only strengthTwo=None, and unchanged inactive dictionary pins. Raw object-list controls expose C3/C4 above.
- Repository status is unchanged from audit start: only the parent's compatibility report and truth report edits/untracked artifacts are present. No commits were made.

No Blocker or High finding was established. New Medium C1/C2 plus in-scope existing C3 prevent VERIFIED PASS.
