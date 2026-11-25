# CrossAudit-3-CompileCorrectness — Round 3

**Verdict: REQUEST CHANGES**

- Frozen commit: `50bb3fad2189b54f45f4cc0e0c6d2071d2e73090`.
- Full-task base: `38838ab43cf3d056951f2fc6c52afb737d34e3c6`.
- Review date: 2026-11-26.
- Scope: public compile, inspection, diagnostics, binding precedence, stage causality, selector final state, exact LoRA changes, graph/type/metadata preservation and source immutability.
- Read the supplied task and repository instructions, README and roadmap before probing. No old audit conclusions were consulted during the independent investigation. The current round's auxiliary-output finding was consulted only for the explicitly requested cross-check after independent findings were established.
- All retained graph fixtures in these artifacts are newly authored neutral synthetic graphs. Asset identifiers and LoRA names are synthetic labels, not installed model names. The later C6 cross-check reads the blind audit's source graph in place and retains only a restricted dimension/connection summary. No full external workflow, model, image, credential or original author's text is included.

## Standards

No separate hard repository-convention violation is claimed in this assigned slice. The output-only audit respects the read-only freeze: no product, golden, saved workflow, old report or generated client was changed; no commit or push was made by this audit. The defects below concern the behavioral Spec axis. Maintaining links in the execution closure and retaining source metadata worked in the exercised cases, but that does not establish that automatic binding targets are semantically correct.

## Spec

### Blocker

None established.

### High C1 — Generated reference dependencies are misclassified as the primary generation stage

**Location:** `server/mio_server/comfy/binding_inference.py:291-329` (`primary_sites`, `dependencies`); downstream consumers are `prompt_owners` and `infer_dimension_bindings`.

**Requirement:** distinguish multi-stage generation from reference/control paths, preserve unrelated nodes, and either identify the correct input or clearly request manual mapping.

**Minimal topology:** main text + main latent → main sampler → decoder → SaveImage. A separate fixed-text, fixed-latent sampler generates a reference image. Connect that image either to `ControlNetApply.image` on the main sampler's conditioning path or to `IPAdapter.image` on its model path. The main sampler's latent does not come from the reference sampler.

**Public reproduction:** `probe_compile.py`, cases `generated_control_reference_is_not_generation_stage` and `generated_style_reference_is_not_generation_stage`; `cross_checks.py`, cases `generated_reference_control` and `generated_reference_style`. Both call `compile_workflow` and `inspect`; the cross-check also calls public `diagnose` with locally declared static contracts.

Input values: prompt `updated scene`, width `768`, height `1024`, steps `28`.

The intended main-only exact delta, independently demonstrated using explicit mappings, is:

| Pointer | Before | After |
| --- | --- | --- |
| `/text/inputs/text` | `main scene` | `updated scene` |
| `/canvas/inputs/width` | `640` | `768` |
| `/canvas/inputs/height` | `896` | `1024` |
| `/sample/inputs/steps` | `20` | `28` |

**Actual:** all four main targets remain unchanged. Instead the compiler changes `/layout_text/inputs/text`, `/layout_canvas/inputs/width`, `/layout_canvas/inputs/height` and `/layout_sample/inputs/steps`. It changes the auxiliary canvas from `256×320` to `768×1024` and auxiliary steps from `8` to `28`. Both topologies return `warnings=[]`; inspection returns `compilable=true`, `missing=[]`; static diagnostics return `ok=true`. The source graph remains unchanged.

**Cause:** any sampling site that can reach another sampling site through any non-scalar dependency is eliminated from `primary_sites`. Conditioning and model reference dependencies are treated like a sequential latent/image generation feed. A valid reference generator is therefore promoted to the sole primary site.

**Required correction:** use stage causality and payload roles rather than the full execution dependency closure. If the role cannot be proven, preserve the graph and explicitly surface ambiguity instead of confidently redirecting values. A clean refusal/manual boundary is acceptable; silent writes into the auxiliary reference graph are not.

