"""Real uploads remain valid workspace data across backup and restart recovery."""

import hashlib
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
from PIL import Image

from ..core.backup import MAX_AI_ATTACHMENT, copy_assistant_data


class AttachmentBackupReviewTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name).resolve()
        self.data = self.root / "workspace"
        self.ctx = None
        self.client = None
        self.addCleanup(self.close)
        self.open()
        output = io.BytesIO()
        Image.new("RGB", (1, 1), "white").save(output, format="PNG")
        self.png = output.getvalue()

    def close(self):
        if self.client is not None:
            self.client.close()
            self.client = None
        if self.ctx is not None:
            self.ctx.close()
            self.ctx = None

    def open(self):
        self.ctx = AppContext.create(self.data, autostart=False, seed_instance=False)
        # No workshop fixture may fall back to the checkout's mutable data directory.
        self.ctx.legacy_root = self.root / "empty-seed"
        self.ctx.legacy_root.mkdir(exist_ok=True)
        self.client = TestClient(create_app(self.ctx, serve_web=False), base_url="http://127.0.0.1")
        info = self.ok(self.client.get("/api/extensions"))["items"]
        digest = next(item["digest"] for item in info if item["id"] == "ai-assist")
        self.ok(self.client.post("/api/extensions/ai-assist/enable", json={"digest": digest}))

    def ok(self, response, status=200):
        self.assertEqual(response.status_code, status, response.text)
        return response.json()

    def upload(self):
        metadata = self.ok(
            self.client.post(
                "/api/ext/ai-assist/attachments", files={"file": ("neutral.png", self.png)}
            ),
            201,
        )
        self.assertEqual(metadata["url"], f"/api/ext/ai-assist/attachments/{metadata['id']}")
        response = self.client.get(metadata["url"])
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.content, self.png)
        self.metadata_path = (
            self.data / "extensions_data/ai-assist/attachments" / f"{metadata['id']}.json"
        )
        return metadata

    def archive(self):
        head = self.ok(self.client.get("/api/backups/head"))["head"]
        created = self.ok(
            self.client.post("/api/backups", json={"include_credentials": False}), 201
        )
        self.assertEqual(created["inspection"]["manifest"]["source_head"], head)
        response = self.client.get(f"/api/backups/{created['id']}/download")
        self.assertEqual(response.status_code, 200)
        self.ok(self.client.post("/api/backups/inspect", content=response.content))
        return response.content

    def restore(self, raw):
        plan = self.ok(self.client.post("/api/backups/restore-plans", content=raw), 201)
        self.ok(
            self.client.post(
                f"/api/backups/restore-plans/{plan['id']}/apply",
                json={
                    "expected_head": plan["expected_head"],
                    "expected_archive_sha256": plan["inspection"]["sha256"],
                },
            )
        )
        self.close()
        self.open()

    def write_metadata(self, metadata):
        self.metadata_path.write_text(json.dumps(metadata), encoding="utf-8")

    def forged_archive(self, raw, name, replacement):
        with zipfile.ZipFile(io.BytesIO(raw)) as source:
            files = {name: source.read(name) for name in source.namelist()}
        files[name] = replacement
        manifest = json.loads(files["manifest.json"])
        for entry in manifest["entries"]:
            if entry["path"] == name:
                entry.update(size=len(replacement), sha256=hashlib.sha256(replacement).hexdigest())
        files["manifest.json"] = json.dumps(manifest).encode()
        output = io.BytesIO()
        with zipfile.ZipFile(output, "w") as archive:
            for name, content in files.items():
                archive.writestr(name, content)
        return output.getvalue()

    def test_real_upload_backup_inspect_restore_and_restart(self):
        self.ok(
            self.client.put(
                "/api/ext/ai-assist/settings",
                json={
                    "active_channel_id": "offline",
                    "channels": [
                        {
                            "id": "offline",
                            "base_url": "https://example.invalid/v1",
                            "api_key": "SYNTHETIC_BACKUP_CREDENTIAL",
                            "model": "offline-only",
                        }
                    ],
                },
            )
        )
        attachment = self.upload()
        raw = self.archive()
        with zipfile.ZipFile(io.BytesIO(raw)) as archive:
            config = archive.read("extensions_data/ai-assist/config.json")
            self.assertNotIn(b"SYNTHETIC_BACKUP_CREDENTIAL", config)
            self.assertNotIn("api_key", json.loads(config)["channels"][0])
            self.assertEqual(
                json.loads(archive.read(self.metadata_path.relative_to(self.data).as_posix())),
                attachment,
            )
        later = self.upload()
        self.restore(raw)
        self.assertEqual(self.client.get(attachment["url"]).content, self.png)
        self.assertEqual(self.client.get(later["url"]).status_code, 404)
        settings = self.ok(self.client.get("/api/ext/ai-assist/settings"))
        self.assertEqual(settings["channels"][0]["api_key"], "")
        self.archive()

    def test_workspace_without_attachments_still_roundtrips(self):
        raw = self.archive()
        self.restore(raw)
        self.archive()

    def test_exact_legacy_metadata_alias_survives_archive_and_restart(self):
        attachment = self.upload()
        legacy = {**attachment, "url": f"/api/ai-assist/attachments/{attachment['id']}"}
        self.write_metadata(legacy)
        raw = self.archive()
        self.restore(raw)
        returned, _ = self.ctx.extension_services["ai-assist"].attachment(attachment["id"])
        self.assertEqual(returned["url"], attachment["url"])
        self.assertEqual(self.client.get(returned["url"]).content, self.png)
        self.assertEqual(json.loads(self.metadata_path.read_text(encoding="utf-8")), legacy)
        self.archive()

    def test_urls_are_exact_id_bound_aliases_without_query_or_origin(self):
        attachment = self.upload()
        for url in (
            attachment["url"] + "?token=synthetic",
            attachment["url"] + "#fragment",
            "https://example.invalid" + attachment["url"],
            "/api/ai-assist/attachments/" + "img_" + "f" * 32,
            attachment["url"].replace("/ext/", "/v2/ext/"),
            attachment["url"].replace("/attachments/", "/attachments/../attachments/"),
            attachment["url"] + "/",
            None,
        ):
            with self.subTest(url=url):
                self.write_metadata({**attachment, "url": url})
                self.assertEqual(self.client.get("/api/backups/head").status_code, 400)
                self.assertEqual(self.client.post("/api/backups", json={}).status_code, 400)

    def test_rehashed_archive_with_invalid_metadata_is_rejected(self):
        attachment = self.upload()
        raw = self.archive()
        name = self.metadata_path.relative_to(self.data).as_posix()
        for changes in (
            {"id": "img_" + "f" * 32},
            {"size": len(self.png) + 1},
            {"mime_type": "text/html"},
            {"url": attachment["url"] + "?token=synthetic"},
            {"url": f"/api/ai-assist/attachments/{attachment['id']}?token=synthetic"},
        ):
            with self.subTest(changes=changes):
                forged = self.forged_archive(
                    raw, name, json.dumps({**attachment, **changes}).encode()
                )
                self.assertEqual(
                    self.client.post("/api/backups/inspect", content=forged).status_code, 400
                )
                self.assertEqual(
                    self.client.post("/api/backups/restore-plans", content=forged).status_code, 400
                )

    def test_attachment_copy_keeps_streaming_limit_and_budget(self):
        self.upload()
        binary = self.metadata_path.with_suffix(".bin")
        with patch.object(Path, "read_bytes", side_effect=AssertionError("whole-file image read")):
            copy_assistant_data(
                self.data, self.root / "copied", include_credentials=False, byte_budget=4096
            )
        with self.assertRaisesRegex(ValueError, "size limit"):
            copy_assistant_data(
                self.data, self.root / "small", include_credentials=False, byte_budget=1
            )
        with binary.open("r+b") as output:
            output.truncate(MAX_AI_ATTACHMENT + 1)
        self.assertEqual(self.client.get("/api/backups/head").status_code, 400)
        self.assertEqual(self.client.post("/api/backups", json={}).status_code, 400)

    def test_metadata_credentials_are_not_allowed_by_either_url_alias(self):
        attachment = self.upload()
        for url in (attachment["url"], f"/api/ai-assist/attachments/{attachment['id']}"):
            with self.subTest(url=url):
                self.write_metadata({**attachment, "url": url, "api_key": "SYNTHETIC_METADATA_KEY"})
                self.assertEqual(self.client.post("/api/backups", json={}).status_code, 400)
                created = self.ok(
                    self.client.post("/api/backups", json={"include_credentials": True}), 201
                )
                raw = self.client.get(f"/api/backups/{created['id']}/download").content
                with zipfile.ZipFile(io.BytesIO(raw)) as archive:
                    metadata = json.loads(
                        archive.read(self.metadata_path.relative_to(self.data).as_posix())
                    )
                    self.assertEqual(metadata["api_key"], "SYNTHETIC_METADATA_KEY")
