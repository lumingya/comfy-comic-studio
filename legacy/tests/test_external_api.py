import http.client
import json
import os
import unittest
from pathlib import Path
from unittest.mock import patch

from backend import mio_api, server
from tests.api_support import TOKEN, ApiServerCase

CHANNEL = {"id": "p1", "title": "API", "provider": "openai", "model": "gpt-image-1",
           "baseUrl": "https://example.com/v1", "keyMode": "none"}


class ExternalApiTests(ApiServerCase):
    @classmethod
    def seed(cls):
        store = cls.store()
        store.apply([
            {"kind": "collections", "id": "c1", "document": {"id": "c1", "title": "C"}, "expected": None},
            {"kind": "storyboards", "id": "s1", "expected": None, "document": {
                "id": "s1", "title": "A", "projectId": "c1",
                "frames": [{"id": "f1", "name": "one", "prompt": "test", "nodeOverrides": {"3": {"seed": 1}}}]}},
            {"kind": "albums", "id": "b1", "expected": None, "document": {
                "id": "b1", "title": "B", "projectId": "c1", "steps": [], "sourceSnapshot": {"note": "internal"}}},
        ], settings_changes=[{"name": "workspace", "expected": None, "document": {
            "ui": {"comfyStudio": {"activeProjectId": "c1", "settings": {"imageGeneration": {
                "active": "p1", "profiles": [CHANNEL]}}}}}}])

    def test_disabled_without_strong_token(self):
        with patch.dict(os.environ, {"MIO_API_TOKEN": ""}):
            response = self.get("/api/v1/health")
        self.assertEqual(response.status, 503)
        self.assertEqual(response.error["code"], "api_disabled")

    def test_token_required(self):
        response = self.get("/api/v1/health", token="bad")
        self.assertEqual(response.status, 401)
        self.assertTrue(response.json["requestId"].startswith("req_"))
        self.assertEqual(response.headers["X-Request-Id"], response.json["requestId"])

    def test_health(self):
        data = self.ok(self.get("/api/v1/health"))
        self.assertEqual(data["name"], "Mio")
        self.assertEqual(data["version"], mio_api.VERSION)

    def test_capabilities_are_honest(self):
        data = self.ok(self.get("/api/v1/capabilities"))
        self.assertTrue(data["browserQueueIntegration"])
        self.assertIn("comfyui", data["generationProviders"])
        self.assertIn("comfyui", data["providers"])
        self.assertGreater(data["operations"], 50)

    def test_schema_is_raw_and_secured(self):
        response = self.get("/api/v1/openapi.json")
        self.assertEqual(response.status, 200)
        spec = response.json
        self.assertEqual(spec["openapi"], "3.1.0")
        self.assertIn("/api/v1/images/generations", spec["paths"])
        self.assertIn("bearerAuth", spec["components"]["securitySchemes"])

    def test_every_route_is_documented_with_unique_operation_ids(self):
        spec = mio_api.openapi()
        ids = [op["operationId"] for methods in spec["paths"].values() for op in methods.values()]
        self.assertEqual(len(ids), len(set(ids)))
        routes = self.ok(self.get("/api/v1/routes"))
        self.assertEqual(len(routes), len(ids))
        for op in (op for methods in spec["paths"].values() for op in methods.values()):
            self.assertTrue(op["summary"])
            self.assertTrue(op["tags"])

    def test_catalog_channel_view_does_not_leak_urls(self):
        data = self.ok(self.get("/api/v1/resources/channels"))
        self.assertEqual(data["items"][0]["id"], "p1")
        self.assertNotIn("baseUrl", json.dumps(data))

    def test_storyboard_dto_removes_execution_snapshots(self):
        data = self.ok(self.get("/api/v1/storyboards?limit=1&offset=0"))
        self.assertEqual(data["total"], 1)
        self.assertNotIn("nodeOverrides", json.dumps(data))
        self.assertEqual(data["items"][0]["frames"][0]["prompt"], "test")

    def test_album_dto_removes_source_snapshots(self):
        data = self.ok(self.get("/api/v1/albums"))
        self.assertEqual(data["items"][0]["id"], "b1")
        self.assertNotIn("sourceSnapshot", json.dumps(data))

    def test_invalid_pagination(self):
        for query in ("limit=101", "offset=-1", "limit=no"):
            response = self.get("/api/v1/albums?" + query)
            self.assertEqual(response.status, 400)
            self.assertEqual(response.error["code"], "invalid_query")

    def test_origin_rejected_on_external_and_private_reads(self):
        for path in ("/api/v1/health", "/api/config"):
            self.assertEqual(self.get(path, headers={"Origin": "https://evil.example"}).status, 403)

    def test_preflight_allows_authorization_and_writes_only_for_known_origins(self):
        conn = http.client.HTTPConnection("127.0.0.1", self.httpd.server_port, timeout=5)
        self.addCleanup(conn.close)
        conn.request("OPTIONS", "/api/v1/health", headers={"Origin": f"http://localhost:{server.PORT}"})
        response = conn.getresponse()
        self.assertEqual(response.status, 204)
        self.assertIn("Authorization", response.getheader("Access-Control-Allow-Headers"))
        self.assertIn("If-Match", response.getheader("Access-Control-Allow-Headers"))
        self.assertIn("PATCH", response.getheader("Access-Control-Allow-Methods"))
        self.assertIn("ETag", response.getheader("Access-Control-Expose-Headers"))
        response.read()

    def test_unknown_route_and_method(self):
        self.assertEqual(self.get("/api/v1/nope").error["code"], "not_found")
        response = self.delete("/api/v1/albums")
        self.assertEqual(response.status, 405)
        self.assertIn("GET", response.headers["Allow"])

    def test_invalid_json_and_media_type_are_enveloped(self):
        response = self.call("POST", "/api/v1/images/generations", raw=b"{nope")
        self.assertEqual((response.status, response.error["code"]), (400, "invalid_json"))
        response = self.call("POST", "/api/v1/images/generations", raw=b"x", content_type="text/plain")
        self.assertEqual((response.status, response.error["code"]), (415, "unsupported_media_type"))

    def test_generates_once_without_mutating_browser_queue(self):
        for field in ("channelId", "providerId"):
            with patch.object(server, "generate_provider_image", return_value={"image": "/images/a.png", "offlineFallback": False}) as generate, \
                    patch.object(server, "write_split_config") as write:
                response = self.post("/api/v1/images/generations", {field: "p1", "prompt": "test", "apiKey": "private-key"})
            data = self.ok(response)
            generate.assert_called_once()
            write.assert_not_called()
            self.assertNotIn("private-key", json.dumps(data))
            self.assertNotIn("key", generate.call_args.args[0]["config"])
            self.assertEqual(generate.call_args.args[0]["albumId"], "external")
            self.assertEqual(data["assetEndpoint"], "/api/v1/assets?path=%2Fimages%2Fa.png")

    def test_rejects_ambiguous_or_unsupported_requests(self):
        for body in ({"channelId": "p1", "config": {}, "prompt": "x"}, {"config": {"provider": "comfyui"}, "prompt": "x"},
                     {"channelId": "p1", "prompt": ""}, {"channelId": "p1", "prompt": "x", "frame": {"workflow": {}}},
                     {"channelId": "p1", "prompt": "x", "forceWrite": True}, {"channelId": "p1", "providerId": "p2", "prompt": "x"}):
            self.assertEqual(self.post("/api/v1/images/generations", body).status, 400, body)
        self.assertEqual(self.post("/api/v1/images/generations", {"channelId": "missing", "prompt": "x"}).error["code"], "channel_not_found")

    def test_busy_returns_429(self):
        mio_api.GENERATION_SLOT.acquire()
        try:
            self.assertEqual(self.post("/api/v1/images/generations", {"channelId": "p1", "prompt": "x"}).status, 429)
        finally:
            mio_api.GENERATION_SLOT.release()

    def test_upstream_error_is_sanitized_and_slot_released(self):
        with patch.object(server, "generate_provider_image", side_effect=RuntimeError("SECRET")):
            response = self.post("/api/v1/images/generations", {"channelId": "p1", "prompt": "x"})
        self.assertEqual(response.status, 502)
        self.assertNotIn("SECRET", response.raw.decode())
        self.assertTrue(mio_api.GENERATION_SLOT.acquire(blocking=False))
        mio_api.GENERATION_SLOT.release()

    def test_asset_path_is_local_and_traversal_safe(self):
        for path in ("https%3A%2F%2Fevil.example%2Fa.png", "%2Fimages%2F..%2Fserver.py", "%2Fetc%2Fpasswd"):
            self.assertEqual(self.get("/api/v1/assets?path=" + path).status, 400)
        with patch.object(server, "image_url_to_data_url", return_value="data:image/png;base64,AA=="):
            data = self.ok(self.get("/api/v1/assets?path=%2Fimages%2Fa.png"))
        self.assertIn("dataUrl", data)

    def test_mio_environment_takes_precedence_with_legacy_fallback(self):
        with patch.dict(os.environ, {"MIO_PORT": "8899", "COMFY_COMIC_PORT": "8777"}):
            self.assertEqual(server._read_port_from_env(), 8899)

    def test_openapi_file_matches_runtime(self):
        root = Path(__file__).resolve().parents[1]
        spec = json.loads((root / "docs/api/openapi.json").read_text(encoding="utf-8"))
        self.assertEqual(spec, mio_api.openapi(), "Run python tools/build_api_docs.py")
        self.assertEqual((root / "docs/api/ROUTES.md").read_text(encoding="utf-8"), mio_api.route_table(),
                         "Run python tools/build_api_docs.py")

    def test_ordered_images_reach_generation_adapter(self):
        images = ["/images/albums/variable-assets/one.png", "/images/albums/variable-assets/two.png"]
        with patch.object(server, "generate_provider_image", return_value={"image": "/images/result.png"}) as generate:
            self.ok(self.post("/api/v1/images/generations", {"channelId": "p1", "prompt": "@image_1 @image_2", "images": images}))
        self.assertEqual(generate.call_args.args[0]["images"], images)

    def test_private_generation_preserves_status_and_error_body(self):
        raw = json.dumps({"error": {"code": "unsupported_images", "message": "参数错误 " + "detail " * 100 + "SECRET"}}, ensure_ascii=False).encode()
        error = server.ProviderHTTPError(422, raw, "SECRET")
        with patch.object(server, "generate_provider_image", side_effect=error) as generate:
            response = self.call("POST", "/api/image/generate", {})
        self.assertEqual(response.status, 422)
        self.assertEqual(response.json, json.loads(raw.replace(b"SECRET", b"[REDACTED]")))
        self.assertEqual(generate.call_count, 1)

    def test_external_upstream_status_and_details_are_preserved(self):
        with patch.object(server, "generate_provider_image", side_effect=server.ProviderHTTPError(429, b'{"error":"quota SECRET"}', "SECRET")):
            response = self.post("/api/v1/images/generations", {"channelId": "p1", "prompt": "x"})
        self.assertEqual(response.status, 429)
        self.assertIn("quota [REDACTED]", response.error["message"])
        self.assertNotIn("SECRET", response.raw.decode())


if __name__ == "__main__":
    unittest.main()
