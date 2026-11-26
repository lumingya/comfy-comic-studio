"""Neutral exact-output regressions for mirror ownership and active LoRA fields."""

import json
from copy import deepcopy
from unittest import TestCase

from mio_server.comfy import slot_adapters, workflow_slots
from mio_server.comfy.compile import compile_workflow
from mio_server.comfy.inspection import InspectRequest, inspect
from mio_server.comfy.workflow_slot_common import LibraryError
from mio_server.comfy.workflow_slot_shapes import stack_slots
from mio_server.render_models import WorkflowDoc


def graph(inputs):
    return {
        "base": {
            "class_type": "CheckpointLoaderSimple",
            "inputs": {"ckpt_name": "base.safetensors"},
        },
        "slot": {
            "class_type": "NeutralUnseenInputs",
            "inputs": {"model": ["base", 0], **inputs},
        },
        "sample": {"class_type": "KSampler", "inputs": {"model": ["slot", 0]}},
        "save": {"class_type": "SaveImage", "inputs": {"images": ["sample", 0]}},
    }


def override(group, index=0, **changes):
    item = group["loras"][index]
    return {
        "groups": [
            {
                "key": group["key"],
                "loras": [{"key": item["key"], "name": item["name"], **changes}],
            }
        ]
    }


def mode_graph(mode="simple", count=2):
    return graph(
        {
            "mode": mode,
            "num_loras": count,
            **{
                key.format(i): value
                for i, name in (
                    (1, "ink.safetensors"),
                    (2, "wash.safetensors"),
                    (3, "hidden.safetensors"),
                )
                for key, value in (
                    ("lora_{}_name", name),
                    ("lora_{}_strength", -0.6 if i == 1 else 2.0),
                    ("lora_{}_model_strength", 0.3),
                    ("lora_{}_clip_strength", -0.2),
                )
            },
            "widget": {"retained": [1, 1.0, True]},
        }
    )


