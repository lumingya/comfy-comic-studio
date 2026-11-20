"""Binary panel operations keep declarations, real scopes and bounded inert delivery."""

from unittest.mock import patch

from fastapi.testclient import TestClient
from pydantic import ValidationError

from mio_server.api import create_app
from mio_server.extensions.manifest import PanelRequestSpec
from mio_server.extensions.panel_media import safe_filename

from .api_harness import LOCAL, ApiCase
from .test_extensions import write_ext

MAIN = """
import io
from fastapi.responses import Response, StreamingResponse, RedirectResponse
from PIL import Image
def activate(mio):
    def png():
        output = io.BytesIO()
        Image.new("RGB", (2, 3), "white").save(output, format="PNG")
        return output.getvalue()
    @mio.route("GET", "/image", scope="read")
    def image():
        return Response(png(), media_type="image/png", headers={"Set-Cookie": "secret=no"})
    @mio.route("GET", "/stream", scope="read")
    def stream():
        return StreamingResponse(iter([png()]), media_type="image/png")
    @mio.route("GET", "/named/{value}", scope="read")
    def named(value: str):
        return Response(png() if value == "雨 1" else b"wrong path", media_type="image/png")
    @mio.route("GET", "/lying", scope="read")
    def lying():
        return Response(png(), media_type="image/png", headers={"Content-Length": "1"})
    @mio.route("GET", "/wrong", scope="read")
    def wrong():
        return Response(b"<script>throw 1</script>", media_type="image/png")
    @mio.route("GET", "/truncated", scope="read")
    def truncated():
        output = io.BytesIO()
        Image.new("RGB", (8, 8), "white").save(output, format="JPEG")
        return Response(output.getvalue()[:-2], media_type="image/jpeg")
    @mio.route("GET", "/svg", scope="read")
    def svg():
        return Response(b"<svg></svg>", media_type="image/svg+xml")
    @mio.route("GET", "/redirect", scope="read")
    def redirect():
        return RedirectResponse("https://example.invalid")
    @mio.route("POST", "/download", scope="render")
    def download():
        return Response(b"<!doctype html><script>window.executed = true</script>",
            media_type="text/html", headers={"Content-Disposition":
                "attachment; filename*=UTF-8''..%2F..%2FCON.exe"})
"""


