import unittest

from fastapi.testclient import TestClient

from mio_server.app import create_app
from mio_server.storage import SQLiteStore


class ApiTests(unittest.TestCase):
    def setUp(self):
        self.store = SQLiteStore(":memory:")
        self.addCleanup(self.store.close)
        self.client = TestClient(create_app(self.store))

    def test_create_series_and_episode(self):
        self.assertEqual(self.client.get("/healthz").json()["ok"], True)
        response = self.client.post("/api/series", json={"title": "雨夜的未完画稿"})
        self.assertEqual(response.status_code, 201, response.text)
        series = response.json()
        self.assertTrue(series["id"].startswith("series_"))

        response = self.client.post(f"/api/series/{series['id']}/episodes", json={"title": "第一话", "order": 0})
        self.assertEqual(response.status_code, 201, response.text)
        self.assertEqual(response.json()["series_id"], series["id"])
        self.assertEqual(len(self.client.get(f"/api/series/{series['id']}/episodes").json()), 1)

    def test_not_found(self):
        self.assertEqual(self.client.get("/api/series/nope").status_code, 404)
        self.assertEqual(self.client.post("/api/series/nope/episodes", json={"title": "x", "order": 0}).status_code, 404)


if __name__ == "__main__":
    unittest.main()
