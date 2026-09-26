import tempfile
import unittest
from pathlib import Path

from mio_server.models import Character, Episode, Panel, Series
from mio_server.storage import NotFound, SQLiteStore


class StorageTests(unittest.TestCase):
    def test_series_and_episodes_roundtrip(self):
        with tempfile.TemporaryDirectory() as tmp:
            store = SQLiteStore(Path(tmp) / "mio.sqlite3")
            series = Series(
                title="长雨街", bible={"characters": [Character(name="苏晚", age=24).model_dump()]}
            )
            store.create_series(series)
            loaded = store.get_series(series.id)
            self.assertEqual(loaded.title, "长雨街")
            self.assertEqual(loaded.bible.characters[0].name, "苏晚")

            episode = Episode(
                series_id=series.id,
                title="第一话",
                order=0,
                panels=[Panel(order=0, description="雨幕")],
            )
            store.create_episode(episode)
            self.assertEqual(store.list_episodes(series.id)[0].panels[0].description, "雨幕")

            store.delete_series(series.id)
            with self.assertRaises(NotFound):
                store.get_series(series.id)
            with self.assertRaises(NotFound):
                store.list_episodes(series.id)
            store.close()


class AssetConcurrencyTests(unittest.TestCase):
    def test_identical_bytes_from_many_threads(self):
        """Regression: concurrent puts of the same content raised WinError 5 on Windows."""
        import threading

        from mio_server.assets import AssetStore

        with tempfile.TemporaryDirectory() as tmp:
            store = SQLiteStore(Path(tmp) / "db.sqlite3")
            assets = AssetStore(Path(tmp) / "assets", store)
            data = b"\x89PNG\r\n\x1a\n" + b"x" * 4096
            errors, ids = [], []

            def put():
                try:
                    ids.append(assets.put(data, source="t").id)
                except Exception as exc:  # pragma: no cover - the failure being guarded
                    errors.append(exc)

            threads = [threading.Thread(target=put) for _ in range(8)]
            for t in threads:
                t.start()
            for t in threads:
                t.join()
            self.assertEqual(errors, [])
            self.assertEqual(len(set(ids)), 1)
            self.assertEqual(assets.read(ids[0]), data)
            store.close()


if __name__ == "__main__":
    unittest.main()
