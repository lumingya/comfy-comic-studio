"""Review regressions through real publication, state recovery and delivery paths."""

import copy
import json
import unittest
from unittest import mock

from mio_server.comfy.client import OutputImage
from mio_server.comfy.executor import ComfyRenderExecutor
from mio_server.jobs import COMFY, Candidate, ItemSpec, JobConflict

from . import test_comfy_state_executor as state_fixture
from .test_compile_executor import FakeClient, png
from .test_result_delivery import DeliveryCase


class RecoveryClient(FakeClient):
    offset = 0

    @classmethod
    def images(cls):
        return [
            OutputImage("9", f"{index}.png", "", "output", png(color))
            for index, color in enumerate(((40, cls.offset, 0), (80, cls.offset, 0)))
        ]

    def run(self, *args, **kwargs):
        result = super().run(*args, **kwargs)
        result.images = self.images()
        return result

    def collect(self, entry, outputs=None):
        return self.images(), {}


class CheckpointClient(FakeClient):
    reads = []
    wrong_history = False

    def run(self, graph, outputs, **kwargs):
        result = super().run(graph, outputs, **kwargs)
        result.images[0].node = outputs[0]
        return result

    def history(self, prompt_id):
        return {"prompt_id": prompt_id, "outputs": {"saved": {"images": [{}]}}}

    def collect(self, entry, outputs=None):
        prompt = entry["prompt_id"]
        self.reads.append((prompt, outputs))
        value = 1 if self.wrong_history and prompt == "p1" else int(prompt[1:]) * 40
        return [OutputImage(outputs[0], "a.png", "", "output", png((value, 0, 0)))], {}


class SafeCheckpointExecutor(ComfyRenderExecutor):
    replay_safe = True


