"""Invented mode-switched stack contracts; no external workflow or prompt content."""

from copy import deepcopy
from unittest import TestCase

from mio_server.comfy import slot_adapters as SA
from mio_server.comfy import workflow_slots as S
from mio_server.comfy.compile import compile_workflow
from mio_server.comfy.workflow_slot_shapes import stack_slots
from mio_server.render_models import WorkflowDoc

from .api_harness import ApiCase


def workflow(mode="simple", *, local="None", count=3):
    return {
        "pool": {
            "class_type": "InventedModeStack",
            "inputs": {
                "input_mode": mode,
                "lora_count": count,
                **{
                    key + str(index): value
                    for index, name in (
                        (1, "ink.safetensors"),
                        (2, "None"),
                        (3, "wash.safetensors"),
                        (4, "hidden.safetensors"),
                    )
                    for key, value in (
                        ("lora_name_", name),
                        ("lora_wt_", -0.75 if index == 1 else 0.25),
                        ("model_str_", 0.8),
                        ("clip_str_", -0.2),
                    )
                },
            },
        },
        "loader": {
            "class_type": "InventedCombinedLoader",
            "inputs": {
                "ckpt_name": "synthetic.safetensors",
                "lora_name": local,
                "lora_model_strength": 0.9,
                "lora_clip_strength": 0.4,
                "lora_stack": ["pool", 0],
            },
        },
        "sampler": {"class_type": "KSampler", "inputs": {"model": ["loader", 0]}},
        "save": {"class_type": "SaveImage", "inputs": {"images": ["sampler", 0]}},
    }


def group_for(doc, node="pool"):
    return next(
        group
        for group in SA.describe(doc)["groups"]
        if any(site["nodeId"] == node for site in group["sites"])
    )


def overrides(group, item, **changes):
    return {
        "groups": [
            {"key": group["key"], "loras": [{"key": item["key"], "name": item["name"], **changes}]}
        ]
    }


