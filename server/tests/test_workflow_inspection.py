"""Import review, output selection and extension rules share the actual compiler."""

import copy
import unittest
from unittest import mock

from mio_server.comfy import bindings as B
from mio_server.comfy import compile as C
from mio_server.comfy import inspection as I
from mio_server.comfy.diagnostics import diagnose
from mio_server.render_models import RenderProfile, RenderStage, WorkflowConfig, WorkflowDoc

from .api_harness import ApiCase
from .test_bindings import multi_stage_workflow, plain_sdxl


class InspectionTests(unittest.TestCase):
    def inspect(self, graph, **kw):
        return I.inspect(I.InspectRequest(workflow=graph, **kw))

    def test_standard_graph_and_package_leave_inputs_unchanged(self):
        graph = plain_sdxl()
        for payload in (graph, {"graph": graph, "config": {"values": {"seed": 99}}}):
            before = copy.deepcopy(payload)
            report = self.inspect(payload)
            self.assertTrue(report.importable)
            self.assertTrue(report.compilable)
            self.assertEqual(report.missing, [])
            self.assertEqual(report.output_nodes, ["9"])
            self.assertEqual(report.models[0].value, "x.safetensors")
            self.assertIsNone(report.diagnostics)
            self.assertEqual(payload, before)

    def test_ui_and_invalid_formats_are_actionable_not_imported(self):
        ui = self.inspect({"nodes": [], "links": []})
        self.assertEqual(ui.format, "ui")
        self.assertFalse(ui.importable)
        self.assertIn("API", ui.issues[0].message)
        for value in ({}, {"1": {"inputs": {}}}, {"graph": []}):
            report = self.inspect(value)
            self.assertEqual(report.format, "invalid")
            self.assertFalse(report.importable)

    def test_unresolved_text_chain_reports_candidates_not_guessed_writes(self):
        graph = plain_sdxl()
        graph["6"]["inputs"]["text"] = ["10", 0]
        graph["10"] = {"class_type": "Concat", "inputs": {"a": ["11", 0], "b": ["12", 0]}}
        graph["11"] = {"class_type": "String", "inputs": {"text": "one"}}
        graph["12"] = {"class_type": "String", "inputs": {"text": "two"}}
        # clip is a link, so there is no writable string in the positive encoder itself.
        before = copy.deepcopy(graph)
        report = self.inspect(graph)
        self.assertIn("prompt", report.missing)
        self.assertTrue(any(i.code == "ambiguous" and i.kind == "prompt" for i in report.issues))
        self.assertTrue({"11", "12"} <= {b.node for b in report.candidates if b.kind == "prompt"})
        self.assertFalse(any(b.kind == "prompt" for b in report.bindings))
        self.assertEqual(graph, before)

    def test_custom_output_mapping_selects_node_without_replacing_image_link(self):
        graph = plain_sdxl()
        graph["9"]["class_type"] = "CustomImageOutput"
        before = copy.deepcopy(graph)
        for pointer in ("/9", "/9/inputs/images"):
            doc = WorkflowDoc(
                name="custom", graph=graph, config=WorkflowConfig(mapping={"output": pointer})
            )
            compiled = C.compile_workflow(doc, {"prompt": "new", "output": "must not be written"})
            self.assertEqual(compiled.outputs, ["9"])
            self.assertEqual(compiled.graph["9"]["inputs"]["images"], ["8", 0])
            self.assertEqual(graph, before)
        with self.assertRaises(B.BindingError):
            B.resolve(graph, {"prompt": "/9/inputs/images"})

    def test_split_noise_guider_and_unique_text_chain_are_bound(self):
        graph = {
            "1": {"class_type": "String", "inputs": {"value": "mug"}},
            "2": {"class_type": "CLIPTextEncode", "inputs": {"text": ["1", 0]}},
            "3": {"class_type": "BasicGuider", "inputs": {"conditioning": ["2", 0]}},
            "4": {"class_type": "RandomNoise", "inputs": {"noise_seed": 1}},
            "5": {"class_type": "EmptyFluxLatentImage", "inputs": {"width": 512, "height": 512}},
            "6": {
                "class_type": "SamplerCustomAdvanced",
                "inputs": {"guider": ["3", 0], "noise": ["4", 0], "latent_image": ["5", 0]},
            },
            "7": {"class_type": "PreviewImage", "inputs": {"images": ["6", 0]}},
        }
        before = copy.deepcopy(graph)
        doc = WorkflowDoc(name="split", graph=graph)
        out = C.compile_workflow(doc, {"prompt": "new mug", "seed": 42, "width": 768})
        self.assertEqual(out.graph["1"]["inputs"]["value"], "new mug")
        self.assertEqual(out.graph["4"]["inputs"]["noise_seed"], 42)
        self.assertEqual(out.graph["5"]["inputs"]["width"], 768)
        self.assertEqual(graph, before)

    def test_two_encoder_text_fields_are_not_silently_reduced_to_one(self):
        graph = plain_sdxl()
        graph["6"]["inputs"] = {"text_g": "global", "text_l": "local"}
        report = self.inspect(graph)
        self.assertIn("prompt", report.missing)
        self.assertTrue(any(i.code == "ambiguous" for i in report.issues))

    def test_variant_checks_only_actual_dependencies(self):
        graph = multi_stage_workflow()
        info = {node["class_type"]: {"input": {}} for node in graph.values()}
        info.pop("UpscaleModelLoader")
        draft = self.inspect(graph, variant="draft", object_info=info)
        final = self.inspect(graph, variant="final", object_info=info)
        self.assertTrue(draft.diagnostics.ok)
        self.assertNotIn("60", draft.selected_nodes)
        self.assertFalse(final.diagnostics.ok)
        self.assertEqual(final.diagnostics.missing_nodes[0].class_type, "UpscaleModelLoader")

    def test_rule_validation_isolated_and_explicit_bindings_win(self):
        graph = plain_sdxl()
        before = copy.deepcopy(graph)

        def bad(g):
            g.clear()
            return [{"kind": "prompt", "node": "3", "field": "positive"}]

        bound, problems = B.resolve(graph, rules=[("ext:bad", bad)])
        self.assertTrue(problems)
        self.assertEqual(graph, before)
        self.assertEqual(next(b.node for b in bound if b.kind == "prompt"), "6")

        def rule(g):
            return [B.Binding("prompt", "7", "text")]

        bound, _ = B.resolve(graph, {"prompt": "/6/inputs/text"}, rules=[("ext:good", rule)])
        self.assertEqual([b.node for b in bound if b.kind == "prompt"], ["6"])

    def test_unbound_request_parameters_are_reported(self):
        graph = plain_sdxl()
        graph["3"]["class_type"] = "UnknownSampler"
        graph["5"]["class_type"] = "UnknownLatent"
        # Unfamiliar classes with standard ports are inferable; opaque ports require mapping.
        graph["3"]["inputs"]["random_state"] = graph["3"]["inputs"].pop("seed")
        graph["5"]["inputs"]["horizontal_extent"] = graph["5"]["inputs"].pop("width")
        graph["5"]["inputs"]["vertical_extent"] = graph["5"]["inputs"].pop("height")
        report = self.inspect(graph, values={"seed": 22, "width": 512, "height": 768})
        self.assertTrue({"seed", "width", "height"} <= set(report.missing))
        self.assertTrue(
            any(i.code == "compile_warning" and "seed" in i.message for i in report.issues)
        )


