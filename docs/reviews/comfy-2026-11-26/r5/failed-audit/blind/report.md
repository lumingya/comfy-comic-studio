# Independent R5 fresh blind audit

**Verdict: REQUEST CHANGES.** Two Medium findings affect generic manual recovery and reference-role guidance. No Blocker or High finding was established. This is an independent first version; no peer R5 report or old oracle was read.

## Fixed identity and scope

- Candidate: `fa6308384826fad7629b2c727d70230cc7951d05`; full-task diff base: `38838ab43cf3d056951f2fc6c52afb737d34e3c6`.
- Selection and semantic targets were sealed before any product import at `2026-11-26T07:10:51.970101+00:00`. The batch/output supplement was also sealed before the first product import.
- Fresh selection: 12 public static workflows from 8 public repositories: 10 API graphs and 2 editor-only boundaries, including one original PNG containing editor metadata only. No video, audio, animation or 3D graph was selected.
- Full raw SHA, cross-revision public source identities, normalized API/editor graph identities and directed-port WL32 topology were compared against the preflight ledger. All selected available layers miss. Two candidate topology matches were excluded before product use. The sample was never changed after product results.
- Historical limit: 25 missing originals have only 12-character raw prefixes, and 5 further candidate locations are absent. Their unavailable normalized/topology identities cannot be recomputed. No exhaustive novelty claim is made against those unavailable bytes.
- Actual product execution: public route operation functions, private in-memory store, real empty contribution registry. No shared database, HTTP persistence, browser, live ComfyUI call, plugin execution, render, GPU, paid API, dependency install, test suite or build. The only product lease was released immediately after the finite serial batch.
- Before the first product import, process affinity 1 and BelowNormal 16384 were set and read back fail-closed. PID, UTC and actual source SHA are in `probe-resource-before-import.json`. All 405 source files and the 217 runtime files match the frozen candidate aggregates.

## Independent findings

### R5-BLIND-M1 - Medium

Valid empty positive and negative string fields are missing from manual candidates, so the conservative inference boundary omits the actual recovery targets.

Both text fields are empty strings in the unchanged public source. Inspection reports both roles unbound, offers only three scalar candidates, and offers no text candidate. Both independently frozen exact mappings compile with the sole requested typed edit.

Relevant source: `server/mio_server/comfy/bindings.py:415`, `server/mio_server/comfy/bindings.py:424`, `server/mio_server/comfy/inspection.py:229`, `server/mio_server/comfy/inspection.py:231`.

Required direction: Generate literal text mapping candidates from field role/type without requiring nonempty current content; support paired semantic text field names generically and preserve explicit user selection. Do not infer execution contracts from values.

### R5-BLIND-M2 - Medium

Reference-role candidates stop at immediate consumers, losing the base/control role through ordinary resize and preprocessing paths. Distinct source roles collapse to the same generic reference candidate.

C05 has separate style source /5 and base/control source /21. Inspection offers only generic reference candidates for both; no base or control role survives. The frozen base mapping changes only /21 and the separate manual style override changes only /5, preserving the other source and every connection. C02 similarly offers only a generic reference for its resized base source.

Relevant source: `server/mio_server/comfy/inspection.py:248`, `server/mio_server/comfy/inspection.py:269`, `server/mio_server/comfy/inspection.py:276`.

Required direction: Trace source-image candidates through read-only semantic routes to downstream role consumers, retain distinct source identities, and expose uncertain multi-role choices for manual review instead of requiring a class whitelist or automatically overwriting multiple images.

## Results with separate denominators

