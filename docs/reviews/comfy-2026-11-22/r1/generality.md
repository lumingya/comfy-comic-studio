# Wave 4 round 1: Generality and architecture audit

Decision: CHANGES REQUIRED. This audit does not issue VERIFIED PASS.

| Severity | Count |
| --- | ---: |
| Blocker | 0 |
| High | 0 |
| Medium | 2 |
| Low | 0 |

## Scope and method

- Code scope: `38838ab..71457f6`, branch `codex/static-workflow-compat`. The before-corpus measurement baseline `aa06d0a` is a separate reference, not the code-review boundary. Website changes are outside scope.
- Read the repository instructions, product README, roadmap section 2.1, original task specification, compatibility report, matrix, and pending semantic-truth report.
- Inspected changed routing, inference, binding, compilation, inspection, import, and LoRA traversal/writer code; traced the existing rule and slot-adapter seams. Concentrated on generic contracts, explicit control priority, cycles, ambiguity, inactive nodes, and stage isolation.
- All added probes and this report are outside the repository. No product files, personal workflow documents, runtime database, browser state, external service, models, or GPU execution were modified or used.

## M1: Nested selector controls overflow the Python call stack

Location: `server/mio_server/comfy/workflow_graph.py:59`; recursive call chain also at lines 47 and 103.

The new graph resolver is iterative for forwarding edges, but resolving a selector's linked control recursively enters `_literal -> _origin -> _route -> selection`. A finite, acyclic static graph with 250 nested boolean selector controls and a normal image-generation chain contains only 259 nodes, yet `inspect(InspectRequest(workflow=graph))` raises an uncaught `RecursionError`. The equivalent 209-node graph succeeds. The import-inspection HTTP handler delegates to this function without translating that exception, so a supported-size topology fails with an internal error instead of bindings or an actionable limitation. This is within the original 120-300+ node robustness scope and far below the declared 20,000-node import bound.

Reproduction: run `probe_generality.py` from the repository root. The probe starts with a six-node neutral static-image graph, a literal boolean source, and adds controls as follows:

```python
previous = "flag"
for index in range(250):
    current = f"choice{index}"
    graph[current] = node(
        "UnseenBooleanSwitch",
        on_true=True,
        on_false=False,
        boolean=[previous, 0],
    )
    previous = current
```

A final conditioning switch uses the last control. `probe_results.json` records successful 159/209-node controls and the 259/309-node failures. Input dictionaries remain ordinary API graph objects; there is no deep JSON-container nesting and no cycle. The compile-correctness auditor independently implemented the probe with one extra negative encoder: 210 nodes succeeded and 260 nodes raised an uncaught `RecursionError` through public inspection.

Required correction: evaluate nested selector controls with a bounded iterative work stack and cycle tracking, or return a stable unresolved/manual result when a genuine evaluation bound is reached. Raising the global recursion limit would retain the architectural failure.

## M2: Encoder detection bypasses the inactive-node routing contract

Location: `server/mio_server/comfy/binding_inference.py:203`.

`conditioning_sources` recognizes an encoder and calls `encoder_sources` before checking the node through the shared semantic router. Consequently an encoder with `mode=4` still contributes its own literal text as an automatic prompt target, although `SemanticGraph.is_active` and the new mode regression specify that bypassed widgets are inactive. The public `compile_workflow` rewrites that widget when a prompt value is supplied. This is an inconsistent interpretation of the same graph depending on whether traversal reaches an encoder shortcut or the shared router.

Reproduction: in the neutral six-node graph from `probe_generality.py`, set `graph["text"]["mode"] = 4`, then call `bindings.resolve` and public `compile_workflow`. Resolution contains `text.text (heuristic)` and compilation changes that text field; the original graph remains unchanged. The probe records both facts. The compile-correctness auditor independently reproduced the write through public compile and inspection.

Required correction: apply the inactive/bypass decision before the encoder fast path. Follow a declared safe bypass route where available; otherwise keep the text origin unresolved and offer manual control. This finding is about Mio's stated semantic contract. It does not claim that ComfyUI's API executor honors the extra `mode` metadata or that GPU execution was tested.

## Positive verification and limits

- No new plugin whitelist was introduced in the reviewed diff. Structural input patterns, declared ports, bounded semantic conventions, and the existing extension rule/slot-codec mechanisms remain the main seams. The shared graph kernel depends on slot primitives; inference depends on that kernel, with no new import cycle found in these dependencies.
- Explicit Mio tags and manual mappings retain priority over heuristic claims. Independent neutral probes confirmed tag-owned prompt/seed targets and a manual size target. Existing tag grammar, variants, and JSON Pointer controls are covered by the focused suite below.
- A cyclic text-routing probe terminates without inventing a writable prompt origin and leaves its source unchanged. A concatenation of distinct literal fragments remains unbound. These verify conservative binding behavior only, not ComfyUI runtime validity.
- The focused command passed 80 tests: `python -m unittest tests.test_bindings tests.test_workflow_graph_routes tests.test_workflow_semantic_bindings tests.test_workflow_slots_v3 -q`, with `PYTHONPATH=server`.
- The existing `alice_copy_workflow.json` fixture has 138 nodes. `test_workflow_slots_v3` includes its model/LoRA override and original-graph preservation check, and passed. The compatibility report additionally documents a separate read-only check of the personal 138-node workflow: seed/batch recovery and width/height detection improved, while both old and new versions still require frontend parameter state for full compilation. That personal check was not repeated or represented as full runtime acceptance here.
- The supplied full-CI pass at this head was not duplicated. The full real corpus, blind downloads, browser acceptance, and full gates belong to the other designated audits. Matrix counts and the 21-graph semantic-truth assessment were checked for scope/claim consistency; they are not converted into an unsupported world-wide compatibility rate.

## Evidence files

- `probe_generality.py`: minimal synthetic and immutable-input probes.
- `probe_results.json`: sanitized machine-readable outcomes.
- No external workflow or private prompt is embedded in this report.

Both Medium findings require repair and fresh independent re-audit before this area can issue VERIFIED PASS.
