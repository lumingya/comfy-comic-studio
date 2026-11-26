"""Catalog reads reuse real analysis without weakening editing or execution validation."""

import unittest
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from unittest.mock import patch

from mio_server.comfy import bindings as B
from mio_server.comfy import compile as C
from mio_server.comfy import slot_adapters as SA
from mio_server.comfy import workflow_slot_plan as plans
from mio_server.comfy import workflow_slots as slots
from mio_server.registry import Registry
from mio_server.render_models import WorkflowDoc
from mio_server.workflow_catalog import WorkflowCatalog

from .api_harness import ApiCase
from .test_workflow_stack_modes import workflow as mode_workflow


def graph():
    return {
        "1": {
            "class_type": "CheckpointLoaderSimple",
            "inputs": {"ckpt_name": "base.safetensors"},
        },
        "2": {
            "class_type": "LoraLoader",
            "inputs": {
                "model": ["1", 0],
                "clip": ["1", 1],
                "lora_name": "ink.safetensors",
                "strength_model": 0.7,
                "strength_clip": 0.4,
            },
        },
        "3": {"class_type": "CLIPTextEncode", "inputs": {"clip": ["2", 1], "text": "rain"}},
        "4": {"class_type": "CLIPTextEncode", "inputs": {"clip": ["2", 1], "text": "blur"}},
        "5": {
            "class_type": "EmptyLatentImage",
            "inputs": {"width": 512, "height": 512, "batch_size": 1},
        },
        "6": {
            "class_type": "KSampler",
            "inputs": {
                "model": ["2", 0],
                "positive": ["3", 0],
                "negative": ["4", 0],
                "latent_image": ["5", 0],
                "seed": 7,
                "steps": 2,
                "cfg": 7,
                "sampler_name": "euler",
                "scheduler": "normal",
                "denoise": 1,
            },
        },
        "7": {"class_type": "VAEDecode", "inputs": {"samples": ["6", 0], "vae": ["1", 2]}},
        "8": {"class_type": "SaveImage", "inputs": {"images": ["7", 0]}},
    }


def stack_graph(shape, *, enabled=True):
    source = graph()
    entries = (
        {
            "lora_name_1": "ink.safetensors",
            "strength_1": "private-invalid-weight",
            "clip_strength_1": 0.4,
            "switch_1": "On" if enabled else "Off",
        }
        if shape == "flat"
        else {
            "lora_1": {
                "lora": "ink.safetensors",
                "strength": "private-invalid-weight",
                "strengthTwo": 0.4,
                "on": enabled,
            }
        }
    )
    source["2"] = {
        "class_type": "CatalogSyntheticStack",
        "inputs": {"model": ["1", 0], "clip": ["1", 1], **entries},
    }
    return source


