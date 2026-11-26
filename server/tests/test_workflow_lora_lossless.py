"""Synthetic LoRA edits preserve native values outside the requested fields."""

import json
from copy import deepcopy
from unittest import TestCase

from mio_server.comfy import slot_adapters
from mio_server.comfy.compile import compile_workflow
from mio_server.render_models import WorkflowDoc


def graph(inputs):
    return {
        "base": {
            "class_type": "CheckpointLoaderSimple",
            "inputs": {"ckpt_name": "base.safetensors"},
        },
        "stack": {
            "class_type": "SyntheticUnseenStack",
            "inputs": {"model": ["base", 0], **inputs},
            "_meta": {"opaque": {"retained": 1.0}},
        },
        "sample": {"class_type": "KSampler", "inputs": {"model": ["stack", 0]}},
        "save": {"class_type": "SaveImage", "inputs": {"images": ["sample", 0]}},
    }


def override(group, index=0, **changes):
    pin = group["loras"][index]
    return {
        "groups": [
            {"key": group["key"], "loras": [{"key": pin["key"], "name": pin["name"], **changes}]}
        ]
    }


class LosslessLoRAWriterTests(TestCase):
    def assert_json_exact(self, actual, expected):
        # Normal equality hides an unwanted 1.0 -> 1 or True -> 1 rewrite.
        self.assertEqual(json.dumps(actual, sort_keys=True), json.dumps(expected, sort_keys=True))

    def compile(self, source, changes, *, index=0):
        doc = WorkflowDoc(name="Synthetic native value preservation", graph=source)
        original = deepcopy(doc.model_dump())
        group = slot_adapters.describe(doc)["groups"][0]
        selected = override(group, index, **changes)
        result = compile_workflow(doc, {}, slot_overrides=selected)
        self.assert_json_exact(doc.model_dump(), original)
        self.assert_json_exact(slot_adapters.describe(doc)["groups"][0], group)
        return result.graph

    def test_object_vacancies_keep_position_native_types_and_wrapping(self):
        for wrapped in (False, True):
            for empty in (None, "", "None"):
                with self.subTest(wrapped=wrapped, empty=empty):
                    entries = [
                        {"name": empty, "strength": 1.0, "active": False, "marker": "vacancy"},
                        {"name": "ink.safetensors", "strength": 0.7, "on": True},
                        {"lora": "wash.safetensors", "strength": "-0.6", "on": True},
                        {"name": "fine.safetensors", "strength": 1.0, "clipStrength": -2.0},
                        {
                            "lora": "tone.safetensors",
                            "strength": "-0.8",
                            "clipStrength": "0.2",
                            "active": False,
                        },
                    ]
                    source = graph(
                        {"loras": {"__value__": entries, "widget": [1.0]} if wrapped else entries}
                    )
                    expected = deepcopy(source)
                    container = expected["stack"]["inputs"]["loras"]
                    (container["__value__"] if wrapped else container)[1]["strength"] = 0.4
                    actual = self.compile(source, {"strength": 0.4})
                    self.assert_json_exact(actual, expected)

    def test_partial_object_pin_edit_preserves_its_other_fields(self):
        source = graph(
            {
                "loras": [
                    {
                        "name": "ink.safetensors",
                        "strength": "0.7",
                        "clipStrength": "0.2",
                        "on": True,
                        "marker": {"retained": 1.0},
                    }
                ]
            }
        )
        expected = deepcopy(source)
        expected["stack"]["inputs"]["loras"][0]["strength"] = -0.123456789
        self.assert_json_exact(self.compile(source, {"strength": -0.123456789}), expected)

    def test_flat_and_power_partial_edits_preserve_native_types_and_vacancies(self):
        source = graph(
            {
                "lora_name_1": "ink.safetensors",
                "strength_1": 0.7,
                "enabled_1": 1,
                "clip_strength_1": -2.0,
                "lora_name_2": "wash.safetensors",
                "strength_2": 1.0,
                "enabled_2": 1,
                "lora_name_3": "",
                "strength_3": 1.0,
                "enabled_3": 0,
                "num_loras": 3,
            }
        )
        expected = deepcopy(source)
        expected["stack"]["inputs"]["strength_1"] = 0.4
        self.assert_json_exact(self.compile(source, {"strength": 0.4}), expected)
        source = graph(
            {
                "lora_1": {"lora": "ink.safetensors", "strength": 0.7, "on": True},
                "lora_name_2": "wash.safetensors",
                "strength_2": 1.0,
                "enabled_2": 1,
            }
        )
        expected = deepcopy(source)
        expected["stack"]["inputs"]["strength_2"] = -0.4
        self.assert_json_exact(self.compile(source, {"strength": -0.4}, index=1), expected)

    def test_duplicate_object_pin_uses_its_own_metadata_and_exact_neighbor_tag(self):
        source = graph(
            {
                "loras": [
                    {"name": "ink.safetensors", "strength": "0.70", "on": True, "marker": 1},
                    {
                        "name": "ink.safetensors",
                        "strength": -0.6,
                        "clipStrength": "0.2",
                        "on": True,
                        "marker": 2,
                    },
                ],
                "text": "prefix <lora:ink:0.70> middle\n<lora:ink:-0.6:0.20> <lora:ink:0.9> suffix",
                "prose": "a quiet bookstore, morning light",
            }
        )
        expected = deepcopy(source)
        expected["stack"]["inputs"]["loras"][1]["strength"] = -0.123456789
        expected["stack"]["inputs"]["text"] = (
            "prefix <lora:ink:0.70> middle\n<lora:ink:-0.123456789:0.20> <lora:ink:0.9> suffix"
        )
        self.assert_json_exact(self.compile(source, {"strength": -0.123456789}, index=1), expected)

    def test_numeric_gate_only_changes_when_toggled_and_keeps_its_type(self):
        source = graph(
            {
                "lora_name_1": "ink.safetensors",
                "strength_1": 0.7,
                "enabled_1": 1,
                "lora_name_2": "wash.safetensors",
                "strength_2": 1.0,
                "enabled_2": 1,
            }
        )
        expected = deepcopy(source)
        expected["stack"]["inputs"].update(strength_1=0, enabled_1=0)
        self.assert_json_exact(self.compile(source, {"enabled": False}), expected)

    def test_closed_flat_gates_discover_toggle_and_preserve_saved_weights(self):
        for closed, opened in ((0, 1), (0.0, 1.0), (False, True), ("Off", "On")):
            with self.subTest(gate=repr(closed)):
                source = graph(
                    {
                        "lora_name_1": "ink.safetensors",
                        "strength_1": 0.7,
                        "enabled_1": 1,
                        "lora_name_2": "ink.safetensors",
                        "strength_2": -0.6,
                        "clip_strength_2": -2.0,
                        "enabled_2": closed,
                    }
                )
                doc = WorkflowDoc(name="Synthetic closed flat gate", graph=source)
                original = deepcopy(doc.model_dump())
                group = slot_adapters.describe(doc)["groups"][0]
                first, second = group["loras"]
                self.assertTrue(first["enabled"])
                self.assertFalse(second["enabled"])
                self.assertNotEqual(first["key"], second["key"])
                self.assertEqual((second["strength"], second["clip"]), (-0.6, -2.0))

                for index, changes, edits in (
                    (0, {"strength": 0.4}, {"strength_1": 0.4}),
                    (1, {"enabled": False}, {}),
                    (1, {"enabled": True}, {"enabled_2": opened}),
                ):
                    expected = deepcopy(source)
                    expected["stack"]["inputs"].update(edits)
                    compiled = compile_workflow(
                        doc, {}, slot_overrides=override(group, index, **changes)
                    )
                    self.assert_json_exact(compiled.graph, expected)
                    after = slot_adapters.describe(
                        WorkflowDoc(name="Synthetic gate result", graph=compiled.graph)
                    )["groups"][0]
                    self.assertEqual(
                        [pin["key"] for pin in after["loras"]],
                        [first["key"], second["key"]],
                    )
                    self.assertEqual(after["loras"][1]["enabled"], changes.get("enabled", False))
                self.assert_json_exact(doc.model_dump(), original)
                self.assert_json_exact(slot_adapters.describe(doc)["groups"][0], group)

    def test_object_remove_add_and_toggle_keep_unowned_rows_and_metadata(self):
        source = graph(
            {
                "loras": {
                    "__value__": [
                        {"name": None, "strength": 1.0, "active": False, "marker": "vacancy"},
                        {
                            "name": "ink.safetensors",
                            "strength": 0.7,
                            "active": True,
                            "marker": "ink",
                        },
                        {
                            "name": "wash.safetensors",
                            "strength": -0.6,
                            "on": False,
                            "marker": "wash",
                        },
                        {"name": "", "strength": "1", "on": False, "marker": "tail"},
                    ],
                    "widget": {"retained": True},
                }
            }
        )
        doc = WorkflowDoc(name="Synthetic removal and addition", graph=source)
        original = deepcopy(doc.model_dump())
        result = compile_workflow(
            doc,
            {},
            slot_overrides={
                "unpin": ["ink.safetensors"],
                "loras": [{"name": "tone.safetensors", "strength": -0.4}],
            },
        )
        rows = result.graph["stack"]["inputs"]["loras"]["__value__"]
        old = source["stack"]["inputs"]["loras"]["__value__"]
        self.assert_json_exact(rows[:3], [old[0], old[2], old[3]])
        self.assertEqual((rows[3]["name"], rows[3]["strength"]), ("tone.safetensors", -0.4))
        self.assert_json_exact(doc.model_dump(), original)
        expected = deepcopy(source)
        expected["stack"]["inputs"]["loras"]["__value__"][2]["on"] = True
        self.assert_json_exact(self.compile(source, {"enabled": True}, index=1), expected)