class DeclaredDiagnosticsTests(unittest.TestCase):
    def test_required_links_types_ranges_and_numeric_combos(self):
        info = {
            "Source": {"output": ["IMAGE"]},
            "Custom": {
                "input": {
                    "required": {
                        "missing": ["STRING"],
                        "count": ["INT", {"min": 1, "max": 4}],
                        "scale": ["FLOAT", {"min": 0, "max": 1}],
                        "choice": [[1, 2]],
                    },
                    "optional": {"text": ["STRING"], "enabled": ["BOOLEAN"]},
                }
            },
        }
        graph = {
            "1": {"class_type": "Source", "inputs": {}},
            "2": {
                "class_type": "Custom",
                "inputs": {
                    "count": 9,
                    "scale": "bad",
                    "choice": 3,
                    "text": 1,
                    "enabled": "yes",
                    "broken": ["404", 0],
                    "port": ["1", 2],
                    "negative": ["1", -1],
                },
            },
        }
        result = diagnose(graph, info)
        self.assertFalse(result["ok"])
        self.assertEqual(len(result["missing_inputs"]), 1)
        self.assertEqual(len(result["invalid_links"]), 3)
        self.assertEqual(len(result["invalid_inputs"]), 4)
        self.assertEqual(result["invalid_values"][0]["value"], 3)
        self.assertIn("VALIDATE_INPUTS", result["scope"])
        graph["2"]["inputs"] = {"missing": "ok", "count": "2", "scale": "0.5", "choice": 1}
        self.assertTrue(diagnose(graph, info)["ok"])


