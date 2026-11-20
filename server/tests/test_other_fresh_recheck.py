"""Fresh probes for the second-stage API, storage and scheduler repairs."""

import io
import json
import tempfile
import threading
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient
from PIL import Image

from mio_server.assets import AssetStore
from mio_server.auth import issue
from mio_server.importer import LegacyImporter
from mio_server.jobs import ItemSpec, JobEngine, ResourcePool
from mio_server.models import Episode, Series
from mio_server.storage import Conflict, NotFound, SQLiteStore

from .api_harness import LOCAL, ApiCase


class OtherFreshApiTests(ApiCase):
    def test_corrupt_compressed_members_return_json_client_error(self):
        client = TestClient(self.client.app, base_url=LOCAL, raise_server_exceptions=False)
        for compression in (zipfile.ZIP_DEFLATED, zipfile.ZIP_BZIP2, zipfile.ZIP_LZMA):
            with self.subTest(compression=compression):
                archive = io.BytesIO()
                with zipfile.ZipFile(archive, "w", compression) as output:
                    output.writestr(
                        "manifest.json", json.dumps({"format": "mio.bundle", "version": 1})
                    )
                raw = bytearray(archive.getvalue())
                with zipfile.ZipFile(io.BytesIO(raw)) as source:
                    entry = source.getinfo("manifest.json")
                    start = (
                        entry.header_offset + 30 + len(entry.filename.encode()) + len(entry.extra)
                    )
                if compression == zipfile.ZIP_DEFLATED:
                    # Reserved BTYPE=3 raises zlib.error, rather than a CRC BadZipFile.
                    raw[start] = (raw[start] & 0xF9) | 0x06
                elif compression == zipfile.ZIP_BZIP2:
                    raw[start] = 0
                else:
                    raw[start + 4] = 255  # Invalid LZMA filter properties.
                response = client.post("/api/bundles", content=bytes(raw))
                self.assertIn(response.status_code, (400, 422), response.text)
                self.assertEqual(response.headers["content-type"].split(";")[0], "application/json")
                self.assertFalse(self.ctx.store.list_series())
                self.assertFalse(self.ctx.store.asset_ids())

    def test_activity_touch_preserves_scope_edits_and_rejects_rotated_credential(self):
        token, _ = issue("Fresh token", ["read", "write"])
        self.ctx.store.put_doc(token)
        token.scopes = ["read"]
        self.ctx.store.put_doc(token)
        self.assertTrue(self.ctx.store.touch_api_token(token.id, token.secret_hash, "audit-time"))
        touched = self.ctx.store.get_doc("api_token", token.id)
        self.assertEqual(touched.scopes, ["read"])
        self.assertEqual(touched.last_used_at, "audit-time")
        token.secret_hash = "rotated-synthetic-hash"
        token.last_used_at = "rotation-time"
        self.ctx.store.put_doc(token)
        self.assertFalse(
            self.ctx.store.touch_api_token(token.id, touched.secret_hash, "stale-time")
        )
        current = self.ctx.store.get_doc("api_token", token.id)
        self.assertEqual(current.secret_hash, token.secret_hash)
        self.assertEqual(current.last_used_at, "rotation-time")

    def test_successful_restore_cannot_be_deleted_by_a_stale_purge(self):
        for kind in ("series", "episode"):
            with self.subTest(kind=kind):
                series = self.ctx.store.create_series(Series(title="Restore boundary"))
                target = (
                    series
                    if kind == "series"
                    else self.ctx.store.create_episode(
                        Episode(series_id=series.id, title="Episode", order=0)
                    )
                )
                getattr(self.ctx.trash, f"delete_{kind}")(target.id)
                entered, release, restore_finished = (
                    threading.Event(),
                    threading.Event(),
                    threading.Event(),
                )
                original_delete = getattr(self.ctx.store, f"delete_{kind}")
                purge_errors, restore_errors = [], []

                def delayed_delete(identifier):
                    entered.set()
                    if not release.wait(5):
                        raise TimeoutError("purge boundary was not released")
                    return original_delete(identifier)

                def purge():
                    try:
                        self.ctx.trash.purge(kind, target.id)
                    except Exception as exc:
                        purge_errors.append(exc)

                def restore():
                    try:
                        getattr(self.ctx.trash, f"restore_{kind}")(target.id)
                    except Exception as exc:
                        restore_errors.append(exc)
                    finally:
                        restore_finished.set()

                with patch.object(self.ctx.store, f"delete_{kind}", side_effect=delayed_delete):
                    purger = threading.Thread(target=purge)
                    restorer = threading.Thread(target=restore)
                    purger.start()
                    try:
                        self.assertTrue(entered.wait(3))
                        restorer.start()
                        # A serialized restore may wait until purge finishes. An unlocked
                        # successful restore must survive the already planned stale delete.
                        restore_finished.wait(0.5)
                    finally:
                        release.set()
                        purger.join(3)
                        if restorer.ident is not None:
                            restorer.join(3)
                self.assertFalse(purger.is_alive())
                self.assertFalse(restorer.is_alive())
                self.assertTrue(restore_finished.is_set())
                self.assertTrue(all(isinstance(exc, (Conflict, NotFound)) for exc in purge_errors))
                if restore_errors:
                    self.assertTrue(
                        all(isinstance(exc, (Conflict, NotFound)) for exc in restore_errors)
                    )
                else:
                    getter = getattr(self.ctx.store, f"get_{kind}")
                    self.assertIsNone(getter(target.id).deleted_at)


