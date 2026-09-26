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


if __name__ == "__main__":
    unittest.main()