| Check | Actual result |
|---|---:|
| API import | 10 / 10 |
| Editor-only rejection with human API-export guidance | 2 / 2; excluded from API execution success |
| Default final branch and exact surviving graph | 9 / 10; C10 requires explicit output selection |
| Explicit final output mapping and exact ancestor closure | 10 / 10 |
| Present scalar requests, including batch | 94 |
| Automatic resulting state exactly matches frozen target state | 62 / 94 |
| Demonstrated exact automatic writes, excluding no-op values | 56 / 87 change-bearing requests |
| Automatic non-exact present requests | 32: 15 rejected, 17 safely left unchanged with warnings |
| Explicit scalar mapping resulting state exactly matches frozen target state | 94 / 94 |
| Demonstrated exact explicit scalar writes | 87 / 87 change-bearing requests |
| Separate frozen custom pointer writes | 3 / 3 |
| Absent scalar requests | 16: 5 rejected, 11 unchanged; not counted as feature successes |
| Source documents unchanged | 10 / 10 API documents |
| Original source files unchanged | 12 / 12 |
| Real named adapter item, stable keyed weight and disable | 1 / 1; both operations correct |
| Empty declared-catalog diagnostics | 9 explicitly invalid; C10 blocked by missing default output |
| Invalid retained connections in successful diagnostic graph checks | 0 |

Automatic misses above are not automatically classified as defects: safe ambiguity, unsupported custom execution semantics and precise manual mapping are recorded separately. The two findings concern missing usable recovery candidates, rather than a demand to guess or overwrite ambiguous sources.

C10 is a two-stage bundled graph with no standalone image-sink edge. The engine does not infer an output. All frozen explicit mappings plus the final terminal selection work exactly. This is retained as a manual/custom-output boundary; it is not relabelled an automatic success.

C04 has image-derived dimension edges. No global width or height literal was declared in the oracle, and these edges remained intact. C09 has tile dimensions rather than global image dimensions; the unrelated tile controls remained intact.

Seven frozen scalar requests equal their source values. They prove only an exact resulting state, not a write. Six of those have exact automatic state and all seven have exact manual state. The demonstrated-write figures remove these no-ops.

## Sample identity and result ledger

| ID | Family | Form | Nodes | Default graph | Explicit output | Raw SHA-256 |
|---|---|---|---:|---|---|---|
| C01 | AuraFlow | API | 8 | exact | exact | `22c1c7c25dc09f3e600c0d64822fe638b8447ed2e64319473e791dffb2e5db29` |
| C02 | SD3 | API | 13 | exact | exact | `55f3d8dcd60bf90c552bac64f99a072d1dfeaa6f744fa6491931ed752ecfeb3e` |
| C03 | Kolors | API | 7 | exact | exact | `f2b4a1fd16f434f7d4ff50ad53b3cafd13091ae377e5438202f97088aee836b1` |
| C04 | Flux | API | 18 | exact | exact | `b76d1cd7916144c0df0cce459edf8dda18b59891e4927710f1779f0a2c788646` |
| C05 | SDXL | API | 17 | exact | exact | `cead3fa8bc56c54e5701fa997d77fd64756ce8690de063c4160c1d8255fc59ad` |
| C08 | SDXL | API | 8 | exact | exact | `d8361c675246514af83e6368f2368bf9612b10e1e496830fd50805dee44b3728` |
| C09 | SDXL | API | 9 | exact | exact | `7692e8e2ea6dfb10207a58b43aaf5e80c6f1e64d1ef0e690437f8ca0b527ce1c` |
| C10 | SDXL | API | 6 | manual boundary | exact | `ed42731e5aba02519c75e01edab0e4d951eac8eaedc8bde8eb75d361ef700993` |
| C11 | SDXL | API | 13 | exact | exact | `b08a655ee67f9dfcc767400454545e5e8f2feb52092de6dd7b67fe985c2c9190` |
| C13 | SDXL | API | 10 | exact | exact | `792ef1361b15be363136e508043cd0d75b3d532a937736d8fdc73054ffbc7c82` |
| C16 | Qwen Image | editor-only JSON | 18 | editor guidance | not executable | `61a903dadeee1f648e52cc2551a1fd2b29e81bc5fc8e7436092e9a136b01c7ff` |
| C17 | SD | editor-only PNG | 21 | editor guidance | not executable | `bffac37bdb77606530923cc392273ef2d681542eecede2466da7233818fc6bb4` |

Public pinned sources (original content remains private in the external audit directory):

