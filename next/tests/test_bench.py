"""End-to-end benchmark run against fake ComfyUI and fake proxy servers (no GPU, no network)."""
import argparse
import contextlib
import io
import json
import re
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from PIL import Image

from mio_next import bench
from tests.story_fixture import make_story
from tests.test_comfy_client import FakeComfy


def png(size=(64, 64), color=(180, 200, 230)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", size, color).save(buf, "PNG")
    return buf.getvalue()


class FakeProxy(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def _send(self, payload, raw=False):
        body = payload if raw else json.dumps(payload).encode()
        self.send_response(200)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        self._send(png((96, 96), (240, 180, 120)), raw=True)

    def do_POST(self):
        payload = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        self.server.models.append(payload["model"])
        content = payload["messages"][-1]["content"]
        text = content if isinstance(content, str) else " ".join(p.get("text", "") for p in content if p.get("type") == "text")
        if payload["model"] in ("gpt-image-2.5-flare", "gpt-image-2", "max"):
            url = f"http://127.0.0.1:{self.server.server_address[1]}/img.png"
            return self._send({"choices": [{"message": {"content": f"![img]({url})"}}]})
        if "continuity checker" in text:
            names = re.findall(r'^\d+\. "([^"]+)"', text, re.M)
            reply = {"characters": [{"name": n, "present": True, "identity": 5, "features": {}} for n in names],
                     "extra_people": 0, "scene": 4, "quality": 4}
        else:
            reply = {"faces": [{"name": "Lin", "box": [100, 100, 300, 300]}]}
        self._send({"model": payload["model"], "choices": [{"message": {"content": json.dumps(reply)}}]})


def serve(handler, **attrs):
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    for key, value in attrs.items():
        setattr(server, key, value)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


class BenchTests(unittest.TestCase):
    def test_full_pipeline_on_two_panels(self):
        comfy = serve(FakeComfy, scenario="ok", submitted=[], uploads=[], queued=threading.Event(), client_frames=b"",
                      pcp={}, pcp_log=[], view_bytes=png((1024, 1024)),
                      history_outputs={"8": {"images": [{"filename": "t.png", "subfolder": "", "type": "temp"}]},
                                       "16": {"images": [{"filename": "i.png", "subfolder": "", "type": "temp"}]}})
        proxy = serve(FakeProxy, models=[])
        for server in (comfy, proxy):
            self.addCleanup(server.server_close)
            self.addCleanup(server.shutdown)
        with tempfile.TemporaryDirectory() as tmp:
            story_path = Path(tmp) / "story.json"
            story_path.write_text(json.dumps(make_story(), ensure_ascii=False), encoding="utf-8")
            args = argparse.Namespace(
                story=str(story_path), out=str(Path(tmp) / "bench"), approaches="baseline,hybrid", panels="p01,p04",
                checkpoint="x.safetensors", sampling_steps=8, i2i_steps=6, denoise=0.5, strength=0.7, seed=1, workers=2, cloud_workers=2, pace=0,
                server=f"http://127.0.0.1:{comfy.server_address[1]}", llm=f"http://127.0.0.1:{proxy.server_address[1]}/v1",
                force=False)
            buf = io.StringIO()
            with contextlib.redirect_stdout(buf):
                code = bench.Bench(args).run(list(bench.STEPS))
            self.assertEqual(code, 0, buf.getvalue())
            out = Path(args.out)
            for rel in ("baseline/sheets/lin.png", "baseline/panels/p04.png", "hybrid/cloud/sheets/zhou.png",
                        "hybrid/sheets/zhou.png", "hybrid/cloud/p04.png", "hybrid/panels/p01.png",
                        "judge/hybrid.json", "faces/baseline.json", "strip/hybrid/001.jpg", "metrics.json", "REPORT.md"):
                self.assertTrue((out / rel).exists(), rel)
            metrics = json.loads((out / "metrics.json").read_text(encoding="utf-8"))
            hybrid = metrics["approaches"]["hybrid"]
            self.assertEqual(hybrid["consistency"]["appearances"], 2)  # p04: lin + zhou
            self.assertEqual(hybrid["consistency"]["pass_rate"], 1.0)
            self.assertEqual(hybrid["timing"]["per_panel"]["n"], 2)
            self.assertIn("max", proxy.models)                  # all cloud image requests use the chosen model
            self.assertNotIn("gpt-image-2.5-flare", proxy.models)
            submitted = comfy.submitted[-1]["prompt"]
            self.assertEqual(submitted["1"]["inputs"]["ckpt_name"], "x.safetensors")
            self.assertTrue(submitted["10"]["inputs"]["image"].startswith("mio/"))
            self.assertEqual(submitted["14"]["inputs"]["steps"], 6)  # img2img uses its own step count
            meta = json.loads((out / "hybrid" / "cloud" / "p04.json").read_text(encoding="utf-8"))
            self.assertEqual((meta["mode"], meta["model"]), ("multi", "max"))
            # the cloud drafts can be judged on their own (no local restyle)
            args.approaches = "cloud"
            with contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(bench.Bench(args).run(["judge", "report"]), 0)
            cloud = json.loads((out / "metrics.json").read_text(encoding="utf-8"))["approaches"]["cloud"]
            self.assertEqual(cloud["consistency"]["appearances"], 2)
            self.assertEqual(cloud["timing"]["cloud"]["n"], 2)
            args.approaches = "baseline,hybrid"
            with contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(bench.Bench(args).run(["report"]), 0)
            report = (out / "REPORT.md").read_text(encoding="utf-8")
            self.assertIn("## 一致性", report)
            self.assertIn("| p04 |", report)
            # second run resumes: nothing new is rendered
            before = len(comfy.submitted)
            with contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(bench.Bench(args).run(["sheets", "baseline", "cloud", "hybrid"]), 0)
            self.assertEqual(len(comfy.submitted), before)


if __name__ == "__main__":
    unittest.main()
