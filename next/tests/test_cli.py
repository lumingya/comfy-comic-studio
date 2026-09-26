import contextlib
import io
import json
import tempfile
import threading
import unittest
from http.server import ThreadingHTTPServer
from pathlib import Path

from mio_next.comfy import cli
from tests.test_bindings import multi_stage_workflow
from tests.test_comfy_client import FakeComfy

PANEL = [
    {"type": "separator", "name": "采样", "value": ""},
    {"type": "slider", "name": "步数", "value": 28, "config": {"step": 1}},
    {"type": "switch", "name": "保存图像", "value": True},
]


def workflow_with_panel():
    graph = multi_stage_workflow()
    graph["85"] = {"class_type": "ParameterControlPanel", "inputs": {"pcp_ui": ""}, "_meta": {"title": "panel"}}
    graph["86"] = {"class_type": "ParameterBreak", "inputs": {"parameters": ["85", 0]}, "_meta": {"title": "break"}}
    graph["30"]["inputs"]["steps"] = ["86", 0]
    return graph


CLEAN = {"/12/inputs/selected_prompts": "masterpiece", "/13/inputs/selected_prompts": ""}
GUARD = ["forbidden_tag", "forbidden_style"]


class CliTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.dir = Path(tmp.name)
        self.workflow = self.dir / "wf.json"
        self.workflow.write_text(json.dumps(workflow_with_panel()), encoding="utf-8")

    def server(self, scenario="ok"):
        server = ThreadingHTTPServer(("127.0.0.1", 0), FakeComfy)
        server.scenario, server.submitted, server.uploads = scenario, [], []
        server.queued, server.client_frames = threading.Event(), b""
        server.pcp, server.pcp_log = {}, []
        threading.Thread(target=server.serve_forever, daemon=True).start()
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        return server, f"http://127.0.0.1:{server.server_address[1]}"

    def config(self, **extra):
        data = {"overrides": CLEAN, "guard": GUARD, "state": {"85": {"class_type": "ParameterControlPanel", "state": PANEL}}}
        data.update(extra)
        path = self.dir / "run.json"
        path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
        return str(path)

    def cli(self, *argv):
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            code = cli.main([str(a) for a in argv])
        return code, buf.getvalue()

    def test_draft_run_saves_images_metrics_and_restores_panel(self):
        server, url = self.server()
        config = self.config(variants={"draft": {"frontend": {"85": {"步数": 12}}}})
        code, out = self.cli("run", self.workflow, "--config", config, "--variant", "draft", "--prompt", "1girl, adult",
                             "--seed", 7, "--server", url, "--out", self.dir / "out")
        self.assertEqual(code, 0, out)
        submitted = server.submitted[0]["prompt"]
        self.assertEqual(submitted["10"]["inputs"]["positive"], "1girl, adult")
        self.assertEqual(submitted["30"]["inputs"]["noise_seed"], 7)
        self.assertNotIn("62", submitted)  # final branch pruned
        self.assertNotIn("80", submitted)  # frontend-only node pruned
        self.assertEqual(submitted["13"]["inputs"]["selected_prompts"], "")
        # panel: pushed with the draft change, then restored to the (empty) server state
        self.assertEqual([n for n, _ in server.pcp_log], ["85", "85"])
        self.assertEqual(server.pcp_log[0][1][1]["value"], 12)
        self.assertEqual(server.pcp_log[1][1], [])
        metrics = json.loads((self.dir / "out" / "draft-7.json").read_text(encoding="utf-8"))
        self.assertEqual(metrics["outputs"], ["50"])
        self.assertEqual(metrics["inspect"], {"70": ["1girl, adult, seaside"]})
        self.assertEqual(len(metrics["images"]), 1)
        self.assertTrue(Path(metrics["images"][0]).read_bytes().startswith(b"PNG:"))
        self.assertIn("检查 70", out)

    def test_guard_blocks_submission(self):
        server, url = self.server()
        code, out = self.cli("run", self.workflow, "--config", self.config(overrides={}), "--variant", "draft",
                             "--server", url, "--out", self.dir / "out")
        self.assertEqual(code, 2)
        self.assertIn("forbidden_tag", out)
        self.assertEqual(server.submitted, [])

    def test_negative_prompt_may_contain_blocked_terms(self):
        server, url = self.server()
        code, out = self.cli("run", self.workflow, "--config", self.config(), "--variant", "draft", "--seed", 5,
                             "--negative", "forbidden_tag, lowres", "--server", url, "--out", self.dir / "out")
        self.assertEqual(code, 0, out)
        self.assertEqual(server.submitted[0]["prompt"]["11"]["inputs"]["positive"], "forbidden_tag, lowres")

    def test_final_prompt_is_checked_after_the_run(self):
        server, url = self.server()
        code, out = self.cli("run", self.workflow, "--config", self.config(), "--variant", "draft", "--prompt", "1girl, adult",
                             "--guard", "seaside", "--seed", 1, "--server", url, "--out", self.dir / "out")
        self.assertEqual(code, 3, out)
        self.assertEqual(json.loads((self.dir / "out" / "draft-1.json").read_text(encoding="utf-8"))["images"], [])
        self.assertEqual(list((self.dir / "out").glob("*.png")), [])

    def test_dry_run_needs_no_server(self):
        code, out = self.cli("run", self.workflow, "--config", self.config(), "--variant", "final", "--seed", 3,
                             "--set", "/62/inputs/filename_prefix=mio/final", "--out", self.dir / "out", "--dry-run")
        self.assertEqual(code, 0, out)
        graph = json.loads((self.dir / "out" / "final-3.api.json").read_text(encoding="utf-8"))
        self.assertEqual(graph["62"]["inputs"]["filename_prefix"], "mio/final")
        self.assertNotIn("50", graph)

    def test_rejects_ui_format_and_missing_variant(self):
        ui = self.dir / "ui.json"
        ui.write_text(json.dumps({"nodes": [], "links": []}), encoding="utf-8")
        with self.assertRaises(SystemExit) as ctx:
            self.cli("run", ui, "--dry-run")
        self.assertIn("导出（API）", str(ctx.exception))
        with self.assertRaises(SystemExit) as ctx:
            self.cli("run", self.workflow, "--dry-run", "--out", self.dir / "out")
        self.assertIn("draft, final", str(ctx.exception))

    def test_inspect_reports_variants_and_stateful_nodes(self):
        code, out = self.cli("inspect", self.workflow, "--config", self.config(state="not-yet.json"))
        self.assertEqual(code, 0, out)
        self.assertIn("变体 draft：输出 50", out)
        self.assertIn("变体 final：输出 62", out)
        self.assertIn("85 ParameterControlPanel", out)

    def test_snapshot_and_missing_state(self):
        server, url = self.server()
        server.pcp["85"] = PANEL
        target = self.dir / "state.json"
        code, out = self.cli("snapshot", self.workflow, "--out", target, "--server", url)
        self.assertEqual(code, 0, out)
        self.assertEqual(json.loads(target.read_text(encoding="utf-8"))["85"]["state"], PANEL)
        server.pcp.clear()
        code, out = self.cli("run", self.workflow, "--config", self.config(state={}), "--variant", "draft",
                             "--server", url, "--out", self.dir / "out")
        self.assertEqual(code, 1)
        self.assertIn("没有参数", out)
        self.assertEqual(server.submitted, [])


if __name__ == "__main__":
    unittest.main()