class R3LoRALosslessTests(TestCase):
    def exact(self, actual, expected):
        self.assertEqual(json.dumps(actual, sort_keys=True), json.dumps(expected, sort_keys=True))

    def run_edit(self, source, changes, *, index=0, kind=None):
        doc = WorkflowDoc(name="Neutral exact-output case", graph=source)
        before = deepcopy(doc.model_dump())
        groups = slot_adapters.describe(doc)["groups"]
        group = next(
            group
            for group in groups
            if (kind is None or group["kind"] == kind)
            and any(site["nodeId"] == "slot" for site in group["sites"])
        )
        result = compile_workflow(doc, {}, slot_overrides=override(group, index, **changes))
        self.exact(doc.model_dump(), before)
        return result.graph, group

    def test_partial_text_mirrors_keep_their_individual_membership(self):
        for split in (False, True):
            for index in (0, 1):
                with self.subTest(split=split, index=index):
                    source = graph(
                        {
                            "loras": [
                                {
                                    "name": "ink.safetensors",
                                    "strength": 0.7,
                                    "active": True,
                                },
                                {
                                    "name": "wash.safetensors",
                                    "strength": -0.3,
                                    "active": True,
                                },
                            ],
                            "text": "ink prose <lora:ink:0.70> tail",
                            "caption": "wash prose <lora:wash:-0.30>" if split else "plain prose",
                        }
                    )
                    expected = deepcopy(source)
                    expected["slot"]["inputs"]["loras"][index]["strength"] = -0.4
                    if index == 0:
                        expected["slot"]["inputs"]["text"] = "ink prose <lora:ink:-0.4> tail"
                    elif split:
                        expected["slot"]["inputs"]["caption"] = "wash prose <lora:wash:-0.4>"
                    actual, _ = self.run_edit(source, {"strength": -0.4}, index=index)
                    self.exact(actual, expected)

    def test_partial_mirror_add_remove_preserve_existing_unmirrored_rows(self):
        source = graph(
            {
                "loras": [
                    {"name": "ink.safetensors", "strength": 0.7, "active": True},
                    {"name": "wash.safetensors", "strength": -0.3, "active": True},
                ],
                "text": "ink <lora:ink:0.70>",
                "caption": "plain prose",
            }
        )
        doc = WorkflowDoc(name="Neutral add and remove", graph=source)
        added = compile_workflow(
            doc,
            {},
            slot_overrides={"loras": [{"name": "tone.safetensors", "strength": -0.8}]},
        ).graph
        self.assertEqual(added["slot"]["inputs"]["text"], "ink <lora:ink:0.70> <lora:tone:-0.8>")
        self.assertEqual(added["slot"]["inputs"]["caption"], "plain prose")
        removed = compile_workflow(doc, {}, slot_overrides={"unpin": ["ink.safetensors"]}).graph
        self.assertEqual(removed["slot"]["inputs"]["text"], "ink ")
        self.exact(removed["slot"]["inputs"]["loras"], source["slot"]["inputs"]["loras"][1:])

    def test_chain_partial_edits_preserve_numeric_strings_names_and_neighbors(self):
        for changed in ("strength", "clip"):
            source = graph(
                {
                    "lora_name": "folder\\Ink.safetensors",
                    "strength_model": "0.7",
                    "strength_clip": "0.20",
                    "clip": ["base", 1],
                    "widget": {"retained": [1.0, False]},
                }
            )
            source["neighbor"] = {
                "class_type": "LoraLoader",
                "inputs": {
                    "model": ["slot", 0],
                    "clip": ["slot", 1],
                    "lora_name": "wash.safetensors",
                    "strength_model": 1.0,
                    "strength_clip": "-0.30",
                },
            }
            source["sample"]["inputs"]["model"] = ["neighbor", 0]
            expected = deepcopy(source)
            expected["slot"]["inputs"][
                "strength_model" if changed == "strength" else "strength_clip"
            ] = -0.4
            actual, group = self.run_edit(source, {changed: -0.4}, kind="chain")
            self.assertEqual((group["loras"][0]["strength"], group["loras"][0]["clip"]), (0.7, 0.2))
            self.exact(actual, expected)

    def test_embedded_clip_edit_preserves_original_model_weight_representation(self):
        source = graph(
            {
                "ckpt_name": "base.safetensors",
                "lora_name": "ink.safetensors",
                "strength_model": "0.7",
                "strength_clip": "0.2",
            }
        )
        expected = deepcopy(source)
        expected["slot"]["inputs"]["strength_clip"] = -0.4
        actual, group = self.run_edit(source, {"clip": -0.4}, kind="embedded")
        self.assertEqual((group["loras"][0]["strength"], group["loras"][0]["clip"]), (0.7, 0.2))
        self.exact(actual, expected)

    def test_chain_genuine_new_items_still_clone_and_disabled_items_zero_weights(self):
        source = graph(
            {
                "lora_name": "ink.safetensors",
                "strength_model": "0.7",
                "strength_clip": "0.2",
            }
        )
        expected = deepcopy(source)
        expected["slot"]["inputs"].update(strength_model=0, strength_clip=0)
        actual, _ = self.run_edit(source, {"enabled": False})
        self.exact(actual, expected)
        doc = WorkflowDoc(name="Neutral chain expansion", graph=source)
        added = compile_workflow(
            doc,
            {},
            slot_overrides={"loras": [{"name": "tone.safetensors", "strength": -0.4}]},
        ).graph
        self.exact(added["slot"], source["slot"])
        self.assertEqual(added["slot:lora1"]["inputs"]["lora_name"], "tone.safetensors")
        self.assertEqual(added["slot:lora1"]["inputs"]["strength_model"], -0.4)

    def test_simple_suffix_mode_uses_one_effective_weight_and_respects_count(self):
        source = mode_graph()
        actual, group = self.run_edit(source, {"strength": -0.4})
        self.assertEqual(
            [(pin["name"], pin["strength"], pin["clip"]) for pin in group["loras"]],
            [("ink.safetensors", -0.6, None), ("wash.safetensors", 2.0, None)],
        )
        expected = deepcopy(source)
        expected["slot"]["inputs"]["lora_1_strength"] = -0.4
        self.exact(actual, expected)
        slots = stack_slots(source["slot"], source)
        self.assertEqual([slot["index"] for slot in slots], [1, 2])
        self.assertEqual(slots[0]["strengthPaths"], slots[0]["clipPaths"])
        actual, _ = self.run_edit(source, {"enabled": False})
        expected["slot"]["inputs"]["lora_1_strength"] = 0
        self.exact(actual, expected)

    def test_advanced_suffix_mode_preserves_simple_and_hidden_weights(self):
        source = mode_graph("advanced")
        expected = deepcopy(source)
        expected["slot"]["inputs"]["lora_1_model_strength"] = -0.4
        actual, group = self.run_edit(source, {"strength": -0.4})
        self.assertEqual((group["loras"][0]["strength"], group["loras"][0]["clip"]), (0.3, -0.2))
        self.exact(actual, expected)

    def test_suffix_mode_unknown_linked_incomplete_and_invalid_count_are_readonly(self):
        for mode, count in (
            ("unknown", 2),
            (["base", 0], 2),
            ("simple", True),
            ("simple", -1),
            ("simple", ["base", 0]),
            ("simple", 0),
        ):
            source = mode_graph(mode, count)
            self.assertEqual(stack_slots(source["slot"], source), [])
        for missing in (
            "lora_1_strength",
            "lora_1_model_strength",
            "lora_1_clip_strength",
        ):
            source = mode_graph(count=1)
            del source["slot"]["inputs"][missing]
            self.assertEqual(stack_slots(source["slot"], source), [])
        source = mode_graph(count=1)
        source["slot"]["inputs"]["lora_1_strength"] = ["base", 0]
        self.assertEqual(stack_slots(source["slot"], source), [])

    def test_simple_suffix_shared_weight_rejects_distinct_model_and_clip_request(self):
        with self.assertRaises(LibraryError):
            self.run_edit(mode_graph(), {"strength": -0.4, "clip": -0.5})

    def test_cached_mode_paths_refresh_after_analysis_revision_change(self):
        source = mode_graph()
        previous = workflow_slots.analyze(source)
        previous["analysisRevision"] = 2
        group = previous["lora"]["groups"][0]
        group["enabled"] = False
        group["writer"]["slots"][0]["clipPaths"] = ["lora_1_clip_strength"]
        refreshed = workflow_slots.ensure_plan(source, {"plan": previous})
        current = refreshed["lora"]["groups"][0]
        self.assertNotEqual(refreshed["analysisRevision"], previous["analysisRevision"])
        self.assertFalse(current["enabled"])
        self.assertEqual(current["writer"]["slots"][0]["clipPaths"], ["lora_1_strength"])

    def test_malformed_object_names_return_structured_error_without_echoing_values(
        self,
    ):
        for name in (True, 42, {"private": "do-not-echo"}, ["do-not-echo"]):
            source = graph({"loras": [{"name": name, "strength": 0.7}]})
            result = inspect(InspectRequest(workflow=source))
            self.assertFalse(result.compilable)
            self.assertTrue(
                any(
                    issue.code == "slot_error" and issue.severity == "error"
                    for issue in result.issues
                )
            )
            self.assertNotIn("do-not-echo", " ".join(issue.message for issue in result.issues))
            with self.assertRaises(LibraryError):
                slot_adapters.describe(WorkflowDoc(name="Neutral malformed name", graph=source))
