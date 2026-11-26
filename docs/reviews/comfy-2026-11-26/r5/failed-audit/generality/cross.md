# R5 generality cross-review

**REQUEST CHANGES.** I independently accept `R5-BLIND-M1` and `R5-BLIND-M2` as two distinct Medium findings in generality/manual recovery. They are discovery and guidance failures within the requested compatibility work. Successful explicit writes do not remove them. There is no conditional pass.

Candidate: `fa6308384826fad7629b2c727d70230cc7951d05`.
Full-task base: `38838ab43cf3d056951f2fc6c52afb737d34e3c6`.
UTC and artifact hashes are fixed by `final.json`. My initial report and seal remain unchanged.

## Evidence and independence

This is the authorized cross phase after all five independent initial reports were sealed. I verified 16 consumed initial artifacts against their role seals, including my own four sealed files. I separately verified the safe blind cross projection SHA `7d12aeb45cc1e9fdbc963e6d912ec5c42c4b399ff81f58d553bc1f90ac282554`; its three underlying result hashes are present in the blind initial seal. I re-read the relevant source and the candidate-rendering interface. The public projection supplies frozen sample facts; source and port-path reasoning below are my own. This does not independently reproduce the producer's private-to-public projection after private reads were stopped.

`cross-evidence.json` records actual hashes, whitelisted counts, pointer deltas, source-preservation flags, and the port edges used here. `cross_verify.py` is a pure-file checker; it imports no application modules and performs no test or product call. Its two initial fail-closed assertions exposed my own schema assumptions, not product failures: image cases have two full-source deltas because of legitimate predeclared pruning, and per-sample frozen-result hashes identify sealed underlying result files rather than the combined public result file. The final checker retains both distinctions.

Git HEAD was read back at the candidate and status was empty. Source identities remain the initial 217-module runtime aggregate `5a5ee950ae0c972791ae17fab92978579adec7d6d419133e6eaf9eb9e649377d` and 405-file server aggregate `7a8dec42eb98849d6eff92dfeb84dd9b329136ee7e16a754b367bb7dda60da17`; this cross phase did not re-execute those modules.

## Medium: empty and paired semantic text fields disappear from manual recovery

The frozen C03 facts contain two valid string fields of length zero at `/3/inputs/prompt` and `/3/inputs/negative_prompt`. Inspection offers only three scalar candidates: seed, width, and height. It offers neither text role. Each predeclared explicit text mapping has one full-source replacement, exactly the expected graph, zero oracle differences, and exactly the expected effective target. The source graph, document, and file preservation flags are true.

The source explains this independently. `server/mio_server/comfy/bindings.py:415-425` enumerates reachable encoder strings only when their stripped value is nonempty. `server/mio_server/comfy/inspection.py:229-234` then applies the shared text-field allowlist; `bindings.py:69-82` does not include the paired negative semantic field. Thus simply removing the blank-value filter would still leave the negative-field discovery gap. `web/src/pages/settings/WorkflowInspection.tsx:225-232` renders the supplied candidates, so the missing server candidates cannot become selectable through that interface.

This is one Medium root cause: manual text discovery depends on populated content and an incomplete semantic-field model. It is not two findings and is not a requirement to guess and execute arbitrary custom encoders. A correction should expose valid empty text targets and distinguish paired semantic roles while preserving explicit tags/mapping precedence and conservative automatic inference.

## Medium: transformed image sources lose their downstream manual roles

The safe frozen port evidence independently establishes indirect use:

- C02: source `/275/0` reaches `/277/inputs/image`, then `/277/0` reaches `/278/inputs/pixels`. The source candidate is only generic reference.
- C05: `/21/0` reaches `/22/inputs/image`, then `/22/0` reaches `/23/inputs/pixels`. A second branch reaches `/19/inputs/image` and then `/18/inputs/image`; that same consumer also receives `/18/inputs/control_net`. A separate source `/5/0` reaches `/4/inputs/image`.
- C05 offers two generic reference source candidates, with no base-image or control candidate. C02 likewise has neither indirect role.

The reported resize/preprocess categories are neutral descriptions from the blind evidence. My independent check relies on the actual public port chains and terminal role fields; it does not establish any opaque plugin's runtime identity semantics.

`server/mio_server/comfy/inspection.py:248-280` builds immediate consumers and classifies image source roles only from those immediate consumers. It never follows the above downstream image lineage. This explains why an intermediate image-processing step erases useful manual role guidance.

The explicit predeclared base mappings reach only `/275/inputs/image` and `/21/inputs/image`; the independent style pointer reaches only `/5/inputs/image`. All three expected graphs are exact and all oracle differences are zero. Full-source deltas are **two each**, not one: the target replacement plus legitimate removal at `/135` for C02 or `/20` for C05. Those removals match the frozen output closure. The source graph, document, and file preservation flags are true.

This is one Medium root cause: downstream role information is lost at the manual-candidate layer. It is distinct from the text discovery issue. A correction should use bounded, port-aware, read-only lineage to offer appropriate or explicitly uncertain manual roles for ordinary image-processing chains, preserving separate sources. It must not turn arbitrary unknown transformations into automatic identity rewrites. Existing conservative automatic binding boundaries remain appropriate.

## Five-role interface and deduplication

