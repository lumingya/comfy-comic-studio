"""Frozen plugin protocols, selected outputs and recovery without another prompt."""

import base64
import copy
import importlib.util
import io
import tempfile
import unittest
import zipfile
from pathlib import Path
from types import SimpleNamespace

from fastapi.testclient import TestClient

from mio_server.api import create_app
from mio_server.assets import AssetStore
from mio_server.comfy import adapters, contracts
from mio_server.comfy.bindings import BindingError
from mio_server.comfy.client import ComfyClient, ComfyError, RunResult
from mio_server.comfy.compile import compile_workflow, validate_outputs, validate_plan
from mio_server.comfy.executor import ComfyRenderExecutor
from mio_server.context import AppContext
from mio_server.extensions.sdk import ExtensionAPI
from mio_server.jobs import COMFY, Candidate, ItemSpec, JobConflict, JobEngine
from mio_server.jobs.dependencies import available, missing, references
from mio_server.pipeline.render import RenderService
from mio_server.render_models import RenderStage, WorkflowConfig, WorkflowDoc
from mio_server.storage import SQLiteStore

from .test_compile_executor import image_pair_workflow, png
from .test_jobs import Recorder, drain

ROOT = Path(__file__).resolve().parents[2]


def example(name):
    spec = importlib.util.spec_from_file_location(
        name.replace("-", "_"), ROOT / "examples/extensions" / name / "main.py"
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class ObjectState:
    def validate(self, state, *, nonempty=False):
        if not isinstance(state, dict) or (nonempty and not state):
            raise ValueError("expected object")

    def change(self, state, changes):
        return {**state, **changes}

    def capture(self, client, node):
        return copy.deepcopy(client.values[node])

    def push(self, client, node, state):
        client.values[node] = copy.deepcopy(state)


class ProtocolClient(ComfyClient):
    def __init__(self):
        super().__init__("http://test")
        self.runs, self.uploads = [], []
        self.history_entry = {
            "outputs": {
                "42": {
                    "images_base64": [
                        base64.b64encode(png((1, 2, 3))).decode(),
                        base64.b64encode(png((4, 5, 6))).decode(),
                    ]
                }
            }
        }

    def run(self, graph, outputs, **kw):
        self.runs.append(copy.deepcopy(graph))
        prompt = f"p{len(self.runs)}"
        kw["on_queued"](prompt)
        images, texts = (
            self.collect(self.history_entry, ["42"])
            if len(self.runs) == 1
            else self.collect(
                {"outputs": {"13": {"images": [{"filename": "result.png"}]}}}, outputs
            )
        )
        return RunResult(prompt, images, 0, texts=texts)

    def upload_image(self, data, filename):
        self.uploads.append(data)
        return "selected.png"

    def view(self, *args):
        return png()

    def history(self, prompt):
        return copy.deepcopy(self.history_entry)


class AdapterContracts(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name)
        self.store = SQLiteStore(self.root / "docs.db")
        self.addCleanup(self.store.close)
        self.assets = AssetStore(self.root / "assets", self.store)
        self.engine = JobEngine(self.root / "jobs.db", autostart=False)
        self.addCleanup(self.engine.close)
        self.registry = self.engine.registry
        contracts.register_builtins(self.registry)
        self.ctx = SimpleNamespace(engine=self.engine, registry=self.registry, data_dir=self.root)
        self.sdk = ExtensionAPI("inline", self.root, self.ctx, digest="a" * 64)
        example("comfy-inline-images").activate(self.sdk)
        self.doc = WorkflowDoc(
            name="Inline",
            graph={
                "42": {
                    "class_type": "MioInlineImages",
                    "inputs": {},
                    "_meta": {"title": "[mio:output]"},
                }
            },
            config=WorkflowConfig(output_adapters={"42": {"id": "inline-images"}}),
        )
        self.service = RenderService(self.store, self.assets, self.engine)
        self.store.put_doc(self.doc)
        self.second = image_pair_workflow()
        self.store.put_doc(self.second)
        self.client = ProtocolClient()
        self.engine.pool.set_instances(
            [SimpleNamespace(id="local", base_url="http://test", capacity=1, enabled=True)]
        )
        self.executor = ComfyRenderExecutor(
            self.assets, lambda url: self.client, registry=self.registry
        )
        self.engine.register("comfy.render", self.executor)

    def chain(self, index=1):
        return self.service._chain(
            [
                RenderStage(workflow_id=self.doc.id),
                RenderStage(
                    workflow_id=self.second.id, feed_output={"node_id": "42", "index": index}
                ),
            ],
            {},
            {},
            {},
            [],
        )

    def test_select_second_output_and_upload_once_for_all_targets(self):
        stages, feeds = self.chain()
        job = self.engine.submit(
            "comfy.render", [ItemSpec({"stages": stages, "feeds": feeds}, resource=COMFY)]
        )
        done = drain(self.engine, job["id"])
        self.assertEqual(done["state"], "completed", done)
        self.assertEqual(self.client.uploads, [png((4, 5, 6))])
        self.assertEqual(self.client.runs[1]["10"]["inputs"]["image"], "selected.png")
        self.assertEqual(self.client.runs[1]["11"]["inputs"]["image"], "selected.png")
        self.assertEqual(
            [im["index"] for im in done["items"][0]["result"]["stages"][0]["images"]], [0, 1]
        )

    def test_out_of_range_never_submits_next_stage(self):
        stages, feeds = self.chain(8)
        job = self.engine.submit(
            "comfy.render", [ItemSpec({"stages": stages, "feeds": feeds}, resource=COMFY)]
        )
        current = drain(self.engine, job["id"])
        self.assertEqual(current["state"], "blocked")
        self.assertEqual(current["items"][0]["state"], "uncertain")
        self.assertTrue(current["items"][0]["result"]["images"])
        self.assertEqual(self.engine.deliveries(job["id"])[0]["state"], "publishing")
        self.assertEqual(len(self.client.runs), 1)
        self.assertEqual(self.client.uploads, [])

    def test_first_stage_selector_rejected(self):
        with self.assertRaises(ValueError):
            self.service._chain(
                [RenderStage(workflow_id=self.doc.id, feed_output={"node_id": "42"})],
                {},
                {},
                {},
                [],
            )

    def test_hook_cannot_change_output_node_identity_or_frozen_plan(self):
        stage = compile_workflow(self.doc, {}, registry=self.registry)
        changed = copy.deepcopy(stage.graph)
        changed["42"]["class_type"] = "OtherNode"
        with self.assertRaises(BindingError):
            validate_outputs(changed, stage.output_adapters, self.registry)
        stage.output_adapters["42"]["plan"] = {"injected": True}
        with self.assertRaises(BindingError):
            validate_outputs(stage.graph, stage.output_adapters, self.registry)

    def test_missing_adapter_blocks_without_attempt_then_original_identity_restores(self):
        stages, feeds = self.chain()
        job = self.engine.submit(
            "comfy.render", [ItemSpec({"stages": stages, "feeds": feeds}, resource=COMFY)]
        )
        self.registry.unregister_source(self.sdk.source)
        self.engine.refresh_executor_jobs()
        self.assertIsNone(self.engine._claim(Candidate(job["id"], 0, COMFY), "local"))
        blocked = self.engine.get(job["id"])
        self.assertEqual(blocked["state"], "blocked")
        self.assertEqual(blocked["items"][0]["attempts"], 0)
        self.assertTrue(missing(self.engine, job["id"]))
        other = ExtensionAPI("inline", self.root, self.ctx, digest="b" * 64)
        example("comfy-inline-images").activate(other)
        self.assertTrue(missing(self.engine, job["id"]))
        self.registry.unregister_source(self.sdk.source)
        example("comfy-inline-images").activate(self.sdk)
        self.assertEqual(drain(self.engine, job["id"])["state"], "completed")

    def test_running_dependency_blocks_disabling_even_with_builtin_executor(self):
        stages, feeds = self.chain()
        job = self.engine.submit(
            "comfy.render", [ItemSpec({"stages": stages, "feeds": feeds}, resource=COMFY)]
        )
        context = self.engine._claim(Candidate(job["id"], 0, COMFY), "local")
        self.assertIsNotNone(context)
        with self.assertRaises(JobConflict):
            self.engine.ensure_executor_source_idle(self.sdk.source)
        self.engine._run(context, COMFY, "local")
        self.engine.ensure_executor_source_idle(self.sdk.source)

    def test_reconcile_custom_output_and_invalid_payload_do_not_resubmit(self):
        stage = compile_workflow(self.doc, {}, registry=self.registry).to_json()
        job = self.engine.submit("comfy.render", [ItemSpec({"stages": [stage]}, resource=COMFY)])
        context = self.engine._claim(Candidate(job["id"], 0, COMFY), "local")
        context.checkpoint("0:p1")
        result = self.executor.reconcile(context)
        self.assertEqual(len(result["images"]), 2)
        self.assertEqual(result["images"][1]["index"], 1)
        self.client.history_entry["outputs"]["42"]["images_base64"] = ["not-base64"]
        with self.assertRaises(ComfyError):
            self.executor.reconcile(context)
        self.assertEqual(self.client.runs, [])

    def test_object_state_protocol_uses_same_journal_and_preserves_third_party_changes(self):
        self.sdk.contribute("comfy_state_adapter", "object-state", ObjectState())
        doc = WorkflowDoc(
            name="Object state",
            graph={
                "1": {"class_type": "ObjectNode", "inputs": {}, "_meta": {"title": "[mio:output]"}}
            },
            config=WorkflowConfig(
                state_adapters={"1": "object-state"},
                state={"1": {"steps": 8}},
                frontend={"1": {"steps": 12}},
            ),
        )
        stage = compile_workflow(doc, {}, registry=self.registry)
        validate_plan(stage.graph, stage.frontend_state, self.registry)
        client = SimpleNamespace(values={"1": {"steps": 3}})
        journal = []
        entries = adapters.prepare_plan(
            client,
            stage.frontend_state,
            lambda entries: journal.append(copy.deepcopy(entries)),
            self.registry,
        )
        self.assertEqual(client.values["1"], {"steps": 12})
        self.assertTrue(any(e[0]["write_intent"] for e in journal))
        client.values["1"] = {"steps": 99}
        issues = adapters.restore_plan(client, entries, lambda entries: None, self.registry)
        self.assertEqual(issues[0]["kind"], "conflict")
        self.assertEqual(client.values["1"], {"steps": 99})
        client.values["1"] = {"steps": 12}
        self.assertEqual(
            adapters.restore_plan(client, entries, lambda entries: None, self.registry), []
        )
        self.assertEqual(client.values["1"], {"steps": 3})

    def test_generic_export_dependency_uses_same_lifecycle(self):
        self.sdk.contribute("exporter", "test-file", lambda: None)
        self.engine.register("export.test", Recorder())
        ref = {
            "point": "exporter",
            "id": "test-file",
            "source": self.sdk.source,
            "digest": self.sdk.digest,
            "contract": 1,
        }
        job = self.engine.submit("export.test", [ItemSpec({"n": 1})], {"dependencies": [ref]})
        self.registry.unregister_source(self.sdk.source)
        self.engine.refresh_executor_jobs()
        self.assertEqual(self.engine.get(job["id"])["state"], "blocked")
        self.assertEqual(self.engine.get(job["id"])["items"][0]["attempts"], 0)

    def test_user_story_json_is_not_an_execution_dependency(self):
        ref = {"point": "exporter", "id": "old", "source": "user", "digest": "", "contract": 1}
        self.assertEqual(list(references({"series": {"variables": {"dependencies": [ref]}}})), [])
        self.assertEqual(list(references({"meta": ref, "graph": {"dependencies": [ref]}})), [])
        self.registry.register("exporter", "old", lambda: None, source="user")
        self.assertTrue(available(self.registry, ref))

    def test_restart_keeps_frozen_identity_and_late_refinement_dependency(self):
        stages, feeds = self.chain()
        job = self.engine.submit(
            "comfy.render", [ItemSpec({"stages": stages, "feeds": feeds}, resource=COMFY)]
        )
        self.engine.close()
        restarted = JobEngine(self.root / "jobs.db", autostart=False)
        self.addCleanup(restarted.close)
        restarted.register(
            "comfy.render",
            ComfyRenderExecutor(self.assets, lambda url: self.client, registry=restarted.registry),
        )
        self.assertTrue(missing(restarted, job["id"]))
        sdk = ExtensionAPI(
            "inline",
            self.root,
            SimpleNamespace(engine=restarted, registry=restarted.registry, data_dir=self.root),
            digest="a" * 64,
        )
        example("comfy-inline-images").activate(sdk)
        self.assertFalse(missing(restarted, job["id"]))
        refs = list(references({"refinement": {"stages": stages}}))
        self.assertEqual(refs[0]["digest"], "a" * 64)

    def test_pcp_example_registers_a_reviewed_protocol(self):
        example("comfy-pcp-adapter").activate(self.sdk)
        ref = contracts.select(self.registry, "comfy_state_adapter", "example-pcp")
        self.assertEqual(ref["source"], self.sdk.source)
        protocol = contracts.resolve(self.registry, ref)
        self.assertEqual(
            protocol.change([{"name": "steps", "value": 2}], {"steps": 4})[0]["value"], 4
        )

    def test_frozen_configuration_is_unchanged_and_current_override_does_not_replace_old(self):
        stages, _ = self.chain()
        frozen = copy.deepcopy(stages)
        other = ExtensionAPI("other", self.root, self.ctx, digest="b" * 64)
        other.contribute(
            "comfy_output_adapter",
            "inline-images",
            example("comfy-inline-images").InlineImages(),
            replace=True,
        )
        self.doc.config.output_adapters["42"].options["new"] = True
        self.assertEqual(stages, frozen)
        old_ref = stages[0]["output_adapters"]["42"]["adapter"]
        self.assertIsNotNone(contracts.resolve(self.registry, old_ref))
        self.assertEqual(
            contracts.select(self.registry, "comfy_output_adapter", "inline-images")["source"],
            other.source,
        )

    def test_invalid_inline_output_is_uncertain_and_does_not_repeat_prompt(self):
        stages, feeds = self.chain()
        self.client.history_entry["outputs"]["42"]["images_base64"] = [
            base64.b64encode(b"not an image").decode()
        ]
        job = self.engine.submit(
            "comfy.render", [ItemSpec({"stages": stages, "feeds": feeds}, resource=COMFY)]
        )
        result = drain(self.engine, job["id"])
        self.assertEqual(result["items"][0]["state"], "uncertain")
        self.assertEqual(len(self.client.runs), 1)
        self.engine.tick()
        self.assertEqual(len(self.client.runs), 1)
        with self.assertRaises(JobConflict):
            self.engine.ensure_executor_source_idle(self.sdk.source)


class AdapterInstallTests(unittest.TestCase):
    def test_examples_install_enable_discover_compile_and_disable_via_v2(self):
        with tempfile.TemporaryDirectory() as tmp:
            ctx = AppContext.create(tmp, autostart=False, seed_instance=False)
            try:
                client = TestClient(create_app(ctx, serve_web=False), base_url="http://127.0.0.1")
                token = client.post(
                    "/api/tokens",
                    json={"name": "admin", "scopes": ["admin", "read", "write", "render"]},
                ).json()["token"]
                headers = {"Authorization": "Bearer " + token}
                for name, point, adapter_id in [
                    ("comfy-inline-images", "comfy_output_adapter", "inline-images"),
                    ("comfy-pcp-adapter", "comfy_state_adapter", "example-pcp"),
                ]:
                    buf = io.BytesIO()
                    with zipfile.ZipFile(buf, "w") as z:
                        for filename in ("mio-extension.json", "main.py"):
                            z.write(ROOT / "examples/extensions" / name / filename, filename)
                    installed = client.post(
                        "/api/v2/extensions", content=buf.getvalue(), headers=headers
                    )
                    self.assertEqual(installed.status_code, 201, installed.text)
                    digest = installed.json()["digest"]
                    response = client.post(
                        f"/api/v2/extensions/{name}/enable",
                        json={"digest": digest},
                        headers=headers,
                    )
                    self.assertEqual(response.status_code, 200, response.text)
                    catalog = client.get("/api/v2/comfy-adapters", headers=headers)
                    self.assertEqual(catalog.status_code, 200)
                    item = next(item for item in catalog.json() if item["id"] == adapter_id)
                    self.assertEqual(item["source"], "ext:" + name)
                    self.assertEqual(item["digest"], digest)
                    if adapter_id == "inline-images":
                        doc = WorkflowDoc(
                            name="Installed output",
                            graph={
                                "42": {
                                    "class_type": "MioInlineImages",
                                    "inputs": {},
                                    "_meta": {"title": "[mio:output]"},
                                }
                            },
                            config=WorkflowConfig(output_adapters={"42": {"id": adapter_id}}),
                        )
                        ctx.store.put_doc(doc)
                        compiled = client.post(
                            f"/api/v2/workflows/{doc.id}/compile",
                            json={"values": {}},
                            headers=headers,
                        )
                        self.assertEqual(compiled.status_code, 200, compiled.text)
                        self.assertEqual(
                            compiled.json()["output_adapters"]["42"]["adapter"]["digest"], digest
                        )
                    response = client.post(f"/api/v2/extensions/{name}/disable", headers=headers)
                    self.assertEqual(response.status_code, 200, response.text)
                    self.assertNotIn(
                        adapter_id,
                        [
                            item["id"]
                            for item in client.get("/api/v2/comfy-adapters", headers=headers).json()
                        ],
                    )
            finally:
                ctx.close()