class OtherFreshImporterTests(unittest.TestCase):
    def test_failed_album_overwrite_does_not_publish_asset_metadata(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            legacy = root / "legacy"
            album = legacy / "albums" / "book"
            album.mkdir(parents=True)
            payload = {
                "id": "fresh-album",
                "title": "Original",
                "steps": [{"name": "Original", "width": 512, "height": 768}],
            }
            path = album / "album.json"
            path.write_text(json.dumps(payload), encoding="utf-8")
            store = SQLiteStore(":memory:")
            try:
                assets = AssetStore(root / "assets", store)
                importer = LegacyImporter(store, legacy, assets)
                report = importer.import_albums()
                series = store.get_series(report.series[0]).model_dump(mode="json")
                episode = store.get_episode(report.episodes[0]).model_dump(mode="json")
                before = store.asset_ids()
                image = io.BytesIO()
                Image.new("RGB", (64, 64), "blue").save(image, format="PNG")
                (album / "one.png").write_bytes(image.getvalue())
                payload["steps"] = [
                    {"name": "Valid", "width": 512, "height": 768, "image": "one.png"},
                    {"name": "Invalid", "width": 1, "height": 100},
                ]
                path.write_text(json.dumps(payload), encoding="utf-8")
                with self.assertRaises(ValueError):
                    importer.import_albums(overwrite=True)
                self.assertEqual(store.asset_ids(), before)
                self.assertEqual(store.get_series(report.series[0]).model_dump(mode="json"), series)
                self.assertEqual(
                    store.get_episode(report.episodes[0]).model_dump(mode="json"), episode
                )
            finally:
                store.close()


class OtherFreshClaimTests(unittest.TestCase):
    def test_self_pause_skips_later_planned_items_and_cancel_skips_other_job(self):
        for action in ("self_pause", "cancel_other"):
            with self.subTest(action=action):
                engine = JobEngine(":memory:", autostart=False, pool=ResourcePool(local_capacity=2))

                class Executor:
                    def execute(self, ctx):
                        return {"ok": True}

                try:
                    engine.register("fresh", Executor())
                    with patch("mio_server.jobs.engine.time.time", return_value=1):
                        first = engine.submit(
                            "fresh",
                            [ItemSpec({}), ItemSpec({})]
                            if action == "self_pause"
                            else [ItemSpec({})],
                            priority=10,
                            window=2,
                        )
                        second = (
                            first
                            if action == "self_pause"
                            else engine.submit("fresh", [ItemSpec({})])
                        )

                    def interrupt(event):
                        if event["job_id"] == first["id"] and event["type"] == "started":
                            getattr(engine, "pause" if action == "self_pause" else "cancel")(
                                second["id"]
                            )

                    engine.subscribe(interrupt)
                    self.assertEqual(engine.tick(), 1)
                    final = engine.get(second["id"])
                    item = final["items"][1 if action == "self_pause" else 0]
                    self.assertEqual(item["attempts"], 0)
                    self.assertEqual(
                        item["state"], "pending" if action == "self_pause" else "canceled"
                    )
                finally:
                    engine.close()