### Medium C2 — Partial object/text mirrors inject unrequested LoRA tags

**Location:** `server/mio_server/comfy/workflow_slot_writers.py:367-377`, `_mirror_object_tags` additions.

**Requirement:** stable-key LoRA overrides must change the requested item without changing other items or unrelated text.

**Public reproduction:** `lora/probe.py` cases `object-partial-mirror-unrelated-tag-injection` and `object-two-text-mirrors-must-not-copy-cross-field-tags`; independently confirmed by `cross_checks.py` case `object_partial_text_mirror_crosscheck`. Public `slot_adapters.describe` supplies the actual stable group/item keys, then public `compile_workflow` applies the keyed change. Inspection accepts the source.

An object list contains two enabled synthetic items, strengths `0.7` and `-0.3`. A text input contains only `neutral <lora:first:0.70> label`. Override only the first object's strength to `-0.4`.

**Expected exact delta:** `/stack/inputs/loras/0/strength: 0.7 → -0.4`; existing first tag becomes `<lora:first:-0.4>`; no second tag is added and no second item changes.

**Actual text:** `neutral <lora:first:-0.4> label <lora:second:-0.3>`. With two fields initially containing one different item each, the fields acquire each other's item. The code appends all assigned items absent from a given field, including unchanged pre-existing items; evidence of one mirrored tag is incorrectly treated as ownership of the full group. Source immutability passes, which does not prevent the compiled text from changing meaning.

**Required correction:** preserve the membership and ownership of each individual mirror field for partial changes. Appending a genuinely new requested item must not cause existing unrepresented items to be injected into a partial mirror.

### Medium C3 — Accepted numeric-string chain weights silently change an unrequested model weight

**Location:** `server/mio_server/comfy/workflow_slot_values.py:85-94` and `server/mio_server/comfy/workflow_slot_writers.py:40-48`.

**Provenance:** the fallback/read-and-rewrite behavior predates this change range. It is not reported as a new regression; it remains an unmet part of this full-task lossless-compilation objective. The review scope expressly includes all already-supported LoRA shapes and types.

**Public reproduction:** `lora/probe.py` case `chain-numeric-string-weight-clip-only-preserves-model`; independently confirmed using a complete `LoraLoader` with model and CLIP consumers by `cross_checks.py` case `accepted_numeric_string_chain_crosscheck`.

Source inputs: `strength_model="0.7"`, `strength_clip="0.2"`. Declared FLOAT diagnostics accept them (`diagnose.ok=true`), and inspection with the requested override returns `compilable=true`, `diagnostics.ok=true`. Controls nevertheless report model strength `1` and no clip value. Request only a keyed clip override to `-0.4`.

**Expected exact delta:** `/lora/inputs/strength_clip: "0.2" → -0.4`; preserve `/lora/inputs/strength_model="0.7"`.

**Actual extra delta:** `/lora/inputs/strength_model: "0.7" → 1`. This changes both representation and effective numeric value from `0.7` to `1`. `_pinned` substitutes a default for numeric strings and `_apply_chain` writes every field, including the unrequested one. Source immutability passes.

**Required correction:** either parse accepted numeric values consistently and retain untouched original fields, or mark the unsupported representation read-only with a clear error. Do not accept it and silently replace a different weight.

### Medium C4 — Cross-confirmed: auxiliary selector outputs inherit payload selection at node scope

**Origin:** current-round Generality audit, independently reproduced here after the initial compile findings.

**Location:** `server/mio_server/comfy/binding_inference.py:100-110,318-329`; LoRA reachability counterpart `server/mio_server/comfy/workflow_slot_graph.py:19-23`.

Two distinct full generation branches feed numbered inputs of a synthetic two-output selector with `select=1`. SaveImage consumes selector output **1**, whose route is undeclared. Public `SemanticGraph.route([selector,1])` correctly reports `undeclared-output-port`. The compiler still scopes the entire selector by its payload choice, automatically changes only the first branch's prompt and width, returns `warnings=[]`, and inspection reports `compilable=true`, `missing=[]`.

