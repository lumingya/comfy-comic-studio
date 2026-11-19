"""Static CTK shares import validation, keeps sources untouched and reveals no private data."""

import io
import json
import subprocess
import sys
import tempfile
import unittest
import zipfile
from contextlib import redirect_stdout
from pathlib import Path
from unittest.mock import patch

from mio_server.auth import issue
from mio_server.backups.database import logical_head
from mio_server.extensions.ctk import check_package, diagnose_workspace, main
from mio_server.extensions.manifest import digest

from .api_harness import ApiCase
from .test_extensions import write_ext
from .test_theme_packages import THEME, archive, theme_files

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00\x00\x00\x00IDAT\x00\x00\x00\x00"
WALLPAPER_ID = "wallpaper_" + "a" * 32
PRIVATE_VALUE = "PRIVATE-CTK-TEST-CREDENTIAL"


def snapshot(folder):
    return {
        path.relative_to(folder).as_posix(): path.read_bytes()
        for path in folder.rglob("*")
        if path.is_file() and not path.name.endswith(".lease")
    }


def wallpaper(folder, *, payload=PNG, indexed=True):
    folder.mkdir(parents=True, exist_ok=True)
    (folder / f"{WALLPAPER_ID}.png").write_bytes(payload)
    if indexed:
        (folder / f"{WALLPAPER_ID}.json").write_text(
            json.dumps(
                {"id": WALLPAPER_ID, "filename": "private.png", "kind": "image", "suffix": "png"}
            ),
            encoding="utf-8",
        )


class PackageCTKTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name).resolve()

    def extension_zip(self):
        source = write_ext(
            self.root / "source", "demo", "raise AssertionError('main must not execute')"
        )
        manifest_path = source / "mio-extension.json"
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        manifest["backup"] = "backup.py"
        manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
        (source / "backup.py").write_text(
            "raise AssertionError('backup must not execute')", encoding="utf-8"
        )
        (source / "requirements.txt").write_text(
            "never-install-this-ctk-fixture>=1", encoding="utf-8"
        )
        package = self.root / "extension.zip"
        with zipfile.ZipFile(package, "w") as result:
            for name, value in snapshot(source).items():
                result.writestr(name, value)
        return source, package

    def test_extension_folder_and_zip_are_validated_without_executing_any_package_code(self):
        source, package = self.extension_zip()
        before = snapshot(self.root)
        from mio_server.extensions import ctk

        original = tempfile.TemporaryDirectory
        temporary_roots = []

        def temporary(*args, **kwargs):
            instance = original(*args, **kwargs)
            temporary_roots.append(Path(instance.name))
            return instance

        with (
            patch("mio_server.extensions.dependencies.subprocess.run") as pip,
            patch("mio_server.extensions.manager.ExtensionManager.enable") as enable,
            patch("mio_server.extensions.manager.ExtensionManager._run_main") as execute,
            patch.object(ctk.tempfile, "TemporaryDirectory", side_effect=temporary),
        ):
            for path in (source, package):
                report = check_package(path, "extension")
                self.assertTrue(report.valid, report)
                self.assertEqual(report.id, "demo")
            pip.assert_not_called()
            enable.assert_not_called()
            execute.assert_not_called()
        self.assertEqual(snapshot(self.root), before)
        self.assertTrue(temporary_roots)
        self.assertTrue(all(not folder.exists() for folder in temporary_roots))

    def test_theme_zip_uses_the_authoritative_import_validator_and_cleans_staging(self):
        package = self.root / "theme.zip"
        package.write_bytes(archive())
        before = package.read_bytes()
        with patch(
            "mio_server.extensions.ctk._extract_zip_to_folder",
            wraps=__import__(
                "mio_server.theme_packages", fromlist=["_extract_zip_to_folder"]
            )._extract_zip_to_folder,
        ) as validate:
            report = check_package(package, "theme")
        self.assertTrue(report.valid, report)
        validate.assert_called_once()
        self.assertEqual(package.read_bytes(), before)
        self.assertFalse(validate.call_args.args[1].exists())

    def test_invalid_archive_and_declarations_return_codes_without_exception_payloads(self):
        bad = self.root / "bad.zip"
        with zipfile.ZipFile(bad, "w") as package:
            package.writestr(f"../{PRIVATE_VALUE}", b"not allowed")
        for kind in ("extension", "theme"):
            report = check_package(bad, kind)
            self.assertFalse(report.valid)
            self.assertEqual(report.findings[0].code, "package.invalid")
            self.assertNotIn(PRIVATE_VALUE, report.model_dump_json())
            self.assertNotIn(str(self.root), report.model_dump_json())
        source, _ = self.extension_zip()
        (source / "requirements.txt").write_text(
            "--index-url https://user:secret@example.invalid", encoding="utf-8"
        )
        report = check_package(source, "extension")
        self.assertFalse(report.valid)
        self.assertNotIn("secret", report.model_dump_json())

    def test_filtered_card_rules_are_reported_for_partial_and_empty_card_styles(self):
        for css, filtered in (
            ('.theme-card[data-theme-id="self"] {color:red}', False),
            ('.theme-card[data-theme-id="self"] + .other {color:red}', True),
            (
                '.theme-card[data-theme-id="self"] {color:red} .theme-card[data-theme-id="someone-else"] {color:blue}',
                True,
            ),
            ('@media (max-width: 800px) {.theme-card[data-theme-id="self"] {color:red}}', True),
            ('body {--label:".theme-card";color:red}', False),
        ):
            with self.subTest(css=css):
                package = self.root / "theme.zip"
                package.write_bytes(
                    archive(
                        theme_files(
                            {**THEME, "style_file": "theme.css"},
                            resources={"theme.css": css.encode()},
                        )
                    )
                )
                report = check_package(package, "theme")
                self.assertTrue(report.valid, report)
                self.assertEqual(
                    "theme.card_css.filtered" in {item.code for item in report.findings}, filtered
                )

    def test_cli_emits_machine_readable_json_and_an_honest_exit_status(self):
        _, package = self.extension_zip()
        output = io.StringIO()
        with redirect_stdout(output):
            result = main([str(package)], kind="extension")
        report = json.loads(output.getvalue())
        self.assertEqual(result, 0)
        self.assertEqual(report["format_version"], 1)
        self.assertEqual(report["id"], "demo")
        self.assertTrue(report["limitations"])
        tool = Path(__file__).resolve().parents[2] / "tools/check_theme_package.py"
        broken = self.root / "broken.zip"
        broken.write_bytes(b"not a ZIP")
        completed = subprocess.run(
            [sys.executable, str(tool), str(broken)],
            capture_output=True,
            text=True,
            encoding="utf-8",
            check=False,
        )
        self.assertEqual(completed.returncode, 1, completed.stderr)
        self.assertFalse(json.loads(completed.stdout)["valid"])

    def test_extension_folder_rejects_link_and_reparse_entries_before_reading_them(self):
        import stat
        from types import SimpleNamespace

        source, _ = self.extension_zip()
        target = source / "main.py"
        original = Path.lstat
        for mode, attributes in (
            (stat.S_IFLNK, 0),
            (stat.S_IFREG, stat.FILE_ATTRIBUTE_REPARSE_POINT),
        ):
            with self.subTest(mode=mode):

                def redirected(path, *args, **kwargs):
                    if path == target:
                        return SimpleNamespace(st_mode=mode, st_file_attributes=attributes)
                    return original(path, *args, **kwargs)

                with patch.object(Path, "lstat", new=redirected):
                    report = check_package(source, "extension")
                self.assertFalse(report.valid)
                self.assertEqual(report.findings[0].code, "package.invalid")

    def test_workspace_digest_comparison_uses_the_effective_extension_source(self):
        installed = write_ext(self.root / "installed", "demo", "raise AssertionError('installed')")
        write_ext(self.root / "builtin", "demo", "raise AssertionError('builtin')")
        report = diagnose_workspace(
            self.root,
            extension_roots=[("installed", installed.parent), ("builtin", self.root / "builtin")],
            theme_roots=[],
            expected_digests={"demo": digest(installed)},
        )
        self.assertTrue(report.valid, report)
        self.assertNotIn("extension.digest.changed", {item.code for item in report.findings})


class PrivateDiagnosticsTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.workspace = Path(temporary.name).resolve()

    def preferences(self, area, identifier, value):
        path = self.workspace / area / identifier / "preferences.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(value), encoding="utf-8")
        return path

    def diagnose(self):
        return diagnose_workspace(self.workspace, extension_roots=[], theme_roots=[])

    def test_legacy_fallback_shadow_and_conflict_are_reported_without_read_side_effects(self):
        self.preferences("extension_data", "fallback", {"token": PRIVATE_VALUE})
        for identifier, canonical, legacy in (
            ("shadow", {"x": 1}, {"x": 1}),
            ("conflict", {"x": PRIVATE_VALUE}, {"x": 2}),
            ("typed-conflict", {"x": 1}, {"x": True}),
        ):
            self.preferences("extensions_data", identifier, canonical)
            self.preferences("extension_data", identifier, legacy)
        before = snapshot(self.workspace)
        report = self.diagnose()
        codes = {(item.id, item.code) for item in report.findings}
        self.assertIn(("fallback", "private.legacy.fallback"), codes)
        self.assertIn(("shadow", "private.legacy.shadow"), codes)
        self.assertIn(("conflict", "private.legacy.conflict"), codes)
        self.assertIn(("typed-conflict", "private.legacy.conflict"), codes)
        self.assertTrue(report.valid)
        self.assertNotIn(PRIVATE_VALUE, report.model_dump_json())
        self.assertEqual(snapshot(self.workspace), before)

    def test_wallpaper_orphans_bad_metadata_and_differing_legacy_media_are_left_untouched(self):
        canonical = self.workspace / "theme_data/paper/wallpapers"
        legacy = self.workspace / "themes/paper/user_wallpapers"
        wallpaper(canonical)
        wallpaper(legacy, payload=PNG + b"different")
        orphan = self.workspace / "theme_data/orphan-theme/wallpapers"
        wallpaper(orphan, indexed=False)
        bad = self.workspace / "theme_data/bad-theme/wallpapers"
        wallpaper(bad)
        (bad / f"{WALLPAPER_ID}.json").write_text(
            '{"unsafe":"' + PRIVATE_VALUE + '"}', encoding="utf-8"
        )
        before = snapshot(self.workspace)
        report = self.diagnose()
        codes = {(item.id, item.code) for item in report.findings}
        self.assertIn(("paper", "private.legacy.conflict"), codes)
        self.assertIn(("orphan-theme", "private.wallpaper.orphan"), codes)
        self.assertIn(("bad-theme", "private.wallpaper.invalid"), codes)
        self.assertFalse(report.valid)
        self.assertNotIn(PRIVATE_VALUE, report.model_dump_json())
        self.assertEqual(snapshot(self.workspace), before)

    def test_invalid_private_json_and_redirected_paths_return_sanitized_findings(self):
        import stat
        from types import SimpleNamespace

        path = self.preferences("theme_data", "paper", {"safe": True})
        path.write_text('{"duplicate":1,"duplicate":2}', encoding="utf-8")
        report = self.diagnose()
        self.assertIn("private.preferences.invalid", {item.code for item in report.findings})
        original = Path.lstat
        target = self.workspace / "theme_data"

        def redirected(path, *args, **kwargs):
            if path == target:
                return SimpleNamespace(
                    st_mode=stat.S_IFDIR, st_file_attributes=stat.FILE_ATTRIBUTE_REPARSE_POINT
                )
            return original(path, *args, **kwargs)

        with patch.object(Path, "lstat", new=redirected):
            report = self.diagnose()
        self.assertIn("private.path.invalid", {item.code for item in report.findings})


class DiagnosticApiTests(ApiCase):
    def test_admin_diagnostic_uses_the_same_readonly_contract_without_executing_package_code(self):
        folder = write_ext(
            self.ctx.extensions.root, "demo", "raise AssertionError('must not execute')"
        )
        reviewed = digest(folder)
        from mio_server.settings import ExtensionState

        settings = self.ctx.settings()
        settings.extensions["demo"] = ExtensionState(enabled=False, digest=reviewed)
        self.ctx.store.put_doc(settings)
        (folder / "main.py").write_text(
            "raise AssertionError('changed package must not execute')", encoding="utf-8"
        )
        private = self.ctx.data_dir / "extension_data/demo/preferences.json"
        private.parent.mkdir(parents=True)
        private.write_text(json.dumps({"api_key": PRIVATE_VALUE}), encoding="utf-8")
        before = {
            area: snapshot(self.ctx.data_dir / area)
            for area in ("extensions", "extension_data", "extensions_data", "theme_data")
        }
        database_head = logical_head(self.ctx.store._conn, self.ctx.engine.db)
        local = self.client.get("/api/extensions/diagnostics")
        self.assertEqual(local.status_code, 200, local.text)
        codes = {item["code"] for item in local.json()["findings"]}
        self.assertIn("extension.digest.changed", codes)
        self.assertIn("private.legacy.fallback", codes)
        self.assertNotIn(PRIVATE_VALUE, local.text)
        self.assertEqual(self.ctx.extensions.loaded, {})
        self.assertEqual({area: snapshot(self.ctx.data_dir / area) for area in before}, before)
        # SQLite reads can update SHM reader marks; compare persisted logical data instead.
        self.assertEqual(logical_head(self.ctx.store._conn, self.ctx.engine.db), database_head)
        url = "/api/v2/extensions/diagnostics"
        self.assertEqual(self.client.get(url).status_code, 401)
        for scope in ("read", "write", "render", "admin"):
            token, plain = issue(scope, [scope])
            self.ctx.store.put_doc(token)
            response = self.client.get(url, headers={"Authorization": f"Bearer {plain}"})
            self.assertEqual(response.status_code, 200 if scope == "admin" else 403, response.text)
            if scope == "admin":
                self.assertEqual(response.json(), local.json())
        schema = self.client.get("/api/v2/openapi.json").json()
        self.assertIn("/extensions/diagnostics", schema["paths"])
