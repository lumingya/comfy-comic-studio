"""Crash the built-in publishers around actual SQLite commits and output-file renames."""

import io
import json
import os
from types import SimpleNamespace
from unittest import mock

from fastapi.testclient import TestClient
from PIL import Image

from mio_server.api import create_app
from mio_server.jobs import Canceled, ItemSpec, JobConflict
from mio_server.pipeline import cloud_jobs
from mio_server.render_models import RenderStage
from mio_server.storage import NotFound

from .test_compile_executor import FakeClient, png
from .test_render_qa import FakeCloudRenderer
from .test_result_delivery import DeliveryCase, ProcessLost


class CountedCloud(FakeCloudRenderer):
    calls = 0

    def panel(self, *args, **kwargs):
        type(self).calls += 1
        _, meta = super().panel(*args, **kwargs)
        return png((type(self).calls, 30, 60)), meta


class PublicationTests(DeliveryCase):
    def test_cloud_crash_boundaries_never_resubmit_and_recover_owned_saved_bytes(self):
        CountedCloud.calls = 0
        profile = self.ctx.render.profile(None).model_copy(
            update={"id": "cloud-publish", "cloud_shape": True, "cloud_refine": False}
        )
        self.ctx.store.put_doc(profile)
        for point in ("intent", "staged", "rename", "register", "pending", "receipt"):
            with self.subTest(point=point):
                job = self.ctx.render.render(self.episode.id, profile_id=profile.id, candidates=1)
                ctx = self.claim(job)
                executor = self.ctx.engine.executors[job["kind"]]
                target, name = {
                    "intent": (self.ctx.engine, "_prepare_publication"),
                    "staged": (os, "replace"),
                    "rename": (self.ctx.assets, "_write"),
                    "register": (self.ctx.assets, "_register"),
                    "pending": (self.ctx.engine, "_restore_publication"),
                    "receipt": (executor, "on_complete"),
                }[point]
                original = getattr(target, name)

                def crash(*args, **kwargs):
                    if point in ("intent", "rename", "receipt"):
                        original(*args, **kwargs)
                    raise ProcessLost()

                with (
                    mock.patch.object(cloud_jobs, "CloudRenderer", CountedCloud),
                    mock.patch.object(target, name, side_effect=crash),
                    self.assertRaises(ProcessLost),
                ):
                    result = executor.execute(ctx)
                    self.ctx.engine._finish(
                        job["id"], 0, ctx.epoch, "complete", result=result, apply=True
                    )
                item = self.ctx.engine.get(job["id"])["items"][0]
                asset_id = item["result"]["images"][0]["asset_id"]
                before = CountedCloud.calls
                with mock.patch.object(
                    cloud_jobs, "CloudRenderer", side_effect=AssertionError("charged twice")
                ):
                    self.reopen()
                    self.reopen()
                current = self.ctx.engine.get(job["id"])
                self.assertEqual(CountedCloud.calls, before)
                self.assertEqual(current["items"][0]["attempts"], 1)
                takes = [
                    t
                    for t in self.ctx.store.get_episode(self.episode.id).takes
                    if t.job_id == job["id"]
                ]
                if point == "intent":
                    self.assertEqual(current["state"], "blocked")
                    self.assertEqual(current["items"][0]["state"], "uncertain")
                    self.assertEqual(takes, [])
                    self.assertIn(
                        asset_id, current["items"][0]["error"]["detail"]["missing_assets"]
                    )
                else:
                    self.assertEqual(current["state"], "completed")
                    self.assertEqual([t.asset_id for t in takes], [asset_id])
                    self.assertEqual(self.ctx.assets.read(asset_id), png((before, 30, 60)))

    def test_partial_artifacts_stay_visible_uncertain_and_gc_safe_until_explicit_deletion(self):
        job = self.render_job()
        ctx = self.claim(job)
        pairs = [
            (self.ctx.assets.describe(data), data) for data in (png((1, 2, 3)), png((4, 5, 6)))
        ]
        result = {"images": [{"asset_id": a.id} for a, _ in pairs], "meta": ctx.input["meta"]}
        original = self.ctx.assets.publish

        def crash_after_first(*args):
            original(*args)
            raise ProcessLost()

        with (
            mock.patch.object(self.ctx.assets, "publish", side_effect=crash_after_first),
            self.assertRaises(ProcessLost),
        ):
            ctx.publish_result(result, pairs)
        self.reopen()
        self.reopen()
        current = self.ctx.engine.get(job["id"])
        self.assertEqual(current["state"], "blocked")
        detail = current["items"][0]["error"]["detail"]
        self.assertEqual(detail["available_assets"], [pairs[0][0].id])
        self.assertEqual(detail["missing_assets"], [pairs[1][0].id])
        client = TestClient(create_app(self.ctx, serve_web=False), base_url="http://127.0.0.1")
        response = client.get(f"/api/jobs/{job['id']}")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["items"][0]["result"], result)
        self.assertEqual(self.ctx.assets.collect_garbage(set()), [])
        self.assertEqual(self.ctx.assets.read(pairs[0][0].id), pairs[0][1])
        with self.assertRaises(JobConflict):
            self.ctx.engine.retry(job["id"], confirm_uncertain=True)
        with self.assertRaises(JobConflict):
            self.ctx.engine.delete(job["id"])
        self.assertIn(job["id"], self.ctx.engine.active_operation_jobs({self.episode.id}))
        self.ctx.engine.cancel(job["id"])
        self.assertEqual(self.ctx.engine.deliveries(job["id"])[0]["state"], "discarded")
        self.assertEqual(self.ctx.assets.collect_garbage(set()), [])
        self.ctx.engine.delete(job["id"])
        self.assertIn(pairs[0][0].id, self.ctx.assets.collect_garbage(set()))
        self.assertEqual(FakeClient.graphs, [])

    def test_partial_staging_file_stays_owned_and_visible_without_fake_completion(self):
        job = self.render_job()
        ctx = self.claim(job)
        data = png()
        asset = self.ctx.assets.describe(data)
        target = self.ctx.assets.path(asset)
        staging = target.with_name(f".{target.name}.publishing")

        def crash(path, contents):
            path.parent.mkdir(parents=True, exist_ok=True)
            with staging.open("wb") as output:
                output.write(contents[: len(contents) // 2])
                output.flush()
                os.fsync(output.fileno())
            raise ProcessLost()

        with (
            mock.patch.object(self.ctx.assets, "_write", side_effect=crash),
            self.assertRaises(ProcessLost),
        ):
            ctx.publish_result({"images": [{"asset_id": asset.id}]}, [(asset, data)])
        self.reopen()
        self.reopen()
        item = self.ctx.engine.get(job["id"])["items"][0]
        self.assertEqual(item["state"], "uncertain")
        self.assertEqual(
            item["error"]["detail"]["artifacts"],
            [
                {
                    "asset_id": asset.id,
                    "location": "staging",
                    "saved_bytes": len(data) // 2,
                    "expected_bytes": len(data),
                }
            ],
        )
        self.assertEqual(staging.read_bytes(), data[: len(data) // 2])
        self.assertFalse(target.exists())
        self.assertEqual(self.ctx.store.get_episode(self.episode.id).takes, [])

    def test_intermediate_comfy_output_has_owner_and_never_auto_runs_the_next_stage(self):
        profile = self.ctx.render.profile(None).model_copy(update={"id": "two-stages"})
        profile.draft.append(
            RenderStage(id="tail", kind="refine", workflow_id="builtin_i2i_tile", feed="previous")
        )
        self.ctx.store.put_doc(profile)
        job = self.ctx.render.render(self.episode.id, profile_id=profile.id, candidates=1)
        ctx = self.claim(job)
        executor = self.ctx.engine.executors[job["kind"]]
        original = executor._publish_prepared

        def crash(*args):
            original(*args)
            raise ProcessLost()

        with (
            mock.patch.object(executor, "_publish_prepared", side_effect=crash),
            self.assertRaises(ProcessLost),
        ):
            executor.execute(ctx)
        self.reopen()
        self.reopen()
        current = self.ctx.engine.get(job["id"])
        intent = self.ctx.engine.publication_intent(job["id"], 0)
        self.assertEqual(intent["owner"]["job_id"], job["id"])
        self.assertFalse(intent["terminal"])
        self.assertEqual(current["items"][0]["error"]["detail"]["stage"], 0)
        self.assertEqual(current["items"][0]["state"], "uncertain")
        self.assertTrue(
            self.ctx.assets.exists(current["items"][0]["result"]["images"][0]["asset_id"])
        )
        self.assertEqual(self.ctx.store.get_episode(self.episode.id).takes, [])
        self.assertEqual(len(FakeClient.graphs), 1)

    def test_stage_payload_and_artifacts_cannot_change_or_publish_after_cancellation(self):
        job = self.render_job()
        ctx = self.claim(job)
        data = png()
        artifact = self.ctx.assets.describe(data)
        result = {"images": [{"asset_id": artifact.id}], "meta": ctx.input["meta"]}
        ctx.publish_result(result, [(artifact, data)], terminal=False)
        with self.assertRaises(JobConflict):
            ctx.publish_result({**result, "changed": True}, [(artifact, data)], terminal=False)
        other = self.ctx.assets.describe(png((4, 4, 4)))
        with self.assertRaises(JobConflict):
            ctx.publish_result(result, [(other, png((4, 4, 4)))], terminal=False)
        self.ctx.engine.cancel(job["id"])
        with self.assertRaises((Canceled, JobConflict)):
            ctx.publish_result(result, [(artifact, data)], terminal=False)

    def test_envelope_tampering_cannot_promote_a_saved_intermediate_result(self):
        job = self.render_job()
        ctx = self.claim(job)
        data = png()
        artifact = self.ctx.assets.describe(data)
        result = {"images": [{"asset_id": artifact.id}], "meta": ctx.input["meta"]}
        ctx.publish_result(result, [(artifact, data)], terminal=False)
        envelope = self.ctx.engine.publication_intent(job["id"], 0)
        envelope["terminal"] = True
        with self.ctx.engine.db:
            self.ctx.engine.db.execute(
                "UPDATE job_deliveries SET result_json = ? WHERE job_id = ?",
                (json.dumps(envelope), job["id"]),
            )
        self.reopen()
        current = self.ctx.engine.get(job["id"])
        self.assertEqual(current["state"], "blocked")
        self.assertEqual(current["items"][0]["state"], "uncertain")
        self.assertEqual(self.ctx.store.get_episode(self.episode.id).takes, [])

    def test_local_restore_rejects_false_media_metadata_and_unsafe_artifact_ids(self):
        data = png()
        asset = self.ctx.assets.describe(data)
        self.ctx.assets._write(self.ctx.assets.path(asset), data)
        wrong = asset.model_copy(update={"width": asset.width + 1})
        with self.assertRaises(ValueError):
            self.ctx.assets.restore(wrong)
        with self.assertRaises(NotFound):
            self.ctx.store.get_asset(asset.id)
        with self.assertRaises(ValueError):
            self.ctx.assets.restore(asset.model_copy(update={"id": "../outside"}))
        self.assertTrue(self.ctx.assets.restore(asset))

    def test_truncated_jpeg_stays_owned_but_never_becomes_a_completed_result(self):
        payload = io.BytesIO()
        Image.new("RGB", (8, 8), (50, 60, 70)).save(payload, "JPEG")
        data = payload.getvalue()[:-2]
        artifact = self.ctx.assets.describe(data)
        self.assertEqual(artifact.mime, "image/jpeg")
        job = self.render_job()
        ctx = self.claim(job)
        with self.assertRaises(ValueError):
            ctx.publish_result({"images": [{"asset_id": artifact.id}]}, [(artifact, data)])
        self.reopen()
        self.reopen()
        current = self.ctx.engine.get(job["id"])
        self.assertEqual(current["items"][0]["state"], "uncertain")
        self.assertEqual(self.ctx.engine.deliveries(job["id"])[0]["state"], "publishing")
        self.assertEqual(self.ctx.store.get_episode(self.episode.id).takes, [])
        with self.assertRaises(NotFound):
            self.ctx.store.get_asset(artifact.id)

    def test_pending_publication_revalidates_bytes_before_any_completion_callback(self):
        job = self.render_job()
        ctx = self.claim(job)
        result = self.ctx.engine.executors[job["kind"]].execute(ctx)
        asset_id = result["images"][0]["asset_id"]
        path = self.ctx.assets.path(asset_id)
        data = path.read_bytes()
        path.write_bytes(b"corrupted owned output")
        self.reopen()
        self.reopen()
        current = self.ctx.engine.get(job["id"])
        self.assertEqual(current["items"][0]["state"], "uncertain")
        self.assertEqual(self.ctx.store.get_episode(self.episode.id).takes, [])
        self.assertIn(asset_id, current["items"][0]["error"]["detail"]["missing_assets"])
        self.ctx.assets.path(asset_id).write_bytes(data)
        self.assertEqual(self.ctx.engine.replay_result(job["id"], 0)["state"], "completed")
        self.assertEqual(len(self.ctx.store.get_episode(self.episode.id).takes), 1)
        self.assertEqual(len(FakeClient.graphs), 1)

    def test_republishing_complete_staging_does_not_truncate_saved_bytes(self):
        data = png()
        asset = self.ctx.assets.describe(data)
        target = self.ctx.assets.path(asset)
        target.parent.mkdir(parents=True, exist_ok=True)
        staging = target.with_name(f".{target.name}.publishing")
        staging.write_bytes(data)
        with mock.patch.object(
            self.ctx.assets, "_write", side_effect=AssertionError("rewrote saved result")
        ):
            self.ctx.assets.publish(asset, data)
        self.assertEqual(target.read_bytes(), data)
        self.assertFalse(staging.exists())

    def test_staging_hard_link_cannot_overwrite_an_unrelated_file(self):
        data = png()
        asset = self.ctx.assets.describe(data)
        target = self.ctx.assets.path(asset)
        target.parent.mkdir(parents=True, exist_ok=True)
        victim = self.root / "unrelated.bin"
        expected = b"keep this unrelated content"
        victim.write_bytes(expected)
        staging = target.with_name(f".{target.name}.publishing")
        try:
            os.link(victim, staging)
        except OSError as exc:
            self.skipTest(f"hard links unavailable: {exc}")
        with self.assertRaises(ValueError):
            self.ctx.assets._write(target, data)
        self.assertEqual(victim.read_bytes(), expected)
        self.assertFalse(target.exists())

    def test_generic_publication_retains_manifest_after_pending_and_ack(self):
        executor = SimpleNamespace(
            execute=lambda ctx: {}, on_complete=mock.Mock(), replay_safe=True
        )
        self.ctx.engine.register("generic.result", executor)
        job = self.ctx.engine.submit("generic.result", [ItemSpec({})])
        ctx = self.claim(job)
        data = png()
        asset = self.ctx.assets.describe(data)
        result = {"ok": True}
        ctx.publish_result(result, [(asset, data)])
        ctx.publish_result(result, [(asset, data)])
        with self.assertRaises(JobConflict):
            ctx.publish_result(result, [(asset, data)], terminal=False)
        with self.assertRaises(JobConflict):
            ctx.publish_result(result, [], stage=1)
        with self.assertRaises(JobConflict):
            ctx.publish_result(result, [])
        self.assertEqual(self.ctx.assets.collect_garbage(set()), [])
        self.ctx.engine._finish(job["id"], 0, ctx.epoch, "complete", result=result, apply=True)
        executor.on_complete.assert_called_once()
        self.assertEqual(executor.on_complete.call_args.args[2], result)
        self.assertEqual(self.ctx.engine.get(job["id"])["items"][0]["result"], result)
        self.assertEqual(self.ctx.engine.deliveries(job["id"])[0]["state"], "applied")
        self.assertEqual(self.ctx.assets.collect_garbage(set()), [])
        self.assertEqual(self.ctx.assets.read(asset.id), data)

    def test_complete_staging_hard_link_is_not_promoted_or_changed(self):
        data = png()
        asset = self.ctx.assets.describe(data)
        target = self.ctx.assets.path(asset)
        target.parent.mkdir(parents=True, exist_ok=True)
        victim = self.root / "shared-image.png"
        victim.write_bytes(data)
        staging = target.with_name(f".{target.name}.publishing")
        try:
            os.link(victim, staging)
        except OSError as exc:
            self.skipTest(f"hard links unavailable: {exc}")
        with self.assertRaises(ValueError):
            self.ctx.assets.restore(asset)
        self.assertEqual(victim.read_bytes(), data)
        self.assertTrue(staging.exists())
        self.assertFalse(target.exists())

    def test_cancellation_before_publication_records_no_intent_or_result_files(self):
        job = self.render_job()
        ctx = self.claim(job)
        self.ctx.engine.cancel(job["id"])
        data = png()
        asset = self.ctx.assets.describe(data)
        with self.assertRaises((Canceled, JobConflict)):
            ctx.publish_result({"ok": True}, [(asset, data)])
        self.assertEqual(self.ctx.engine.deliveries(job["id"]), [])
        self.assertFalse(self.ctx.assets.path(asset).exists())

    def test_stale_epoch_cannot_record_an_intent_or_write_output(self):
        job = self.render_job()
        ctx = self.claim(job)
        with self.ctx.engine.db:
            self.ctx.engine.db.execute(
                "UPDATE job_items SET epoch = epoch + 1 WHERE job_id = ?", (job["id"],)
            )
        data = png()
        asset = self.ctx.assets.describe(data)
        with self.assertRaises(JobConflict):
            ctx.publish_result({"ok": True}, [(asset, data)])
        self.assertEqual(self.ctx.engine.deliveries(job["id"]), [])
        self.assertFalse(self.ctx.assets.path(asset).exists())

    def test_gc_keeps_legacy_arbitrary_artifacts_fields_compatible(self):
        job = self.render_job()
        ctx = self.claim(job)
        result = {"artifacts": ["report.txt", {"path": "report.json"}]}
        self.ctx.engine._record_delivery(self.ctx.engine._item_row(job["id"], 0), result)
        self.assertEqual(self.ctx.engine.retained_result_assets(), set())
        self.assertEqual(self.ctx.assets.collect_garbage(set()), [])
        self.assertEqual(ctx.attempt, 1)
