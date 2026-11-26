# R3 Fixed-Cohort Repair Retest

**Completed repair checks: VERIFIED PASS. Independent final audit sign-off: NOT PERFORMED.** This is a repair retest of the original fixed 15-source cohort, not a new blind sample or replacement of the original REQUEST CHANGES audit. The original prewritten seed oracle remains unchanged and its two-sample discrepancy is explicitly not counted as automatic recognition success.

After the resource-stop instruction, this reviewer performed only existing-result organization and lightweight file hashing. No product call, test, browser or new probe was started. The completed main and mode-variant JSON files predate the stop. A read-only process inventory found no running Python process whose command line belonged to this retest directory. No process outside this reviewer's ownership was stopped.

## Source and evidence identity

The run used the frozen repair working tree while Git HEAD still named the prior audit commit. It is now committed as `eb876cfbb8cf14de34a99b6544469460c11acc24`. All **399 backend Python files**, including newly added modules and tests, have identical paths and SHA-256 values before the completed run and at the post-commit read-only check. The before/after aggregate is `fc05610ec3081baf270e2700a1b973cf25bcc0b0db576da30016fde0f0503d38`. This aggregate uses `json.dumps(files, sort_keys=True)` with default separators. The cross-check's compact-separator aggregate is `4b9a7dbbc103779a63556e33693bdb02ffc2d5ffe57f67e9869390633319b5cd`; its complete per-file map is identical. These two aggregate strings describe the same source files.

All **86 original R3 evidence files** remain byte-identical, with no added or missing file. Evidence-map aggregate before/after: `c581cd198ec46cdf1b8eea673986ef7bf61e32eb313c71627261ed571cfb7645`. The copied manifest, prewritten oracle and two helpers are byte-identical to their originals. Full relative-path source hashes are retained in `backend-source-sha256-before.json` and `backend-source-sha256-after.json`; `file-integrity-check.json` records comparisons. These checks read files only.

| Original artifact | Preserved SHA-256 |
|---|---|
| `report.md` | `41de347d55b8525a7ffd9edb6acdcdb0c29acfb62dbc7e9e3941fd6ca1d443e5` |
| `sanitized-results.json` | `535bd8b7ffe8ab907808e8ea1e5fb9247fc8e1a23877b86038871664e538d978` |
| `pre-engine-expectations-private.json` | `6517239fbf8669cc78737772970279ed1d76d2f25f814fe3113d989ce9bf88ef` |
| `selected-manifest.json` | `d35a4b2b9614d1cbdd8a612c61dd43f4df7afac7360f7b104b6a1ad0543b390f` |
| `cross_checks.py` | `c69e0de7c5a6d5881222d96a036380b4672253d1e972ae34f61b342e00d42ad5` |
| `cross-check-results.json` | `90bf2883d3496bdeee87c680bc489d822f2027bc92e27c63721cdc0a3dc63910` |

## Blocker

None established by these completed repair checks. This statement does not replace whole-product gates or a new independent final review.

## High

**B-H1 — CLOSED in the fixed real sample.** The three simple/count-controlled stack sites now expose **10 effective entries rather than 12**. The two dormant out-of-count entries remain stored but are not exposed as active entries. Default effective model/CLIP weights match all 10 original oracle entries: the prior **7 incorrect CLIP defaults become 0**. Negative and disabled operations are now **20/20 exact complete-graph matches**, versus 0/20 before the repair. Each operation changes only its active simple weight; inactive advanced-mode drafts, count-inactive drafts, all links and the source graph remain unchanged. The three standard-chain entries also pass **6/6** negative/disabled operations. Across the original cohort, all **13 effective real LoRA entries** are covered.

An additional, explicitly derived advanced-mode variant covers the same 10 entries at the same three sites. Its **20/20** negative/disabled complete-graph comparisons pass, changing only active advanced model/CLIP fields and preserving simple-mode drafts. These variants are supplemental metamorphic checks; they do not replace real sources, change the fixed count/oracle or claim new blind-sample coverage. Arbitrary unknown mode/count layouts were not newly probed.

**X-H1 — CLOSED in both original neutral variants.** Generated control-reference and style-reference branches retain their complete auxiliary subgraphs; only the intended main prompt, width and steps change. Both full-graph comparisons and separate link checks pass.

## Medium

**B-M1 — CLOSED through safe abstention and a demonstrated effective manual control.** In the original fixed-preset sample, automatic `width` and `height` bindings are empty. Requesting 768x640 yields warnings for both missing effective bindings and leaves the entire preset node unchanged. It no longer silently writes inactive numeric draft fields as though they control size.

