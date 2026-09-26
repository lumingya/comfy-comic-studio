import copy
import json
import unittest
from pathlib import Path

from mio_server.comfy import workflow_slots as slots
from mio_server.comfy.workflow_slots import LibraryError


class WorkflowSlotsTests(unittest.TestCase):
    def test_shared_contract(self):
        fixtures = json.loads(
            (Path(__file__).parents[2] / "tests/fixtures/workflow_slots_contract.json").read_text()
        )["cases"]
        for f in fixtures:
            with self.subTest(fixture=f["name"]):
                before = copy.deepcopy(f["workflow"])
                plan = slots.analyze(
                    f["workflow"], f.get("objectInfo"), f.get("manual"), f.get("slots")
                )
                for g in plan["lora"]["groups"]:
                    if g["key"] in f.get("enable", []):
                        g["enabled"] = True
                plan.pop("analyzedAt")
                self.assertEqual(plan, f["plan"])
                if f["error"]:
                    with self.assertRaises(LibraryError) as caught:
                        slots.apply(f["workflow"], plan, f["overrides"], f.get("objectInfo"))
                    self.assertEqual(str(caught.exception), f["error"])
                else:
                    result = slots.apply(f["workflow"], plan, f["overrides"], f.get("objectInfo"))
                    for k, value in f["apply"].items():
                        self.assertEqual(result[k], value, k)
                self.assertEqual(f["workflow"], before)

    def test_catalog_from_object_info(self):
        catalog = slots.catalog_from_object_info(
            {
                "CheckpointLoaderSimple": {
                    "input": {"required": {"ckpt_name": [["b.safetensors", "a.safetensors"]]}}
                },
                "Checkpoint Loader with Name (Image Saver)": {
                    "input": {"required": {"ckpt_name": [["c.safetensors", "a.safetensors"]]}}
                },
                "UNETLoader": {
                    "input": {
                        "required": {
                            "unet_name": [["flux.safetensors"]],
                            "weight_dtype": [["default", "fp8"]],
                        }
                    }
                },
                "LoraLoader": {"input": {"required": {"lora_name": [["None", "x.safetensors"]]}}},
                "Broken": {"input": {"required": {"lora_name": ["STRING"]}}},
            }
        )
        self.assertEqual(
            catalog,
            {
                "checkpoints": ["a.safetensors", "b.safetensors", "c.safetensors"],
                "unets": ["flux.safetensors"],
                "loras": ["x.safetensors"],
                "vaes": [],
            },
        )

    def test_tag_formatting_matches_browser(self):
        self.assertEqual(
            slots.format_tag({"name": "sub\\Cool Style.safetensors", "strength": 0.85}, "stem"),
            "<lora:Cool Style:0.85>",
        )
        self.assertEqual(
            slots.format_tag({"name": "x.safetensors", "strength": 1, "clip": 0.5}, "stem"),
            "<lora:x:1:0.5>",
        )
        self.assertEqual(slots.number_text(0.1 + 0.2), "0.3")
        parsed = slots.parse_lora_syntax("hello <lora:a:0.5> world, <lora:b:1:0.7>")
        self.assertEqual(
            parsed["loras"],
            [{"name": "a", "strength": 0.5}, {"name": "b", "strength": 1, "clip": 0.7}],
        )
        self.assertEqual(parsed["text"], "hello world")

    def test_describe_overrides(self):
        self.assertEqual(
            slots.describe_overrides(
                {
                    "model": "Illustrious\\wai.safetensors",
                    "loras": [{"name": "a.safetensors", "strength": 0.8}],
                }
            ),
            "wai · LoRA · a ×0.8",
        )
        self.assertEqual(slots.describe_overrides({"loras": []}), "LoRA · 无追加")
        self.assertEqual(slots.describe_overrides({}), "")
