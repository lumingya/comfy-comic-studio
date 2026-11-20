"""One dispatch boundary for core shapes, keyed defaults and extension codecs."""

from copy import deepcopy
from unittest import TestCase
from unittest.mock import patch

from mio_server.comfy import slot_adapters as adapters
from mio_server.comfy import workflow_slots as slots
from mio_server.comfy.builtin_slot_adapters import BUILTINS
from mio_server.comfy.compile import compile_workflow
from mio_server.registry import Registry
from mio_server.render_models import WorkflowConfig, WorkflowDoc


def node(**inputs):
    return {"class_type": "GenericOperation", "inputs": inputs}


def graph(kind):
    operation = {
        "chain": node(
            model=["1", 0],
            lora_name="ink.safetensors",
            strength_model=0.8,
            strength_clip=0.3,
        ),
        "stack": node(
            model=["1", 0],
            lora_1_name="ink.safetensors",
            model_strength_1=0.8,
            clip_strength_1=0.3,
        ),
        "object": node(
            model=["1", 0],
            loras=[
                {"name": "ink.safetensors", "strength": 0.8, "clipStrength": 0.3, "active": True}
            ],
        ),
        "embedded": node(
            ckpt_name="base.safetensors",
            lora_name="ink.safetensors",
            lora_strength=0.8,
            strength_clip=0.3,
        ),
        "syntax": node(model=["1", 0], lora_syntax="quiet <lora:ink.safetensors:0.8:0.3>"),
    }[kind]
    workflow = {
        "1": node(ckpt_name="base.safetensors"),
        "2": operation,
        "3": {"class_type": "KSampler", "inputs": {"model": ["2", 0]}},
        "4": {"class_type": "SaveImage", "inputs": {"images": ["3", 0]}},
    }
    if kind == "embedded":
        del workflow["1"]
    return workflow


def selected(group, item, **changes):
    return {
        "groups": [
            {"key": group["key"], "loras": [{"key": item["key"], "name": item["name"], **changes}]}
        ]
    }


