# eb876cf terminal retest: saved failures and static attribution

This is attribution of the completed fixed-corpus run, not another product measurement. Original truth and the saved 6f9bdf2/50bb3fa outputs remain unchanged. `delta-summary.json` records complete before/current pointer multisets for every changed kind. `delta-evidence.json` records selected public node type/port facts without literal input values.

| Original R1 check | Original truth = 6f9 = 50bb | eb876cf | Result retained |
|---|---|---|---|
| `noisy_latents_3_subjects.png` prompt | `[]` (manual) | `[/71/inputs/text]` | incorrect; whole-graph exact=false |
| `helper/hf-lora-stack.json` width | `[/134/inputs/width]` | `[]` | missing; whole-graph exact=false |
| `helper/hf-lora-stack.json` height | `[/134/inputs/height]` | `[]` | missing; whole-graph exact=false |

The unchanged denominator is 70; the terminal R1 result remains **67/70**, not a rewritten truth denominator or new PASS classification. current75 remains230/230, explicit R1 mapping20/20, true LoRA7 items/14 exact operations.

## Unsafe noisy composition regression

The image output path is `Save9.images <- Decode8.samples <- Sampler58.latent_image <- LatentComposite75`. Compositors75/69/61 carry upstream samplers57/60/64/73 through `samples_to`/`samples_from`. The current exact canvas-port vocabulary omits both payload fields. It stops before those upstream stages and incorrectly promotes downstream sampler58 to primary. Since `Sampler58.positive <- CLIPTextEncode71.text`, `/71/inputs/text` becomes an automatic prompt target despite the original independent manual truth for multiple prompts.

Additional actual multiset changes in the same sample: batch targets5/62/65 are removed; steps/cfg/sampler/scheduler move from57/60/64/73 to58. All executable seed targets remain57/58/60/64/73. Generic ambiguous/unbound warnings do not make the new automatic prompt safe.

## hf safety withdrawal, still two old truth failures

`Save229.images <- ColorEnhance227.image <- ColorMatch225`. ColorMatch225 has `source <- Decode136 <- Sampler135 <- EmptyLatent134` and `target <- Sharpen213 <- Upscale210 <- Upscale200 <- Sharpen145 <- Decode136`. Neither `source` nor `target` proves a canvas role by name, and no trusted output-port contract establishes output identity. The primary set becomes empty, withdrawing width/height/batch134 and steps/cfg/sampler/scheduler135.

This is a conservative manual boundary, but the two original automatic dimension truth checks remain missing. Seed135/200/210 still fan out. Explicit prompt/negative mapping operations remain exact; those are separate from automatic dimensions.

## Three supplement policy changes outside the five annotated kinds

Samples `7b2a5c320f0b`, `e160259f512e`, `7c4ec6c02960` share `Sampler6 -> IterativeLatentUpscale14.samples` and `PixelKSampleUpscalerProvider30 -> IterativeLatentUpscale14.upscaler`. Provider30 is execution configuration, not an independent first canvas stage. Its steps/cfg/denoise/sampler/scheduler auto targets are removed; seed30 remains. The five independently annotated prompt/negative/seed/width/height checks remain exact, but there is no independent old truth for these provider controls, so no new PASS proof is invented.

## Private138: additional batch withdrawal and warning gap

Actual saved result: old6f9/50bb counts `output1, batch1, width1, height1, seed2`; eb876cf counts `output1, seed2`. Thus **three** automatic targets are withdrawn. Width/height map back explicitly in the recorded two in-memory binding-stage operations; batch mapping was not additionally executed. Original config mapping count0 and explicit tags0 remain unchanged. Full compile remainsfalse for missing frontend state; LoRA43, DB bytes/payload and source document stay unchanged.

The scope owner's static attribution uses the committed138-node fixture: `Save4277.images -> 4612:4611.image -> 4612:4610(ifElse) -> 4612:4835.image -> 3827(ifElse) -> 365`. Node365 carries `A or B <- 366:1` and `in <- 366:0`; node366 (`ImpactIfNone`) carries `signal`/`any_input <- 4407:0`. No declared identity route establishes that bundle's canvas output. The unique batch holder2848 (`EmptyLatentImage`) still feeds `Context2856/4571/4583.latent`, with further `ContextSwitch3260.ctx_02` and `Context4592.base_ctx` dependencies. Those are not proven canvas payload contracts. Batch is outside a provable primary canvas lineage; this is distinct from numeric-helper width/height stopping.

This path is expressly fixture/source attribution. The terminal private measurement did not export a graph fingerprint proving byte equality to the fixture, so no fresh private payload equality claim is made. No class-name exception, automatic restoration, DB write or additional engine call was performed.

Actual inspection codes: `ambiguous`, `compile_error`, `dependencies_unchecked`, `unbound`. `inspection.py` missing/unbound loops only `CORE_KINDS`, which excludes batch; no batch-specific inspect notice is established. `compile.py` appends an ignored requested-value notice recommending tag/mapping/trusted adapter before frontend planning, but no returned batch notice was observed: the saved full compile used no values and still fails for missing frontend state. Do not turn this static warning path into tested user-visible batch coverage.
