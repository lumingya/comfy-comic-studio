"""Independent bounded-edge checks for precise LoRA serialization and validation."""

import math
from copy import deepcopy
from unittest import TestCase

from mio_server.comfy import slot_adapters as adapters
from mio_server.comfy import workflow_slots as slots
from mio_server.comfy.compile import compile_workflow
from mio_server.render_models import WorkflowConfig, WorkflowDoc

from .test_core_slot_dispatch import graph, selected


class LoRAPrecisionRecheck(TestCase):
    def test_tiny_syntax_weights_remain_parseable_and_discoverable(self):
        for model, clip in ((1e-7, 2e-8), (-1e-7, -2e-8), (5e-324, -5e-324)):
            with self.subTest(model=model, clip=clip):
                source = graph("syntax")
                original = deepcopy(source)
                plan = slots.ensure_plan(source)
                group = plan["lora"]["groups"][0]
                pin = group["pinned"][0]
                compiled = slots.apply(
                    source, plan, selected(group, pin, enabled=True, strength=model, clip=clip)
                )["workflow"]
                text = compiled["2"]["inputs"]["lora_syntax"]
                parsed = slots.parse_lora_syntax(text)["loras"]
                self.assertEqual(len(parsed), 1, text)
                self.assertEqual((parsed[0]["strength"], parsed[0]["clip"]), (model, clip))
                rediscovered = slots.ensure_plan(compiled)["lora"]["groups"][0]
                tiny = rediscovered["pinned"][0]
                self.assertEqual((tiny["strength"], tiny["clip"]), (model, clip))
                self.assertEqual(source, original)

    def test_every_shape_rejects_nonfinite_and_just_outside_range_without_mutating_source(self):
        outside = (math.nextafter(5.0, math.inf), math.nextafter(-5.0, -math.inf))
        for kind in ("chain", "stack", "object", "embedded", "syntax"):
            source = graph(kind)
            original = deepcopy(source)
            plan = slots.ensure_plan(source)
            group = plan["lora"]["groups"][0]
            pin = group["pinned"][0]
            for field in ("strength", "clip"):
                for value in (*outside, math.nan, math.inf, -math.inf):
                    with self.subTest(kind=kind, field=field, value=value):
                        with self.assertRaises(slots.LibraryError):
                            slots.apply(source, plan, selected(group, pin, **{field: value}))
                        self.assertEqual(source, original)

    def test_duplicate_added_names_have_independent_precise_weights_and_partial_toggles(self):
        model, clip = math.nextafter(1 / 3, math.inf), math.nextafter(2 / 7, -math.inf)
        doc = WorkflowDoc(
            name="Precise duplicate additions",
            graph=graph("chain"),
            config=WorkflowConfig(
                slot_overrides={
                    "loras": [
                        {
                            "key": "wash-a",
                            "name": "wash.safetensors",
                            "strength": model,
                            "clip": clip,
                        },
                        {
                            "key": "wash-b",
                            "name": "wash.safetensors",
                            "strength": -model,
                            "clip": -clip,
                        },
                    ]
                }
            ),
        )
        change = {"loras": [{"key": "wash-a", "name": "wash.safetensors", "enabled": False}]}
        controls = adapters.describe(doc, overrides=change)["groups"][0]["loras"]
        a = next(item for item in controls if item["key"] == "wash-a")
        b = next(item for item in controls if item["key"] == "wash-b")
        self.assertEqual((a["strength"], a["clip"], a["enabled"]), (model, clip, False))
        self.assertEqual((b["strength"], b["clip"], b["enabled"]), (-model, -clip, True))
        graph_off = compile_workflow(doc, {}, slot_overrides=change).graph
        self.assertEqual(graph_off["2:lora1"]["inputs"]["strength_model"], 0)
        self.assertEqual(graph_off["2:lora2"]["inputs"]["strength_model"], -model)
        graph_on = compile_workflow(
            doc,
            {},
            slot_overrides={
                "loras": [{"key": "wash-a", "name": "wash.safetensors", "enabled": True}]
            },
        ).graph
        self.assertEqual(graph_on["2:lora1"]["inputs"]["strength_model"], model)
        self.assertEqual(graph_on["2:lora1"]["inputs"]["strength_clip"], clip)