class ReviewPublicationRecoveryTests(DeliveryCase):
    def checkpoint_job(self):
        hook = mock.Mock(side_effect=OSError("callback interrupted"))
        executor = SafeCheckpointExecutor(self.ctx.assets, CheckpointClient, on_result=hook)
        engine = self.ctx.engine
        self.checkpoint_number = getattr(self, "checkpoint_number", 0) + 1
        kind = f"review.checkpoints.{self.checkpoint_number}"
        engine.register(kind, executor)
        stages = [
            {"graph": {node: {"class_type": "SaveImage", "inputs": {}}}, "outputs": [node]}
            for node in ("7", "9")
        ]
        job = engine.submit(kind, [ItemSpec({"stages": stages}, resource=COMFY)])
        FakeClient.graphs, CheckpointClient.reads = [], []
        CheckpointClient.wrong_history = False
        with self.assertLogs("mio.jobs", level="ERROR"):
            engine._run(self.claim(job), COMFY, "local")
        original = engine._publication(engine._pending_delivery(job["id"], 0))
        self.assertEqual(engine.deliveries(job["id"])[0]["state"], "pending")
        return job, original, hook

    def test_terminal_reconcile_repairs_missing_earlier_checkpoints(self):
        for missing in ((0,), (0, 1)):
            with self.subTest(missing=missing):
                job, original, hook = self.checkpoint_job()
                for index in missing:
                    artifact = original["checkpoints"][index]["artifacts"][0]
                    self.ctx.assets.path(artifact["id"]).unlink()
                hook.side_effect = None
                with mock.patch.object(
                    FakeClient, "run", side_effect=AssertionError("second POST")
                ):
                    recovered = self.ctx.engine.resolve(job["id"], 0, "reconcile")
                self.assertEqual(recovered["items"][0]["state"], "complete")
                self.assertEqual(recovered["items"][0]["result"], original["result"])
                retained = json.loads(
                    self.ctx.engine.db.execute(
                        "SELECT result_json FROM job_deliveries WHERE job_id = ?", (job["id"],)
                    ).fetchone()[0]
                )
                self.assertEqual(retained, original)
                self.assertEqual(
                    CheckpointClient.reads, [(f"p{i + 1}", ["7", "9"][i : i + 1]) for i in missing]
                )
                self.assertEqual(len(FakeClient.graphs), 2)
                self.assertEqual(hook.call_count, 2)
                self.assertEqual(self.ctx.engine.deliveries(job["id"])[0]["state"], "applied")
                for index, checkpoint in enumerate(original["checkpoints"]):
                    asset_id = checkpoint["artifacts"][0]["id"]
                    self.assertEqual(self.ctx.assets.read(asset_id), png(((index + 1) * 40, 0, 0)))

    def test_wrong_earlier_history_cannot_replace_checkpoint_manifest(self):
        job, original, hook = self.checkpoint_job()
        earlier = original["checkpoints"][0]["artifacts"][0]
        self.ctx.assets.path(earlier["id"]).unlink()
        CheckpointClient.wrong_history = True
        hook.side_effect = None
        with mock.patch.object(FakeClient, "run", side_effect=AssertionError("second POST")):
            with self.assertRaises(JobConflict):
                self.ctx.engine.resolve(job["id"], 0, "reconcile")
        self.assertFalse(self.ctx.assets.path(earlier["id"]).exists())
        self.assertEqual(CheckpointClient.reads, [("p1", ["7"])])
        self.assertEqual(hook.call_count, 1)
        self.assertEqual(len(FakeClient.graphs), 2)
        self.assertEqual(self.ctx.engine.publication_intent(job["id"], 0), original)

    def test_missing_pending_files_do_not_bypass_replay_safe_callback_gate(self):
        job = self.render_job()
        engine = self.ctx.engine
        executor = engine.executors[job["kind"]]
        executor.client_factory = RecoveryClient
        executor.on_result = mock.Mock(side_effect=OSError("callback interrupted"))
        with self.assertLogs("mio.jobs", level="ERROR"):
            engine._run(self.claim(job), COMFY, "local")
        self.assertEqual(engine.deliveries(job["id"])[0]["state"], "pending")
        image = engine.get(job["id"])["items"][0]["result"]["images"][0]
        self.ctx.assets.path(image["asset_id"]).unlink()
        with (
            mock.patch.object(executor, "reconcile", wraps=executor.reconcile) as reconcile,
            mock.patch.object(FakeClient, "run", side_effect=AssertionError("second POST")),
        ):
            for _ in range(2):
                with self.assertRaisesRegex(JobConflict, "replay-safe"):
                    engine.resolve(job["id"], 0, "reconcile")
        self.assertEqual(reconcile.call_count, 0)
        self.assertEqual(executor.on_result.call_count, 1)

    def test_explicit_terminal_reconcile_repairs_zero_and_partial_local_files(self):
        for saved_count in (0, 1):
            with self.subTest(saved_count=saved_count):
                RecoveryClient.offset = saved_count
                job = self.render_job()
                engine, assets = self.ctx.engine, self.ctx.assets
                executor = engine.executors[job["kind"]]
                executor.client_factory = RecoveryClient
                publish = assets.publish
                published = 0

                def disk_failure(asset, data):
                    nonlocal published
                    if published == saved_count:
                        raise OSError("transient disk full")
                    published += 1
                    return publish(asset, data)

                with mock.patch.object(assets, "publish", side_effect=disk_failure):
                    engine._run(self.claim(job), COMFY, "local")
                original = engine.publication_intent(job["id"], 0)
                self.assertTrue(original["terminal"])
                self.assertEqual(engine.deliveries(job["id"])[0]["state"], "publishing")
                self.assertEqual(engine.get(job["id"])["items"][0]["state"], "uncertain")
                self.assertIsNone(engine.state_leases.get(job["id"], 0))
                before_runs = len(FakeClient.graphs)
                with (
                    mock.patch.object(
                        FakeClient, "history", side_effect=AssertionError("startup GET")
                    ),
                    mock.patch.object(FakeClient, "run", side_effect=AssertionError("second POST")),
                ):
                    self.reopen()
                engine, assets = self.ctx.engine, self.ctx.assets
                executor = engine.executors[job["kind"]]
                executor.client_factory = RecoveryClient
                with (
                    mock.patch.object(FakeClient, "run", side_effect=AssertionError("second POST")),
                    mock.patch.object(executor, "reconcile", wraps=executor.reconcile) as reconcile,
                ):
                    recovered = engine.resolve(job["id"], 0, "reconcile")
                self.assertEqual(reconcile.call_count, 1)
                self.assertEqual(recovered["items"][0]["state"], "complete")
                self.assertEqual(recovered["items"][0]["result"], original["result"])
                retained = json.loads(
                    engine.db.execute(
                        "SELECT result_json FROM job_deliveries WHERE job_id = ?", (job["id"],)
                    ).fetchone()[0]
                )
                self.assertEqual(retained, original)
                self.assertEqual(engine.deliveries(job["id"])[0]["state"], "applied")
                for image, expected in zip(original["result"]["images"], RecoveryClient.images()):
                    self.assertEqual(assets.read(image["asset_id"]), expected.data)
                self.assertEqual(len(FakeClient.graphs), before_runs)


