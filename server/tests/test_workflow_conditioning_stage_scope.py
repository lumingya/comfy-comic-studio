"""Neutral conditioning-stage controls; no plugin-specific phase contracts."""

import copy
import json
import unittest

from mio_server.comfy.compile import compile_workflow
from mio_server.render_models import WorkflowConfig, WorkflowDoc

CONTROLS = {"steps": 29, "cfg": 4.5, "sampler": "new sampler", "denoise": 0.4, "scheduler": "new"}
FIELDS = {kind: "sampler_name" if kind == "sampler" else kind for kind in CONTROLS}


def node(kind="NeutralUnit", **inputs):
    return {"class_type": kind, "inputs": inputs}


def base(prefix):
    return {
        prefix + "model": node(),
        prefix + "text": node(clip=[prefix + "model", 1], text=prefix + "subject"),
        prefix + "canvas": node(width=640, height=896, batch_size=1),
        prefix + "sample": node(
            model=[prefix + "model", 0],
            positive=[prefix + "text", 0],
            latent_image=[prefix + "canvas", 0],
            seed=17,
            steps=20,
            cfg=6.0,
            sampler_name="original",
            denoise=1.0,
            scheduler="original",
        ),
        prefix + "decode": node(samples=[prefix + "sample", 0]),
        prefix + "save": node("SaveImage", images=[prefix + "decode", 0]),
    }


def phases(field="transfer", port="positive"):
    graph = {**base("early_"), **base("late_")}
    del graph["early_save"]
    graph["condition"] = node(**{field: ["early_sample", 0]})
    graph["late_sample"]["inputs"][port] = ["condition", 0]
    return graph


def modern_phases():
    graph = phases()
    graph["guider"] = node(model=["late_model", 0], positive=["condition", 0], cfg=6.0)
    graph["schedule"] = node(steps=20, denoise=1.0, scheduler="original")
    graph["picker"] = node(sampler_name="original")
    graph["noise"] = node(seed=17)
    graph["late_sample"]["inputs"] = {
        "latent_image": ["late_canvas", 0],
        "guider": ["guider", 0],
        "sigmas": ["schedule", 0],
        "sampler": ["picker", 0],
        "noise": ["noise", 0],
    }
    return graph


def compile_graph(graph, values, mapping=None):
    doc = WorkflowDoc(
        name="Neutral conditioning stages",
        graph=graph,
        config=WorkflowConfig(mapping=mapping or {}),
    )
    before = copy.deepcopy(doc.model_dump())
    original = copy.deepcopy(graph)
    # Compilation legitimately prunes nodes outside the selected output closure.
    # Compare requested writes with the same document/configuration compiled as-is.
    baseline = copy.deepcopy(compile_workflow(doc, {}).graph)
    if graph != original or doc.model_dump() != before:
        raise AssertionError("baseline compile mutated the source document")
    result = compile_workflow(doc, values)
    if graph != original or doc.model_dump() != before:
        raise AssertionError("compile mutated the source document")
    return result, baseline


def updated(baseline, targets, values=CONTROLS):
    expected = copy.deepcopy(baseline)
    for target in targets:
        expected[target]["inputs"].update({FIELDS[kind]: value for kind, value in values.items()})
    return expected


