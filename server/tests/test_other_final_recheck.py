"""Independent boundary probes for OF1-OF3 after their second-stage repairs."""

import hashlib
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
from mio_server.importer import LegacyImporter
from mio_server.models import Episode, Series
from mio_server.storage import Conflict, SQLiteStore
from mio_server.trash import Trash

from .api_harness import LOCAL, ApiCase


def image_bytes(color):
    output = io.BytesIO()
    Image.new("RGB", (64, 64), color).save(output, format="PNG")
    return output.getvalue()


def visible_state(store):
    return {
        table: [tuple(row) for row in store._rows(f"SELECT * FROM {table} ORDER BY rowid")]
        for table in ("series", "episodes", "documents", "assets", "episode_snapshots")
    }


class OtherFinalApiTests(ApiCase):
    def test_corrupt_later_member_rolls_back_earlier_asset_for_each_backend(self):
        self.ctx.store.create_series(Series(title="Existing work"))
        self.ctx.assets.put(image_bytes("blue"), source="existing")
        before = visible_state(self.ctx.store)
        client = TestClient(self.client.app, base_url=LOCAL, raise_server_exceptions=False)
        for compression in (zipfile.ZIP_DEFLATED, zipfile.ZIP_BZIP2, zipfile.ZIP_LZMA):
            with self.subTest(compression=compression):
                blob = image_bytes("red")
                output = io.BytesIO()
                with zipfile.ZipFile(output, "w") as archive:
                    archive.writestr(
                        "manifest.json", json.dumps({"format": "mio.bundle", "version": 1})
                    )
                    archive.writestr(f"assets/{hashlib.sha256(blob).hexdigest()}.png", blob)
                    archive.writestr(
                        "series.json", Series(title="Imported").model_dump_json(), compression
                    )
                raw = bytearray(output.getvalue())
                with zipfile.ZipFile(io.BytesIO(raw)) as archive:
                    entry = archive.getinfo("series.json")
                    start = (
                        entry.header_offset + 30 + len(entry.filename.encode()) + len(entry.extra)
                    )
                if compression == zipfile.ZIP_DEFLATED:
                    raw[start] = (raw[start] & 0xF9) | 0x06
                elif compression == zipfile.ZIP_BZIP2:
                    raw[start] = 0
                else:
                    raw[start + 4] = 255
                response = client.post("/api/bundles", content=bytes(raw))
                self.assertEqual(response.status_code, 400, response.text)
                self.assertEqual(response.json()["kind"], "invalid")
                self.assertEqual(visible_state(self.ctx.store), before)

    def test_restore_winner_survives_waiting_purge_with_and_without_engine(self):
        for with_engine in (False, True):
            for kind in ("series", "episode"):
                with self.subTest(engine=with_engine, kind=kind):
                    trash = Trash(self.ctx.store, self.ctx.engine if with_engine else None)
                    series = self.ctx.store.create_series(Series(title="Restore first"))
                    target = (
                        series
                        if kind == "series"
                        else self.ctx.store.create_episode(
                            Episode(series_id=series.id, title="Episode", order=0)
                        )
                    )
                    getattr(trash, f"delete_{kind}")(target.id)
                    method = "save_series" if kind == "series" else "update_episode"
                    original = getattr(self.ctx.store, method)
                    entered, release, purge_started, purge_finished = (
                        threading.Event() for _ in range(4)
                    )
                    restore_errors, purge_errors = [], []

                    def delayed_restore_write(*args, **kwargs):
                        entered.set()
                        if not release.wait(5):
                            raise TimeoutError("restore boundary was not released")
                        return original(*args, **kwargs)

                    def restore():
                        try:
                            getattr(trash, f"restore_{kind}")(target.id)
                        except Exception as exc:
                            restore_errors.append(exc)

                    def purge():
                        purge_started.set()
                        try:
                            trash.purge(kind, target.id)
                        except Exception as exc:
                            purge_errors.append(exc)
                        finally:
                            purge_finished.set()

                    with patch.object(self.ctx.store, method, side_effect=delayed_restore_write):
                        restorer = threading.Thread(target=restore)
                        purger = threading.Thread(target=purge)
                        restorer.start()
                        try:
                            self.assertTrue(entered.wait(3))
                            purger.start()
                            self.assertTrue(purge_started.wait(3))
                            self.assertFalse(purge_finished.wait(0.1))
                        finally:
                            release.set()
                            restorer.join(3)
                            if purger.ident is not None:
                                purger.join(3)
                    self.assertFalse(restorer.is_alive())
                    self.assertFalse(purger.is_alive())
                    self.assertEqual(restore_errors, [])
                    self.assertEqual(len(purge_errors), 1)
                    self.assertIsInstance(purge_errors[0], Conflict)
                    self.assertIsNone(getattr(self.ctx.store, f"get_{kind}")(target.id).deleted_at)


class OtherFinalImporterTests(unittest.TestCase):
    def test_run_late_failure_rolls_back_album_recipe_and_asset_batch(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            legacy = root / "legacy"
            album = legacy / "albums" / "book"
            album.mkdir(parents=True)
            (legacy / "workflows").mkdir()
            (legacy / "storyboards").mkdir()
            album_path = album / "album.json"
            workflow_path = legacy / "workflows" / "recipe.json"
            board_path = legacy / "storyboards" / "board.json"
            album_payload = {
                "id": "final-album",
                "title": "Original album",
                "steps": [{"name": "Original", "width": 512, "height": 768, "image": "one.png"}],
            }
            workflow_payload = {
                "id": "final-workflow",
                "title": "Original recipe",
                "workflow": {"1": {"class_type": "CLIPTextEncode", "inputs": {"text": "old"}}},
            }
            board_payload = {
                "id": "final-board",
                "projectId": "final-project",
                "title": "Original storyboard",
                "frames": [{"name": "Valid", "width": 512, "height": 768}],
            }
            (album / "one.png").write_bytes(image_bytes("blue"))
            album_path.write_text(json.dumps(album_payload), encoding="utf-8")
            workflow_path.write_text(json.dumps(workflow_payload), encoding="utf-8")
            board_path.write_text(json.dumps(board_payload), encoding="utf-8")
            store = SQLiteStore(":memory:")
            try:
                assets = AssetStore(root / "assets", store)
                importer = LegacyImporter(store, legacy, assets)
                report = importer.run()
                self.assertEqual(len(report.albums), 1)
                self.assertEqual(len(report.workflows), 1)
                before = visible_state(store)
                (album / "two.png").write_bytes(image_bytes("red"))
                album_payload["title"] = "Replacement album"
                album_payload["steps"][0]["image"] = "two.png"
                workflow_payload["title"] = "Replacement recipe"
                workflow_payload["workflow"]["1"]["inputs"]["text"] = "new"
                board_payload["frames"].append({"name": "Invalid", "width": 1, "height": 100})
                album_path.write_text(json.dumps(album_payload), encoding="utf-8")
                workflow_path.write_text(json.dumps(workflow_payload), encoding="utf-8")
                board_path.write_text(json.dumps(board_payload), encoding="utf-8")
                with patch.object(store, "put_doc", wraps=store.put_doc) as write_recipe:
                    with self.assertRaises(ValueError):
                        importer.run(overwrite=True)
                    self.assertEqual(write_recipe.call_count, 1)
                self.assertEqual(visible_state(store), before)
            finally:
                store.close()
