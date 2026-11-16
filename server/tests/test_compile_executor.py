import io
import tempfile
import unittest
import urllib.error
import urllib.request
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from PIL import Image

from mio_server.assets import AssetStore
from mio_server.comfy import compile as C
from mio_server.comfy.bindings import BindingError
from mio_server.comfy.client import ComfyClient, ComfyError, OutputImage, RunResult
from mio_server.comfy.diagnostics import diagnose, model_catalog
from mio_server.comfy.executor import ComfyRenderExecutor
from mio_server.jobs import COMFY, ItemSpec, JobEngine
from mio_server.render_models import WorkflowConfig, WorkflowDoc
from mio_server.storage import SQLiteStore

from . import test_comfy_client as fake_comfy
from .test_jobs import drain


def png(color=(200, 80, 80), size=(64, 96)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", size, color).save(buf, "PNG")
    return buf.getvalue()


def builtin(wid):
    return next(d for d in C.builtin_workflows() if d.id == wid)


def image_pair_workflow(first="init", second="init"):
    return WorkflowDoc(
        id="image-pair",
        name="Image pair",
        graph={
            "10": {
                "class_type": "LoadImage",
                "inputs": {"image": "original-a.png"},
                "_meta": {"title": f"[mio:{first}]"},
            },
            "11": {
                "class_type": "LoadImage",
                "inputs": {"image": "original-b.png"},
                "_meta": {"title": f"[mio:{second}]"},
            },
            "12": {
                "class_type": "ImageBatch",
                "inputs": {"image1": ["10", 0], "image2": ["11", 0]},
            },
            "13": {"class_type": "PreviewImage", "inputs": {"images": ["12", 0]}},
        },
    )


class CompileTests(unittest.TestCase):
    def test_builtin_t2i_binds_values(self):
        out = C.compile_workflow(
            builtin("builtin_t2i_sdxl"),
            {
                "prompt": "1girl, library",
                "negative": "lowres",
                "seed": 7,
                "width": 832,
                "height": 1216,
            },
        )
        texts = [
            n["inputs"].get("text")
            for n in out.graph.values()
            if n["class_type"] == "CLIPTextEncode"
        ]
        self.assertIn("1girl, library", texts)
        self.assertIn("lowres", texts)
        latent = next(n for n in out.graph.values() if n["class_type"] == "EmptyLatentImage")
        self.assertEqual((latent["inputs"]["width"], latent["inputs"]["height"]), (832, 1216))
        self.assertTrue(out.outputs)
        self.assertTrue(out.checkpoint)
        self.assertEqual(out.uploads, {})

    def test_image_inputs_become_placeholders(self):
        out = C.compile_workflow(
            builtin("builtin_i2i_tile"), {"prompt": "x", "init": C.asset_value("a" * 64)}
        )
        self.assertEqual(list(out.uploads.values()), ["a" * 64])
        filled = C.fill_placeholders(out.graph, {"a" * 64: "mio/a.png"})
        self.assertEqual(C.find_placeholders(filled), {})

    def test_missing_image_input_is_an_error(self):
        with self.assertRaises(BindingError):
            C.compile_workflow(
                builtin("builtin_t2i_sdxl"), {"prompt": "x", "ref:1": C.asset_value("b" * 64)}
            )

    def test_plain_reference_defaults_to_first_without_changing_numbered_slots(self):
        doc = image_pair_workflow("ref", "ref:2")
        refs = {"ref:1": C.asset_value("first"), "ref:2": C.asset_value("second")}
        out = C.compile_workflow(doc, refs)
        self.assertEqual(out.uploads, {"/10/inputs/image": "first", "/11/inputs/image": "second"})
        explicit = C.compile_workflow(doc, {**refs, "ref": C.asset_value("explicit")})
        self.assertEqual(
            explicit.uploads, {"/10/inputs/image": "explicit", "/11/inputs/image": "second"}
        )
        numbered = C.compile_workflow(image_pair_workflow("ref:1", "ref:2"), refs)
        self.assertEqual(numbered.uploads, out.uploads)
        self.assertEqual(doc.graph["10"]["inputs"]["image"], "original-a.png")

    def test_plain_reference_does_not_accept_an_unresolvable_numbered_value(self):
        with self.assertRaisesRegex(BindingError, "ref:2"):
            C.compile_workflow(image_pair_workflow("ref", "ref"), {"ref:2": C.asset_value("a")})
        out = C.compile_workflow(
            image_pair_workflow("ref", "ref:2"), {"ref:1": C.asset_value("first")}
        )
        self.assertEqual(out.uploads, {"/10/inputs/image": "first"})
        self.assertEqual(out.graph["11"]["inputs"]["image"], "original-b.png")

    def test_overrides_and_guard(self):
        doc = builtin("builtin_t2i_sdxl")
        node = next(k for k, n in doc.graph.items() if n["class_type"] == "KSampler")
        out = C.compile_workflow(doc, {"prompt": "x"}, overrides={f"/{node}/inputs/steps": 11})
        self.assertEqual(out.graph[node]["inputs"]["steps"], 11)
        guarded = doc.model_copy(update={"config": WorkflowConfig(guard=["forbidden"])})
        with self.assertRaises(BindingError):
            C.compile_workflow(guarded, {"prompt": "a forbidden thing"})
        # negative text is exempt from the guard
        C.compile_workflow(guarded, {"prompt": "fine", "negative": "forbidden"})

    def test_describe(self):
        info = C.describe(builtin("builtin_inpaint_sdxl"))
        self.assertIn("init", info["image_inputs"])
        self.assertIn("mask", info["image_inputs"])


class DiagnosticsTests(unittest.TestCase):
    def test_invalid_combo_alone_fails_diagnostics(self):
        graph = {"1": {"class_type": "CustomSampler", "inputs": {"sampler": "removed"}}}
        for spec in ([["euler"]], ["COMBO", {"options": ["euler"]}]):
            with self.subTest(spec=spec):
                info = {"CustomSampler": {"input": {"required": {"sampler": spec}}}}
                report = diagnose(graph, info)
                self.assertFalse(report["ok"])
                self.assertEqual(report["missing_nodes"], [])
                self.assertEqual(report["missing_models"], [])
                self.assertEqual(report["invalid_values"][0]["value"], "removed")
                self.assertEqual(report["invalid_values"][0]["allowed"], ["euler"])

    def test_valid_combo_and_unconstrained_input_pass_diagnostics(self):
        graph = {
            "1": {
                "class_type": "CustomSampler",
                "inputs": {"sampler": "euler", "text": "free text", "model": ["2", 0]},
            },
            "2": {"class_type": "Source", "inputs": {}},
        }
        info = {
            "Source": {"output": ["MODEL"]},
            "CustomSampler": {
                "input": {
                    "required": {"sampler": [["euler"]], "text": ["STRING"]},
                    "optional": {"model": [["literal"]]},
                }
            },
        }
        report = diagnose(graph, info)
        self.assertTrue(report["ok"])
        self.assertEqual(report["invalid_values"], [])

    def test_empty_combo_rejects_a_value(self):
        graph = {"1": {"class_type": "CustomSampler", "inputs": {"sampler": "euler"}}}
        for spec in ([[]], ["COMBO", {"options": []}]):
            with self.subTest(spec=spec):
                info = {"CustomSampler": {"input": {"optional": {"sampler": spec}}}}
                report = diagnose(graph, info)
                self.assertFalse(report["ok"])
                self.assertEqual(report["invalid_values"][0]["allowed"], [])

    def test_missing_nodes_and_models(self):
        graph = {
            "1": {
                "class_type": "CheckpointLoaderSimple",
                "inputs": {"ckpt_name": "nope.safetensors"},
            },
            "2": {"class_type": "FancyNode", "inputs": {}},
            "3": {"class_type": "KSampler", "inputs": {"sampler_name": "bogus", "model": ["1", 0]}},
        }
        info = {
            "CheckpointLoaderSimple": {
                "input": {"required": {"ckpt_name": [["base.safetensors"]]}}
            },
            "KSampler": {
                "input": {"required": {"sampler_name": ["COMBO", {"options": ["euler"]}]}}
            },
        }
        report = diagnose(graph, info)
        self.assertFalse(report["ok"])
        self.assertEqual(report["missing_nodes"][0]["class_type"], "FancyNode")
        self.assertEqual(report["missing_models"][0]["value"], "nope.safetensors")
        self.assertEqual(report["invalid_values"][0]["allowed"], ["euler"])
        self.assertEqual(model_catalog(info)["checkpoints"], ["base.safetensors"])


class FakeClient:
    uploads: list = []
    graphs: list = []
    mode = "ok"

    def __init__(self, base_url):
        self.base_url = base_url

    def upload_image(self, data, filename, subfolder="mio"):
        FakeClient.uploads.append(filename)
        return f"{subfolder}/{filename}"

    def run(self, graph, outputs, on_event=None, timeout=0, on_queued=None, cancelled=None):
        FakeClient.graphs.append(graph)
        if FakeClient.mode == "rejected":
            raise ComfyError("prompt invalid", detail={"node_errors": {}}, kind="rejected")
        on_queued(f"p{len(FakeClient.graphs)}")
        on_event({"type": "progress", "value": 1, "max": 2})
        if FakeClient.mode == "timeout":
            raise ComfyError("等待 ComfyUI 超时", kind="timeout")
        return RunResult(
            f"p{len(FakeClient.graphs)}",
            [OutputImage("9", "a.png", "", "output", png((len(FakeClient.graphs) * 40, 0, 0)))],
            0.5,
        )

    def history(self, prompt_id):
        return {"outputs": {"9": {"images": [{"filename": "a.png"}]}}}

    def collect(self, entry, outputs=None):
        return [OutputImage("9", "a.png", "", "output", png((1, 2, 3)))], {}

    def interrupt(self):
        pass

    def delete_queued(self, prompt_id):
        pass


class ExecutorTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.store = SQLiteStore(Path(tmp.name) / "db.sqlite3")
        self.addCleanup(self.store.close)
        self.assets = AssetStore(Path(tmp.name) / "assets", self.store)
        self.engine = JobEngine(":memory:", autostart=False, poll=0.01)
        self.addCleanup(self.engine.close)
        self.engine.pool.set_instances(
            [SimpleNamespace(id="c1", base_url="http://x", capacity=1, enabled=True)]
        )
        self.results = []
        self.engine.register(
            "comfy.render",
            ComfyRenderExecutor(
                self.assets,
                FakeClient,
                on_result=lambda job, item, result: self.results.append(result),
            ),
        )
        FakeClient.uploads, FakeClient.graphs, FakeClient.mode = [], [], "ok"

    def submit(self):
        init = self.assets.put(png((0, 0, 255)))
        s1 = C.compile_workflow(builtin("builtin_t2i_sdxl"), {"prompt": "x"})
        s2 = C.compile_workflow(
            builtin("builtin_i2i_tile"), {"prompt": "x", "init": C.asset_value(init.id)}
        )
        feed = next(iter(s2.uploads))
        spec = ItemSpec(
            input={
                "stages": [s1.to_json(), s2.to_json()],
                "feeds": [None, feed],
                "meta": {"panel": "p"},
            },
            resource=COMFY,
        )
        return self.engine.submit("comfy.render", [spec])

    def test_two_stage_chain_feeds_previous_image(self):
        job = drain(self.engine, self.submit()["id"])
        self.assertEqual(job["state"], "completed", job)
        self.assertEqual(len(FakeClient.graphs), 2)
        result = self.results[0]
        self.assertEqual(len(result["stages"]), 2)
        first = result["stages"][0]["images"][0]["asset_id"]
        # stage 2 received stage 1's output, not the placeholder init image
        self.assertIn(f"mio_{first[:24]}.png", FakeClient.uploads)
        self.assertEqual(result["meta"], {"panel": "p"})
        self.assertEqual(self.assets.read(result["images"][0]["asset_id"])[:4], b"\x89PNG")

    def test_frozen_single_feed_fills_every_previous_placeholder_once(self):
        first = C.compile_workflow(builtin("builtin_t2i_sdxl"), {})
        second = C.compile_workflow(image_pair_workflow(), {"init": C.asset_value(C.PREVIOUS)})
        frozen = second.to_json()
        frozen["uploads"] = {}
        job = self.engine.submit(
            "comfy.render",
            [
                ItemSpec(
                    input={
                        "stages": [first.to_json(), frozen],
                        "feeds": [None, "/10/inputs/image"],
                    },
                    resource=COMFY,
                )
            ],
        )
        done = drain(self.engine, job["id"])
        self.assertEqual(done["state"], "completed", done)
        graph = FakeClient.graphs[1]
        self.assertEqual(graph["10"]["inputs"]["image"], graph["11"]["inputs"]["image"])
        self.assertEqual(len(FakeClient.uploads), 1)
        self.assertEqual(C.find_placeholders(graph), {})
        self.assertEqual(done["items"][0]["input"]["stages"][1]["graph"], second.graph)

    def test_feed_targets_keep_literal_input_names_for_new_and_frozen_plans(self):
        doc = image_pair_workflow()
        fields = {"10": "image/path/", "11": "image~1path"}
        for node_id, field in fields.items():
            node = doc.graph[node_id]
            node["inputs"] = {field: node["inputs"]["image"]}
            node["_meta"]["title"] = f"[mio:init={field}]"
        first = C.compile_workflow(builtin("builtin_t2i_sdxl"), {})
        second = C.compile_workflow(doc, {"init": C.asset_value(C.PREVIOUS)})
        targets = list(second.uploads)
        frozen = second.to_json()
        frozen["uploads"] = {}
        for feeds in ([None, targets[0]], [[], targets]):
            with self.subTest(feeds=feeds):
                FakeClient.uploads, FakeClient.graphs = [], []
                job = self.engine.submit(
                    "comfy.render",
                    [
                        ItemSpec(
                            input={"stages": [first.to_json(), frozen], "feeds": feeds},
                            resource=COMFY,
                        )
                    ],
                )
                done = drain(self.engine, job["id"])
                self.assertEqual(done["state"], "completed", done)
                graph = FakeClient.graphs[1]
                self.assertEqual(len(FakeClient.uploads), 1)
                for node_id, field in fields.items():
                    self.assertEqual(
                        graph[node_id]["inputs"], {field: f"mio/{FakeClient.uploads[0]}"}
                    )
                self.assertEqual(C.find_placeholders(graph), {})
                self.assertEqual(done["items"][0]["input"]["stages"][1]["graph"], second.graph)

    def test_rejected_prompt_fails_without_uncertainty(self):
        FakeClient.mode = "rejected"
        job = drain(self.engine, self.submit()["id"])
        self.assertEqual(job["items"][0]["state"], "failed")

    def test_timeout_after_queue_is_uncertain(self):
        FakeClient.mode = "timeout"
        job = drain(self.engine, self.submit()["id"])
        self.assertEqual(job["items"][0]["state"], "uncertain")
        self.assertEqual(len(FakeClient.graphs), 1)  # never resubmitted
        self.assertEqual(self.results, [])

    def test_history_and_download_connection_loss_can_be_reconciled_without_resubmission(self):
        for endpoint in ("/history/", "/view?"):
            with self.subTest(endpoint=endpoint):
                server, client = fake_comfy.ClientTests.start(self, "ok")
                server.view_bytes = png()
                self.engine.register(
                    "comfy.render",
                    ComfyRenderExecutor(
                        self.assets,
                        lambda base_url: ComfyClient(client.base_url),
                        on_result=lambda job, item, result: self.results.append(result),
                    ),
                )
                stage = C.compile_workflow(builtin("builtin_t2i_sdxl"), {"prompt": "x"})
                server.history_outputs = {
                    stage.outputs[0]: {"images": [{"filename": "a.png", "type": "output"}]}
                }
                job = self.engine.submit(
                    "comfy.render", [ItemSpec(input={"stages": [stage.to_json()]}, resource=COMFY)]
                )
                urlopen = urllib.request.urlopen

                def disconnected(request, *args, **kwargs):
                    if endpoint in request.full_url:
                        raise urllib.error.URLError(ConnectionResetError("response interrupted"))
                    return urlopen(request, *args, **kwargs)

                before = len(self.results)
                with patch("urllib.request.urlopen", side_effect=disconnected):
                    job = drain(self.engine, job["id"])
                self.assertEqual(job["items"][0]["state"], "uncertain")
                self.assertEqual(job["items"][0]["error"]["kind"], "connection_lost")
                self.assertEqual(job["items"][0]["upstream"], "0:p1")
                self.assertEqual(len(self.results), before)
                self.assertEqual(len(server.submitted), 1)
                self.engine.resolve(job["id"], 0, "reconcile")
                self.assertEqual(self.engine.get(job["id"])["items"][0]["state"], "complete")
                self.assertEqual(len(self.results), before + 1)
                self.assertEqual(self.engine.reconcile_all(), 0)
                self.assertEqual(len(server.submitted), 1)

    def test_structured_failure_types_do_not_depend_on_error_language(self):
        for kind, queued, expected in (
            ("timeout", True, "uncertain"),
            ("execution_error", True, "failed"),
            ("unreachable", False, "failed"),
            ("connection_lost", False, "uncertain"),
            ("http", True, "uncertain"),
        ):
            with self.subTest(kind=kind, queued=queued):

                def fail(graph, outputs, **kwargs):
                    if queued:
                        kwargs["on_queued"]("accepted")
                    raise ComfyError("English-only failure message", kind=kind)

                with patch.object(FakeClient, "run", side_effect=fail):
                    job = drain(self.engine, self.submit()["id"])
                self.assertEqual(job["items"][0]["state"], expected)