class InspectionApiTests(ApiCase):
    def test_preview_and_open_api_have_no_storage_or_network_side_effects(self):
        before = len(self.ctx.store.list_docs("workflow"))
        with mock.patch.object(
            self.ctx, "comfy_client_factory", side_effect=AssertionError("network")
        ):
            report = self.ok(
                self.client.post("/api/workflows/inspect", json={"workflow": plain_sdxl()})
            )
        self.assertTrue(report["compilable"])
        self.assertEqual(len(self.ctx.store.list_docs("workflow")), before)
        self.assertEqual(self.ctx.engine.list(), [])
        issued = self.ok(
            self.client.post("/api/tokens", json={"name": "writer", "scopes": ["write"]}), 201
        )
        opened = self.ok(
            self.client.post(
                "/api/v2/workflows/inspect",
                json={"workflow": plain_sdxl()},
                headers={"Authorization": "Bearer " + issued["token"]},
            )
        )
        self.assertEqual(opened, report)

    def test_extension_rule_reaches_preview_import_compile_and_render_then_disables(self):
        graph = plain_sdxl()
        graph["9"]["class_type"] = "CustomOutput"

        def rule(g):
            return (
                [B.Binding("output", "9")]
                if g.get("9", {}).get("class_type") == "CustomOutput"
                else []
            )

        self.ctx.registry.register("workflow_binding", "custom-output", rule, source="ext:demo")
        report = self.ok(self.client.post("/api/workflows/inspect", json={"workflow": graph}))
        self.assertTrue(report["compilable"])
        wf = self.ok(
            self.client.post("/api/workflows", json={"name": "custom", "graph": graph}), 201
        )
        preview = self.ok(
            self.client.post(f"/api/workflows/{wf['id']}/compile", json={"values": {}})
        )
        self.assertEqual(preview["outputs"], ["9"])
        profile = self.ctx.store.put_doc(
            RenderProfile(name="custom", candidates=1, draft=[RenderStage(workflow_id=wf["id"])])
        )
        _, ep = self.make_episode()
        job = self.ok(
            self.client.post(
                f"/api/episodes/{ep['id']}/render",
                json={
                    "profile_id": profile.id,
                    "panel_ids": [ep["panels"][0]["id"]],
                    "candidates": 1,
                },
            )
        )
        self.assertEqual(job["items"][0]["input"]["stages"][0]["outputs"], ["9"])
        self.ctx.registry.unregister_source("ext:demo")
        report = self.ok(self.client.post("/api/workflows/inspect", json={"workflow": graph}))
        self.assertFalse(report["compilable"])
        self.assertIn("output", report["missing"])
        self.assertEqual(
            self.client.post(f"/api/workflows/{wf['id']}/compile", json={"values": {}}).status_code,
            400,
        )

    def test_diagnose_variant_body_prunes_unselected_branch(self):
        graph = multi_stage_workflow()
        wf = self.ok(
            self.client.post("/api/workflows", json={"name": "variant", "graph": graph}), 201
        )
        info = {
            n["class_type"]: {"input": {}}
            for n in graph.values()
            if n["class_type"] != "UpscaleModelLoader"
        }
        with mock.patch.object(self.ctx, "comfy_client_factory") as factory:
            factory.return_value.object_info.return_value = info
            draft = self.ok(
                self.client.post(
                    f"/api/workflows/{wf['id']}/diagnose?instance_id=c1", json={"variant": "draft"}
                )
            )
            final = self.ok(
                self.client.post(
                    f"/api/workflows/{wf['id']}/diagnose?instance_id=c1", json={"variant": "final"}
                )
            )
        self.assertTrue(draft["ok"])
        self.assertFalse(final["ok"])
        self.assertNotIn("60", draft["selected_nodes"])
