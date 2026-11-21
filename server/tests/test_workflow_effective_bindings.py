"""Compile routing follows frozen effective values, without pruning inactive switch links."""

import copy
import unittest
from unittest.mock import patch

from mio_server.comfy import bindings as B
from mio_server.comfy import compile as C
from mio_server.comfy import workflow_slots as slots
from mio_server.comfy.inspection import InspectRequest, inspect
from mio_server.render_models import WorkflowConfig, WorkflowDoc


def node(kind, **inputs):
    return {"class_type": kind, "inputs": inputs}


def switching_workflow(config=None):
    graph = {
        "model": node("CheckpointLoaderSimple", ckpt_name="synthetic.safetensors"),
        "first": node("CLIPTextEncode", text="first original", clip=["model", 1]),
        "second": node("CLIPTextEncode", text="second original", clip=["model", 1]),
        "switch": node("Switch", on_true=["first", 0], on_false=["second", 0], boolean=True),
        "latent": node("EmptyLatentImage", width=768, height=1024, batch_size=1),
        "sample": node(
            "KSampler",
            model=["model", 0],
            positive=["switch", 0],
            latent_image=["latent", 0],
            seed=1,
            steps=20,
        ),
        "decode": node("VAEDecode", samples=["sample", 0], vae=["model", 2]),
        "save": node("SaveImage", images=["decode", 0]),
    }
    return WorkflowDoc(name="Synthetic selector", graph=graph, config=config or WorkflowConfig())