**Expected exact delta without trusted output-1 semantics:** no automatic prompt or width write; retain candidates and require mapping or a route contract. **Actual delta:** `/a_text/inputs/text → updated scene` and `/a_canvas/inputs/width: 640 → 768`.

The model-port version also marks the second LoRA `dead` despite that undeclared auxiliary output being the only downstream consumer. Public controls list both groups inactive. This is distinct from the correctly tested output-0 payload selector.

**Required correction:** preserve the consumed output port in scope, stage and dead-branch analysis. Do not apply output-0 selection facts globally to other outputs.

### Medium C6 — Cross-confirmed: preset size producers accept ineffective automatic width/height writes

**Origin:** targeted follow-up cross-check of current-round Blind sample `R3-03`, performed after the initial report. No other blind finding was reclassified; in particular the seed-fan-out truth difference remains a contract observation, not a proven Medium.

**Location:** `server/mio_server/comfy/binding_dimensions.py:96-117,168-176`. Paired width/height literal fields are promoted to writable size sources without evidence that those fields control the producer's selected output.

**Real connections verified:** node `84`, class `SDXLAspectRatio`, has `width=64`, `height=64`, and a fixed 4:3 preset for `1152×896`. Outputs 0/1 feed node `78` (`Efficient Loader`) inputs `empty_latent_width`/`empty_latent_height`; its latent output 3 feeds first sampler `67`, whose latent output 3 feeds refinement sampler `85`. The source dimensions are therefore in the actual generation chain, not an unrelated preview.

**Public reproduction:** new `aspect_ratio_crosscheck.py` calls `compile_workflow` and `inspect` on the existing blind sample without saving that graph here, then repeats the behavior with a new minimal neutral synthetic graph. New `aspect_ratio_crosscheck.json` retains only safe field/connection summaries. No existing result artifact was rewritten; all seven prior script/result/slice-report hashes are recorded and checked unchanged.

Request `width=768`, `height=640`. Both real and synthetic compilations automatically bind the literal fields and change only those two literals from `64` to `768`/`640`, preserving the fixed preset. Both return `warnings=[]`; inspection reports `compilable=true` with neither dimension missing. Source documents remain unchanged.

**Upstream contract independently checked, without plugin execution:** public upstream commit history and normalized source bytes confirm the provided legacy contract matches `1ff8dedad0d0bd9a0330c501f509ad91c54843d1` (2023-07-27), and the current contract matches `81eb6c6d222db2b9136d6f6c1e48dfb3d5dc7017` (2024-11-25). AST inspection of the legacy fixed-preset branch proves it assigns output width/height to `1152`/`896`, replacing the manual arguments. The current method accepts only the preset and parses its dimensions; it has no width/height arguments. Thus the applicable legacy implementation conclusively leaves the effective output at `1152×896`, and the current implementation supplies no evidence that legacy width/height writes would become effective. This is a static contract conclusion, not a claim of executed images.

Pinned primary source locations:

```text
https://raw.githubusercontent.com/throttlekitty/SDXLCustomAspectRatio/1ff8dedad0d0bd9a0330c501f509ad91c54843d1/SDXLAspectRatio.py
https://raw.githubusercontent.com/throttlekitty/SDXLCustomAspectRatio/81eb6c6d222db2b9136d6f6c1e48dfb3d5dc7017/SDXLAspectRatio.py
```

**Expected conservative exact delta:** no automatic width/height change while the producer's preset semantics are unproven; leave the source literals and preset intact and report a dimension-control boundary. A trusted adapter may instead select a proven effective size control. **Actual extra delta:** `/84/inputs/width: 64 → 768`, `/84/inputs/height: 64 → 640`, with no effective output-size change under the matching legacy contract.