class PanelMediaTests(ApiCase):
    def setUp(self):
        super().setUp()
        requests = [
            {
                "id": name,
                "method": "GET",
                "path": f"/ext/demo/{name}",
                "scope": "read",
                "response": "image",
            }
            for name in ("image", "stream", "lying", "wrong", "truncated", "svg", "redirect")
        ]
        requests += [
            {
                "id": "named",
                "method": "GET",
                "path": "/ext/demo/named/{value}",
                "scope": "read",
                "response": "image",
            },
            {
                "id": "download",
                "method": "POST",
                "path": "/ext/demo/download",
                "scope": "render",
                "response": "download",
            },
            {
                "id": "lowered",
                "method": "POST",
                "path": "/ext/demo/download",
                "scope": "read",
                "response": "download",
            },
        ]
        self.folder = write_ext(
            self.ctx.extensions.root,
            main=MAIN,
            panels=[
                {
                    "id": "media",
                    "title": "Media",
                    "slot": "episode",
                    "entry": "panel.html",
                    "requests": requests,
                }
            ],
        )
        (self.folder / "panel.html").write_text("<p>Media</p>", encoding="utf-8")
        self.ctx.extensions.enable("demo", self.ctx.extensions.info("demo").digest)
        self.client = TestClient(create_app(self.ctx, serve_web=False), base_url=LOCAL)
        self.panel = self.ok(self.client.get("/api/extension-panels"))[0]

    def call(self, name="image", *, token=None, v2=False, **extra):
        return self.client.post(
            f"{'/api/v2' if v2 else '/api'}/extension-panels/demo/media/requests",
            json={
                "activation": self.panel["activation"],
                "digest": self.panel["digest"],
                "request_id": name,
                **extra,
            },
            headers={"Authorization": f"Bearer {token}"} if token else {},
        )

    def token(self, *scopes):
        return self.ok(
            self.client.post("/api/tokens", json={"name": "panel-media", "scopes": scopes}), 201
        )["token"]

    def test_image_uses_binary_transport_without_forwarding_headers(self):
        for name in ("image", "stream"):
            response = self.call(name)
            self.assertEqual(response.status_code, 200, response.text)
            self.assertTrue(response.content.startswith(b"\x89PNG\r\n"))
            self.assertEqual(response.headers["x-mio-panel-response"], "image")
            self.assertEqual(response.headers["cache-control"], "no-store")
            self.assertEqual(response.headers["x-content-type-options"], "nosniff")
            self.assertNotIn("set-cookie", response.headers)
        self.assertEqual(self.call(url="https://example.invalid").status_code, 422)

    def test_unicode_path_segments_are_decoded_for_asgi_routing(self):
        response = self.call("named", path_params={"value": "雨 1"})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertTrue(response.content.startswith(b"\x89PNG\r\n"))

    def test_stream_actual_length_and_content_type_are_enforced(self):
        self.assertEqual(self.call("lying").status_code, 415)
        for name in ("wrong", "truncated", "svg", "redirect"):
            self.assertEqual(self.call(name).status_code, 415, name)
        with patch("mio_server.extensions.panel_media.MAX_IMAGE_BYTES", 20):
            for name in ("image", "stream"):
                self.assertEqual(self.call(name).status_code, 413, name)
        with patch("mio_server.extensions.panel_media.MAX_IMAGE_PIXELS", 5):
            self.assertEqual(self.call().status_code, 415)
        self.assertEqual(self.call().status_code, 200)

    def test_download_is_attachment_with_inert_content_and_safe_filename(self):
        response = self.call("download")
        self.assertEqual(response.status_code, 200, response.text)
        self.assertIn(b"<script>", response.content)
        self.assertEqual(response.headers["content-security-policy"], "default-src 'none'; sandbox")
        header = response.headers["content-disposition"]
        self.assertTrue(header.startswith("attachment;"))
        self.assertNotIn("%2F", header)
        self.assertTrue(header.endswith(".html"))
        with patch("mio_server.extensions.panel_media.MAX_DOWNLOAD_BYTES", 20):
            self.assertEqual(self.call("download").status_code, 413)

    def test_actual_v2_scope_is_rechecked_and_no_redirect_or_scope_lowering(self):
        read = self.token("read")
        self.assertEqual(self.call(v2=True).status_code, 401)
        self.assertEqual(self.call(v2=True, token=read).status_code, 200)
        self.assertEqual(self.call("download", v2=True, token=read).status_code, 403)
        self.assertEqual(self.call("lowered").status_code, 403)
        render = self.token("read", "render")
        self.assertEqual(self.call("download", v2=True, token=render).status_code, 200)

    def test_old_activation_and_changed_files_cannot_obtain_media(self):
        self.ctx.extensions.disable("demo")
        self.assertEqual(self.call().status_code, 404)
        self.ctx.extensions.enable("demo", self.ctx.extensions.info("demo").digest)
        self.assertEqual(self.call().status_code, 404)
        self.panel = self.ok(self.client.get("/api/extension-panels"))[0]
        (self.folder / "panel.html").write_text("changed", encoding="utf-8")
        self.assertEqual(self.call().status_code, 404)

    def test_spooled_files_and_concurrency_slots_are_released_on_success_and_rejection(self):
        from mio_server.extensions import panel_media

        original = panel_media.tempfile.TemporaryFile
        files = []

        def temporary():
            value = original()
            files.append(value)
            return value

        with patch.object(panel_media.tempfile, "TemporaryFile", side_effect=temporary):
            self.assertEqual(self.call().status_code, 200)
            self.assertEqual(self.call("wrong").status_code, 415)
            self.assertEqual(self.call("lying").status_code, 415)
        self.assertEqual(len(files), 3)
        self.assertTrue(all(value.closed for value in files))
        slots = self.ctx.extensions.loaded["demo"].api._panel_slots
        acquired = [slots.acquire(blocking=False) for _ in range(4)]
        try:
            self.assertEqual(acquired, [True] * 4)
            self.assertEqual(self.call().status_code, 429)
        finally:
            for value in acquired:
                if value:
                    slots.release()

    def test_binary_manifest_modes_and_filename_are_strict(self):
        for response, method, scope in (
            ("image", "POST", "read"),
            ("image", "GET", "admin"),
            ("download", "DELETE", "write"),
            ("html", "GET", "read"),
        ):
            with self.assertRaises(ValidationError):
                PanelRequestSpec(
                    id="one", method=method, scope=scope, path="/ext/demo/image", response=response
                )
        for value in (
            'attachment; filename="CON"',
            'attachment; filename="a.exe"',
            'attachment; filename="../bad\\name.exe"',
        ):
            filename = safe_filename(value, "text/html")
            self.assertNotIn("/", filename)
            self.assertNotIn("\\", filename)
            self.assertTrue(filename.endswith(".html"))