class ReviewStateRecoveryTests(unittest.TestCase):
    # Reuse the established temporary real-store fixture without inheriting its test methods.
    setUp = state_fixture.StateExecutorTests.setUp
    make_client = state_fixture.StateExecutorTests.make_client
    make_engine = state_fixture.StateExecutorTests.make_engine
    submit = state_fixture.StateExecutorTests.submit
    run_job = state_fixture.StateExecutorTests.run_job
    item = state_fixture.StateExecutorTests.item
    lease = state_fixture.StateExecutorTests.lease
    assert_released = state_fixture.StateExecutorTests.assert_released

    def test_state_restore_repairs_missing_earlier_and_current_checkpoint(self):
        run, publish = self.client.run, self.assets.publish

        def distinct_outputs(*args, **kwargs):
            result = run(*args, **kwargs)
            filename = f"{result.prompt_id}.png"
            result.images = [
                OutputImage("2", filename, "", "output", png((len(self.client.runs) * 40, 0, 0)))
            ]
            self.client.histories[result.prompt_id]["outputs"]["2"]["images"][0]["filename"] = (
                filename
            )
            return result

        writes = 0

        def fail_final_publish(asset, data):
            nonlocal writes
            writes += 1
            if writes == 2:
                raise OSError("terminal disk failure")
            return publish(asset, data)

        job = self.submit(count=2)
        with (
            mock.patch.object(self.client, "run", side_effect=distinct_outputs),
            mock.patch.object(self.assets, "publish", side_effect=fail_final_publish),
        ):
            self.run_job(job)
        original = self.engine.publication_intent(job, 0)
        earlier = original["checkpoints"][0]["artifacts"][0]
        self.assets.path(earlier["id"]).unlink()

        def historical_png(filename, *args):
            return png((40 if filename == "p1.png" else 80, 0, 0))

        with mock.patch.object(self.client, "view", side_effect=historical_png) as view:
            recovered = self.engine.resolve(job, 0, "reconcile")
        self.assertEqual(recovered["items"][0]["state"], "complete")
        self.assertEqual(recovered["items"][0]["result"], original["result"])
        self.assertEqual([call.args[0] for call in view.call_args_list], ["p1.png", "p2.png"])
        self.assertEqual(len(self.client.runs), 2)
        self.assertEqual(len(self.results), 1)
        self.assertEqual(self.assets.read(earlier["id"]), png((40, 0, 0)))
        self.assert_released(job)

    def test_stage_one_recovery_does_not_reuse_stage_zero_publication(self):
        self.client.modes = ["ok", "timeout"]
        job = self.submit(count=2)
        self.run_job(job)
        original = self.engine.publication_intent(job, 0)
        self.assertEqual(original["stage"], 0)
        self.assertEqual(self.lease(job)["data"]["stage"], 1)
        self.client.finish("p2")
        final_png = png((10, 20, 30))
        with mock.patch.object(self.client, "view", return_value=final_png) as view:
            report = self.engine.restore_state(job, 0)
        self.assertTrue(report["restored"])
        self.assertEqual(view.call_count, 1)
        self.assertEqual(self.item(job)["state"], "complete")
        self.assertEqual(report["result"]["stages"][-1]["prompt_id"], "p2")
        final_id = report["result"]["images"][0]["asset_id"]
        self.assertNotEqual(final_id, original["result"]["images"][0]["asset_id"])
        self.assertEqual(self.assets.read(final_id), final_png)
        self.assertEqual(len(self.results), 1)
        self.assertEqual(len(self.client.runs), 2)
        self.assertEqual(self.engine.deliveries(job)[0]["state"], "applied")
        self.assert_released(job)

    def test_discard_only_current_item_delivery_and_allow_explicit_retry(self):
        template_job = self.submit(count=2)
        frozen = self.engine.get(template_job)["items"][0]["input"]
        job = self.engine.submit(
            "comfy.render", [ItemSpec(copy.deepcopy(frozen), resource=COMFY) for _ in range(2)]
        )["id"]
        self.client.modes = ["ok", "ok", "ok", "ok"]
        self.run_job(job)
        first_delivery = self.engine.deliveries(job)[0]
        first_result = self.engine.get(job)["items"][0]["result"]
        ctx = self.engine._claim(Candidate(job, 1, COMFY), "local")
        publish = self.assets.publish
        calls = 0

        def fail_terminal(asset, data):
            nonlocal calls
            calls += 1
            if calls == 2:
                raise OSError("transient disk full")
            return publish(asset, data)

        with mock.patch.object(self.assets, "publish", side_effect=fail_terminal):
            self.engine._run(ctx, COMFY, "local")
        original = self.engine.publication_intent(job, 1)
        saved_id = original["checkpoints"][0]["result"]["images"][0]["asset_id"]
        saved_bytes = self.assets.read(saved_id)
        runs = len(self.client.runs)
        lease_before = self.engine.state_leases.get(job, 1)
        with mock.patch.object(self.engine, "_event", side_effect=OSError("journal disk full")):
            failed = self.engine.restore_state(job, 1, discard_result=True)
        self.assertFalse(failed["restored"])
        self.assertEqual(self.engine.state_leases.get(job, 1), lease_before)
        self.assertEqual(self.engine.deliveries(job)[1]["state"], "publishing")
        report = self.engine.restore_state(job, 1, discard_result=True)
        self.assertTrue(report["restored"])
        self.assertEqual(report["error"]["kind"], "result_discarded")
        self.assertEqual(self.engine.deliveries(job)[1]["state"], "discarded")
        current = self.engine.get(job)
        self.assertEqual(current["items"][1]["state"], "failed")
        self.assertEqual(current["items"][1]["error"]["kind"], "result_discarded")
        self.assertFalse(current["canceled"])
        self.assertIsNone(self.engine.state_leases.get(job, 1))
        self.assertEqual(self.engine.deliveries(job)[0], first_delivery)
        self.assertEqual(current["items"][0]["result"], first_result)
        self.assertEqual(self.assets.read(saved_id), saved_bytes)
        self.assertIn(saved_id, self.engine.retained_result_assets())
        retained = json.loads(
            self.engine.db.execute(
                "SELECT result_json FROM job_deliveries WHERE job_id = ? AND idx = 1",
                (job,),
            ).fetchone()[0]
        )
        self.assertEqual(retained, original)
        retried = self.engine.retry(job, indexes=[1], confirm_uncertain=True)
        self.assertEqual([item["state"] for item in retried["items"]], ["complete", "pending"])
        self.assertEqual(len(self.client.runs), runs)


if __name__ == "__main__":
    unittest.main()
