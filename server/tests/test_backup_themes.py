"""Independent inert theme packages participate in backup integrity and restart recovery."""

import json
import tempfile
import unittest
from pathlib import Path

from mio_server.backups import Backups
from mio_server.backups.archive import inspect_archive
from mio_server.backups.models import BackupOptions, RestoreApply
from mio_server.context import AppContext
from mio_server.theme_packages import package_theme
from mio_server.themes import parse_theme


class BackupThemesTests(unittest.TestCase):
    def test_theme_folder_survives_backup_and_real_restart_restore(self):
        with tempfile.TemporaryDirectory() as directory:
            workspace = Path(directory).resolve() / "workspace"
            ctx = AppContext.create(workspace, autostart=False, seed_instance=False)
            try:
                theme = parse_theme(
                    {"id": "forest", "name": "Forest", "mode": "dark", "tokens": {"bg": "#10201a"}}
                )
                identifier, data = package_theme(theme)
                before = Backups(ctx).head().head
                ctx.theme_packages.install_package(data)
                service = Backups(ctx)
                self.assertNotEqual(service.head().head, before)
                backup = service.export(BackupOptions())
                paths = {entry.path for entry in backup.inspection.manifest.entries}
                self.assertTrue(
                    {f"themes/{identifier}/mio-theme.json", f"themes/{identifier}/theme.json"}
                    <= paths
                )
                ctx.theme_packages.remove(identifier)
                plan = service.stage(service.download(backup.id))
                service.apply(
                    plan.id,
                    RestoreApply(
                        expected_head=plan.expected_head,
                        expected_archive_sha256=plan.inspection.sha256,
                    ),
                )
            finally:
                ctx.close()
            restored = AppContext.create(workspace, autostart=False, seed_instance=False)
            try:
                folder = workspace / "themes" / identifier
                self.assertEqual(json.loads((folder / "theme.json").read_bytes())["name"], "Forest")
                self.assertTrue(
                    any(item.id == identifier for item in restored.registry.all("theme"))
                )
            finally:
                restored.close()

    def test_theme_backup_rejects_unrecognized_package_files(self):
        with tempfile.TemporaryDirectory() as directory:
            ctx = AppContext.create(directory, autostart=False, seed_instance=False)
            try:
                theme = parse_theme(
                    {"id": "forest", "name": "Forest", "mode": "light", "tokens": {"bg": "#ffffff"}}
                )
                identifier, data = package_theme(theme)
                ctx.theme_packages.install_package(data)
                (ctx.data_dir / "themes" / identifier / "execute.py").write_text(
                    "pass", encoding="utf-8"
                )
                with self.assertRaises(ValueError):
                    Backups(ctx).export(BackupOptions())
            finally:
                ctx.close()

    def test_theme_media_files_are_included_and_restored_without_loading_them_into_memory(self):
        with tempfile.TemporaryDirectory() as directory:
            workspace = Path(directory).resolve() / "workspace"
            ctx = AppContext.create(workspace, autostart=False, seed_instance=False)
            try:
                theme = parse_theme(
                    {
                        "id": "moving-wallpaper",
                        "name": "Moving wallpaper",
                        "mode": "dark",
                        "background": {
                            "kind": "video",
                            "file": "assets/backgrounds/wallpaper.mp4",
                            "opacity": 0.25,
                        },
                    }
                )
                video = b"\x00\x00\x00\x18ftypisom" + b"backup-video-fixture"
                identifier, package = package_theme(
                    theme, {"assets/backgrounds/wallpaper.mp4": video}
                )
                ctx.theme_packages.install_package(package)
                service = Backups(ctx)
                backup = service.export(BackupOptions())
                paths = {entry.path for entry in backup.inspection.manifest.entries}
                self.assertIn(f"themes/{identifier}/assets/backgrounds/wallpaper.mp4", paths)
                with tempfile.TemporaryDirectory() as staging:
                    destination = Path(staging)
                    inspection = inspect_archive(
                        service.download(backup.id),
                        destination,
                        trusted_workspace=workspace,
                    )
                    restored = destination / f"themes/{identifier}/assets/backgrounds/wallpaper.mp4"
                    self.assertTrue(
                        any(
                            entry.path == restored.relative_to(destination).as_posix()
                            for entry in inspection.manifest.entries
                        )
                    )
                    self.assertEqual(restored.read_bytes(), video)
            finally:
                ctx.close()
