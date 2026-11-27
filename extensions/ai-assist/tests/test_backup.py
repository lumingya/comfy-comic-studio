"""AI history and images participate in workspace integrity, redaction and restart recovery."""

import hashlib
import json
import tempfile
import threading
import unittest
import zipfile
from concurrent.futures import ThreadPoolExecutor, TimeoutError
from pathlib import Path
from unittest.mock import patch

from mio_server.backups import Backups, snapshot
from mio_server.backups.models import BackupOptions, RestoreApply
from mio_server.context import AppContext
from mio_server.storage import Conflict

from ..core.backup import allowed_ai_path, copy_assistant_data
from ..core.models import AssistSettings, Channel
from ..core.storage import write_json


class AssistantBackupTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name).resolve()
        self.data = self.root / "workspace"
        self.ctx = AppContext.create(self.data, autostart=False, seed_instance=False)
        self.ctx.extensions.enable("ai-assist", self.ctx.extensions.info("ai-assist").digest)
        self.addCleanup(lambda: self.ctx.close() if self.ctx else None)
        self.service = Backups(self.ctx)
        self.store = self.ctx.extension_services["ai-assist"].store
        self.store.save_settings(
            AssistSettings(
                channels=[
                    Channel(
                        id="local",
                        base_url="https://user:PRIVATE_URL@example.invalid/v1?api_key=PRIVATE_URL",
                        api_key="PRIVATE_AI_KEY",
                        model="test",
                    )
                ],
                active_channel_id="local",
            )
        )
        self.chat = self.store.create("窗边小猫")
        self.attachment_id = "img_" + "a" * 32
        self.attachment_path = (
            self.data / "extensions_data/ai-assist/attachments" / f"{self.attachment_id}.bin"
        )
        self.attachment_path.parent.mkdir(parents=True)
        self.attachment_path.write_bytes(b"tiny image fixture")
        write_json(
            self.attachment_path.with_suffix(".json"),
            {
                "id": self.attachment_id,
                "name": "cat.png",
                "mime_type": "image/png",
                "size": self.attachment_path.stat().st_size,
                "url": f"/api/ai-assist/attachments/{self.attachment_id}",
            },
        )
        self.chat["messages"] = [
            {
                "role": "user",
                "content": "请画一只窗边的小猫",
                "attachment_ids": [self.attachment_id],
            }
        ]
        self.store.put(self.chat)

    def export(self, **options):
        return self.service.export(BackupOptions(**options))

    def command(self, plan):
        return RestoreApply(
            expected_head=plan.expected_head,
            expected_archive_sha256=plan.inspection.sha256,
        )

    def rewrite(self, archive, name, raw, *, includes_credentials=None):
        with zipfile.ZipFile(archive) as source:
            files = {item: source.read(item) for item in source.namelist()}
        files[name] = raw
        manifest = json.loads(files["manifest.json"])
        manifest["entries"] = [entry for entry in manifest["entries"] if entry["path"] != name]
        manifest["entries"].append(
            {"path": name, "size": len(raw), "sha256": hashlib.sha256(raw).hexdigest()}
        )
        if includes_credentials is not None:
            manifest["includes_credentials"] = includes_credentials
        files["manifest.json"] = json.dumps(manifest).encode()
        path = self.root / "changed.zip"
        with zipfile.ZipFile(path, "w") as target:
            for filename, content in files.items():
                target.writestr(filename, content)
        return path

    def test_default_archive_preserves_chat_images_and_removes_configured_credentials(
        self,
    ):
        before = self.service.head().head
        backup = self.export()
        self.assertEqual(backup.inspection.manifest.source_head, before)
        with zipfile.ZipFile(self.service.download(backup.id)) as archive:
            settings = archive.read("extensions_data/ai-assist/config.json")
            self.assertNotIn(b"PRIVATE_AI_KEY", settings)
            self.assertNotIn(b"PRIVATE_URL", settings)
            channel = json.loads(settings)["channels"][0]
            self.assertNotIn("api_key", channel)
            self.assertEqual(channel["base_url"], "https://example.invalid/v1")
            chat = json.loads(
                archive.read(f"extensions_data/ai-assist/conversations/{self.chat['id']}.json")
            )
            self.assertEqual(chat["messages"], self.chat["messages"])
            self.assertEqual(
                archive.read(f"extensions_data/ai-assist/attachments/{self.attachment_id}.bin"),
                b"tiny image fixture",
            )

    def test_explicit_credentials_archive_retains_key_and_false_flag_is_rejected(self):
        backup = self.export(include_credentials=True)
        path = self.service.download(backup.id)
        with zipfile.ZipFile(path) as archive:
            raw = archive.read("extensions_data/ai-assist/config.json")
            self.assertEqual(json.loads(raw)["channels"][0]["api_key"], "PRIVATE_AI_KEY")
        forged = self.rewrite(
            path, "extensions_data/ai-assist/config.json", raw, includes_credentials=False
        )
        with self.assertRaisesRegex(ValueError, "embedded credentials"):
            Backups.inspect(forged)

    def test_restart_restores_history_without_replaying_an_inflight_call(self):
        self.chat["run"] = {
            "status": "running",
            "pending_calls": [{"id": "call", "status": "executing"}],
        }
        self.store.put(self.chat)
        backup = self.export()
        self.chat["run"] = {"status": "completed", "pending_calls": []}
        self.chat["title"] = "Current work"
        self.store.put(self.chat)
        plan = self.service.stage(self.service.download(backup.id))
        self.service.apply(plan.id, self.command(plan))
        self.ctx.close()
        self.ctx = None
        self.ctx = AppContext.create(self.data, autostart=False, seed_instance=False)
        self.ctx.extensions.enable("ai-assist", self.ctx.extensions.info("ai-assist").digest)
        restored = self.ctx.extension_services["ai-assist"].store.get(self.chat["id"])
        self.assertEqual(restored["title"], "窗边小猫")
        self.assertEqual(restored["run"]["status"], "interrupted")
        self.assertEqual(restored["run"]["pending_calls"][0]["status"], "unknown")
        self.assertFalse(self.ctx.extension_services["ai-assist"].workers)
        self.assertEqual(
            self.ctx.extension_services["ai-assist"].store.settings().channels[0].api_key,
            "",
        )
        self.assertEqual(self.attachment_path.read_bytes(), b"tiny image fixture")

    def test_restore_rejects_an_active_or_waiting_assistant(self):
        backup = self.export()
        path = self.service.download(backup.id)
        self.ctx.extension_services["ai-assist"].workers[self.chat["id"]] = object()
        try:
            with self.assertRaisesRegex(Conflict, "AI"):
                self.service.stage(path)
        finally:
            self.ctx.extension_services["ai-assist"].workers.clear()
        plan = self.service.stage(path)
        self.chat["run"]["status"] = "waiting_approval"
        self.store.put(self.chat)
        with self.assertRaisesRegex(Conflict, "AI"):
            self.service.apply(plan.id, self.command(plan))

    def test_chat_and_image_changes_invalidate_restore_head(self):
        before = self.service.head().head
        self.chat["title"] = "Edited title"
        self.store.put(self.chat)
        self.assertNotEqual(before, self.service.head().head)
        backup = self.export()
        plan = self.service.stage(self.service.download(backup.id))
        self.attachment_path.write_bytes(b"different same len")
        with self.assertRaisesRegex(Conflict, "changed since staging"):
            self.service.apply(plan.id, self.command(plan))

    def test_capture_blocks_conversation_edits_until_snapshot_is_complete(self):
        from mio_server.backups import participants as backup_participants

        from ..core.backup import PARTICIPANT

        entered, release, saving = (
            threading.Event(),
            threading.Event(),
            threading.Event(),
        )
        original = snapshot.logical_head

        def capture_head(*args, **kwargs):
            entered.set()
            self.assertTrue(release.wait(3))
            return original(*args, **kwargs)

        def save():
            saving.set()
            self.store.put({**self.chat, "title": "After"})

        with (
            ThreadPoolExecutor(max_workers=2) as pool,
            patch.object(backup_participants, "participants", return_value=[PARTICIPANT]),
            patch.object(snapshot, "logical_head", side_effect=capture_head),
        ):
            exporting = pool.submit(self.export)
            try:
                self.assertTrue(entered.wait(2))
                editing = pool.submit(save)
                self.assertTrue(saving.wait(2))
                with self.assertRaises(TimeoutError):
                    editing.result(timeout=0.05)
            finally:
                release.set()
            backup = exporting.result(4)
            editing.result(4)
        with zipfile.ZipFile(self.service.download(backup.id)) as archive:
            self.assertEqual(
                json.loads(
                    archive.read(f"extensions_data/ai-assist/conversations/{self.chat['id']}.json")
                )["title"],
                "窗边小猫",
            )
        self.assertEqual(self.store.get(self.chat["id"])["title"], "After")

    def test_attachment_pair_limits_and_path_boundaries(self):
        self.assertFalse(allowed_ai_path("extensions_data/ai-assist/attachments/../../outside.bin"))
        self.assertFalse(allowed_ai_path("extensions_data/ai-assist/attachments/x.bin"))
        self.assertFalse(allowed_ai_path("extension-data/ai-assist/settings.json"))
        with self.assertRaisesRegex(ValueError, "size limit"):
            copy_assistant_data(
                self.data, self.root / "small", include_credentials=False, byte_budget=1
            )
        self.attachment_path.with_suffix(".json").unlink()
        with self.assertRaisesRegex(ValueError, "missing metadata"):
            self.export()

    def test_incomplete_atomic_files_are_ignored_but_invalid_committed_paths_rejected(
        self,
    ):
        leftover = self.data / "extensions_data/ai-assist" / ("config.json." + "b" * 32 + ".tmp")
        leftover.write_text("PRIVATE_INCOMPLETE", encoding="utf-8")
        backup = self.export()
        with zipfile.ZipFile(self.service.download(backup.id)) as archive:
            self.assertFalse(any(name.endswith(".tmp") for name in archive.namelist()))
        (self.data / "extensions_data/ai-assist/execute.py").write_text(
            "anything", encoding="utf-8"
        )
        with self.assertRaisesRegex(ValueError, "forbidden path"):
            self.export()

    def test_import_validates_conversation_references_and_nested_json(self):
        backup = self.export()
        path = self.service.download(backup.id)
        chat = {
            **self.chat,
            "messages": [{"role": "user", "attachment_ids": ["img_" + "f" * 32]}],
        }
        forged = self.rewrite(
            path,
            f"extensions_data/ai-assist/conversations/{self.chat['id']}.json",
            json.dumps(chat).encode(),
        )
        with self.assertRaisesRegex(ValueError, "missing attachment"):
            Backups.inspect(forged)
        forged = self.rewrite(
            path, "extensions_data/ai-assist/config.json", b'{"channels":[], "channels": []}'
        )
        with self.assertRaisesRegex(ValueError, "valid UTF-8 JSON"):
            Backups.inspect(forged)
