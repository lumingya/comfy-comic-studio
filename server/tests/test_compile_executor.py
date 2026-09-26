import io
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

from PIL import Image

from mio_server.assets import AssetStore
from mio_server.comfy import compile as C
from mio_server.comfy.bindings import BindingError
from mio_server.comfy.client import ComfyError, OutputImage, RunResult
from mio_server.comfy.diagnostics import diagnose, model_catalog
from mio_server.comfy.executor import ComfyRenderExecutor
from mio_server.jobs import COMFY, ItemSpec, JobEngine
from mio_server.render_models import WorkflowConfig
from mio_server.storage import SQLiteStore

from .test_jobs import drain


def png(color=(200, 80, 80), size=(64, 96)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", size, color).save(buf, "PNG")
    return buf.getvalue()


def builtin(wid):
    return next(d for d in C.builtin_workflows() if d.id == wid)


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
            raise ComfyError("prompt invalid", detail={"node_errors": {}})
        on_queued(f"p{len(FakeClient.graphs)}")
        on_event({"type": "progress", "value": 1, "max": 2})
        if FakeClient.mode == "timeout":
            raise ComfyError("等待 ComfyUI 超时")
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
