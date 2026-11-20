"""Installable complex-node profiles, frozen plans and fault injection without ComfyUI."""

import base64
import copy
import io
import json
import zipfile
from pathlib import Path
from types import SimpleNamespace

from mio_server.comfy import contracts
from mio_server.comfy.bindings import BindingError
from mio_server.comfy.client import ComfyError
from mio_server.comfy.compile import validate_outputs
from mio_server.extensions.ctk import check_package
from mio_server.jobs import COMFY, ItemSpec
from mio_server.render_models import WorkflowDoc

from .api_harness import ApiCase
from .test_compile_executor import png

PACKAGE = Path(__file__).resolve().parents[2] / "examples/extensions/comfy-complex-adapters"
IDENTIFIER = "comfy-complex-adapters"


class ComplexAdapterPackageTests(ApiCase):
    def setUp(self):
        super().setUp()
        archive = io.BytesIO()
        with zipfile.ZipFile(archive, "w") as target:
            for path in sorted(PACKAGE.iterdir()):
                if path.is_file():
                    target.writestr(path.name, path.read_bytes())
        self.archive = archive.getvalue()
        token = self.ok(
            self.client.post(
                "/api/tokens",
                json={"name": "fixture", "scopes": ["admin", "read", "write", "render"]},
            ),
            201,
        )["token"]
        self.headers = {"Authorization": "Bearer " + token}
        installed = self.ok(
            self.client.post("/api/v2/extensions", content=self.archive, headers=self.headers), 201
        )
        self.digest = installed["digest"]
        self.enable(self.digest)
        self.doc = WorkflowDoc.model_validate(
            json.loads((PACKAGE / "workflow.json").read_text(encoding="utf-8"))
        )
        self.ctx.store.put_doc(self.doc)

    def enable(self, digest):
        return self.ok(
            self.client.post(
                f"/api/v2/extensions/{IDENTIFIER}/enable",
                json={"digest": digest},
                headers=self.headers,
            )
        )

    def disable(self):
        return self.ok(
            self.client.post(f"/api/v2/extensions/{IDENTIFIER}/disable", headers=self.headers)
        )

    def compile_response(self, **body):
        return self.client.post(
            f"/api/v2/workflows/{self.doc.id}/compile", json=body, headers=self.headers
        )

    def compiled(self, **body):
        return self.ok(self.compile_response(**body))

    def group(self):
        controls = self.ok(
            self.client.get(f"/api/v2/workflows/{self.doc.id}/loras", headers=self.headers)
        )
        return next(
            item for item in controls["groups"] if item["adapter"]["id"] == "complex-power-stack"
        )

    def collect(self, output, frozen=None):
        frozen = frozen or self.compiled()["output_adapters"]["12"]
        client = SimpleNamespace(view=lambda *args: png((12, 24, 36)))
        return contracts.collect(client, "12", output, frozen, self.ctx.registry)

    def test_static_ctk_install_catalog_disable_and_uninstall(self):
        report = check_package(PACKAGE, "extension")
        self.assertTrue(report.valid, report)
        self.assertEqual(report.id, IDENTIFIER)
        installed = self.ctx.extensions.root / IDENTIFIER
        self.assertTrue(check_package(installed, "extension").valid)
        items = self.ok(self.client.get("/api/v2/comfy-adapters", headers=self.headers))
        own = [item for item in items if item["source"] == "ext:" + IDENTIFIER]
        self.assertEqual({item["id"] for item in own}, {"complex-power-stack", "complex-artifacts"})
        self.assertTrue(all(item["digest"] == self.digest for item in own))
        self.assertTrue(self.compiled()["graph"])
        self.disable()
        self.assertFalse(
            any(
                item["source"] == "ext:" + IDENTIFIER
                for item in self.ok(self.client.get("/api/v2/comfy-adapters", headers=self.headers))
            )
        )
        self.ok(self.client.delete(f"/api/v2/extensions/{IDENTIFIER}", headers=self.headers), 204)
        self.assertFalse(installed.exists())

    def test_duplicate_loras_keep_independent_controls_metadata_and_model_edges(self):
        original = copy.deepcopy(self.doc.graph)
        group = self.group()
        first, second = group["loras"]
        self.assertNotEqual(first["key"], second["key"])
        self.assertEqual(group["adapter"]["digest"], self.digest)
        compiled = self.compiled(
            slot_overrides={
                "groups": [
                    {
                        "key": group["key"],
                        "loras": [
                            {
                                "key": second["key"],
                                "name": second["name"],
                                "enabled": False,
                                "clip": 0.1,
                            }
                        ],
                    }
                ]
            }
        )
        inputs = compiled["graph"]["2"]["inputs"]
        self.assertEqual(inputs["lora_1"], original["2"]["inputs"]["lora_1"])
        self.assertEqual(inputs["lora_2"]["strength"], 0.8)
        self.assertEqual(inputs["lora_2"]["strengthTwo"], 0.1)
        self.assertFalse(inputs["lora_2"]["on"])
        self.assertEqual(inputs["lora_2"]["note"], "preserve second row")
        self.assertEqual(inputs["model"], ["1", 0])
        self.assertEqual(self.ctx.store.get_doc("workflow", self.doc.id).graph, original)

    def test_multistage_values_and_reference_weights_freeze_into_existing_fields(self):
        compiled = self.compiled(
            values={
                "steps": 22,
                "steps:hires": 11,
                "steps:detail": 7,
                "seed:detail": 45,
                "strength:reference": 0.7,
                "strength:pose": 0.4,
                "ref:1": {"$asset": "neutral-reference"},
                "control:pose": {"$asset": "neutral-pose"},
            }
        )
        graph = compiled["graph"]
        self.assertEqual([graph[node]["inputs"]["steps"] for node in ("7", "9", "11")], [22, 11, 7])
        self.assertEqual(graph["11"]["inputs"]["seed"], 45)
        self.assertEqual(graph["4"]["inputs"]["weight"], 0.7)
        self.assertEqual(graph["6"]["inputs"]["strength"], 0.4)
        self.assertEqual(graph["4"]["inputs"]["image"], ["3", 0])
        self.assertEqual(graph["6"]["inputs"]["image"], ["5", 0])
        self.assertEqual(
            compiled["uploads"],
            {
                "/3/inputs/image": "neutral-reference",
                "/5/inputs/image": "neutral-pose",
            },
        )

    def test_explicit_author_mapping_wins_for_the_whole_binding_kind(self):
        self.doc.config.mapping = {"seed": "/7/inputs/seed"}
        self.ctx.store.put_doc(self.doc)
        graph = self.compiled(values={"seed": 91, "seed:hires": 92})["graph"]
        self.assertEqual(graph["7"]["inputs"]["seed"], 91)
        self.assertEqual(graph["9"]["inputs"]["seed"], 2)
        self.assertEqual(graph["11"]["inputs"]["seed"], 3)

    def test_linked_sampler_input_is_not_replaced(self):
        self.doc.graph["20"] = {"class_type": "PrimitiveInt", "inputs": {"value": 20}}
        self.doc.graph["7"]["inputs"]["steps"] = ["20", 0]
        self.ctx.store.put_doc(self.doc)
        compiled = self.compiled(values={"steps": 17})
        self.assertEqual(compiled["graph"]["7"]["inputs"]["steps"], ["20", 0])

    def test_unrecognized_or_shared_image_sources_do_not_silently_bind(self):
        for shared in (False, True):
            with self.subTest(shared=shared):
                graph = copy.deepcopy(self.doc.graph)
                if shared:
                    graph["6"]["inputs"]["image"] = ["3", 0]
                else:
                    graph["3"]["class_type"] = "UnknownImageTransformer"
                changed = self.doc.model_copy(update={"graph": graph})
                self.ctx.store.put_doc(changed)
                self.assertEqual(
                    self.compile_response(values={"ref:1": {"$asset": "test"}}).status_code, 400
                )

    def test_malformed_stack_and_out_of_range_strength_fail_without_changing_source(self):
        group = self.group()
        selected = group["loras"][0]
        self.assertEqual(
            self.compile_response(
                slot_overrides={
                    "groups": [
                        {
                            "key": group["key"],
                            "loras": [
                                {"key": selected["key"], "name": selected["name"], "strength": 9}
                            ],
                        }
                    ]
                }
            ).status_code,
            400,
        )
        self.doc.graph["2"]["inputs"]["lora_1"]["strength"] = "invalid"
        self.ctx.store.put_doc(self.doc)
        self.assertEqual(self.compile_response().status_code, 400)
        self.assertEqual(self.doc.graph["2"]["inputs"]["lora_1"]["strength"], "invalid")

    def test_output_protocol_decodes_inline_and_current_endpoint_file_references(self):
        payload = png((1, 2, 3))
        images = self.collect(
            {
                "artifacts": [
                    {"base64": base64.b64encode(payload).decode("ascii")},
                    {"filename": "neutral.png", "subfolder": "renders", "type": "output"},
                ]
            }
        )
        self.assertEqual(images[0].data, payload)
        self.assertEqual(images[1].data, png((12, 24, 36)))
        self.assertEqual([(item.node, item.index) for item in images], [("12", 0), ("12", 1)])

    def test_output_faults_are_explicit_and_do_not_contact_an_upstream(self):
        for artifacts in (
            None,
            [],
            ["bad"],
            [{"base64": "!!!"}],
            [{"base64": base64.b64encode(b"not an image").decode("ascii")}],
            [{"filename": "https://external.test/a.png"}],
            [{"filename": "ok.png", "subfolder": "../private"}],
            [{"base64": "QQ==", "filename": "ambiguous.png"}],
            [{"filename": "ok.png"}] * 17,
        ):
            with self.subTest(artifacts=artifacts):
                with self.assertRaises(ComfyError):
                    self.collect({"artifacts": artifacts})

    def test_frozen_output_plan_rejects_type_or_plan_injection(self):
        compiled = self.compiled()
        frozen = compiled["output_adapters"]
        changed = copy.deepcopy(compiled["graph"])
        changed["12"]["class_type"] = "DifferentOutput"
        with self.assertRaises(BindingError):
            validate_outputs(changed, frozen, self.ctx.registry)
        frozen["12"]["plan"]["version"] = 999
        with self.assertRaises(BindingError):
            validate_outputs(compiled["graph"], frozen, self.ctx.registry)

    def test_missing_output_identity_blocks_jobs_without_attempt_or_upstream_submission(self):
        compiled = self.compiled()
        snapshot = copy.deepcopy(compiled)
        job = self.ctx.engine.submit(
            "comfy.render", [ItemSpec({"stages": [compiled]}, resource=COMFY)]
        )
        self.disable()
        self.ctx.engine.refresh_executor_jobs()
        self.ctx.engine.tick()
        state = self.ctx.engine.get(job["id"])
        self.assertEqual(state["state"], "blocked")
        self.assertEqual(state["items"][0]["attempts"], 0)
        self.assertEqual(compiled, snapshot)
        self.enable(self.digest)
        self.assertNotEqual(self.ctx.engine.get(job["id"])["state"], "blocked")

    def test_a_new_reviewed_digest_cannot_parse_an_old_frozen_output(self):
        frozen = self.compiled()["output_adapters"]["12"]
        self.disable()
        entry = self.ctx.extensions.root / IDENTIFIER / "main.py"
        entry.write_bytes(entry.read_bytes() + b"\n# different reviewed build\n")
        self.enable(self.ctx.extensions.info(IDENTIFIER).digest)
        with self.assertRaises(ComfyError):
            self.collect({"artifacts": [{"filename": "neutral.png"}]}, frozen)
