"""Independent API-level LoRA acceptance across plugin-name-agnostic graph shapes."""

import json
from copy import deepcopy
from pathlib import Path

from mio_server.extensions.sdk import ExtensionAPI

from .api_harness import ApiCase
from .test_comfy_adapter_contracts import example


def node(kind="ModelOperation", **inputs):
    return {"class_type": kind, "inputs": inputs}


def chain(name="ink.safetensors", source="1", **inputs):
    return node(
        "LoraLoader",
        model=[source, 0],
        clip=[source, 1],
        lora_name=name,
        strength_model=0.7,
        strength_clip=0.3,
        **inputs,
    )


def graph_for(operation, *, source="2"):
    return {
        "1": node("CheckpointLoaderSimple", ckpt_name="base.safetensors"),
        "2": operation,
        "sample": node("KSampler", model=[source, 0]),
        "output": node("SaveImage", images=["sample", 0]),
    }


def topology_cases():
    yield "standard-chain", graph_for(chain()), "chain"
    graph = graph_for(chain())
    graph["3"] = chain("tone.safetensors", "2")
    graph["sample"]["inputs"]["model"] = ["3", 0]
    yield "two-chain-loaders", graph, "chain"
    graph = graph_for(chain())
    graph["second"] = node("CLIPTextEncode", clip=["2", 1], text="蓝色房间")
    graph["sample"]["inputs"]["positive"] = ["second", 0]
    yield "model-and-clip-fanout", graph, "chain"
    graph = graph_for(node(lora_1="ink.safetensors", strength_1=0.7, model=["1", 0]))
    yield "numbered-stack", graph, "stack"
    graph = graph_for(
        node(
            model=["1", 0],
            lora_1_name="ink.safetensors",
            model_strength_1=0.7,
            clip_strength_1=0.3,
            lora_2_name="tone.safetensors",
            model_strength_2=0.8,
            clip_strength_2=0.4,
            num_loras=2,
        )
    )
    yield "two-position-stack", graph, "stack"
    for wrapped in (False, True):
        entries = [
            {"name": "ink.safetensors", "strength": 0.7, "clipStrength": 0.3, "active": True},
            {"name": "tone.safetensors", "strength": 0.8, "clipStrength": 0.4, "active": True},
        ]
        operation = node(model=["1", 0], loras={"__value__": entries} if wrapped else entries)
        yield "wrapped-object" if wrapped else "object-list", graph_for(operation), "object"
    operation = node(
        "CompositeLoader",
        ckpt_name="base.safetensors",
        lora_name="ink.safetensors",
        lora_strength=0.7,
        strength_clip=0.3,
    )
    yield "embedded-loader", graph_for(operation), "embedded"
    operation = node(model=["1", 0], lora_syntax="quiet <lora:ink.safetensors:0.7:0.3>")
    yield "tag-syntax", graph_for(operation), "syntax"
    graph = graph_for(chain())
    graph["197:189"] = graph.pop("2")
    graph["197:189"]["_meta"] = {"title": "参数面板 / Ink α"}
    graph["sample"]["inputs"]["model"] = ["197:189", 0]
    yield "nested-id-and-bilingual-title", graph, "chain"
    graph = graph_for(chain())
    graph["switch"] = node(on_true=["2", 0], on_false=["1", 0], boolean=True)
    graph["sample"]["inputs"]["model"] = ["switch", 0]
    yield "selected-switch-branch", graph, "chain"
    graph = graph_for(chain())
    graph["preview"] = node("PreviewImage", images=["sample", 0])
    yield "multiple-image-outputs", graph, "chain"
    graph = graph_for(chain())
    graph["3"] = node(model=["2", 0], lora_1="tone.safetensors", strength_1=0.4)
    graph["sample"]["inputs"]["model"] = ["3", 0]
    yield "chain-and-stack-mix", graph, "chain"
    packed = [{"name": "ink.safetensors", "strength": 0.7, "clip": 0.3}]
    yield (
        "extension-packed-json",
        graph_for(node("ExamplePackedModel", model=["1", 0], packed_adapters=json.dumps(packed))),
        "extension",
    )


def has_disabled_item(graph, group, name):
    """Read native output inputs, independently of the adapter implementation."""
    site = group["sites"][0]
    values = graph[site["nodeId"]]["inputs"]
    kind = group["kind"]
    if kind in {"chain", "embedded"}:
        return values.get("strength_model", values.get("lora_strength")) == 0
    if kind == "stack":
        return values.get("strength_1", values.get("model_strength_1")) == 0
    if kind == "object":
        entries = values["loras"]
        if isinstance(entries, dict):
            entries = entries["__value__"]
        return entries[0]["active"] is False and entries[0]["strength"] == 0
    if kind == "syntax":
        return f"<lora:{name}:" not in values["lora_syntax"]
    return json.loads(values["packed_adapters"])[0]["enabled"] is False