class ConditioningStageScopeTests(unittest.TestCase):
    def assert_graph_equal(self, actual, expected):
        self.assertEqual(json.dumps(actual, sort_keys=True), json.dumps(expected, sort_keys=True))

    def assert_manual(self, graph, values=CONTROLS):
        result, baseline = compile_graph(graph, values)
        self.assert_graph_equal(result.graph, baseline)
        self.assertFalse(set(values).intersection(result.bindings))
        for kind in values:
            messages = [warning for warning in result.warnings if f" {kind} " in warning]
            self.assertEqual(len(messages), 1)
            self.assertIn("mapping", messages[0])

    def test_opaque_conditioning_stage_requires_each_control_to_be_mapped(self):
        for field in ("operand", "transfer_branch"):
            for port in ("positive", "negative", "conditioning"):
                for kind, value in CONTROLS.items():
                    with self.subTest(field=field, port=port, kind=kind):
                        self.assert_manual(phases(field, port), {kind: value})

    def test_shared_source_output_slots_do_not_make_stages_equivalent(self):
        graph = phases()
        graph["shared_canvas"] = node(width=640, height=896, batch_size=1)
        for slot, prefix in enumerate(("early_", "late_")):
            graph[prefix + "sample"]["inputs"]["latent_image"] = ["shared_canvas", slot]
        self.assert_manual(graph)

    def test_names_and_shared_control_values_do_not_declare_stage_identity(self):
        graph = phases("opaque_payload")
        graph["shared_steps"] = node("PrimitiveNode", value=20)
        for prefix in ("early_", "late_"):
            graph[prefix + "sample"]["inputs"]["steps"] = ["shared_steps", 0]
        rename = {nid: "renamed_" + nid for nid in graph}
        renamed = {}
        for nid, source in graph.items():
            item = copy.deepcopy(source)
            if item["class_type"] not in ("SaveImage", "PrimitiveNode"):
                item["class_type"] = "AnotherNeutralUnit"
            for field, value in item["inputs"].items():
                if isinstance(value, list):
                    item["inputs"][field] = [rename[value[0]], value[1]]
            renamed[rename[nid]] = item
        self.assert_manual(renamed)

    def test_modern_providers_cannot_restore_ambiguous_controls(self):
        self.assert_manual(modern_phases())

    def test_explicit_mapping_can_choose_either_stage(self):
        graph = phases()
        for target in ("early_sample", "late_sample"):
            for kind, value in CONTROLS.items():
                with self.subTest(target=target, kind=kind):
                    result, baseline = compile_graph(
                        graph, {kind: value}, {kind: f"/{target}/inputs/{FIELDS[kind]}"}
                    )
                    self.assert_graph_equal(
                        result.graph, updated(baseline, [target], {kind: value})
                    )
                    self.assertFalse(any(f" {kind} " in warning for warning in result.warnings))

    def test_explicit_tags_can_choose_either_stage(self):
        for target in ("early_sample", "late_sample"):
            for kind, value in CONTROLS.items():
                with self.subTest(target=target, kind=kind):
                    graph = phases()
                    graph[target]["_meta"] = {"title": f"[mio:{kind}={FIELDS[kind]}]"}
                    result, baseline = compile_graph(graph, {kind: value})
                    self.assert_graph_equal(
                        result.graph, updated(baseline, [target], {kind: value})
                    )
                    self.assertFalse(any(f" {kind} " in warning for warning in result.warnings))

    def test_one_explicit_kind_does_not_hide_other_missing_controls(self):
        graph = phases()
        result, baseline = compile_graph(graph, CONTROLS, {"steps": "/late_sample/inputs/steps"})
        self.assert_graph_equal(
            result.graph, updated(baseline, ["late_sample"], {"steps": CONTROLS["steps"]})
        )
        for kind in CONTROLS:
            count = sum(f" {kind} " in warning for warning in result.warnings)
            self.assertEqual(count, 0 if kind == "steps" else 1)

    def test_explicit_fanout_is_preserved(self):
        graph = phases()
        for kind, value in CONTROLS.items():
            with self.subTest(kind=kind):
                mapping = {
                    kind: [
                        f"/{target}/inputs/{FIELDS[kind]}"
                        for target in ("early_sample", "late_sample")
                    ]
                }
                result, baseline = compile_graph(graph, {kind: value}, mapping)
                self.assert_graph_equal(
                    result.graph, updated(baseline, ["early_sample", "late_sample"], {kind: value})
                )
                self.assertFalse(any(f" {kind} " in warning for warning in result.warnings))

    def test_explicit_modern_provider_mapping_remains_writable(self):
        graph = modern_phases()
        targets = {
            "steps": "schedule",
            "cfg": "guider",
            "sampler": "picker",
            "denoise": "schedule",
            "scheduler": "schedule",
        }
        for kind, target in targets.items():
            with self.subTest(kind=kind):
                value = CONTROLS[kind]
                result, baseline = compile_graph(
                    graph, {kind: value}, {kind: f"/{target}/inputs/{FIELDS[kind]}"}
                )
                self.assert_graph_equal(result.graph, updated(baseline, [target], {kind: value}))
                self.assertFalse(any(f" {kind} " in warning for warning in result.warnings))

    def test_known_conditioning_references_preserve_late_controls(self):
        for role in ("latent", "image", "reference_image", "mask"):
            with self.subTest(role=role):
                graph = phases()
                source = "early_sample" if role == "latent" else "early_decode"
                graph["condition"]["inputs"] = {
                    "conditioning": ["late_text", 0],
                    role: [source, 0],
                }
                result, baseline = compile_graph(graph, CONTROLS)
                self.assert_graph_equal(result.graph, updated(baseline, ["late_sample"]))

    def test_model_and_upscaler_references_do_not_choose_another_stage(self):
        for role in ("model", "upscaler"):
            with self.subTest(role=role):
                graph = phases()
                graph["late_sample"]["inputs"]["positive"] = ["late_text", 0]
                if role == "model":
                    graph["adapter"] = node(model=["late_model", 0], image=["early_decode", 0])
                    graph["late_sample"]["inputs"]["model"] = ["adapter", 0]
                else:
                    graph["provider"] = node(
                        model=["late_model", 0], positive=["condition", 0], seed=7
                    )
                    graph["transform"] = node(image=["late_decode", 0], upscaler=["provider", 0])
                    graph["late_save"]["inputs"]["images"] = ["transform", 0]
                result, baseline = compile_graph(graph, CONTROLS)
                self.assert_graph_equal(result.graph, updated(baseline, ["late_sample"]))

    def test_seed_fanout_still_follows_execution_scope(self):
        graph = phases()
        result, baseline = compile_graph(graph, {"seed": 99})
        expected = copy.deepcopy(baseline)
        for target in ("early_sample", "late_sample"):
            expected[target]["inputs"]["seed"] = 99
        self.assert_graph_equal(result.graph, expected)

    def test_direct_and_reencoded_canvas_stages_keep_first_controls(self):
        for reencode in (False, True):
            with self.subTest(reencode=reencode):
                graph = phases()
                origin = "early_sample"
                if reencode:
                    graph["encode"] = node(pixels=["early_decode", 0])
                    origin = "encode"
                graph["late_sample"]["inputs"].update(
                    positive=["late_text", 0], latent_image=[origin, 0]
                )
                result, baseline = compile_graph(graph, CONTROLS)
                self.assert_graph_equal(result.graph, updated(baseline, ["early_sample"]))

    def test_known_reference_does_not_hide_an_opaque_generation_dependency(self):
        graph = phases()
        graph["condition"]["inputs"].update(
            conditioning=["late_text", 0], reference_image=["early_decode", 0]
        )
        self.assert_manual(graph)

    def test_hidden_conditioning_stage_on_a_refiner_is_also_checked(self):
        graph = {**phases(), **base("initial_")}
        del graph["initial_save"]
        graph["late_sample"]["inputs"]["latent_image"] = ["initial_sample", 0]
        self.assert_manual(graph)

    def test_static_condition_selector_uses_only_its_selected_payload(self):
        for selected in (1, 2):
            with self.subTest(selected=selected):
                graph = phases()
                graph["choice"] = node(
                    input1=["condition", 0], input2=["late_text", 0], select=selected
                )
                graph["late_sample"]["inputs"]["positive"] = ["choice", 0]
                if selected == 1:
                    self.assert_manual(graph)
                else:
                    result, baseline = compile_graph(graph, CONTROLS)
                    self.assert_graph_equal(result.graph, updated(baseline, ["late_sample"]))

    def test_dynamic_condition_selector_keeps_a_possible_phase_ambiguous(self):
        graph = phases()
        graph["selection"] = node(value=1)
        graph["choice"] = node(
            input1=["condition", 0], input2=["late_text", 0], select=["selection", 0]
        )
        graph["late_sample"]["inputs"]["positive"] = ["choice", 0]
        self.assert_manual(graph)

    def test_auxiliary_condition_output_cannot_borrow_a_payload_phase(self):
        graph = phases()
        graph["choice"] = node(input1=["condition", 0], input2=["late_text", 0], select=1)
        graph["late_sample"]["inputs"]["positive"] = ["choice", 1]
        result, baseline = compile_graph(graph, CONTROLS)
        self.assert_graph_equal(result.graph, updated(baseline, ["late_sample"]))

    def test_non_generation_providers_and_cycles_do_not_invent_a_stage(self):
        for cycle in (False, True):
            with self.subTest(cycle=cycle):
                graph = phases()
                graph["condition"]["inputs"] = {
                    "conditioning": ["late_text", 0],
                    "image": ["early_decode", 0],
                    "operand": ["helper", 0],
                }
                graph["helper"] = (
                    node(again=["helper", 0])
                    if cycle
                    else node(model=["late_model", 0], positive=["late_text", 0], seed=7)
                )
                result, baseline = compile_graph(graph, CONTROLS)
                self.assert_graph_equal(result.graph, updated(baseline, ["late_sample"]))

    def test_an_opaque_cycle_does_not_hide_a_reachable_generation_stage(self):
        graph = phases()
        graph["condition"]["inputs"]["transfer"] = ["loop", 0]
        graph["loop"] = node(again=["loop", 0], branch=["early_sample", 0])
        self.assert_manual(graph)

    def test_multiple_outputs_do_not_allow_silent_partial_control_writes(self):
        self.assert_manual({**phases(), **base("other_")})

    def test_unknown_canvas_and_auxiliary_output_still_require_mapping(self):
        for auxiliary in (False, True):
            with self.subTest(auxiliary=auxiliary):
                graph = phases()
                if auxiliary:
                    graph["result"] = node(
                        input1=["late_decode", 0], input2=["early_decode", 0], select=1
                    )
                    slot = 1
                else:
                    graph["result"] = node(image=["late_decode", 0], operand=["early_decode", 0])
                    slot = 0
                graph["late_save"]["inputs"]["images"] = ["result", slot]
                self.assert_manual(graph)


if __name__ == "__main__":
    unittest.main()
