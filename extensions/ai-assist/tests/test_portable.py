"""The extension works when imported into a host with no bundled assistant package."""

import io
import json
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient
from mio_server.api import create_app
from mio_server.context import AppContext
from mio_server.extensions.manifest import files
from mio_server.extensions.trust import reviewed_packages

PACKAGE = Path(__file__).resolve().parents[1]


class PortableTests(unittest.TestCase):
    def test_clean_host_import_activate_chat_workspace_and_disable(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with patch("mio_server.extensions.manager.BUILTIN_ROOT", root / "empty"):
                ctx = AppContext.create(root / "data", autostart=False, seed_instance=False)
                try:
                    client = TestClient(
                        create_app(ctx, serve_web=False), base_url="http://127.0.0.1"
                    )
                    self.assertEqual(client.get("/api/extensions").json()["items"], [])
                    buffer = io.BytesIO()
                    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as archive:
                        for path in files(PACKAGE):
                            archive.write(path, "portable/" + path.relative_to(PACKAGE).as_posix())
                    imported = client.post("/api/extensions", content=buffer.getvalue())
                    self.assertEqual(imported.status_code, 201, imported.text)
                    info = imported.json()
                    self.assertFalse(info["builtin"])
                    self.assertEqual(info["status"], "disabled")
                    enabled = client.post(
                        "/api/extensions/ai-assist/enable", json={"digest": info["digest"]}
                    )
                    self.assertEqual(enabled.status_code, 200, enabled.text)
                    self.assertEqual(enabled.json()["status"], "active")
                    self.assertEqual(
                        client.get("/api/ext/ai-assist/status").json()["enabled"], True
                    )
                    self.assertIn(
                        "/ext/ai-assist/conversations",
                        client.get("/api/v2/openapi.json").json()["paths"],
                    )
                    surface = client.get("/api/extension-surfaces").json()["items"][0]
                    page = client.get(surface["url"])
                    self.assertEqual(page.status_code, 200)
                    self.assertIn("connect-src 'self'", page.headers["content-security-policy"])
                    created = client.post(
                        "/api/ext/ai-assist/conversations", json={"title": "portable"}
                    )
                    self.assertEqual(created.status_code, 201)
                    conversation_id = created.json()["id"]
                    self.assertTrue(
                        (
                            root
                            / "data/extensions_data/ai-assist/conversations"
                            / f"{conversation_id}.json"
                        ).exists()
                    )
                    self.assertEqual(len(reviewed_packages(ctx.data_dir)), 1)
                    self.assertEqual(
                        client.post("/api/extensions/ai-assist/disable").status_code, 200
                    )
                    self.assertEqual(client.get("/api/ext/ai-assist/status").status_code, 404)
                    self.assertEqual(client.get("/api/extension-surfaces").json()["items"], [])
                    self.assertEqual(len(reviewed_packages(ctx.data_dir)), 1)
                    self.assertEqual(
                        client.post(
                            "/api/extensions/ai-assist/enable", json={"digest": info["digest"]}
                        ).status_code,
                        200,
                    )
                    self.assertEqual(
                        client.get(
                            f"/api/ext/ai-assist/conversations/{conversation_id}"
                        ).status_code,
                        200,
                    )
                    self.assertEqual(client.delete("/api/extensions/ai-assist").status_code, 204)
                    self.assertEqual(client.get("/api/extensions").json()["items"], [])
                    self.assertEqual(client.get("/api/ext/ai-assist/status").status_code, 404)
                    self.assertTrue(
                        (
                            root
                            / "data/extensions_data/ai-assist/conversations"
                            / f"{conversation_id}.json"
                        ).exists()
                    )
                finally:
                    ctx.close()

    def test_real_folder_import_overrides_builtin_and_uninstall_restores_disabled_builtin(self):
        with tempfile.TemporaryDirectory() as directory:
            ctx = AppContext.create(directory, autostart=False, seed_instance=False)
            try:
                client = TestClient(create_app(ctx, serve_web=False), base_url="http://127.0.0.1")
                builtin = next(
                    item
                    for item in client.get("/api/extensions").json()["items"]
                    if item["id"] == "ai-assist"
                )
                self.assertTrue(builtin["builtin"])
                imported = client.post(
                    "/api/extensions/folder",
                    files=[
                        (
                            "files",
                            (
                                "ai-assist/" + path.relative_to(PACKAGE).as_posix(),
                                path.read_bytes(),
                            ),
                        )
                        for path in files(PACKAGE)
                    ],
                )
                self.assertEqual(imported.status_code, 201, imported.text)
                info = imported.json()
                self.assertFalse(info["builtin"])
                self.assertEqual(info["status"], "disabled")
                enabled = client.post(
                    "/api/extensions/ai-assist/enable", json={"digest": info["digest"]}
                )
                self.assertEqual(enabled.json()["status"], "active", enabled.text)
                self.assertEqual(client.get("/api/ext/ai-assist/status").status_code, 200)
                self.assertEqual(client.delete("/api/extensions/ai-assist").status_code, 204)
                restored = next(
                    item
                    for item in client.get("/api/extensions").json()["items"]
                    if item["id"] == "ai-assist"
                )
                self.assertTrue(restored["builtin"])
                self.assertEqual(restored["status"], "disabled")
                self.assertEqual(client.get("/api/ext/ai-assist/status").status_code, 404)
            finally:
                ctx.close()

    def test_folder_import_ignores_dependencies_and_rejects_traversal(self):
        with tempfile.TemporaryDirectory() as directory:
            ctx = AppContext.create(directory, autostart=False, seed_instance=False)
            try:
                client = TestClient(create_app(ctx, serve_web=False), base_url="http://127.0.0.1")
                content = json.dumps({"id": "simple-theme", "name": "Simple"}).encode()
                imported = client.post(
                    "/api/extensions/folder",
                    files=[
                        ("files", ("simple/mio-extension.json", content)),
                        ("files", ("simple/node_modules/big.txt", b"ignored")),
                        ("files", ("simple/data/catalog.json", b"{}")),
                    ],
                )
                self.assertEqual(imported.status_code, 201, imported.text)
                self.assertFalse(
                    (Path(directory) / "extensions/simple-theme/node_modules").exists()
                )
                self.assertTrue(
                    (Path(directory) / "extensions/simple-theme/data/catalog.json").is_file()
                )
                bad = client.post(
                    "/api/extensions/folder", files=[("files", ("../escape", b"bad"))]
                )
                self.assertEqual(bad.status_code, 400)
            finally:
                ctx.close()