class SlotTopologyMatrixTests(ApiCase):
    def setUp(self):
        super().setUp()
        api = ExtensionAPI("matrix-slot", Path(self.tmp), self.ctx, digest="matrix-reviewed")
        example("comfy-slot-codec").activate(api)

    def imported(self, name, graph):
        return self.ok(self.client.post("/api/workflows", json={"name": name, "graph": graph}), 201)

    def test_fourteen_topologies_import_discover_toggle_compile_without_source_mutation(self):
        cases = list(topology_cases())
        self.assertGreaterEqual(len(cases), 14)
        for name, graph, kind in cases:
            with self.subTest(topology=name):
                original = deepcopy(graph)
                workflow = self.imported(name, graph)
                path = f"/api/workflows/{workflow['id']}"
                controls = self.ok(self.client.get(path + "/loras"))
                group = next(group for group in controls["groups"] if group["kind"] == kind)
                selected = group["loras"][0]
                self.assertTrue(group["supports_independent_toggle"])
                self.assertTrue(selected["enabled"])
                change = {"key": selected["key"], "name": selected["name"], "enabled": False}
                payload = {"slot_overrides": {"groups": [{"key": group["key"], "loras": [change]}]}}
                compiled = self.ok(self.client.post(path + "/compile", json=payload))
                self.assertTrue(has_disabled_item(compiled["graph"], group, selected["name"]))
                reported = next(
                    entry
                    for entry in compiled["lora_controls"]["groups"]
                    if entry["key"] == group["key"]
                )
                self.assertFalse(reported["loras"][0]["enabled"])
                self.assertEqual(self.ok(self.client.get(path))["graph"], original)
                self.assertEqual(graph, original)
                change["enabled"] = True
                restored = self.ok(self.client.post(path + "/compile", json=payload))["graph"]
                site = group["sites"][0]["nodeId"]
                self.assertEqual(restored[site], original[site])
                self.assertEqual(self.ok(self.client.get(path + "/loras")), controls)

    def test_same_name_pins_have_independent_keys_and_survive_an_added_lora(self):
        graph = graph_for(
            node(
                model=["1", 0],
                loras=[
                    {
                        "name": "ink.safetensors",
                        "strength": 0.3,
                        "clipStrength": 0.2,
                        "active": True,
                    },
                    {
                        "name": "ink.safetensors",
                        "strength": 0.8,
                        "clipStrength": 0.6,
                        "active": True,
                    },
                ],
            )
        )
        workflow = self.imported("Same name", graph)
        path = f"/api/workflows/{workflow['id']}"
        group = self.ok(self.client.get(path + "/loras"))["groups"][0]
        first, second = group["loras"]
        self.assertNotEqual(first["key"], second["key"])
        overrides = {
            "loras": [{"name": "wash.safetensors", "strength": 0.4, "clip": 0.1}],
            "groups": [
                {
                    "key": group["key"],
                    "loras": [{"key": second["key"], "name": second["name"], "enabled": False}],
                }
            ],
        }
        compiled = self.ok(self.client.post(path + "/compile", json={"slot_overrides": overrides}))
        entries = compiled["graph"]["2"]["inputs"]["loras"]
        self.assertEqual(len(entries), 3)
        self.assertEqual(entries[0], graph["2"]["inputs"]["loras"][0])
        self.assertEqual(
            (entries[1]["strength"], entries[1]["clipStrength"], entries[1]["active"]),
            (0, 0, False),
        )
        self.assertEqual(
            (entries[2]["name"], entries[2]["strength"], entries[2]["clipStrength"]),
            ("wash.safetensors", 0.4, 0.1),
        )
        self.assertEqual(self.ok(self.client.get(path))["graph"], graph)

    def test_dead_switch_branch_is_read_only_and_reports_why(self):
        graph = graph_for(chain())
        graph["switch"] = node(on_true=["2", 0], on_false=["1", 0], boolean=False)
        graph["sample"]["inputs"]["model"] = ["switch", 0]
        workflow = self.imported("Bypassed", graph)
        path = f"/api/workflows/{workflow['id']}"
        group = self.ok(self.client.get(path + "/loras"))["groups"][0]
        self.assertFalse(group["active"])
        self.assertFalse(group["supports_independent_toggle"])
        self.assertTrue(group["reason"])
        selected = group["loras"][0]
        denied = self.client.post(
            path + "/compile",
            json={
                "slot_overrides": {
                    "groups": [
                        {
                            "key": group["key"],
                            "loras": [
                                {"key": selected["key"], "name": selected["name"], "enabled": False}
                            ],
                        }
                    ]
                }
            },
        )
        self.assertEqual(denied.status_code, 400, denied.text)
        self.assertEqual(self.ok(self.client.get(path))["graph"], graph)

    def test_muted_and_bypassed_lora_nodes_never_claim_an_active_control(self):
        for mode in (2, 4):
            with self.subTest(mode=mode):
                graph = graph_for(chain())
                graph["2"]["mode"] = mode
                workflow = self.imported(f"Mode {mode}", graph)
                path = f"/api/workflows/{workflow['id']}"
                group = self.ok(self.client.get(path + "/loras"))["groups"][0]
                self.assertFalse(group["active"])
                self.assertFalse(group["supports_independent_toggle"])
                self.assertTrue(group["reason"])
                self.assertEqual(self.ok(self.client.get(path))["graph"], graph)

    def test_native_disabled_rows_are_visible_and_reenable_with_original_strengths(self):
        operations = [
            node(
                model=["1", 0],
                loras=[
                    {
                        "name": "ink.safetensors",
                        "strength": 0.7,
                        "clipStrength": 0.3,
                        "active": False,
                    }
                ],
            ),
            node(
                model=["1", 0],
                lora_1={
                    "lora": "ink.safetensors",
                    "strength": 0.7,
                    "strengthTwo": 0.3,
                    "on": False,
                },
            ),
        ]
        for index, operation in enumerate(operations):
            with self.subTest(shape=index):
                graph = graph_for(operation)
                workflow = self.imported("Disabled at import", graph)
                path = f"/api/workflows/{workflow['id']}"
                group = self.ok(self.client.get(path + "/loras"))["groups"][0]
                self.assertEqual(len(group["loras"]), 1)
                selected = group["loras"][0]
                self.assertFalse(selected["enabled"])
                self.assertEqual((selected["strength"], selected["clip"]), (0.7, 0.3))
                payload = {
                    "slot_overrides": {
                        "groups": [
                            {
                                "key": group["key"],
                                "loras": [
                                    {
                                        "key": selected["key"],
                                        "name": selected["name"],
                                        "enabled": True,
                                    }
                                ],
                            }
                        ]
                    }
                }
                compiled = self.ok(self.client.post(path + "/compile", json=payload))
                inputs = compiled["graph"]["2"]["inputs"]
                entry = inputs["loras"][0] if index == 0 else inputs["lora_1"]
                self.assertTrue(entry["active"] if index == 0 else entry["on"])
                self.assertEqual(entry["strength"], 0.7)
                self.assertEqual(entry["clipStrength"] if index == 0 else entry["strengthTwo"], 0.3)
                self.assertEqual(self.ok(self.client.get(path))["graph"], graph)

    def test_configured_additional_lora_has_a_stable_independent_control(self):
        graph = graph_for(chain())
        workflow = self.imported("Default added adapter", graph)
        path = f"/api/workflows/{workflow['id']}"
        self.ok(
            self.client.patch(
                path,
                json={
                    "config": {
                        "slot_overrides": {
                            "loras": [
                                {
                                    "name": "wash.safetensors",
                                    "strength": 0.6,
                                    "clip": 0.2,
                                    "enabled": False,
                                }
                            ]
                        }
                    }
                },
            )
        )
        controls = self.ok(self.client.get(path + "/loras"))
        group = controls["groups"][0]
        self.assertEqual(
            [entry["name"] for entry in group["loras"]], ["ink.safetensors", "wash.safetensors"]
        )
        appended = group["loras"][1]
        self.assertFalse(appended["pinned"])
        self.assertFalse(appended["enabled"])
        self.assertTrue(appended["key"])
        self.assertEqual(self.ok(self.client.get(path + "/loras")), controls)
        change = {"key": appended["key"], "name": appended["name"], "enabled": True}
        compiled = self.ok(
            self.client.post(
                path + "/compile",
                json={"slot_overrides": {"groups": [{"key": group["key"], "loras": [change]}]}},
            )
        )
        inputs = compiled["graph"]["2:lora1"]["inputs"]
        self.assertEqual(inputs["lora_name"], "wash.safetensors")
        self.assertEqual((inputs["strength_model"], inputs["strength_clip"]), (0.6, 0.2))
        self.assertEqual(self.ok(self.client.get(path))["graph"], graph)
