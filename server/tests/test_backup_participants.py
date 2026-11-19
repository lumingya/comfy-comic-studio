"""Backup data contracts are generic and never loaded from imported archive contents."""

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from mio_server.backups import Backups
from mio_server.backups import participants as P
from mio_server.backups.extension_data import save_settings
from mio_server.backups.models import BackupOptions, RestoreApply
from mio_server.context import AppContext
from mio_server.extensions.manifest import digest
from mio_server.extensions.trust import remember_package

CONTRACT = """from contextlib import nullcontext
class Data:
    root = "extensions_data/notes"
    def allowed(self, name): return name == "extensions_data/notes/items.json"
    def size_limit(self, name): return 1024
    def files(self, workspace, *, include_credentials=True):
        path = workspace / "extensions_data/notes/items.json"
        if path.is_file(): yield "extensions_data/notes/items.json", path
    def snapshot(self, source, target, *, include_credentials, byte_budget):
        total = 0
        for name, path in self.files(source):
            raw = path.read_bytes()
            total += len(raw)
            if total > byte_budget: raise ValueError("byte budget")
            output = target / name
            output.parent.mkdir(parents=True, exist_ok=True)
            output.write_bytes(raw)
        return total
    def lock(self, ctx): return nullcontext()
    def restore_guard(self, ctx): pass
PARTICIPANT = Data()
"""


class BackupParticipantsTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name).resolve()
        self.shipped = self.root / "extensions"
        self.workspace = self.root / "workspace"
        self.workspace.mkdir()
        self.patch = patch.object(P, "EXTENSIONS_ROOT", self.shipped)
        self.patch.start()
        self.addCleanup(self.patch.stop)

    def package(self, root):
        folder = root / "notes"
        folder.mkdir(parents=True)
        (folder / "mio-extension.json").write_text(
            json.dumps({"id": "notes", "name": "Notes", "main": "main.py", "backup": "backup.py"}),
            encoding="utf-8",
        )
        (folder / "main.py").write_text(
            "raise AssertionError('services must not start')", encoding="utf-8"
        )
        (folder / "backup.py").write_text(CONTRACT, encoding="utf-8")
        return folder

    def test_shipped_data_contract_does_not_activate_extension_main(self):
        self.package(self.shipped)
        participant = P.participants()[0]
        self.assertEqual(participant.root, "extensions_data/notes")
        self.assertTrue(P.allowed_path("extensions_data/notes/items.json"))
        self.assertFalse(P.allowed_path("extensions_data/notes/../mio.sqlite3"))

    def test_only_reviewed_external_packages_supply_backup_rules(self):
        folder = self.package(self.root / "reviewed")
        with patch("mio_server.extensions.trust.reviewed_packages", return_value=[]):
            self.assertFalse(P.allowed_path("extensions_data/notes/items.json", self.workspace))
        with patch("mio_server.extensions.trust.reviewed_packages", return_value=[folder]):
            self.assertTrue(P.allowed_path("extensions_data/notes/items.json", self.workspace))
            target = self.workspace / "extensions_data/notes/items.json"
            target.parent.mkdir(parents=True)
            target.write_text('{"title":"Notebook"}', encoding="utf-8")
            before = P.with_workspace_head("a" * 64, self.workspace)
            target.write_text('{"title":"Changed"}', encoding="utf-8")
            self.assertNotEqual(P.with_workspace_head("a" * 64, self.workspace), before)
            exported = self.root / "exported"
            P.copy_data(self.workspace, exported, include_credentials=False, byte_budget=1024)
            self.assertEqual(
                (exported / "extensions_data/notes/items.json").read_bytes(), target.read_bytes()
            )
            self.assertEqual(
                list(P.data_files(exported, trusted_workspace=self.workspace))[0][0],
                "extensions_data/notes/items.json",
            )

    def test_archive_workspace_cannot_supply_its_own_code(self):
        self.package(self.workspace / "extensions")
        with patch("mio_server.extensions.trust.reviewed_packages", return_value=[]):
            self.assertEqual(P.participants(self.workspace), [])

    def test_contract_cannot_claim_another_extensions_data_or_workspace_root(self):
        folder = self.package(self.shipped)
        for root in ("extensions_data/other", "notes", "themes", "extensions_data/notes/../other"):
            with self.subTest(root=root):
                (folder / "backup.py").write_text(
                    CONTRACT.replace('root = "extensions_data/notes"', f'root = "{root}"'),
                    encoding="utf-8",
                )
                with self.assertRaisesRegex(ValueError, "invalid or duplicate"):
                    P.participants()

    def test_participant_cannot_claim_or_snapshot_generic_sdk_settings(self):
        folder = self.package(self.shipped)
        (folder / "backup.py").write_text(
            CONTRACT.replace('return name == "extensions_data/notes/items.json"', "return True")
            .replace(
                'workspace / "extensions_data/notes/items.json"',
                'workspace / "extensions_data/notes/settings.json"',
            )
            .replace(
                'yield "extensions_data/notes/items.json"',
                'yield "extensions_data/notes/settings.json"',
            ),
            encoding="utf-8",
        )
        save_settings(self.workspace, "notes", {"value": "SDK"})
        self.assertIsNone(P.owner("extensions_data/notes/settings.json"))
        with self.assertRaisesRegex(ValueError, "outside its data area"):
            list(P.data_files(self.workspace))
        with self.assertRaisesRegex(ValueError, "cannot claim host-owned"):
            P.copy_data(
                self.workspace, self.root / "output", include_credentials=True, byte_budget=1024
            )

    def test_snapshot_cannot_overwrite_sdk_settings_even_if_not_declared(self):
        folder = self.package(self.shipped)
        (folder / "backup.py").write_text(
            CONTRACT.replace(
                "        total = 0",
                "        from mio_server.backups.extension_data import save_settings\n"
                '        save_settings(target, "notes", {"value": "changed by participant"})\n'
                "        total = 0",
            ),
            encoding="utf-8",
        )
        target = self.root / "output"
        save_settings(target, "notes", {"value": "SDK"})
        with self.assertRaisesRegex(ValueError, "changed host-owned"):
            P.copy_data(self.workspace, target, include_credentials=True, byte_budget=1024)

    def test_participant_cannot_claim_or_mutate_host_preferences(self):
        from mio_server.extension_preferences import save_preferences

        folder = self.package(self.shipped)
        target = self.root / "output"
        save_preferences(self.workspace, "notes", {"window": "current"})
        self.assertIsNone(P.owner("extensions_data/notes/preferences.json"))
        (folder / "backup.py").write_text(
            CONTRACT.replace(
                "        total = 0",
                "        from mio_server.extension_preferences import save_preferences\n"
                '        save_preferences(target, "notes", {"window": "tampered"})\n'
                "        total = 0",
            ),
            encoding="utf-8",
        )
        with self.assertRaisesRegex(ValueError, "changed host-owned"):
            P.copy_data(self.workspace, target, include_credentials=True, byte_budget=1024)
        (folder / "backup.py").write_text(
            CONTRACT.replace(
                'return name == "extensions_data/notes/items.json"',
                'return name == "extensions_data/notes/preferences.json"',
            ),
            encoding="utf-8",
        )
        with self.assertRaisesRegex(ValueError, "cannot claim host-owned"):
            P.copy_data(
                self.workspace, self.root / "claim", include_credentials=True, byte_budget=1024
            )

    def test_catalog_scope_verifies_trust_once_for_many_archive_entries(self):
        folder = self.package(self.root / "reviewed")
        with patch(
            "mio_server.extensions.trust.reviewed_packages", return_value=[folder]
        ) as source:
            with P.catalog_scope(self.workspace):
                for _ in range(20):
                    self.assertTrue(
                        P.allowed_path("extensions_data/notes/items.json", self.workspace)
                    )
                    self.assertEqual(
                        P.size_limit("extensions_data/notes/items.json", self.workspace), 1024
                    )
            self.assertEqual(source.call_count, 1)

    def test_external_data_survives_real_backup_restore_without_activating_package(self):
        folder = self.package(self.root / "external")
        ctx = AppContext.create(self.workspace, autostart=False, seed_instance=False)
        try:
            remember_package(self.workspace, folder, digest(folder))
            target = self.workspace / "extensions_data/notes/items.json"
            target.parent.mkdir(parents=True)
            target.write_text('{"title":"Saved notes"}', encoding="utf-8")
            service = Backups(ctx)
            backup = service.export(BackupOptions())
            target.write_text('{"title":"Current notes"}', encoding="utf-8")
            plan = service.stage(service.download(backup.id))
            service.apply(
                plan.id,
                RestoreApply(
                    expected_head=plan.expected_head, expected_archive_sha256=plan.inspection.sha256
                ),
            )
        finally:
            ctx.close()
        restored = AppContext.create(self.workspace, autostart=False, seed_instance=False)
        try:
            self.assertEqual(json.loads(target.read_text(encoding="utf-8"))["title"], "Saved notes")
            self.assertNotIn("notes", restored.extensions.loaded)
            again = Backups(restored).export(BackupOptions())
            self.assertIn(
                "extensions_data/notes/items.json",
                {entry.path for entry in again.inspection.manifest.entries},
            )
        finally:
            restored.close()
