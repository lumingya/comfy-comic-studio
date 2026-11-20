"""Real executor, engine and durable storage against a controllable ComfyUI transport."""

import copy
import tempfile
import threading
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
from urllib.parse import parse_qs, urlsplit

from mio_server.assets import AssetStore
from mio_server.comfy.client import ComfyClient, ComfyError, OutputImage, RunResult
from mio_server.comfy.compile import compile_workflow
from mio_server.comfy.executor import ComfyRenderExecutor
from mio_server.jobs import COMFY, Candidate, ItemSpec, JobEngine
from mio_server.storage import SQLiteStore

from .test_comfy_state_compile import state, workflow
from .test_compile_executor import png


class FakeClient(ComfyClient):
    def __init__(self):
        super().__init__("http://original:8188")
        self.parameters = {"1": state(2)}
        self.queue = {"queue_running": [], "queue_pending": []}
        self.histories = {}
        self.writes = []
        self.runs = []
        self.deleted = []
        self.modes = ["ok"]
        self.fail_restore = False
        self.lose_prepare_response = False
        self.started = threading.Event()
        self.proceed = threading.Event()

    def get_json(self, path, timeout=None):
        if path == "/queue":
            return copy.deepcopy(self.queue)
        if path.startswith("/history/"):
            prompt = path.removeprefix("/history/")
            return (
                {prompt: copy.deepcopy(self.histories[prompt])} if prompt in self.histories else {}
            )
        node = parse_qs(urlsplit(path).query)["node_id"][0]
        return {"parameters": copy.deepcopy(self.parameters[node])}

    def post_json(self, path, payload):
        node, parameters = payload["node_id"], payload["parameters"]
        self.writes.append((node, copy.deepcopy(parameters)))
        if self.fail_restore and parameters == state(2):
            raise ComfyError("restore refused", kind="connection_lost")
        self.parameters[node] = copy.deepcopy(parameters)
        if self.lose_prepare_response and parameters != state(2):
            self.lose_prepare_response = False
            raise ComfyError("state write response lost", kind="connection_lost")
        return {}

    def finish(self, prompt="p1", *, error=False, images=True, text=None):
        self.queue = {"queue_running": [], "queue_pending": []}
        outputs = {"2": {"images": [{"filename": "image.png", "type": "output"}]}} if images else {}
        if text:
            outputs["2"] = {**outputs.get("2", {}), "text": [text]}
        self.histories[prompt] = {
            "status": {"completed": True, "status_str": "error" if error else "success"},
            "outputs": outputs,
        }

    def run(self, graph, outputs, on_event=None, timeout=0, on_queued=None, cancelled=None):
        self.runs.append(copy.deepcopy(graph))
        mode = self.modes[min(len(self.runs) - 1, len(self.modes) - 1)]
        prompt = f"p{len(self.runs)}"
        self.queue["queue_running"] = [[0, prompt]]
        if mode == "lost_response":
            raise ComfyError("prompt response lost", kind="connection_lost")
        on_queued(prompt)
        if mode == "blocked":
            self.started.set()
            if not self.proceed.wait(3):
                raise AssertionError("test failed to release running prompt")
            if cancelled():
                raise ComfyError("stopped waiting", kind="canceled")
        if mode == "timeout":
            raise ComfyError("timed out", kind="timeout")
        self.finish(prompt, error=mode == "error")
        if mode == "error":
            raise ComfyError("execution failed", kind="execution_error")
        return RunResult(prompt, [OutputImage("2", "image.png", "", "output", png())], 0.1)

    def view(self, filename, subfolder, kind):
        return png()

    def delete_queued(self, prompt_id):
        self.deleted.append(prompt_id)


class StateExecutorTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        self.store = SQLiteStore(self.root / "documents.sqlite3")
        self.addCleanup(self.store.close)
        self.assets = AssetStore(self.root / "assets", self.store)
        self.client = FakeClient()
        self.addCleanup(self.client.proceed.set)
        self.urls, self.results = [], []
        self.executor = ComfyRenderExecutor(
            self.assets,
            self.make_client,
            on_result=lambda job, item, result: self.results.append(result),
        )
        self.engine = self.make_engine()

    def make_client(self, url):
        self.urls.append(url)
        return self.client

    def make_engine(self):
        engine = JobEngine(self.root / "jobs.sqlite3", autostart=False)
        self.addCleanup(engine.close)
        engine.pool.set_instances(
            [SimpleNamespace(id="local", base_url="http://original:8188", capacity=3, enabled=True)]
        )
        engine.register("comfy.render", self.executor)
        return engine

    def submit(self, *, count=1, inspect=False, guard=None):
        stage = compile_workflow(workflow(), {}, variant="draft").to_json()
        if inspect:
            stage["inspect"] = ["2"]
        return self.engine.submit(
            "comfy.render",
            [
                ItemSpec(
                    {"stages": [copy.deepcopy(stage) for _ in range(count)], "guard": guard or []},
                    resource=COMFY,
                )
            ],
        )["id"]

    def run_job(self, job):
        ctx = self.engine._claim(Candidate(job, 0, COMFY), "local")
        self.assertIsNotNone(ctx)
        self.engine._run(ctx, COMFY, "local")
        return self.item(job)

    def item(self, job):
        return self.engine.get(job)["items"][0]

    def lease(self, job):
        return self.engine.state_leases.get(job, 0)

    def assert_released(self, job):
        self.assertIsNone(self.lease(job))
        self.assertEqual(self.engine.pool.state_blocks, {})
        self.assertEqual(self.client.parameters["1"], state(2))

    def test_success_restores_state_releases_endpoint_and_applies_image(self):
        job = self.submit()
        self.assertEqual(self.run_job(job)["state"], "complete")
        self.assert_released(job)
        self.assertEqual(len(self.client.runs), 1)
        self.assertEqual(len(self.results), 1)
        image = self.results[0]["images"][0]
        self.assertTrue(self.assets.read(image["asset_id"]).startswith(b"\x89PNG"))
        self.assertEqual([parameters for _, parameters in self.client.writes], [state(), state(2)])

    def test_ambiguous_prepare_write_is_restored_without_submitting_prompt(self):
        self.client.lose_prepare_response = True
        job = self.submit()
        self.assertEqual(self.run_job(job)["state"], "failed")
        self.assert_released(job)
        self.assertEqual(self.client.runs, [])
        self.assertEqual(self.results, [])

    def test_restore_failure_keeps_generated_image_and_recovery_never_reruns(self):
        self.client.fail_restore = True
        job = self.submit()
        self.assertEqual(self.run_job(job)["state"], "uncertain")
        saved = self.lease(job)["data"]["result"]
        self.assertTrue(saved["images"])
        self.assertEqual(self.results, [])
        self.client.fail_restore = False
        report = self.engine.restore_state(job, 0)
        self.assertTrue(report["restored"])
        self.assertEqual(self.results, [saved])
        self.assertEqual(len(self.client.runs), 1)
        self.assertEqual(self.item(job)["state"], "complete")
        self.assert_released(job)

    def test_result_storage_failure_keeps_state_until_result_can_be_saved(self):
        job = self.submit()
        with patch.object(self.assets, "publish", side_effect=OSError("asset disk full")):
            self.assertEqual(self.run_job(job)["state"], "uncertain")
        self.assertIsNotNone(self.lease(job))
        self.assertEqual(self.client.parameters["1"], state())
        self.assertEqual([parameters for _, parameters in self.client.writes], [state()])
        self.assertEqual(self.results, [])
        self.assertTrue(self.engine.restore_state(job, 0)["restored"])
        self.assertEqual(self.item(job)["state"], "complete")
        self.assertEqual(len(self.results), 1)
        self.assertEqual(len(self.client.runs), 1)
        self.assert_released(job)

    def test_recovery_download_failure_and_missing_history_keep_state_reserved(self):
        self.client.modes = ["timeout"]
        job = self.submit()
        self.run_job(job)
        self.client.finish()
        history = copy.deepcopy(self.client.histories)
        with patch.object(
            self.client, "view", side_effect=ComfyError("download lost", kind="connection_lost")
        ):
            self.assertFalse(self.engine.restore_state(job, 0)["restored"])
            self.assertIsNotNone(self.lease(job))
            self.assertEqual(self.client.parameters["1"], state())
            self.client.histories.clear()
            self.assertFalse(self.engine.restore_state(job, 0)["restored"])
        self.assertIsNotNone(self.lease(job))
        self.assertTrue(self.engine.pool.state_blocks)
        self.assertEqual([parameters for _, parameters in self.client.writes], [state()])
        self.assertEqual(self.results, [])
        self.client.histories = history
        self.assertTrue(self.engine.restore_state(job, 0)["restored"])
        self.assertEqual(self.item(job)["state"], "complete")
        self.assertEqual(len(self.client.runs), 1)
        self.assertEqual(len(self.results), 1)
        self.assert_released(job)

    def test_recovery_storage_failure_keeps_result_pending_without_restoring(self):
        self.client.modes = ["timeout"]
        job = self.submit()
        self.run_job(job)
        self.client.finish()
        with patch.object(self.assets, "publish", side_effect=OSError("asset disk full")):
            self.assertFalse(self.engine.restore_state(job, 0)["restored"])
        self.assertIsNotNone(self.lease(job))
        self.assertEqual(self.client.parameters["1"], state())
        self.assertEqual([parameters for _, parameters in self.client.writes], [state()])
        self.assertEqual(self.results, [])
        self.assertTrue(self.engine.restore_state(job, 0)["restored"])
        self.assertEqual(len(self.results), 1)
        self.assertEqual(len(self.client.runs), 1)
        self.assert_released(job)

    def test_explicit_discard_releases_missing_result_without_adopting_or_rerunning(self):
        self.client.modes = ["timeout"]
        job = self.submit()
        self.run_job(job)
        self.client.finish()
        with patch.object(
            self.client, "view", side_effect=ComfyError("download lost", kind="connection_lost")
        ):
            self.assertFalse(self.engine.restore_state(job, 0)["restored"])
        self.client.histories.clear()
        self.assertEqual(self.engine.restore_state(job, 0)["status"], "result_unavailable")
        self.assertTrue(self.lease(job)["data"]["result_pending"])
        self.assertEqual(self.client.parameters["1"], state())
        report = self.engine.restore_state(job, 0, discard_result=True)
        self.assertTrue(report["restored"])
        self.assertIsNone(report["result"])
        self.assertEqual(report["error"]["kind"], "result_discarded")
        self.assertEqual(self.item(job)["state"], "failed")
        self.assertEqual(self.item(job)["error"]["kind"], "result_discarded")
        self.assertEqual(self.results, [])
        self.assertEqual(len(self.client.runs), 1)
        self.assert_released(job)

    def test_discard_and_stop_confirmation_cannot_override_active_execution(self):
        self.client.modes = ["timeout"]
        job = self.submit()
        self.run_job(job)
        before = self.lease(job)
        writes = copy.deepcopy(self.client.writes)
        report = self.engine.restore_state(job, 0, confirm_stopped=True, discard_result=True)
        self.assertFalse(report["restored"])
        self.assertEqual(report["status"], "upstream_active")
        self.assertEqual(self.lease(job), before)
        self.assertEqual(self.client.writes, writes)
        self.assertEqual(self.client.parameters["1"], state())
        self.assertEqual(self.item(job)["state"], "uncertain")
        self.assertEqual(self.results, [])
        self.assertEqual(len(self.client.runs), 1)

    def test_recovery_downloads_and_durably_saves_image_before_restoring(self):
        self.client.modes = ["timeout"]
        job = self.submit()
        self.run_job(job)
        self.client.finish()
        collect, post = self.client.collect, self.client.post_json
        order = []

        def collect_before_restore(entry, outputs):
            self.assertEqual(self.client.parameters["1"], state())
            self.assertIsNotNone(self.lease(job))
            order.append("collect")
            return collect(entry, outputs)

        def restore_after_saved(path, payload):
            self.assertEqual(payload["parameters"], state(2))
            saved = self.lease(job)["data"]["result"]
            self.assertTrue(self.assets.read(saved["images"][0]["asset_id"]).startswith(b"\x89PNG"))
            self.assertEqual(self.results, [])
            order.append("restore")
            return post(path, payload)

        with (
            patch.object(self.client, "collect", side_effect=collect_before_restore),
            patch.object(self.client, "post_json", side_effect=restore_after_saved),
        ):
            self.assertTrue(self.engine.restore_state(job, 0)["restored"])
        self.assertEqual(order, ["collect", "restore"])
        self.assertEqual(len(self.results), 1)
        self.assertEqual(len(self.client.runs), 1)
        self.assert_released(job)

    def test_external_queue_rejects_without_any_state_write(self):
        self.client.queue["queue_pending"] = [[0, "other-user"]]
        job = self.submit()
        item = self.run_job(job)
        self.assertEqual(item["state"], "failed")
        self.assertEqual(item["error"]["kind"], "state_service_busy")
        self.assertEqual(self.client.writes, [])
        self.assertEqual(self.client.runs, [])
        self.assert_released(job)

    def test_known_prompt_timeout_waits_until_terminal_then_recovers_and_adopts(self):
        self.client.modes = ["timeout"]
        job = self.submit()
        self.assertEqual(self.run_job(job)["state"], "uncertain")
        writes = len(self.client.writes)
        report = self.engine.restore_state(job, 0, confirm_stopped=True)
        self.assertEqual(report["status"], "upstream_active")
        self.assertEqual(len(self.client.writes), writes)
        self.assertIsNotNone(self.lease(job))
        self.client.finish()
        self.assertTrue(self.engine.restore_state(job, 0)["restored"])
        self.assertEqual(self.item(job)["state"], "complete")
        self.assertEqual(len(self.results), 1)
        self.assertEqual(len(self.client.runs), 1)
        self.assert_released(job)

    def test_lost_prompt_response_requires_confirmation_and_idle_queue(self):
        self.client.modes = ["lost_response"]
        job = self.submit()
        self.run_job(job)
        self.assertIsNone(self.lease(job)["data"]["prompt_id"])
        self.assertFalse(self.engine.restore_state(job, 0, confirm_stopped=True)["restored"])
        self.client.queue["queue_running"] = []
        self.assertEqual(self.engine.restore_state(job, 0)["status"], "upstream_unknown")
        self.assertTrue(self.engine.restore_state(job, 0, confirm_stopped=True)["restored"])
        self.assertEqual(self.item(job)["state"], "failed")
        self.assertEqual(self.results, [])
        self.assertEqual(len(self.client.runs), 1)
        self.assert_released(job)

    def test_cancel_during_execution_keeps_state_until_stopped_and_never_adopts(self):
        self.client.modes = ["blocked"]
        job = self.submit()
        done = threading.Event()

        def work():
            try:
                self.run_job(job)
            finally:
                done.set()

        thread = threading.Thread(target=work)
        thread.start()
        self.addCleanup(thread.join, 3)
        self.assertTrue(self.client.started.wait(2))
        self.engine.cancel(job)
        self.client.proceed.set()
        self.assertTrue(done.wait(2))
        self.assertEqual(self.item(job)["state"], "canceled")
        self.assertIsNotNone(self.lease(job))
        self.assertEqual(self.client.parameters["1"], state())
        self.assertEqual(self.client.deleted, ["p1"])
        self.assertFalse(self.engine.restore_state(job, 0)["restored"])
        self.client.finish()
        self.assertTrue(self.engine.restore_state(job, 0)["restored"])
        self.assertEqual(self.item(job)["state"], "canceled")
        self.assertEqual(self.results, [])
        self.assert_released(job)

    def test_intermediate_stage_timeout_restores_without_continuing_pipeline(self):
        self.client.modes = ["timeout", "ok"]
        job = self.submit(count=2)
        self.run_job(job)
        self.client.finish()
        self.assertTrue(self.engine.restore_state(job, 0)["restored"])
        self.assertEqual(self.item(job)["state"], "uncertain")
        item = self.item(job)
        self.assertTrue(item["result"]["images"])
        self.assertEqual(self.engine.deliveries(job)[0]["state"], "publishing")
        self.assertEqual(self.engine.publication_intent(job, 0)["owner"]["job_id"], job)
        self.assertEqual(len(self.client.runs), 1)
        self.assertEqual(self.results, [])
        self.assert_released(job)

    def test_intermediate_execution_error_restores_without_next_stage(self):
        self.client.modes = ["error", "ok"]
        job = self.submit(count=2)
        self.assertEqual(self.run_job(job)["state"], "failed")
        self.assertEqual(len(self.client.runs), 1)
        self.assertEqual(self.results, [])
        self.assert_released(job)

    def test_recovered_history_guard_failure_discards_image_after_restoring(self):
        self.client.modes = ["timeout"]
        job = self.submit(inspect=True, guard=["forbidden"])
        self.run_job(job)
        self.client.finish(text="forbidden")
        with patch.object(
            self.executor, "_validate_outputs", side_effect=self.validate_before_restore
        ):
            report = self.engine.restore_state(job, 0)
        self.assertTrue(report["restored"])
        self.assertEqual(report["error"]["kind"], "guard")
        self.assertEqual(self.item(job)["state"], "failed")
        self.assertEqual(self.results, [])
        self.assert_released(job)

    def test_recovered_history_without_image_is_not_adopted(self):
        self.client.modes = ["timeout"]
        job = self.submit()
        self.run_job(job)
        self.client.finish(images=False)
        with patch.object(
            self.executor, "_validate_outputs", side_effect=self.validate_before_restore
        ):
            report = self.engine.restore_state(job, 0)
        self.assertTrue(report["restored"])
        self.assertEqual(report["error"]["kind"], "no_image")
        self.assertEqual(self.results, [])
        self.assertEqual(self.item(job)["state"], "failed")
        self.assert_released(job)

    def validate_before_restore(self, *args):
        self.assertEqual(self.client.parameters["1"], state())
        return ComfyRenderExecutor._validate_outputs(*args)

    def test_recovered_terminal_error_restores_without_adopting(self):
        self.client.modes = ["timeout"]
        job = self.submit()
        self.run_job(job)
        self.client.finish(error=True)
        self.assertTrue(self.engine.restore_state(job, 0)["restored"])
        self.assertEqual(self.item(job)["state"], "failed")
        self.assertEqual(self.results, [])
        self.assert_released(job)

    def test_changed_instance_address_recovers_original_endpoint(self):
        self.client.modes = ["timeout"]
        job = self.submit()
        self.run_job(job)
        self.engine.pool.set_instances(
            [SimpleNamespace(id="local", base_url="http://new:8188", capacity=3, enabled=True)]
        )
        self.client.finish()
        self.engine.restore_state(job, 0)
        self.assertEqual(self.urls, ["http://original:8188", "http://original:8188"])
        self.assert_released(job)

    def test_restart_preserves_journal_blocks_endpoint_and_recovers_saved_result(self):
        self.client.fail_restore = True
        job = self.submit()
        self.run_job(job)
        original = self.lease(job)
        self.engine.close()
        self.engine = self.make_engine()
        self.assertEqual(self.lease(job), original)
        waiting = self.submit()
        self.assertEqual(self.engine.tick(), 0)
        self.assertEqual(self.item(waiting)["state"], "pending")
        self.client.fail_restore = False
        self.engine.restore_state(job, 0)
        self.assertEqual(self.item(job)["state"], "complete")
        self.assertEqual(len(self.client.runs), 1)
        self.assertEqual(len(self.results), 1)
        self.assert_released(job)


if __name__ == "__main__":
    unittest.main()
