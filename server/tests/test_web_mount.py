"""The built web UI is served with SPA fallback, without swallowing API 404s or missing assets."""

import tempfile
import unittest
from pathlib import Path
from unittest import mock

from fastapi.testclient import TestClient

import mio_server.api as api_module
from mio_server.api import create_app
from mio_server.context import AppContext

from .api_harness import LOCAL


class WebMountTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        dist = Path(self.tmp.name) / "dist"
        (dist / "assets").mkdir(parents=True)
        (dist / "index.html").write_text("<!doctype html><div id=root></div>", encoding="utf-8")
        (dist / "assets" / "index-abc123.js").write_text("console.log(1)", encoding="utf-8")
        self.ctx = AppContext.create(
            Path(self.tmp.name) / "data", memory=True, autostart=False, seed_instance=False
        )
        self.patch = mock.patch.object(api_module, "WEB_DIST", dist)
        self.patch.start()
        self.client = TestClient(create_app(self.ctx), base_url=LOCAL)

    def tearDown(self):
        self.patch.stop()
        self.ctx.close()
        self.tmp.cleanup()

    def test_client_routes_get_the_shell_uncached(self):
        for path in ("/", "/episodes/ep_1/board", "/settings"):
            r = self.client.get(path)
            self.assertEqual(r.status_code, 200, path)
            self.assertIn("id=root", r.text)
            self.assertEqual(r.headers["cache-control"], "no-cache")

    def test_hashed_assets_are_immutable(self):
        r = self.client.get("/assets/index-abc123.js")
        self.assertEqual(r.status_code, 200)
        self.assertIn("immutable", r.headers["cache-control"])

    def test_unknown_api_and_missing_files_are_404(self):
        for path in ("/api/nope", "/api", "/assets/index-old.js", "/favicon.ico"):
            r = self.client.get(path)
            self.assertEqual(r.status_code, 404, path)
            self.assertEqual(r.json()["kind"], "not_found")

    def test_api_still_wins(self):
        self.assertEqual(self.client.get("/api/series").json(), [])

    def test_no_path_traversal(self):
        r = self.client.get("/..%2F..%2Fetc%2Fpasswd")
        self.assertNotIn("root:", r.text)


if __name__ == "__main__":
    unittest.main()