class WorkflowCatalogTests(unittest.TestCase):
    def setUp(self):
        self.registry = Registry()
        self.catalog = WorkflowCatalog(self.registry)
        self.addCleanup(self.catalog.close)

    def doc(self, id="one", *, seed=7):
        source = graph()
        source["6"]["inputs"]["seed"] = seed
        return WorkflowDoc(id=id, name=id, graph=source)

    def test_identical_content_is_analyzed_once_on_the_first_catalog_read(self):
        for wrapped in (False, True):
            with self.subTest(wrapped=wrapped):
                first, second = self.doc(), self.doc("two")
                second.name = "another name"
                second.source = "legacy"
                first.updated_at = "2026-11-01T00:00:00Z"
                second.updated_at = "2026-11-02T00:00:00Z"
                with patch.object(plans, "datetime") as clock:
                    clock.now.return_value.isoformat.side_effect = [
                        "2026-11-01T00:00:00+00:00",
                        "2026-11-02T00:00:00+00:00",
                    ]
                    first.slots = slots.analyze(first.graph)
                    second.slots = slots.analyze(second.graph)
                self.assertNotEqual(first.slots["analyzedAt"], second.slots["analyzedAt"])
                if wrapped:
                    first.slots = {"plan": first.slots}
                    second.slots = {"plan": second.slots}
                before = [deepcopy(doc.model_dump()) for doc in (first, second)]
                with (
                    patch.object(C, "describe", wraps=C.describe) as describe,
                    patch.object(slots, "analyze", wraps=slots.analyze) as analyze,
                ):
                    rows = self.catalog.summaries([first, second])
                    self.assertEqual(describe.call_count, 1)
                    self.assertEqual(analyze.call_count, 1)
                    self.assertEqual(self.catalog.summaries([first, second]), rows)
                    self.assertEqual(describe.call_count, 1)
                    self.assertEqual(analyze.call_count, 1)
                for doc, row in zip((first, second), rows, strict=True):
                    for key in ("id", "name", "source", "updated_at"):
                        self.assertEqual(row[key], getattr(doc, key))
                self.assertEqual([doc.model_dump() for doc in (first, second)], before)
                rows[0]["loras"]["enabled"] = False
                rows[0]["variants"].append("corrupt")
                self.assertTrue(rows[1]["loras"]["enabled"])
                self.assertEqual(rows[1]["variants"], [])
                self.assertTrue(self.catalog.summaries([first])[0]["loras"]["enabled"])

    def test_repeated_catalog_and_one_changed_document_do_not_reanalyze_other_graphs(self):
        first, second = self.doc(), self.doc("two", seed=8)
        with patch.object(C, "describe", wraps=C.describe) as describe:
            before = self.catalog.summaries([first, second])
            self.assertEqual(describe.call_count, 2)
            self.assertEqual(self.catalog.summaries([first, second]), before)
            self.assertEqual(describe.call_count, 2)
            first.graph["1"]["inputs"]["ckpt_name"] = "another.safetensors"
            changed = self.catalog.summaries([first, second])
            self.assertEqual(describe.call_count, 3)
            self.assertEqual(changed[0]["checkpoint"], "another.safetensors")
            self.assertEqual(changed[1], before[1])
            self.catalog.summaries([first, second, self.doc("new", seed=9)])
            self.assertEqual(describe.call_count, 4)

    def test_actual_config_slots_revision_and_object_info_are_part_of_the_key(self):
        doc = self.doc()
        doc.slots = slots.analyze(doc.graph)
        stamp = doc.updated_at
        with patch.object(C, "describe", wraps=C.describe) as describe:
            self.catalog.summaries([doc])
            doc.config.mapping["prompt"] = "/3/inputs/text"
            self.catalog.summaries([doc])
            doc.config.values["seed"] = 9
            self.catalog.summaries([doc])
            doc.config.overrides["/1/inputs/ckpt_name"] = "override.safetensors"
            changed = self.catalog.summaries([doc])
            self.assertEqual(changed[0]["checkpoint"], "override.safetensors")
            doc.config.slot_overrides["disabled"] = [doc.slots["lora"]["groups"][0]["key"]]
            self.catalog.summaries([doc])
            doc.slots["lora"]["groups"][0]["enabled"] = False
            disabled = self.catalog.summaries([doc])
            self.assertFalse(disabled[0]["loras"]["supports_independent_toggle"])
            with patch.object(plans, "ANALYSIS_REVISION", plans.ANALYSIS_REVISION + 1):
                self.catalog.summaries([doc])
            self.catalog.summaries([doc], object_info={"LoraLoader": {"output": ["MODEL"]}})
            self.assertEqual(describe.call_count, 8)
        self.assertEqual(doc.updated_at, stamp)

    def test_saved_advisory_groups_are_not_the_source_of_catalog_facts(self):
        doc = self.doc()
        doc.slots = slots.analyze(doc.graph)
        doc.slots["lora"]["groups"] = []
        before = deepcopy(doc.model_dump())
        summary = self.catalog.summaries([doc])[0]
        self.assertEqual(summary["loras"]["groups"], 1)
        self.assertEqual(doc.model_dump(), before)

    def test_binding_registration_replacement_and_no_point_removal_invalidate(self):
        doc = self.doc()
        self.assertEqual(self.catalog.summaries([doc])[0]["variants"], [])
        for variant in ("draft", "final"):
            self.registry.register(
                "workflow_binding",
                "variant",
                lambda _graph, selected=variant: [B.Binding("output", "8", qualifier=selected)],
                source="ext:catalog",
                replace=variant == "final",
                digest=variant,
            )
            self.assertEqual(self.catalog.summaries([doc])[0]["variants"], [variant])
        self.registry.unregister_source("ext:catalog")
        self.assertEqual(self.catalog.summaries([doc])[0]["variants"], [])

    def test_slot_adapter_enable_disable_uses_current_contributions(self):
        class Adapter:
            def inspect(self, node):
                if node["class_type"] != "ExamplePackedModel":
                    return None
                return {
                    "path": "packed_adapters",
                    "loras": [{"name": "ink.safetensors", "strength": 0.5}],
                    "can_disable": True,
                }

        doc = WorkflowDoc(
            name="packed",
            graph={
                "1": {"class_type": "ExamplePackedModel", "inputs": {"packed_adapters": "[]"}},
                "2": {"class_type": "KSampler", "inputs": {"model": ["1", 0]}},
                "3": {"class_type": "SaveImage", "inputs": {"images": ["2", 0]}},
            },
        )
        self.assertEqual(self.catalog.summaries([doc])[0]["loras"]["groups"], 0)
        self.registry.register(
            "workflow_slot_adapter", "packed", Adapter(), source="ext:packed", digest="reviewed"
        )
        summary = self.catalog.summaries([doc])[0]["loras"]
        self.assertEqual(summary["groups"], 1)
        self.assertTrue(summary["supports_independent_toggle"])
        self.registry.unregister_source("ext:packed")
        self.assertEqual(self.catalog.summaries([doc])[0]["loras"]["groups"], 0)

    def test_registry_change_during_analysis_discards_the_entire_old_snapshot(self):
        describe = C.describe
        changed = False

        def changing(doc, **kwargs):
            nonlocal changed
            result = describe(doc, **kwargs)
            if not changed:
                changed = True
                self.registry.register(
                    "workflow_binding",
                    "late",
                    lambda _graph: [B.Binding("output", "8", qualifier="current")],
                )
            return result

        with patch.object(C, "describe", side_effect=changing) as wrapped:
            rows = self.catalog.summaries([self.doc(), self.doc("two", seed=8)])
        self.assertEqual([row["variants"] for row in rows], [["current"], ["current"]])
        self.assertEqual(wrapped.call_count, 4)

    def test_capacity_returned_copies_and_workspace_isolation(self):
        small = WorkflowCatalog(self.registry, capacity=2)
        other = WorkflowCatalog(Registry())
        self.addCleanup(small.close)
        self.addCleanup(other.close)
        one, two, three = self.doc(), self.doc("two", seed=8), self.doc("three", seed=9)
        with patch.object(C, "describe", wraps=C.describe) as describe:
            small.summaries([one, two])
            row = small.summaries([one])[0]
            row["loras"]["enabled"] = False
            row["variants"].append("corrupt")
            self.assertEqual(small.summaries([one])[0]["variants"], [])
            small.summaries([three])
            small.summaries([two])
            self.assertEqual(describe.call_count, 4)
            other.summaries([one])
            self.assertEqual(describe.call_count, 5)
        one.name = "renamed"
        one.updated_at = "changed"
        self.assertEqual(small.summaries([one])[0]["name"], "renamed")
        self.assertEqual(small.summaries([one])[0]["updated_at"], "changed")

    def test_concurrent_callers_receive_independent_consistent_results(self):
        doc = self.doc()
        expected = self.catalog.summaries([doc])
        with ThreadPoolExecutor(max_workers=3) as executor:
            rows = list(executor.map(lambda _: self.catalog.summaries([doc]), range(6)))
        self.assertEqual(rows, [expected] * 6)
        rows[0][0]["loras"]["enabled"] = False
        self.assertTrue(rows[1][0]["loras"]["enabled"])

    def test_unused_mode_count_and_empty_name_weights_keep_their_existing_contracts(self):
        mode = mode_workflow("simple", count=1)
        for key in ("model_str_1", "clip_str_1", "lora_wt_2", "lora_wt_3", "lora_wt_4"):
            mode["pool"]["inputs"][key] = "unused-invalid-weight"
        empty_flat = stack_graph("flat", enabled=False)
        empty_flat["2"]["inputs"]["lora_name_1"] = "None"
        empty_power = stack_graph("power", enabled=False)
        empty_power["2"]["inputs"]["lora_1"]["lora"] = "None"
        chain = graph()
        chain["2"]["inputs"]["strength_model"] = "legacy-invalid-weight"
        for name, source in (
            ("unused-mode-count", mode),
            ("empty-flat", empty_flat),
            ("empty-power", empty_power),
            ("legacy-chain", chain),
        ):
            with self.subTest(name=name):
                doc = WorkflowDoc(name=name, graph=source)
                row = self.catalog.summaries([doc])[0]
                self.assertIsNotNone(row["loras"])
                self.assertNotIn("lora_error", row)
                controls = SA.describe(doc, self.registry)
                self.assertIsInstance(controls["groups"], list)
                if name == "legacy-chain":
                    self.assertEqual(controls["groups"][0]["loras"][0]["strength"], 1)


