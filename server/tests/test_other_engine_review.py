"""Adversarial probes for existing engine-adjacent management paths; offline only."""

import json
import tempfile
import unittest
from pathlib import Path

from mio_server.assets import AssetStore
from mio_server.importer import LegacyImporter
from mio_server.jobs import ItemSpec, JobEngine, ResourcePool
from mio_server.storage import SQLiteStore


class LegacyOverwriteReviewTests(unittest.TestCase):
    def test_failed_project_overwrite_keeps_existing_episode(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            boards = root / "storyboards"
            boards.mkdir()
            path = boards / "board.json"
            payload = {
                "id": "review-board",
                "projectId": "review-project",
                "title": "Original storyboard",
                "frames": [{"name": "Frame", "width": 512, "height": 768}],
            }
            path.write_text(json.dumps(payload), encoding="utf-8")
            store = SQLiteStore(":memory:")
            try:
                importer = LegacyImporter(store, root)
                report = importer.run()
                original = store.get_episode(report.episodes[0]).model_dump(mode="json")
                payload["frames"][0].update(width=1, height=100)
                path.write_text(json.dumps(payload), encoding="utf-8")
                with self.assertRaises(ValueError):
                    importer.run(overwrite=True)
                self.assertEqual(
                    store.get_episode(report.episodes[0]).model_dump(mode="json"), original
                )
            finally:
                store.close()

    def test_failed_album_overwrite_keeps_existing_work_and_episode(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            album_dir = root / "legacy" / "albums" / "sample"
            album_dir.mkdir(parents=True)
            path = album_dir / "album.json"
            payload = {
                "id": "review-album",
                "title": "Original work",
                "steps": [{"name": "Frame", "width": 512, "height": 768}],
            }
            path.write_text(json.dumps(payload), encoding="utf-8")
            store = SQLiteStore(":memory:")
            try:
                assets = AssetStore(root / "assets", store)
                importer = LegacyImporter(store, root / "legacy", assets)
                report = importer.import_albums()
                series_id, episode_id = report.series[0], report.episodes[0]
                original_series = store.get_series(series_id).model_dump(mode="json")
                original_episode = store.get_episode(episode_id).model_dump(mode="json")

                # Legacy inputs can fail later validation, after an overwrite was requested.
                payload["steps"][0].update(width=1, height=100)
                path.write_text(json.dumps(payload), encoding="utf-8")
                with self.assertRaises(ValueError):
                    importer.import_albums(overwrite=True)

                self.assertEqual(
                    store.get_series(series_id).model_dump(mode="json"), original_series
                )
                self.assertEqual(
                    store.get_episode(episode_id).model_dump(mode="json"), original_episode
                )
            finally:
                store.close()


class PendingDispatchReviewTests(unittest.TestCase):
    def test_pausing_another_job_from_started_event_prevents_its_planned_claim(self):
        engine = JobEngine(":memory:", autostart=False, pool=ResourcePool(local_capacity=2))

        class Executor:
            def execute(self, ctx):
                return {"ok": True}

        try:
            engine.register("review", Executor())
            first = engine.submit("review", [ItemSpec({})])
            second = engine.submit("review", [ItemSpec({})])

            def pause_second(event):
                if event["job_id"] == first["id"] and event["type"] == "started":
                    engine.pause(second["id"])

            engine.subscribe(pause_second)
            engine.tick()
            paused = engine.get(second["id"])
            self.assertTrue(paused["paused"])
            self.assertEqual(paused["items"][0]["state"], "pending")
            self.assertEqual(paused["items"][0]["attempts"], 0)
        finally:
            engine.close()
