from copy import deepcopy
from itertools import product
from unittest import TestCase

from mio_server.comfy import slot_adapters as adapters
from mio_server.comfy import workflow_slots as slots
from mio_server.comfy.compile import compile_workflow
from mio_server.render_models import WorkflowConfig, WorkflowDoc

from .test_core_slot_dispatch import graph, selected


class LoRAPrecisionTests(TestCase):
    def test_five_shapes_preserve_full_model_and_clip_precision_through_toggle_and_edit(self):
        kinds = ("chain", "stack", "object", "embedded", "syntax")
        weights = ((0.333333, 0.271828), (1e-7, -1e-9), (0.12345678901234567, 0.7654321098765432))
        for kind, (model, clip) in product(kinds, weights):
            with self.subTest(kind=kind, model=model, clip=clip):
                source = graph(kind)
                original = deepcopy(source)
                plan = slots.ensure_plan(source)
                group = plan["lora"]["groups"][0]
                item = group["pinned"][0]
                update = selected(group, item, enabled=True, strength=model, clip=clip)
                updated = slots.apply(source, plan, update)["workflow"]
                updated_plan = slots.ensure_plan(updated)
                updated_group = updated_plan["lora"]["groups"][0]
                precise = updated_group["pinned"][0]
                self.assertEqual((precise["strength"], precise["clip"]), (model, clip))
                off = selected(updated_group, precise, **{**precise, "enabled": False})
                slots.apply(updated, updated_plan, off)
                on = selected(updated_group, precise, **{**precise, "enabled": True})
                restored = slots.apply(updated, updated_plan, on)["workflow"]
                self.assertEqual(restored, updated)
                self.assertEqual(source, original)

    def test_configured_added_lora_controls_and_compilation_share_full_precision(self):
        doc = WorkflowDoc(
            name="Precise added model",
            graph=graph("chain"),
            config=WorkflowConfig(
                slot_overrides={
                    "loras": [{"name": "wash.safetensors", "strength": 0.333333, "clip": 0.271828}]
                }
            ),
        )
        group = adapters.describe(doc)["groups"][0]
        added = next(item for item in group["loras"] if not item["pinned"])
        self.assertEqual((added["strength"], added["clip"]), (0.333333, 0.271828))
        compiled = compile_workflow(doc, {})
        inputs = compiled.graph["2:lora1"]["inputs"]
        self.assertEqual((inputs["strength_model"], inputs["strength_clip"]), (0.333333, 0.271828))
