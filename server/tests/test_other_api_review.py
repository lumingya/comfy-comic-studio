"""Targeted reproductions from the second-stage review of existing API boundaries."""

import io
import json
import threading
import zipfile
from unittest import mock

from fastapi.testclient import TestClient

from .api_harness import LOCAL, ApiCase


class OtherApiReviewTests(ApiCase):
    def test_first_use_last_seen_write_cannot_resurrect_a_revoked_token(self):
        issued = self.ok(
            self.client.post("/api/tokens", json={"name": "review", "scopes": ["read"]}),
            201,
        )
        token_id, raw = issued["id"], issued["token"]
        entered, release = threading.Event(), threading.Event()
        failures = []
        touch = self.ctx.store.touch_api_token

        def delayed_touch(touched_id, secret_hash, used_at):
            if touched_id == token_id:
                entered.set()
                if not release.wait(3):
                    raise TimeoutError("review did not release the last-used write")
            return touch(touched_id, secret_hash, used_at)

        def verify():
            try:
                self.ctx.tokens.verify(raw, "GET", "/series")
            except Exception as exc:
                failures.append(type(exc).__name__)

        with mock.patch.object(self.ctx.store, "touch_api_token", side_effect=delayed_touch):
            worker = threading.Thread(target=verify)
            worker.start()
            try:
                self.assertTrue(entered.wait(3))
                self.ok(self.client.delete(f"/api/tokens/{token_id}"), 204)
            finally:
                release.set()
                worker.join(3)
        self.assertFalse(worker.is_alive())
        self.assertEqual(failures, [])
        response = self.client.get("/api/v2/series", headers={"Authorization": f"Bearer {raw}"})
        self.assertEqual(response.status_code, 401, "revocation must survive an in-flight touch")

    def test_bundle_with_malformed_metadata_returns_a_client_error(self):
        client = TestClient(self.client.app, base_url=LOCAL, raise_server_exceptions=False)
        for manifest in (
            [],
            None,
            {"format": "mio.bundle", "version": None},
            {"format": "mio.bundle", "version": []},
            {"format": "mio.bundle", "version": True},
            {"format": "mio.bundle", "version": 0},
            {"format": "mio.bundle", "version": 1},
        ):
            with self.subTest(manifest=manifest):
                archive = io.BytesIO()
                with zipfile.ZipFile(archive, "w") as output:
                    output.writestr("manifest.json", json.dumps(manifest))
                response = client.post("/api/bundles", content=archive.getvalue())
                self.assertIn(response.status_code, (400, 422))
                self.assertEqual(response.headers["content-type"].split(";")[0], "application/json")
                self.assertEqual(self.ctx.store.list_series(), [])
