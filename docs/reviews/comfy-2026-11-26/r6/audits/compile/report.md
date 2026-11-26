# R6 independent compile audit — initial report

Verdict: **VERIFIED PASS** for the compile role at candidate `fe914065c7aafb0672bfe10274361f83179ce7f1`, against task base `38838ab43cf3d056951f2fc6c52afb737d34e3c6`. Product findings: **Blocker 0 / High 0 / Medium 0 / Low 0**. This is the independently completed compile review, not a signature for the other R6 roles, cross-review, or final cleanup/publication/delivery.

The original main run remains **69/70**. Its one failure is an audit caller-input error, preserved with its original oracle and actual result. A separately frozen supplemental run is **15/15**. The new real manual-selection denominator is independently **29/29**: 18 prompt and 11 negative requests, each with a legal selected field, an actual single-field binding write, successful complete compilation, strict native-type graph equality, exact output closure, and unchanged source graph/document/file. These numbers are not combined into a compatibility percentage.

## Scope and independent method

I read the originating task, repository AGENTS/README/ROADMAP, the authorized common/role contracts, and the complete base-to-candidate changed-path inventory. The review span contains 224 changed paths. `static-scope.md` records the engine, API, cache, import, slot-adapter, frontend/client input-contract, and unrelated-change scope actually inspected. Historical reports served as identity/contract evidence, not as replacement oracles. No other R6 role product, finding, or verdict was read before this seal; no subagent was used.

All expectations were computed before the corresponding Mio import. Neutral fixtures were built independently. For real manual cases, I decoded only the specifically authorized originals, derived an editable term from the connected conditioning/text structure, chose its native scalar field, and froze a single-field request. Each oracle contains the entire expected binding-stage graph and complete compiled graph, the native type of every nested value, all changed/pruned pointers, output roots, and the complete dependency closure. Typed comparison distinguishes `int`, `float`, and `bool`; Python `==` alone is not the acceptance criterion. Full-graph exactness also checks every unmodified field and connection, including opaque native data.

The actual run separately captured unpruned binding-stage results and complete compile results. A legal compile prune is an expected graph delta, not an unnoticed second source mutation. The in-memory graph, isolated WorkflowDoc, and authorized original file hashes were checked independently for preservation. Warnings and error types/counts/hashes remain in the machine results; complete returns and real source graphs stay in private artifacts.

## Frozen executions and actual results

| Cohort | Frozen requests | Actual result | Evidence |
|---|---:|---|---|
| Main neutral suite | 47 | 46 pass, 1 retained audit input error; includes 1 expected `BindingError` rejection | `oracle-safe.json`, `results.json` |
| First real manual selections | 23 | 23 actual one-field writes, complete typed exact | Same main artifacts |
| Six initially unproved wildcard cases | 6 | 6 newly justified, separately frozen one-field writes; complete typed exact | `supplement/oracle-safe.json`, `supplement/results.json` |
| Corrected five-image caller input | 1 | Complete typed exact; all five upload placeholders exactly match | Same supplemental artifacts |
| Exact old-four source, automatic | 4 | Four exact conservative no-write results, with complete typed compilation | Same supplemental artifacts |
| Exact old-four source, explicit mapping | 4 | Four actual one-field writes; complete typed exact | Same supplemental artifacts |

The main lease `r6-compile-001` executed 70 complete compile calls, 70 unpruned binding calls, and 11 each of slot describe/analyze/apply. PID 36576 read back affinity `1` and priority `16384` before import and again after execution. Its request loop took 2.873973800044041 seconds; the execution tool reported 3.627 seconds of wall time. It exited and released the lease before further product work.

The supplemental root lease `r6-compile-002` executed exactly 15 complete compile and 15 unpruned binding calls, with zero slot calls. Root explicitly authorized the already-frozen argv token `r6-compile-supplement-001` as its one-to-one alias before launch; `supplement/lease-alias.json` records this, and it is counted as one execution. PID 39744 read back affinity `1` and priority `16384` before import and after execution. A daemon watchdog bounded the actual process to 90 seconds. Its request loop took 0.43540109996683896 seconds; the execution tool reported 1.4617388 seconds of wall time. It exited and released the lease immediately.

Both executions used `python -X utf8 -B`, one real process per exclusive lease, serial requests, no network during product execution, no model/GPU work, no user LoRA loading, and no local full suite/build/E2E. Runtime source identity was 218 Python modules, aggregate SHA256 `a00155daa5515501eb3ee117f284c2ae1f8152ac038d7efa7f6208c46b8ad487`. All-server identity was 407 Python files, aggregate SHA256 `018c572cec3c9a629b13e4ea3bf6f6b5fd1323b0581c5f696c294007c61f7b32`. All 407 raw-file hashes stayed unchanged. HEAD stayed at the candidate and the repository stayed clean. No repository/user-data edit, commit, push, dependency install, service restart, or cleanup of another task's files occurred.

