import json
from copy import deepcopy
from pathlib import Path

from mio_server.extensions.sdk import ExtensionAPI

from .api_harness import ApiCase
from .test_comfy_adapter_contracts import example


class WorkflowSlotAdapterTests(ApiCase):
    def test_extension_controls_are_discoverable_and_compile_without_mutating_source(self):
        api = ExtensionAPI("slot-example", Path(self.tmp), self.ctx, digest="reviewed")
        with self.assertRaisesRegex(ValueError, "contract"):
            api.contribute("workflow_slot_adapter", "invalid", object())
        example("comfy-slot-codec").activate(api)
        packed = [
            {"name": "ink.safetensors", "strength": 0.5},
            {"name": "ink.safetensors", "strength": 0.8, "clip": 0.2},
        ]
        graph = {
            "1": {
                "class_type": "ExamplePackedModel",
                "inputs": {"packed_adapters": json.dumps(packed)},
            },
            "2": {"class_type": "KSampler", "inputs": {"model": ["1", 0]}},
            "3": {"class_type": "SaveImage", "inputs": {"images": ["2", 0]}},
        }
        original = deepcopy(graph)
        workflow = self.ok(
            self.client.post("/api/workflows", json={"name": "Custom LoRAs", "graph": graph}), 201
        )
        base = f"/api/workflows/{workflow['id']}"
        group = self.ok(self.client.get(f"{base}/loras"))["groups"][0]
        self.assertEqual(group["adapter"]["source"], api.source)
        before, selected = group["loras"]
        self.assertNotEqual(before["key"], selected["key"])
        payload = {
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
        }
        compiled = self.ok(self.client.post(f"{base}/compile", json=payload))
        rows = json.loads(compiled["graph"]["1"]["inputs"]["packed_adapters"])
        self.assertTrue(rows[0]["enabled"])
        self.assertEqual(rows[1], {**packed[1], "enabled": False})
        self.assertFalse(compiled["lora_controls"]["groups"][0]["loras"][1]["enabled"])
        self.assertEqual(self.ok(self.client.get(base))["graph"], original)
        inspection = self.ok(
            self.client.post("/api/workflows/inspect", json={"workflow": original})
        )
        self.assertEqual(inspection["lora_controls"]["groups"][0]["key"], group["key"])
        self.ctx.registry.unregister_source(api.source)
        self.assertEqual(self.ok(self.client.get(f"{base}/loras"))["groups"], [])
        self.assertEqual(self.client.post(f"{base}/compile", json=payload).status_code, 400)