The existing JSON-pointer override of the controlling `aspectRatio` preset is an effective manual takeover point. Changing only that preset produces an exact whole-graph delta and preserves links. The same reviewed no-call upstream pure function used by the original audit yields **1152x896 before and 1024x1024 after**. This proves the selected supported preset change. It does **not** prove arbitrary requested numeric dimensions are achievable through the inactive numeric width/height fields; their manual byte-write precision remains distinct from effective dimension semantics. No models or GPU operations are involved in the pure upstream method.

**X-M1 — CLOSED through safe abstention.** The original undeclared selector output still reports `undeclared-output-port`. The full graph remains unchanged under the requested automatic values and warnings are emitted; a different payload branch is no longer silently written.

**X-M2 — CLOSED.** The selected object LoRA strength and its existing local text mirror change exactly. Other mirror tag membership remains unchanged; no unrequested cross-field tag is inserted.

**X-M3 — CLOSED.** A clip-only keyed change modifies only the CLIP pointer. The unrequested model strength remains the original string `0.7`, preserving its type and value.

All five neutral cross-checks pass type-sensitive whole-graph, source/document immutability and independent link checks. Their original graph constructors and original evidence were retained. `cross/sanitized-results.json` contains the completed observations; the cross-check source map is identical to the 15-sample retest source map.

## Low and retained contract discrepancy

No additional Low defect was established. **The original seed discrepancy remains open as an oracle/product-policy difference, not converted into a pass.** Samples R3-03 and R3-04 still select three later-stage seed targets beyond the original first-stage-only oracle. The explicit product policy synchronizes unqualified seed across all executed sampling stages while retaining first-stage scope for steps/CFG/sampler. That policy was already documented and tested before this retest. The fixed truth is unchanged, and these cases are not counted as automatic semantic recognition success. This retest does not establish them as a new implementation defect.

## Actual completed coverage

The unchanged cohort contains **15 real public sources: 10 JSON files and 5 original PNG metadata containers**, comprising **11 API and 4 UI-only graphs**. Sampling, provenance and the old deduplication limits remain those of the original audit; no source was replaced after observing repaired behavior. It still spans complex routing/control/reference, identity conditioning, inpainting, upscaling, split sampling, mode-controlled LoRA stacks, standard LoRA chains and large UI-only graphs. Original model and LoRA asset names are withheld.

| Completed check | Result | Scope |
|---|---:|---|
| Original binary decoding and inspect-file consistency | 15/15 | Original JSON/container bytes, exact graph |
| API import preserves original graph | 11/11 | Actual handler and in-memory store |
| UI actionable refusal and import rejection | 4/4 | Boundary check; not executable import success |
| LoRA description, compile and empty-catalogue diagnose | 11/11 API cases | Actual handlers; empty catalogue must reject runnable status |
| No-value compilation preserves surviving source nodes | 11/11 | Expected output-closure pruning distinguished |
| Automatic writer precision against actually selected targets | 11/11 | Not a claim that every semantic target is known |
| Manual scalar/explicit asset-placeholder complete-graph precision | 11/11 | Does not prove inactive preset numeric fields are effective |
| Original input graphs and raw file hashes unchanged | 15/15 | Stored API graph immutability also 11/11 |
| Real effective LoRA negative/disabled operations | 26/26 | 20 stack plus 6 standard chain |
| Advanced-mode supplemental operations | 20/20 | Inactive simple drafts, source and links preserved |
| Original neutral cross-check variants | 5/5 | Main-role ownership, selector scope and lossless LoRA writes |

The four rejected UI-only cases have no executable API to import, so LoRA/compile/diagnose were not called on a fabricated import for them. They are not added to the API success denominator. All graph comparisons distinguish integer, float, boolean, string, list and dictionary types. Semantic target selection, effective upstream behavior, graph write precision, link preservation and source immutability are reported separately.

## Not executed and limits

No product rerun or additional probe was permitted after the CPU stop. The already completed 15-case batch, 26 real-LoRA operations, 20 advanced-mode operations, preset check and all five original cross-check variants are present in saved result files; none was completed by a later hidden run. No additional stress/repetition, browser interaction, full repository gates, GPU/model load, installation, live dependency service or inference validation was performed by this reviewer. The original secondary partial-authoritative-catalogue diagnose probe was not rerun; only the declared empty catalogue was retested. An accepted API dry compile is not a GPU/dependency execution certificate.

No unexpected graph/type delta appears in these completed comparisons. This is a scoped repair verification result. The original independent audit and its REQUEST CHANGES signature remain preserved; this report does not issue a fresh independent final sign-off or whole-product gate approval.

## Artifacts and privacy

Publishable outputs are this `report.md`, `sanitized-results.json`, and the already redacted cross report/results. Detailed observations, manifests and original references remain private temporary evidence. This report contains no original graph inputs, author prompt, model asset name, credential or private absolute path. All new work stays in this repair-retest directory and its `cross` subdirectory. Product files, old audits, data, Git staging and commits were not changed by this reviewer.