## Coverage and source conclusions

The neutral matrix covers ordinary scalar parameters and combined writes; modern noise/guider/scheduler/custom-advanced sampling and multi-text encoding; primary/refiner stages and seed fan-out; ambiguous conditioning-stage ownership; unequal independent canvases; draft/final output tags and complete multi-output dependency closure; static selector rebinding; native identity and conservative unknown/auxiliary-output abstention; empty and composed text; explicit tag-plus-mapping fan-out; stage/config/value/pointer precedence; negative guard exclusion; nested native `int`/`float`/`bool`/dictionary preservation; and intact-link overwrite rejection.

The 11 LoRA cases cover 33-item chain, flat, and nested forms; repeated names addressed by independently computed stable occurrence keys; negative strength; model-only and optional CLIP; simple/advanced mode and saved count fields; disabling flat/nested entries; and native object-list/wrapped-list representation with text mirrors and disabled neighbors. Maximum described item count is 33. All 11 preserve the whole expected graph, native numeric representation, neighbor data, and links; they load no LoRA weights.

`comfy/compile.py:218,293` and `comfy/bindings.py:312,390` implement copy-on-write binding/override and full compile boundaries. The source inspection and probes support the separation between automatic semantic ownership and the larger execution dependency closure. Explicit tags/mappings retain ownership, complete execution links survive even when they are not automatic-write routes, and selector changes are rebound before final compilation. `binding_inference.py:333`, `binding_dimensions.py:149`, and the stage-scope logic conservatively decline ambiguous or opaque scalar routes rather than guess a transform's identity.

Slot shape/value/writer/plan/apply seams were reviewed in full alongside stable-key and registry dispatch behavior. Import and patch validate descriptions/controls before persistence; broken descriptions do not silently replace valid saved content. Catalog cache identity includes graph/config/plan/object-info and registry generation, with returned summaries copied rather than shared mutable execution state. These persistence/cache statements are source-contract review conclusions, not claims that this audit ran a database, cache stress suite, or browser flow.

## Real manual29 completion

The exact 29 identities, including both prompt and negative requests sharing an original, remain fixed. The first 23 selections produced exactly one actual binding delta each. Complete compile prunes of 0–2 nodes were independently expected and preserved in the full deltas. Six cases were initially left unproved because a connected wildcard processor contained two text fields and a boolean mode; no unrelated field was selected to manufacture a pass.