| Role | Cross conclusion and retained boundary |
| --- | --- |
| Generality | Initial full-task static review added no product finding. The two blind discoveries are independently accepted here and counted once each. Graph/slot/adapter separation, contribution/cache ownership, stages, unknown-node conservatism, and minimal writes retain the initial scope and limits. |
| Blind | Two Medium discovery findings above. Twelve new public samples do not become twelve automatic successes: API import, UI guidance, automatic request changes, explicit mapping, and absent-request behavior retain separate denominators. No change to the frozen oracle. |
| Compile | The public result independently checks 27/27 declared cases and 173 typed changes. C06 covers explicit five-image roles and paired text; C12 covers tag-plus-mapping fanout; C08/C27 cover explicit typed mapping. Exact graph, typed delta, closure, connections, and source-document checks are true in those cases. These explicit compilation cases do not cover empty-text discovery or indirect image-role candidates. No compile defect is added. |
| Web | The original 112/136 checks and 24 strict-hash failures are retained. All 12 exports have exactly two complete typed differences: `/5/inputs/cfg` and `/5/inputs/denoise`, float to int with the same numeric value. No strict preservation pass is invented. This remains the Web Low number-representation observation; no downstream value/connection failure is demonstrated here. The separate single 1125.23 ms action remains a Low bounded timing observation, including locator/scroll/actionability time, not a rendering benchmark. Different fixtures and successful manual UI actions do not clear the blind discovery failures. |
| Privacy | Retain one publication Low covering three historical documents with one existing neutral asset identifier, rather than three duplicate findings. No additional credential finding is established by my cross review. Privacy owns the actual remote-command/checkout verification; I did not rerun CI. Final cleanup and final delivery remain to be proved by the controller. My two process events below remain separately visible. |

For the round's deduplicated finding inventory this cross accepts two Medium product/manual-experience findings, two Web Low observations, and one publication Low observation. The initial compile and generality reviews add no duplicate product issue. Process events are not silently merged into product counts or treated as new evidence of a private-user-graph leak.

## Process limits: two separate output events

Paths in this section are exact controlled paths relative to the already declared repository or external audit root. No exposed value is repeated here.

1. **Initial fixture-diff event.** During the full-task review I directly returned a Git diff containing the existing tracked `server/fixtures/workflow_slots_contract.json`, alongside source changes. Terminal output contained existing fixture text snippets and asset identifiers and was truncated. No credentials were visible. I cannot establish that the unreturned/truncated portion had no sensitive strings, and I cannot infer real-world ownership from synthetic or preexisting controlled data. This was not an external private-graph import or a new raw sample copy. I stopped full fixture/raw-diff output and disclosed it before sealing the initial report. The initial report already records its Low process observation.
2. **Cross nested-request projection event.** A pure-file metadata reader loaded `blind/product-private/C02.json`, `blind/product-private/C03.json`, and `blind/product-private/C05.json`. Before the stop it also read cached candidate records, source-field metadata, and graph envelopes in memory. One output incorrectly serialized nested request objects because a field expected to be a name string was actually an object. It returned 11, 11, and 12 pre-frozen reviewer request entries, respectively: 34 entries in three blocks in one terminal event. Exposed categories were reviewer-authored neutral text, synthetic image identifiers, generic sampling items, numbers, and target pointers. No source graph object or original-author source prompt was returned by that output, and no credentials were visible. This does not justify claiming unknown cached or truncated data are free of sensitive content.

I promptly disclosed the second event to the controller and privacy reviewer. The controller explicitly stopped further private-result, private-oracle, and original-sample reads. I complied. Subsequent work used only named public artifacts and source, with explicit primitive/role/port whitelists and fail-closed schema checks. There were no product calls, tests, HTTP requests, browser actions, repository edits, commits, pushes, or new raw copies. Privacy has acknowledged both occurrences; the final privacy process record owns its own accounting. These are two events in this auditor's output-control category, not an assertion that an original private user graph was exposed and not a claim of zero output exposure.

## Retained untested and delivery boundaries

- This auditor performed no new application import, product probe, HTTP call, test suite, CI run, browser session, build, model execution, or GPU call. Peer frozen executions are attributed to their actual owners and limits.
- No fresh candidate execution of the private 138-node workflow occurred. The older 138 result is still a full compile failure for missing frontend state, with zero tags in that result. The unchanged 217-module hash does not turn old execution into a new candidate run, and zero tags do not replace an independent 29-tag/mapping regression. Explicit historical width/height writes are narrower than successful full compile; batch full compile remains unproved.
- The new explicit tag/mapping compile cases do not prove all historical tag paths, all third-party adapters, or all unknown-node transformations. The UI run is a headless installed Chrome run with synthetic neutral fixtures; no live dependency/model verification or broad performance claim is made.
- The original source document and the compiled output closure are different contracts. Valid pruning stays recorded rather than being called source mutation or dropped from full deltas.
- The current worktree was clean at the fixed candidate. User workspace cleanup, temporary preview data cleanup, subsequent repairs, final commit/push, and new final gates are controller delivery work, not completed by this report.

Both accepted Medium findings are uncorrected at this fixed candidate. A repaired candidate needs its own targeted checks and the required new review/gate round. This cross-review signs **REQUEST CHANGES**.
