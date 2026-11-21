"""Synthetic sparse stacks retain native positions and per-occurrence metadata."""

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
        "stack": {"class_type": "UnseenStack", "inputs": {"model": ["base", 0], **inputs}},
        "sample": {"class_type": "KSampler", "inputs": {"model": ["stack", 0]}},
        "save": {"class_type": "SaveImage", "inputs": {"images": ["sample", 0]}},
    }


def override(group, item, **changes):
    return {
        "groups": [
            {"key": group["key"], "loras": [{"key": item["key"], "name": item["name"], **changes}]}
        ]
    }


class SparseLoRAStructureTests(TestCase):
    def test_flat_sparse_stack_keeps_position_links_counts_and_duplicate_identity(self):
        source = graph(
            {
                "lora_name_1": "None",
                "strength_1": 1,
                "switch_1": "Off",
                "lora_name_2": "ink.safetensors",
                "strength_2": -0.7,
                "clip_strength_2": 0.2,
                "switch_2": "On",
                "lora_name_3": "ink.safetensors",
                "strength_3": 0.8,
                "clip_strength_3": -0.3,
                "switch_3": "On",
                "num_loras": 3,
                "unrelated": ["base", 1],
            }
        )
        original = deepcopy(source)
        doc = WorkflowDoc(name="Synthetic sparse stack", graph=source)
        group = slot_adapters.describe(doc)["groups"][0]
        first, second = group["loras"]
        self.assertNotEqual(first["key"], second["key"])
        compiled = compile_workflow(doc, {}, slot_overrides=override(group, second, enabled=False))
        expected = deepcopy(source)
        expected["stack"]["inputs"].update(strength_3=0, clip_strength_3=0, switch_3="Off")
        self.assertEqual(compiled.graph, expected)
        self.assertEqual(source, original)
        self.assertEqual(slot_adapters.describe(doc)["groups"][0]["loras"], group["loras"])

    def test_power_dictionary_sparse_pins_keep_native_metadata_and_negative_weights(self):
        source = graph(
            {
                "lora_1": {"lora": "None", "on": False, "strength": 1, "marker": "empty"},
                "lora_2": {
                    "lora": "ink.safetensors",
                    "on": True,
                    "strength": 0.7,
                    "strengthTwo": 0.3,
                    "marker": "first",
                },
                "lora_4": {
                    "lora": "ink.safetensors",
                    "on": True,
                    "strength": -0.4,
                    "strengthTwo": 0.2,
                    "marker": "second",
                },
                "other": {"retained": True},
            }
        )
        original = deepcopy(source)
        doc = WorkflowDoc(name="Synthetic dictionaries", graph=source)
        group = slot_adapters.describe(doc)["groups"][0]
        first, second = group["loras"]
        self.assertNotEqual(first["key"], second["key"])
        change = override(group, second, strength=-0.123456789, clip=-0.987654321)
        compiled = compile_workflow(doc, {}, slot_overrides=change)
        expected = deepcopy(source)
        expected["stack"]["inputs"]["lora_4"].update(
            strength=-0.123456789, strengthTwo=-0.987654321
        )
        self.assertEqual(compiled.graph, expected)
        self.assertEqual(source, original)
        again = slot_adapters.describe(doc)["groups"][0]
        self.assertEqual([item["key"] for item in again["loras"]], [first["key"], second["key"]])

    def test_a_new_pin_uses_vacancy_without_moving_existing_native_pin(self):
        source = graph(
            {
                "lora_1": {"lora": "None", "on": False, "strength": 1, "marker": "vacancy"},
                "lora_2": {
                    "lora": "ink.safetensors",
                    "on": True,
                    "strength": -0.7,
                    "marker": "kept",
                },
            }
        )
        original = deepcopy(source)
        doc = WorkflowDoc(name="Synthetic native vacancy", graph=source)
        compiled = compile_workflow(
            doc, {}, slot_overrides={"loras": [{"name": "wash.safetensors", "strength": 0.4}]}
        )
        inputs = compiled.graph["stack"]["inputs"]
        self.assertEqual(inputs["lora_2"], source["stack"]["inputs"]["lora_2"])
        self.assertEqual(
            inputs["lora_1"],
            {
                "lora": "wash.safetensors",
                "on": True,
                "strength": 0.4,
                "marker": "vacancy",
            },
        )
        self.assertEqual(source, original)

    def test_unpinning_earlier_entry_does_not_move_later_occurrence(self):
        source = graph(
            {
                "lora_1": {
                    "lora": "tone.safetensors",
                    "on": True,
                    "strength": 0.3,
                    "marker": "removed",
                },
                "lora_2": {
                    "lora": "ink.safetensors",
                    "on": True,
                    "strength": -0.7,
                    "marker": "kept",
                },
            }
        )
        doc = WorkflowDoc(name="Synthetic unpin", graph=source)
        result = compile_workflow(doc, {}, slot_overrides={"unpin": ["tone.safetensors"]})
        expected = deepcopy(source)
        del expected["stack"]["inputs"]["lora_1"]
        self.assertEqual(result.graph, expected)