class EffectiveBindingTests(unittest.TestCase):
    def assert_second_prompt(self, compiled):
        self.assertEqual(compiled.graph["first"]["inputs"]["text"], "first original")
        self.assertEqual(compiled.graph["second"]["inputs"]["text"], "replacement")
        self.assertFalse(compiled.graph["switch"]["inputs"]["boolean"])
        self.assertIn("second.text (heuristic)", compiled.bindings["prompt"])
        self.assertEqual(compiled.graph["switch"]["inputs"]["on_true"], ["first", 0])
        self.assertEqual(compiled.graph["switch"]["inputs"]["on_false"], ["second", 0])

    def test_config_pointer_selector_is_applied_before_inference(self):
        doc = switching_workflow(WorkflowConfig(overrides={"/switch/inputs/boolean": False}))
        original = copy.deepcopy(doc.model_dump())
        self.assert_second_prompt(C.compile_workflow(doc, {"prompt": "replacement"}))
        self.assertEqual(doc.model_dump(), original)
        self.assertEqual(C.describe(doc)["bindings"]["prompt"], ["second.text (heuristic)"])

    def test_variant_then_panel_pointers_determine_the_frozen_route(self):
        config = WorkflowConfig(
            overrides={"/switch/inputs/boolean": True},
            variants={"final": {"overrides": {"/switch/inputs/boolean": False}}},
        )
        doc = switching_workflow(config)
        doc.graph["save"]["_meta"] = {"title": "[mio:output:final]"}
        self.assert_second_prompt(
            C.compile_workflow(doc, {"prompt": "replacement"}, variant="final")
        )
        compiled = C.compile_workflow(
            doc,
            {"prompt": "replacement"},
            variant="final",
            overrides={"/switch/inputs/boolean": True},
        )
        self.assertEqual(compiled.graph["first"]["inputs"]["text"], "replacement")
        self.assertEqual(compiled.graph["second"]["inputs"]["text"], "second original")

    def test_explicit_selector_mapping_participates_in_routing_and_pointers_win(self):
        doc = switching_workflow(WorkflowConfig(mapping={"seed": "/switch/inputs/boolean"}))
        self.assert_second_prompt(C.compile_workflow(doc, {"seed": False, "prompt": "replacement"}))
        compiled = C.compile_workflow(
            doc,
            {"seed": False, "prompt": "replacement"},
            overrides={"/switch/inputs/boolean": True},
        )
        self.assertEqual(compiled.graph["first"]["inputs"]["text"], "replacement")
        self.assertTrue(compiled.graph["switch"]["inputs"]["boolean"])

    def test_linked_selector_uses_merged_values_and_preserves_numeric_pointer_priority(self):
        doc = switching_workflow(WorkflowConfig(mapping={"cfg": "/choice/inputs/value"}))
        doc.graph["choice"] = node("PrimitiveNode", value=1)
        doc.graph["switch"]["inputs"] = {
            "input1": ["first", 0],
            "input2": ["second", 0],
            "select": ["choice", 0],
        }
        compiled = C.compile_workflow(
            doc,
            {"cfg": 1, "prompt": "replacement", "seed": 9},
            overrides={"/choice/inputs/value": 2, "/sample/inputs/seed": 42},
        )
        self.assertEqual(compiled.graph["second"]["inputs"]["text"], "replacement")
        self.assertEqual(compiled.graph["choice"]["inputs"]["value"], 2)
        self.assertEqual(compiled.graph["sample"]["inputs"]["seed"], 42)
        self.assertEqual(compiled.graph["switch"]["inputs"]["select"], ["choice", 0])

    def test_bad_pointer_in_pruned_output_variant_is_ignored(self):
        doc = switching_workflow(WorkflowConfig(overrides={"/other/inputs/not_a_field": False}))
        doc.graph["save"]["_meta"] = {"title": "[mio:output:draft]"}
        doc.graph["other"] = {
            **node("SaveImage", images=["second", 0]),
            "_meta": {"title": "[mio:output:final]"},
        }
        compiled = C.compile_workflow(doc, {"prompt": "replacement"}, variant="draft")
        self.assertNotIn("other", compiled.graph)
        with self.assertRaisesRegex(B.BindingError, "not_a_field"):
            C.compile_workflow(doc, {}, variant="final")

    def test_extension_rules_run_once_against_unchanged_source(self):
        doc = switching_workflow()
        observed = []

        def rule(graph):
            observed.append(copy.deepcopy(graph))
            graph["switch"]["inputs"]["boolean"] = "rule private mutation"
            return [B.Binding("seed", "sample", "seed")]

        C.compile_workflow(
            doc,
            {"prompt": "replacement"},
            overrides={"/switch/inputs/boolean": False},
            rules=[("synthetic", rule)],
        )
        self.assertEqual(observed, [doc.graph])

    def test_slot_owned_syntax_tags_survive_binding_after_effective_state_resolution(self):
        doc = switching_workflow()
        doc.graph["first"]["inputs"]["text"] = "source <lora:synthetic:0.25>"
        plan = {"lora": {"groups": []}}
        applied = {"workflow": copy.deepcopy(doc.graph), "notices": [], "plan": plan}
        with (
            patch.object(C.slots, "ensure_plan", return_value=plan),
            patch.object(C.slots, "apply", return_value=applied),
            patch.object(C.SA, "syntax_targets", return_value={("first", "text")}),
        ):
            compiled = C.compile_workflow(
                doc, {"prompt": "replacement"}, slot_overrides={"loras": []}
            )
        self.assertEqual(
            compiled.graph["first"]["inputs"]["text"], "replacement <lora:synthetic:0.25>"
        )

    def test_inspection_reports_the_compiled_effective_binding(self):
        doc = switching_workflow()
        result = inspect(
            InspectRequest(
                workflow=doc.graph,
                values={"prompt": "replacement"},
                overrides={"/switch/inputs/boolean": False},
            )
        )
        self.assertTrue(result.compilable)
        self.assertEqual(
            [
                (binding.node, binding.field)
                for binding in result.bindings
                if binding.kind == "prompt"
            ],
            [("second", "text")],
        )

    def test_lora_append_cannot_silently_target_the_old_selected_branch(self):
        doc = switching_workflow()
        for name in ("a", "b"):
            doc.graph[name] = node(
                "LoraLoaderModelOnly",
                model=["model", 0],
                lora_name=f"{name}.safetensors",
                strength_model=0.6,
            )
        doc.graph["model_switch"] = node(
            "Switch", on_true=["a", 0], on_false=["b", 0], boolean=True
        )
        doc.graph["sample"]["inputs"]["model"] = ["model_switch", 0]
        original = copy.deepcopy(doc.graph)
        plan = slots.ensure_plan(doc.graph, doc.slots)
        group = next(group for group in plan["lora"]["groups"] if group["active"])
        selected = group["pinned"][0]
        requests = (
            {"loras": [{"name": "added.safetensors", "strength": 0.2}]},
            {
                "groups": [
                    {
                        "key": group["key"],
                        "loras": [
                            {"key": selected["key"], "name": selected["name"], "strength": 0.2}
                        ],
                    }
                ]
            },
        )
        for changes in requests:
            with (
                self.subTest(changes=changes),
                self.assertRaisesRegex(B.BindingError, "LoRA.*活动路径"),
            ):
                C.compile_workflow(
                    doc,
                    {},
                    overrides={"/model_switch/inputs/boolean": False},
                    slot_overrides=changes,
                )
        # Pointer changes unrelated to LoRA routing remain valid.
        compiled = C.compile_workflow(
            doc,
            {},
            overrides={"/sample/inputs/seed": 42},
            slot_overrides=requests[1],
        )
        self.assertEqual(compiled.graph["a"]["inputs"]["strength_model"], 0.2)
        self.assertEqual(doc.graph, original)


if __name__ == "__main__":
    unittest.main()