class WorkflowCatalogApiTests(ApiCase):
    def test_slot_library_errors_are_isolated_and_never_cached_as_a_successful_plan(self):
        good = WorkflowDoc(name="healthy", graph=graph())
        self.ctx.store.put_doc(good)
        bad_docs, saved = [], {}
        for shape, enabled in (("flat", True), ("power", True), ("flat", False), ("power", False)):
            bad = WorkflowDoc(
                name=f"unavailable-{shape}-{enabled}", graph=stack_graph(shape, enabled=enabled)
            )
            self.ctx.store.put_doc(bad)
            bad_docs.append(bad)
            saved[bad.id] = self.ctx.store.get_doc("workflow", bad.id).model_dump()
        with patch.object(slots, "analyze", wraps=slots.analyze) as analyze:
            first = self.ok(self.client.get("/api/workflows"))
            calls = analyze.call_count
            second = self.ok(self.client.get("/api/workflows"))
            self.assertEqual(analyze.call_count, calls + len(bad_docs))
        self.assertEqual(first, second)
        rows = {row["id"]: row for row in first}
        self.assertEqual(rows[good.id]["loras"]["groups"], 1)
        self.assertNotIn("lora_error", rows[good.id])
        for bad in bad_docs:
            with self.subTest(shape=bad.name):
                self.assertIsNone(rows[bad.id]["loras"])
                self.assertEqual(rows[bad.id]["lora_error"]["code"], "MIO-SLOT-001")
                self.assertNotIn("private-invalid-weight", str(rows[bad.id]["lora_error"]))
                self.assertEqual(
                    self.ctx.store.get_doc("workflow", bad.id).model_dump(), saved[bad.id]
                )
                detail = self.client.get(f"/api/workflows/{bad.id}/loras")
                self.assertEqual(detail.status_code, 400)
                self.assertEqual(detail.json()["code"], "MIO-SLOT-001")
                repaired = self.ok(
                    self.client.patch(f"/api/workflows/{bad.id}", json={"graph": graph()})
                )
                self.assertTrue(repaired["lora_controls"]["groups"])
                row = next(
                    row for row in self.ok(self.client.get("/api/workflows")) if row["id"] == bad.id
                )
                self.assertEqual(row["loras"]["groups"], 1)
                self.assertNotIn("lora_error", row)

    def test_import_and_patch_validate_returned_controls_before_persisting(self):
        imported = self.ok(
            self.client.post("/api/workflows", json={"name": "healthy", "graph": graph()}), 201
        )
        saved = self.ctx.store.get_doc("workflow", imported["id"]).model_dump()
        before = {doc.id for doc in self.ctx.store.list_docs("workflow")}
        for shape, enabled in (("flat", True), ("power", True), ("flat", False), ("power", False)):
            with self.subTest(shape=shape, enabled=enabled):
                bad = stack_graph(shape, enabled=enabled)
                rejected = self.client.post("/api/workflows", json={"name": "bad", "graph": bad})
                self.assertEqual(rejected.status_code, 400)
                self.assertEqual(rejected.json()["code"], "MIO-SLOT-001")
                self.assertEqual({doc.id for doc in self.ctx.store.list_docs("workflow")}, before)
                rejected = self.client.patch(
                    f"/api/workflows/{imported['id']}", json={"graph": bad}
                )
                self.assertEqual(rejected.status_code, 400)
                self.assertEqual(rejected.json()["code"], "MIO-SLOT-001")
                self.assertEqual(
                    self.ctx.store.get_doc("workflow", imported["id"]).model_dump(), saved
                )

    def test_openapi_declares_nullable_loras_and_optional_neutral_error(self):
        schemas = self.client.app.openapi()["components"]["schemas"]
        summary = schemas["WorkflowSummary"]
        self.assertIn("loras", summary["required"])
        self.assertNotIn("lora_error", summary["required"])
        self.assertIn({"type": "null"}, summary["properties"]["loras"]["anyOf"])
        self.assertEqual(set(schemas["WorkflowSummaryError"]["properties"]), {"code", "message"})
