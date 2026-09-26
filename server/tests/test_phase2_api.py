import io
import zipfile
import unittest

from fastapi.testclient import TestClient

from mio_server.app import create_app
from mio_server.storage import SQLiteStore


class Phase2ApiTests(unittest.TestCase):
    def setUp(self):
        self.store = SQLiteStore(":memory:")
        self.addCleanup(self.store.close)
        self.client = TestClient(create_app(self.store))
        self.series = self.client.post("/api/series", json={"title": "条漫测试"}).json()

    def test_script_assistant_export_package_and_variants(self):
        response = self.client.post(f"/api/series/{self.series['id']}/assistant/script", json={"idea": "雨夜相遇，旧书店重逢", "panel_count": 6})
        self.assertEqual(response.status_code, 200, response.text)
        episode = response.json()["episode"]
        self.assertEqual(len(episode["panels"]), 6)
        self.assertIn("added_panels", response.json()["diff"])

        manifest = self.client.get(f"/api/episodes/{episode['id']}/export/strip").json()
        self.assertEqual(manifest["width"], 800)
        self.assertGreaterEqual(len(manifest["slices"]), 1)

        variants = self.client.post(f"/api/episodes/{episode['id']}/variants", json=["A", "B"])
        self.assertEqual(variants.status_code, 200, variants.text)
        self.assertEqual(len(variants.json()), 2)

        package = self.client.get(f"/api/series/{self.series['id']}/package")
        self.assertEqual(package.status_code, 200)
        with zipfile.ZipFile(io.BytesIO(package.content)) as zf:
            self.assertIn("manifest.json", zf.namelist())
            self.assertIn("series.json", zf.namelist())

    def test_trash_restore(self):
        sid = self.series["id"]
        self.assertEqual(self.client.delete(f"/api/series/{sid}").status_code, 204)
        self.assertEqual(self.client.get("/api/series").json(), [])
        self.assertEqual(self.client.get("/api/trash/series").json()[0]["id"], sid)
        self.assertEqual(self.client.post(f"/api/trash/series/{sid}/restore").status_code, 200)
        self.assertEqual(self.client.get("/api/series").json()[0]["id"], sid)


if __name__ == "__main__":
    unittest.main()