**Required correction and boundary:** do not infer effective size control solely from names on an unknown producer. Manual mapping to these same ignored literals is not a sufficient remedy. Clearly direct the user to a supported preset, an effective canvas input, or an explicit adapter contract; do not imply that the requested arbitrary dimensions have taken effect.

### Low C5 — Malformed object item name escapes inspection as AttributeError

`lora/report.md` records a malformed object item with boolean `name`, reaching `_name_key` at `workflow_slot_values.py:100` and raising `AttributeError` instead of a structured input rejection. This is a malformed-input boundary observation, not a claimed normal supported-shape corruption or new regression. It is not needed for the REQUEST CHANGES verdict.

## Positive evidence and safe boundaries

- Ten independently authored non-LoRA cases: seven exact-output passes; one explicit linked-input mapping produces a clear `BindingError` as expected; two reference-path cases expose C1. All successful compilations pass source-document immutability checks and JSON serialization with non-finite numbers rejected.
- Passed exact checks include ordinary scalar types and metadata, sequential refinement preserving its second-stage settings, multiple separately mapped reference/mask/control assets, final-state coupled selectors, nested escaped JSON Pointers, and output-variant closure/pruning.
- The unresolved dynamic-selector case leaves distinct prompts and dimensions unchanged and provides unbound warnings; this is a safe manual boundary, not counted as a defect.
- The LoRA slice adds thirteen new public compile/inspect cases: ten exact-output passes and three failing cases representing C2 and C3. All thirteen source-immutability checks pass. Positive coverage includes repeated names with stable keys, empty/sparse flat positions, negative weights, Power-style objects, wrapped objects, model-only chains, independent model/CLIP weights, and preserving excess/unrelated textual tags.
- Existing targeted tests: `tests.test_workflow_effective_bindings`, `tests.test_workflow_lora_lossless`, `tests.test_workflow_semantic_bindings`: **55 passed**. This confirms the new counterexamples are outside those existing expectations, not that the counterexamples are safe.
- The later C6 cross-check adds one real graph checked in place and one minimal synthetic reproduction. Both confirm ineffective size writes. Earlier case counts and result artifacts remain unchanged.
- Static `diagnose` only checks the supplied declarations. No actual node execution, model loading, GPU work, ComfyUI service, browser, paid API, or installed-model validation was attempted. The C6 follow-up only used unauthenticated read-only public upstream source/history requests. No full repository gate was repeated because the main audit already owns that evidence.

## Reproduction artifacts and temporary directories

Artifacts are relative to this audit directory:

- `probe_compile.py`, `results_compile.json`: ten independent core cases and exact graph deltas.
- `cross_checks.py`, `cross_checks.json`: own-finding strengthening plus current-round cross-checks using public entry points.
- `lora/probe.py`, `lora/results.json`, `lora/report.md`: independent LoRA slice.
- `aspect_ratio_crosscheck.py`, `aspect_ratio_crosscheck.json`: targeted C6 follow-up, with upstream contract hashes and restricted real-graph summaries; prior artifacts are unchanged.

Run from the repository root with the available project Python:

```text
python <audit-directory>/probe_compile.py <repository-root>
python <audit-directory>/cross_checks.py <repository-root>
python <audit-directory>/lora/probe.py
python <audit-directory>/aspect_ratio_crosscheck.py <repository-root> <blind-audit-directory>
```

Negative probes intentionally record actual and expected deltas in JSON; the scripts are evidence collectors, not green regression tests.

All temporary directories created by this audit are `compile/` and `compile/lora/` under the designated round-3 audit root. No other temporary directory was created. The repository remained at the frozen commit and `git status --short` remained empty when checked after the probes.

## Final cross-review decision

Independent investigation complete; Generality auxiliary-port and Blind preset-size findings independently confirmed; own High and both LoRA Medium findings reproduced through public entry points. **REQUEST CHANGES**. C1–C4 and C6 require correction or a clear conservative boundary and regression coverage before signing VERIFIED PASS. The final severity set is one High, four Medium and one Low observation; no Blocker is established.
