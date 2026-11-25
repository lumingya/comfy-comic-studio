# Wave 4 R3 - Wild Blind Test

**Final verdict: REQUEST CHANGES.** Frozen product: `50bb3fad2189b54f45f4cc0e0c6d2071d2e73090`. Date: 2026-11-26.

This reviewer did not implement the product or participate in previous reviews. The complete supplied task, AGENTS, README and roadmap principles were read before testing. Sampling and the private pre-engine oracle were fixed before the first Mio execution. Only old source URLs, hashes and topology were used for deduplication; previous expectations and results did not supply the oracle. Other reviewers' current-round findings were read only after the initial independent REQUEST CHANGES conclusion.

## Blocker

None established in this slice.

## High B-H1 - A real mode/count-controlled LoRA stack violates its upstream contract

Independent blind sample **R3-01**, a 153-node public author API, contains three `easy loraStack` nodes with `mode=simple`, `toggle=true`. The upstream implementation uses only the simple weight for both model and CLIP, visits slots `1..num_loras`, and preserves the unused advanced-mode draft values. Source snapshots and hashes are recorded in `upstream-contract-index.json`; the owning implementation is [EasyUse loaders.py](https://raw.githubusercontent.com/yolain/ComfyUI-Easy-Use/HEAD/py/nodes/loaders.py), class `loraStack`.

Actual contracts and results, without asset names:

- There are **10 effective entries**: node 815 slots 1-4, node 1248 slots 1-4, node 1252 slots 1-2. Mio reports **12 active entries**, including node 1252's stored but out-of-count slots 3-4.
- **7 of 10 effective entries have an incorrect displayed CLIP weight**. For example node 815 slot 3 executes at model/CLIP `2/2`, but controls report `2/1`; node 1248 slot 1 executes at `0.6/0.6`, but controls report `0.6/1`.
- Applying equal negative weights, or disabling one entry, should change only that entry's active simple-weight field. In **20/20 focused exact graph comparisons**, Mio additionally rewrites both inactive advanced model/CLIP draft fields. Links remain intact and the original graph remains immutable, but the submitted copy contains unrelated input changes. Supplying different model and CLIP weights also cannot have the represented meaning while the source remains in simple mode.

Locations: `workflow_slot_shapes.py:26-75`, `workflow_slot_values.py:19-53`, and `_apply_stack` in `workflow_slot_writers.py`. The existing switched-weight structural contract covers a different flat layout, while this layout falls through to apparent mirrors. Fix mode/count activation and preserve inactive fields through a declared/generic structural contract or a clear read-only boundary; do not treat simultaneous field presence as proof that all fields are active mirrors. Keep the failed source sample and synthetic minimal topology for the next implementation/review round.

Evidence: `pre-engine-expectations-private.json`, `probe-results-private.json`, `followups-private.json`; shareable numeric summaries are in `sanitized-results.json`. The source API also retains unresolved frontend broadcasts, but this does not invalidate the local stack contract: its selected entries and output tuple weights are deterministic, and Mio exposes them as active writable controls.

## Medium B-M1 - Fixed aspect presets make automatic width/height writes ineffective

Independent blind sample **R3-03** has an `SDXLAspectRatio` node 84, with literal width/height 64 and a fixed 4:3 preset. Its outputs feed the initial generation latent through an Efficient Loader. Mio automatically binds `width` and `height` to node 84's numeric fields and reports no missing core kinds. Requesting **768x640** writes those literal fields accurately, while leaving the controlling preset unchanged. The matching upstream pure method returns **1152x896 before and after the change**.

`contract-verification.json` preserves this proof. The reviewed pure legacy method has no function calls: only comparisons, assignments and return; no tensors, model loads or GPU operations were involved. Its declared width/height/default-64 contract matches this source payload. The current owner implementation also derives dimensions exclusively from the preset. Sources: [owner current implementation](https://raw.githubusercontent.com/throttlekitty/SDXLCustomAspectRatio/HEAD/SDXLAspectRatio.py) and [immutable legacy source snapshot](https://huggingface.co/faisalhr1997/comfyui/raw/8074f11d04be3ce0a96e82c73b9af8ff966e508e/SDXLAspectRatio.py).

Location: `binding_dimensions.py:98-130` infers semantic dimension ownership from width/height-shaped scalar fields without proving their preset/mode activation. A trustworthy contract, direct latent-input mapping chosen by the user, or clear abstention is required. Accurate JSON writes alone are not proof of effective size control.

## Current-round cross-confirmed findings

After the independent conclusion, this reviewer read the current Generality and Compile reports and authored fresh neutral graphs in `cross_checks.py`. All five focused variants reproduce the other reviewers' findings on the frozen product:

- **High X-H1:** generated control-reference and style-reference samplers receive the main request's prompt, width and steps, while actual main-generation fields remain unchanged. Both compile with no warnings. These two variants are one causal-role root cause, not two separate defects.
- **Medium X-M1:** an undeclared selector output 1 returns `undeclared-output-port` in the low-level router, yet compilation writes the chosen output-0 branch's prompt and width with no warning.
- **Medium X-M2:** changing one object LoRA inserts another existing item's tag into a local text mirror and cross-inserts tags into the other mirror field.
- **Medium X-M3:** a clip-only keyed change on an accepted numeric-string chain changes unrequested model strength from string `0.7` to numeric `1`.

Evidence: `cross-check-results.json`. These are cross-confirmations, kept separate from the real blind-sample findings and sample denominators. No other reviewer's files were modified or executed.

## Low and contract observations

No additional Low defect is needed for this verdict. The frozen independent oracle expected only the initial generation seed to change. Two real samples instead change later refinement/upscale seeds too. The oracle and first results remain unchanged. Subsequent contract review found the explicit current product policy: all executed sampling stages share the unqualified seed; steps/CFG/sampler apply only to the first stage (`docs/COMFY_WORKFLOW_R2_REPAIRS_2026-11-26.md:30` and `test_primary_stage_prompts_and_size_do_not_overwrite_refiner_inputs`). This is recorded as a prewritten-oracle/product-policy discrepancy, **not silently changed into a pass, not counted as automatic recognition success, and not asserted as an additional product defect**. Explicit manual seed pointers precisely select the intended stage.

Initial manual reference checks had expected an implicit string-to-asset conversion. The raw compile endpoint accepts literal filenames or an explicit asset placeholder. The first result file is preserved; a focused follow-up supplied explicit placeholders and compared the complete graph. All 11 manual checks then pass without changing the source oracle. This was a harness expectation correction, not a product repair.

## Sample composition and deduplication

The fixed cohort has **15 real public workflows**, **10 JSON files and 5 original PNG metadata containers**: **11 API graphs and 4 UI-only graphs**. API graphs total **377 nodes**, maximum **153**. UI graphs total **914 nodes**, maximum **683**. Source ecosystems include EasyUse, Comfyroll, Efficiency, ControlNet, identity conditioning, IPAdapter, implicit broadcasts, string assembly, hooks, LoRA sets, routing and switches. Five metadata examples cover distinct modern editing/reference/split-noise architectures; actual checkpoint and LoRA asset names are excluded from this report.

| Sample | Actual format | Nodes | Preselected topology category |
|---|---:|---:|---|
| R3-01 | api | 153 | api-heavy-poster |
| R3-02 | api | 28 | api-identity-control-lora |
| R3-03 | api | 27 | api-multiref-lora-fusion |
| R3-04 | api | 37 | api-multicontrol-upscale |
| R3-05 | api | 32 | api-identity-text-assembly |
| R3-06 | api | 25 | api-inpaint-adapter |
| R3-07 | api | 15 | metadata-dual-stage-edit |
| R3-08 | api | 20 | metadata-reference-latents |
| R3-09 | api | 12 | metadata-image-edit |
| R3-10 | api | 19 | metadata-multireference-split |
| R3-11 | api | 9 | metadata-lora-distillation |
| R3-12 | ui | 30 | ui-regional-hook-compare |
| R3-13 | ui | 9 | ui-lora-sets |
| R3-14 | ui | 192 | ui-large-implicit-switch |
| R3-15 | ui | 683 | ui-giant-control-inpaint |

Every selected source URL, byte hash and topology fingerprint is new against **182 known URLs, 126 decodable old raw/graph files and 104 distinct topology fingerprints**, including current raw files, R1 and R2. A six-iteration labeled adjacency fingerprint ignores prompts, filenames and node IDs. **25 historical UI originals are unavailable**, so their topology cannot be verified; source/hash metadata is the only historical check for them. No old case was reused or replaced after observing a Mio result.

R3-15 uses a generic mask duplication utility from a video-named plugin suite. It was retained because it has no video load/combine or video-model execution path; the graph is a static multi-control inpainting workflow. The disallowed video, 3D and audio categories were not added to the test cohort.

## Actual handler and precision evidence

The harness calls the real `library` handlers for import, inspect-file with an original binary Request stream, inspect, LoRA description, compile and diagnose; it does not substitute the business implementations. Its store is in memory and its diagnostic client returns an explicitly declared local catalog. No existing app workspace, GPU, installed model, remote inference service, paid API or credentials were used.

| Check | Observed result | Meaning |
|---|---:|---|
| Original binary decoder versus independent metadata/JSON parsing | 15/15 | Exact decoded graph |
| API import graph preservation | 11/11 | Import accepted and persisted exact graph |
| API dry compilation returned | 11/11 | Does not certify GPU/dependency execution |
| UI-only actionable refusal and import rejection | 4/4 | Boundary handling, not executable import success |
| Automatic writes versus the targets actually selected by Mio | 11/11 | Writer precision only, independent of target correctness |
| Manual scalar/reference placeholder type-sensitive whole graph comparison | 11/11 | Requested writes only in selected execution closure |
| No-value compilation preserves every surviving original node | 11/11 | Pruned nodes are the selected output dependency closure |
| Three real standard-chain LoRAs: negative and disabled exact graph | 6/6 | No unrelated scalar/type/link changes |
| Ten real simple-mode stack entries: negative and disabled exact graph | 0/20 | B-H1, inactive advanced fields modified |
| Original source object, stored graph and raw file immutability | 15/15 | Original artifacts remain intact |

Three API samples contain **13 effective selected real LoRA entries**: ten mode-controlled stack entries and three standard-chain entries. The empty stack in a fourth API source is counted only as shape coverage. LoRA controls inside UI-only files are not claimed as executable or writable coverage. Negative values and individual disable were tested on all 13 effective entries. JSON comparisons distinguish int/float/bool/dict/list/string; preserving links and source objects is checked separately from semantic correctness.

Every API diagnosis with an empty catalog reports missing nodes and `ok=false`; that is an explicit missing-dependency test, not a live dependency certification. A second partial catalog taken from upstream CR and Save contracts reports all six missing model/CLIP inputs in R3-01's unresolved broadcast API. The correct boundary is to obtain an expanded API export/adapter and installed dependencies. Compile acceptance is not advertised here as a runnable image workflow.

## Artifacts, privacy and final signature

Shareable redacted artifacts: `report.md`, `sanitized-results.json`, `cross-check-results.json`, `contract-verification.json`, `dedup-verified.json` (no old private paths), and contract source references. Raw source manifests, graphs, binary containers, pre-engine oracle, detailed controls/results and collector scripts remain private temporary evidence for collection. They must not enter Git.

All writes made by this reviewer are under the single assigned temporary audit directory. Its subdirectories are `candidates`, `selected`, `graphs`, `contracts`, and Python cache. Exact locations are recorded separately in `temporary-directories-private.json`; no private absolute path is included here. Original R2 materials, product files, data, Git staging and commits were untouched. Git status was clean and HEAD remained the frozen commit at the check.

The initial independent conclusion and final cross-checked conclusion are both **REQUEST CHANGES**. B-H1 and B-M1 must be corrected and independently re-reviewed; current-round cross-confirmed defects also remain open. No GPU or real model execution claim is made.