class CoreSlotDispatchTests(TestCase):
    def test_five_codecs_use_the_same_dispatch_and_report_their_provenance(self):
        self.assertEqual({adapter.kind for adapter in BUILTINS}, set(graph_kinds()))
        registry = Registry()
        adapters.register_builtins(registry)
        self.assertEqual(len(registry.all(adapters.POINT)), 5)
        self.assertEqual(adapters.installed(registry), ())
        for kind in graph_kinds():
            with self.subTest(kind=kind):
                source = graph(kind)
                original = deepcopy(source)
                raw = slots.analyze(source)
                self.assertNotIn("adapter", raw["lora"]["groups"][0]["writer"])
                doc = WorkflowDoc(name="Pure shapes", graph=source, slots=raw)
                controls = adapters.describe(doc, registry)
                group = controls["groups"][0]
                item = group["loras"][0]
                self.assertEqual(group["kind"], kind)
                self.assertEqual(group["adapter"]["id"], f"builtin.{kind}")
                self.assertEqual(group["adapter"]["source"], "builtin")
                self.assertEqual(controls["adapters"], [group["adapter"]])
                self.assertTrue(item["supports_independent_toggle"])
                with patch.object(adapters, "write_group", wraps=adapters.write_group) as dispatch:
                    result = compile_workflow(
                        doc,
                        {},
                        slot_overrides=selected(group, item, enabled=False),
                        registry=registry,
                    )
                self.assertEqual(dispatch.call_count, 1)
                if kind == "syntax":
                    self.assertEqual(result.graph["2"]["inputs"]["lora_syntax"], "quiet")
                elif kind == "object":
                    self.assertFalse(result.graph["2"]["inputs"]["loras"][0]["active"])
                else:
                    self.assertNotEqual(result.graph["2"]["inputs"], source["2"]["inputs"])
                restored = compile_workflow(
                    doc, {}, slot_overrides=selected(group, item, enabled=True)
                )
                self.assertEqual(restored.graph, original)
                self.assertEqual(source, original)

    def test_originally_disabled_pins_remain_visible_and_restore_native_weights(self):
        for kind in ("object", "stack"):
            with self.subTest(kind=kind):
                source = graph(kind)
                if kind == "object":
                    source["2"]["inputs"]["loras"][0]["active"] = False
                else:
                    source["2"]["inputs"]["switch_1"] = "Off"
                original = deepcopy(source)
                doc = WorkflowDoc(name="Disabled pin", graph=source)
                group = adapters.describe(doc)["groups"][0]
                item = group["loras"][0]
                self.assertFalse(item["enabled"])
                self.assertEqual((item["strength"], item["clip"]), (0.8, 0.3))
                restored = compile_workflow(
                    doc, {}, slot_overrides=selected(group, item, enabled=True)
                )
                values = restored.graph["2"]["inputs"]
                if kind == "object":
                    self.assertTrue(values["loras"][0]["active"])
                    self.assertEqual(values["loras"][0]["clipStrength"], 0.3)
                else:
                    self.assertEqual(values["switch_1"], "On")
                    self.assertEqual(values["clip_strength_1"], 0.3)
                self.assertEqual(source, original)

    def test_appended_defaults_get_stable_group_controls_and_retain_weights_when_toggled(self):
        doc = WorkflowDoc(
            name="Extra default",
            graph=graph("object"),
            config=WorkflowConfig(
                slot_overrides={
                    "loras": [{"name": "wash.safetensors", "strength": 0.6, "clip": 0.25}]
                }
            ),
        )
        controls = adapters.describe(doc)
        group = controls["groups"][0]
        pin, added = group["loras"]
        self.assertTrue(pin["pinned"])
        self.assertFalse(added["pinned"])
        self.assertEqual(added["source"], "defaults")
        self.assertEqual(added["key"], adapters.describe(doc)["groups"][0]["loras"][1]["key"])
        override = selected(group, added, enabled=False)
        described = adapters.describe(doc, overrides=override)["groups"][0]["loras"][1]
        self.assertFalse(described["enabled"])
        self.assertEqual((described["strength"], described["clip"]), (0.6, 0.25))
        disabled = compile_workflow(doc, {}, slot_overrides=override)
        values = disabled.graph["2"]["inputs"]["loras"]
        self.assertEqual([item["name"] for item in values], [pin["name"], added["name"]])
        self.assertTrue(values[0]["active"])
        self.assertFalse(values[1]["active"])
        restored = compile_workflow(doc, {}, slot_overrides=selected(group, added, enabled=True))
        self.assertEqual(restored.graph["2"]["inputs"]["loras"][1]["strength"], 0.6)
        self.assertEqual(restored.graph["2"]["inputs"]["loras"][1]["clipStrength"], 0.25)
        self.assertEqual(doc.config.slot_overrides["loras"][0]["strength"], 0.6)

    def test_same_named_object_rows_preserve_individual_metadata_and_clip_weights(self):
        source = graph("object")
        rows = source["2"]["inputs"]["loras"]
        rows[0]["selector"] = "first"
        rows.append({**rows[0], "selector": "second", "strength": 0.55, "clipStrength": 0.15})
        doc = WorkflowDoc(name="Two pins", graph=source)
        group = adapters.describe(doc)["groups"][0]
        first, second = group["loras"]
        self.assertNotEqual(first["key"], second["key"])
        result = compile_workflow(doc, {}, slot_overrides=selected(group, second, enabled=False))
        actual = result.graph["2"]["inputs"]["loras"]
        self.assertEqual(actual[0], rows[0])
        self.assertEqual(actual[1]["selector"], "second")
        self.assertFalse(actual[1]["active"])
        restored = compile_workflow(doc, {}, slot_overrides=selected(group, second, enabled=True))
        self.assertEqual(restored.graph, source)

    def test_disabled_extra_chain_default_keeps_its_identity_and_can_be_enabled(self):
        doc = WorkflowDoc(
            name="Off extra",
            graph=graph("chain"),
            config=WorkflowConfig(
                slot_overrides={
                    "loras": [
                        {
                            "name": "wash.safetensors",
                            "strength": 0.45,
                            "clip": 0.15,
                            "enabled": False,
                        }
                    ]
                }
            ),
        )
        group = adapters.describe(doc)["groups"][0]
        extra = group["loras"][1]
        self.assertFalse(extra["pinned"])
        self.assertFalse(extra["enabled"])
        disabled = compile_workflow(doc, {})
        values = disabled.graph["2:lora1"]["inputs"]
        self.assertEqual(values["lora_name"], "wash.safetensors")
        self.assertEqual(values["strength_model"], 0)
        enabled = compile_workflow(doc, {}, slot_overrides=selected(group, extra, enabled=True))
        values = enabled.graph["2:lora1"]["inputs"]
        self.assertEqual((values["strength_model"], values["strength_clip"]), (0.45, 0.15))

    def test_slot_syntax_survives_prompt_binding_with_the_selected_enabled_set(self):
        source = graph("syntax")
        source["2"]["_meta"] = {"title": "[mio:prompt=lora_syntax]"}
        source["2"]["inputs"]["lora_syntax"] += " <lora:wash.safetensors:0.6>"
        doc = WorkflowDoc(name="Bound syntax", graph=source)
        group = adapters.describe(doc)["groups"][0]
        item = group["loras"][0]
        result = compile_workflow(
            doc,
            {"prompt": "a quiet room"},
            slot_overrides=selected(group, item, enabled=False),
        )
        self.assertEqual(result.graph["2"]["inputs"]["lora_syntax"], "a quiet room <lora:wash:0.6>")


def graph_kinds():
    return ("chain", "stack", "object", "embedded", "syntax")