Before any supplemental product result, I resolved that ownership using pinned official plugin source at public commit `c4539f99df15cc94d772aeb933ae599c8117e20f`: [processor contract](https://raw.githubusercontent.com/ltdrdata/ComfyUI-Impact-Pack/c4539f99df15cc94d772aeb933ae599c8117e20f/modules/impact/impact_pack.py) (SHA256 `a276ffd9712560ebd841fb91177d238de8a43765b57c919d57ced70430c34a0f`) and [on-prompt mode handling](https://raw.githubusercontent.com/ltdrdata/ComfyUI-Impact-Pack/c4539f99df15cc94d772aeb933ae599c8117e20f/modules/impact/impact_server.py) (SHA256 `20808711e81a27a9236992a3a8d1d58203b8b8fdedcca9475ee0262ef050640d`). Boolean true selects populate behavior, whose input owner is `/107/inputs/wildcard_text`; boolean false selects fixed behavior, whose emitted text owner is `/107/inputs/populated_text`. Five cases use the former and one the latter. The strings are connected to `/30/inputs/text`. This justifies a selected text term; it does not claim to replace every authored region. Neither the plugin nor an installed-version environment was executed or certified.

The six exact identities and mode-dependent targets were frozen separately, then all six actual mappings and complete compiles passed. Thus new manual29 selected/actually-written/compiled/strict-typed-exact counts are each 29, with zero remaining unproved. All 29 preserve the source graph, document, original file, surviving links, native unrelated fields, and expected outputs/closure. `consolidated-results.json` lists every request's expected/actual pointer and complete safe typed delta. The initial 23-selected/6-unproved record remains unchanged in the main artifacts.

## Retained audit input failure

The main `five-image-role-placeholders` request supplied five bare strings directly to `compile_workflow` but expected five asset dictionaries. The compiler correctly writes direct caller values literally. The explicit `compile.asset_value` helper and the pipeline callers in `pipeline/refs.py` and `pipeline/render_edits.py` supply the asset wrapper. This was my frozen input/oracle mismatch, not evidence of a wrong image-role target or graph corruption. Its initial failure and complete actual result remain unchanged.

The separately frozen corrected-input case changes only the caller values to the legal asset representation. It proves all five mask/reference/reference/control/init destinations, complete typed graph and closure, and the exact five-entry uploads map. It is reported as a new supplemental request, not as a rewritten main pass or a 70/70 result.

## Historical denominators and old four false results

The historical current75 core remains **230 = 46 API graphs × 5 requests**, with truth **160 automatic + 29 unmapped manual-required abstentions + 41 absent**. The old complete-graph checks used Python value equality. Old explicit selected-mapping operations are **zero**. They cannot supply the new 29 typed manual writes.

The four old false records share source ID `2df6c0ad8d1a`, raw-container SHA256 `d35c3cfd94b382e7a56b0be98e50a9a4680e9f4d13c7b3c7595cf82de9edfd5e`. They recorded missing automatic targets, successful compile, and no wrong-target writes for prompt, negative, width, and height. Root subsequently authorized only this exact original. I independently decoded its PNG metadata and established a 58-node graph with seven native sampling stages, seven ReferenceLatent nodes, seven native canvases, three saved outputs, and a 57-node execution closure. The canvas dimensions are equal, but reference-latent dependencies couple the conditioning/stage structure. This is more than a trivial single-stage canvas.

The fresh frozen automatic expectations are conservative abstention for all four. All four actual binding graphs remain unchanged, and all four complete compiles exactly match the native-type closure oracle. Four independent explicit requests then select `/6/inputs/text`, `/33/inputs/text`, `/27/inputs/width`, and `/27/inputs/height`. Each changes exactly its chosen field and nothing else before the expected one-node preview prune. These are legal first-stage text/canvas or shared-negative selections; they do not assert that one pointer rewrites every branch. The fresh automatic and explicit results explain the boundary, but the old four remain four false results under their old truth. No old oracle was replaced or reclassified as passed.

The separate historical private graph has 138 nodes, 43 LoRAs, no explicit tags/config mapping, and a recorded complete compile failure from missing frontend state. Its historical binding-only dimension/batch behavior is not a current whole-compile proof. I did not copy/repair that graph, fetch user state, or run a new private138 compile. The historical independent tag/mapping count of 29 is 28 binding-test methods plus one separate slot-acceptance method; it is a different denominator, not 29 private138 executions. The new neutral tag/mapping cases do not fill this private full-compile gap.

## Evidence, limitations, and process disclosure

Primary frozen evidence:

- Main freeze SHA256 `b1b603d4efeb03430f22dde2681485dc5d4824d28301098bda5d4c35e0b3dbfe`; main results SHA256 `636c8e6d7ad50ffcca48217336927f3d578e45ab3474ab63fb2fa46b0ec8d075`.
- Supplemental freeze SHA256 `022aebbdca19c8d794cb36ccf774a2a59f9a4a71ca730e9b460729801f340aed`; supplemental results SHA256 `51f037774c6ece0b93e165a4e7ad15e7bb348e4d876f1be55309401e61a1cd99`.
- Consolidated results SHA256 `2a2fc0573086eb9ecb633c3f9af3e4322f723368db96347a3c59d85554b145c9`; the seal inventories every initial artifact's raw SHA256, including private fixtures/oracles/results and exact executed harnesses.

The source/typed compile conclusion is supported by the actual bounded executions above. Browser appearance/interaction, wire-JSON float spelling, installed custom-node execution, ComfyUI submission, models/GPU, unknown dynamic plugin semantics, and a fresh private138 full compile are not proved by this role. Remote full-suite/CI activation was root's prerequisite evidence, not a local suite run or an independently replayed CI audit here. These limits do not hide a failed product request: the only initial failure is retained and attributed above.

One process disclosure is retained: while reading the newly authorized old-four identity, a tool output included that shallow identity record's owned-TEMP original path and hash-named basename. It did not contain the original graph, prompt, model/LoRA asset names, or credentials. I stopped that raw-record output path, informed root, and used whitelist projections for subsequent source decoding. This is not a claim of zero output events, nor clearance of unknown prior-round truncated content. It is separate from the zero product-defect counts above and remains available for root/privacy review.

This initial report, original machine results, inputs/oracles, and seal are immutable after sealing. Any later same-round cross-review/final decision must be a new artifact with its own provenance.