- C01: public-source-url-sha256:500ca5663608650cfaaffb76a55c8cc37f2c8cdecb7312726f8cd9e5daa6334b
- C02: public-source-url-sha256:aef258bf4a293c5adccba6f6dc6731fd4803111f3263afa5be4d5bb6ad3851d9
- C03: public-source-url-sha256:2ce9ae0d0c4608e3f5c0bcc37af210c5e2c340a32776cb3c3cd6a4bc71d7c2cf
- C04: public-source-url-sha256:e46211583a1a3d8b9171651a22bc3ef4d669abb23abb2de7a6b31f3d7d9cebd5
- C05: public-source-url-sha256:f7baa427f07dbaba33d6ebffa9d99b066a79ec4e142b3e83415199734190db0a
- C08: public-source-url-sha256:0b7dbd574a1ac656edc0391a52a22563ae426577132aba13d3be8dd89e321444
- C09: public-source-url-sha256:82a43a52321d0fbdf41f7be4461d038ad5d9a7032bba1c129d9026f72c5ad617
- C10: public-source-url-sha256:fc1e3f9fd687013364ff6f36f2f994002d0955cbf3bf9b5f8831e535fa0e1869
- C11: public-source-url-sha256:2aac0ba9237dce3b27cd074b5f097ef3c0f63542ed7eecafe242465086bbd791
- C13: public-source-url-sha256:cd0a3f542952a31ff36221abb4723e3b8c5234178bfbf3fed5cb090b2d6c2d74
- C16: public-source-url-sha256:10794897a09343bd62fa3dfc129eec8d9ff91f1840eba6a17cd78079143e41e3
- C17: public-source-url-sha256:5a22e9aecd06bf10601c18af0118ae49b7652fc2affb672f33b3f03b910a0d77

## Audit quality corrections and limits

The immutable pre-product oracle mistakenly called the C04 adapter-shaped site a real named item. Read-back of the unchanged source proves its name is an empty string; the product correctly describes the site without inventing an item. This is an oracle-quality limitation, not a product defect. The sample and frozen oracle were not replaced or edited. Real named adapter coverage is one model-only item in C08; this set does not prove adjacent real chain or nested stack item preservation.

C08 disable writes integer zero, preserving the original integer representation, while its requested weight writes the exact floating value 0.375. The pre-product supplement explicitly accepts either native numeric zero for disable. The raw strict delta retains that int/float difference, but the assessment does not falsely grade it as corruption.

The diagnostic catalog is deliberately empty, so missing node kinds are expected and accurately surfaced. This does not validate installed assets, real plugin schemas or custom validation. The diagnosis operation for C10 preserves its default-output failure; the failed case remains in the denominator.

Selected API graphs have 6-18 nodes; the two editor cases have 18 and 21. This fresh set does not cover giant graphs, 30-plus real adapters, native nested subgraphs, WebP, or a real image carrying executable API metadata. Those remain outside this independent evidence and cannot be inferred from route-function success.

No source changes, commits, pushes or CI reruns were performed. CI success was a startup prerequisite supplied by the controller; independent CI/clean-up verification belongs to its separate reviewer and final delivery phase. No final cleanup is claimed here.

## Evidence and immutability

- Frozen selection: `selected-manifest.json`, `oracle.private.json`, `oracle-public.json`, `pre-product-seal.json`.
- Pre-product batch/output extension: `pre-product-supplement.json` and its seal.
- Every request: `results.json`; complete private operation returns, warnings, errors and source documents: `product-private/Cxx.json`.
- Result rows preserve expected/effective pointers, complete typed changed spans, error fingerprints, output closures, edges and source/document hashes. Original string values are represented only by type/length/hash in public projections.
- Assessment: `assessment.json`; resource/source receipt: `probe-resource-before-import.json`; completed product batch receipt: `product-run-complete.json`.
- The first version is sealed by `initial-seal.json`. Cross-review and any later interpretation must use separate files; these first-version artifacts must not be rewritten.

First-version UTC: `2026-11-26T07:19:48.685749+00:00`.