class StackModeTests(TestCase):
    def test_simple_reads_only_effective_shared_weight_and_active_count(self):
        doc = WorkflowDoc(name="Synthetic shared weights", graph=workflow())
        group = group_for(doc)
        self.assertTrue(group["active"])
        self.assertEqual(
            [(item["name"], item["strength"], item["clip"]) for item in group["loras"]],
            [("ink.safetensors", -0.75, None), ("wash.safetensors", 0.25, None)],
        )
        slots = stack_slots(doc.graph["pool"], doc.graph)
        self.assertEqual([slot["index"] for slot in slots], [1, 2, 3])
        self.assertEqual(slots[0]["strengthPaths"], ["lora_wt_1"])
        self.assertEqual(slots[0]["clipPaths"], ["lora_wt_1"])

    def test_embedded_local_and_upstream_are_independent_groups(self):
        doc = WorkflowDoc(
            name="Synthetic additive loader", graph=workflow(local="tone.safetensors")
        )
        groups = SA.describe(doc)["groups"]
        self.assertEqual(len(groups), 2)
        self.assertEqual(
            sorted(item["name"] for group in groups for item in group["loras"]),
            ["ink.safetensors", "tone.safetensors", "wash.safetensors"],
        )
        pool = group_for(doc)
        original = deepcopy(doc.graph)
        result = compile_workflow(
            doc, {}, slot_overrides=overrides(pool, pool["loras"][0], enabled=False)
        )
        expected = deepcopy(original)
        expected["pool"]["inputs"]["lora_wt_1"] = 0
        self.assertEqual(result.graph, expected)
        self.assertEqual(doc.graph, original)

    def test_simple_weight_and_toggle_only_change_shared_effective_field(self):
        doc = WorkflowDoc(name="Synthetic exact mode writes", graph=workflow())
        original = deepcopy(doc.graph)
        group = group_for(doc)
        for changes, expected_weight in (
            ({"strength": -0.123456789}, -0.123456789),
            ({"strength": -0.123456789, "clip": -0.123456789}, -0.123456789),
            ({"enabled": False}, 0),
        ):
            result = compile_workflow(
                doc, {}, slot_overrides=overrides(group, group["loras"][0], **changes)
            )
            expected = deepcopy(original)
            expected["pool"]["inputs"]["lora_wt_1"] = expected_weight
            self.assertEqual(result.graph, expected)
        self.assertEqual(doc.graph, original)

    def test_incompatible_shared_strength_override_is_rejected(self):
        doc = WorkflowDoc(name="Synthetic shared mismatch", graph=workflow())
        group = group_for(doc)
        with self.assertRaises(ValueError):
            compile_workflow(
                doc, {}, slot_overrides=overrides(group, group["loras"][0], strength=0.5, clip=-0.5)
            )

    def test_trailing_counted_empty_positions_and_hidden_weights_stay_intact(self):
        source = workflow()
        source["pool"]["inputs"]["lora_name_3"] = "None"
        doc = WorkflowDoc(name="Synthetic counted empty positions", graph=source)
        group = group_for(doc)
        result = compile_workflow(
            doc, {}, slot_overrides=overrides(group, group["loras"][0], strength=-0.123456789)
        )
        expected = deepcopy(source)
        expected["pool"]["inputs"]["lora_wt_1"] = -0.123456789
        self.assertEqual(result.graph, expected)

    def test_advanced_overrides_only_distinct_active_weight_fields(self):
        doc = WorkflowDoc(name="Synthetic advanced mode", graph=workflow("advanced"))
        original = deepcopy(doc.graph)
        group = group_for(doc)
        self.assertEqual((group["loras"][0]["strength"], group["loras"][0]["clip"]), (0.8, -0.2))
        result = compile_workflow(
            doc,
            {},
            slot_overrides=overrides(
                group, group["loras"][0], strength=-0.123456789, clip=-0.987654321
            ),
        )
        expected = deepcopy(original)
        expected["pool"]["inputs"].update(model_str_1=-0.123456789, clip_str_1=-0.987654321)
        self.assertEqual(result.graph, expected)

    def test_unknown_linked_mode_and_invalid_count_stay_readonly(self):
        for mode, count in (
            ("random", 3),
            (["switch", 0], 3),
            ("simple", True),
            ("simple", -1),
            ("simple", 0),
        ):
            source = workflow(mode, count=count)
            self.assertEqual(stack_slots(source["pool"], source), [])
            plan = S.analyze(source)
            self.assertFalse(any(group["kind"] == "stack" for group in plan["lora"]["groups"]))
            self.assertTrue(any(issue["code"] == "readonly-origin" for issue in plan["issues"]))

    def test_stale_cached_plan_refreshes_shapes_and_preserves_explicit_preferences(self):
        source = workflow(local="tone.safetensors")
        plan = S.analyze(source)
        for revision in (None, 1):
            stale = deepcopy(plan)
            stale["analysisRevision"] = revision
            stale["lora"]["groups"] = [
                group for group in stale["lora"]["groups"] if group["kind"] != "stack"
            ]
            stale["lora"]["groups"][0]["enabled"] = False
            stale["lora"]["groups"][0]["disabled"] = True
            snapshot = deepcopy(stale)
            refreshed = S.ensure_plan(source, {"plan": stale})
            self.assertEqual(len(refreshed["lora"]["groups"]), 2)
            self.assertNotEqual(refreshed["analysisRevision"], revision)
            local = next(
                group for group in refreshed["lora"]["groups"] if group["kind"] == "embedded"
            )
            self.assertFalse(local["enabled"])
            self.assertTrue(local["disabled"])
            self.assertEqual(stale, snapshot)
        current = S.ensure_plan(source, {"plan": refreshed})
        self.assertEqual(current["analyzedAt"], refreshed["analyzedAt"])


class StackModeApiTests(ApiCase):
    def test_public_discovery_and_negative_precision_per_key_toggle(self):
        source = workflow()
        doc = self.ok(
            self.client.post(
                "/api/workflows", json={"name": "Synthetic mode graph", "graph": source}
            ),
            201,
        )
        issued = self.ok(
            self.client.post(
                "/api/tokens", json={"name": "Synthetic", "scopes": ["read", "write"]}
            ),
            201,
        )
        auth = {"Authorization": "Bearer " + issued["token"]}
        controls = self.ok(self.client.get(f"/api/v2/workflows/{doc['id']}/loras", headers=auth))
        group = next(group for group in controls["groups"] if group["kind"] == "stack")
        first, second = group["loras"]
        body = {
            "slot_overrides": {
                "groups": [
                    {
                        "key": group["key"],
                        "loras": [
                            {
                                "key": first["key"],
                                "name": first["name"],
                                "strength": -0.123456789,
                                "clip": -0.123456789,
                            },
                            {"key": second["key"], "name": second["name"], "enabled": False},
                        ],
                    }
                ]
            }
        }
        result = self.ok(
            self.client.post(f"/api/v2/workflows/{doc['id']}/compile", json=body, headers=auth)
        )
        expected = deepcopy(source)
        expected["pool"]["inputs"].update(lora_wt_1=-0.123456789, lora_wt_3=0)
        self.assertEqual(result["graph"], expected)
        self.assertEqual(self.ok(self.client.get(f"/api/workflows/{doc['id']}"))["graph"], source)
