"""Release selection and signed upgrade/downgrade, without contacting external services."""

from __future__ import annotations

import threading
import unittest
from unittest.mock import patch

import httpx

from mio_server.update import UpdateError, Updater
from mio_server.update.updater import UpdateRecoveryError

from . import test_update as fixture
from .api_harness import ApiCase

TRUSTED = fixture.TRUSTED
manifest_for = fixture.manifest_for
release_zip = fixture.release_zip


def github_release(version="4.1.0", *, signed=True, preview=False):
    tag = f"v{version}"
    return {
        "tag_name": tag,
        "name": f"Mio {tag}",
        "prerelease": preview,
        "body": "修复滚动与排版\n\n- 新增工具",
        "assets": [
            {
                "name": "mio-release.json",
                "browser_download_url": f"https://github.com/lumingya/comfy-comic-studio/releases/download/{tag}/mio-release.json",
            }
        ]
        if signed
        else [],
    }


class ReleaseCatalogTests(unittest.TestCase):
    setUp = fixture.UpdaterTests.setUp

    def updater_for_catalog(self, versions=("4.1.0", "3.9.0")):
        # Manifest and download must describe the same bytes, including ZIP timestamps.
        archives = {version: release_zip(version) for version in versions}

        def handler(request):
            path = request.url.path
            if path.endswith("/releases"):
                return httpx.Response(200, json=[github_release(v) for v in versions])
            if "/tags/" in path:
                return httpx.Response(
                    200, json=github_release(path.rsplit("/", 1)[1].removeprefix("v"))
                )
            if path.endswith("mio-release.json"):
                version = path.split("/")[-2].removeprefix("v")
                return httpx.Response(200, content=manifest_for(archives[version], version))
            for version in versions:
                if path.endswith(f"mio-studio-{version}.zip"):
                    return httpx.Response(200, content=archives[version])
            return httpx.Response(404)

        return Updater(
            self.data,
            self.root,
            current="4.0.0",
            keys=TRUSTED,
            transport=httpx.MockTransport(handler),
        )

    def wait(self, updater):
        updater._worker.join(timeout=5)
        self.assertFalse(updater._worker.is_alive())

    def test_catalog_pagination_and_unsigned_versions_remain_visible(self):
        up = self.updater_for_catalog()
        requests = []

        def respond(request):
            requests.append(request.url)
            return httpx.Response(
                200, json=[github_release(signed=False)], headers={"link": '<next>; rel="next"'}
            )

        up.transport = httpx.MockTransport(respond)
        page = up.releases(2, 12)
        self.assertEqual(requests[0].params["page"], "2")
        self.assertEqual(page["page"], 2)
        self.assertTrue(page["has_more"])
        self.assertFalse(page["items"][0]["installable"])
        self.assertIn("签名", page["items"][0]["unavailable_reason"])

    def test_empty_catalog_and_startup_preferences(self):
        up = self.updater_for_catalog(())
        self.assertIsNone(up.check()["latest"])
        self.assertFalse(up.last_check["available"])
        up.preferences(False)
        reloaded = Updater(self.data, self.root, keys=TRUSTED, transport=up.transport)
        self.assertFalse(reloaded.auto_check)
        self.assertEqual(reloaded.last_check, up.last_check)
        reloaded.startup_check()
        self.assertIsNone(reloaded._worker)

    def test_startup_is_nonblocking_and_only_checks_once(self):
        up = self.updater_for_catalog()
        release = threading.Event()
        entered = threading.Event()
        original = up.check

        def check(feed):
            entered.set()
            release.wait(3)
            return original(feed)

        with patch.object(up, "check", side_effect=check) as method:
            up.startup_check()
            self.assertTrue(entered.wait(1))
            up.startup_check()
            with self.assertRaisesRegex(UpdateError, "正在进行"):
                up.start_check()
            with self.assertRaisesRegex(UpdateError, "正在进行"):
                original()
            release.set()
            self.wait(up)
            self.assertEqual(method.call_count, 1)
            self.assertTrue(up.last_check["available"])

    def test_select_upgrade_then_downgrade(self):
        up = self.updater_for_catalog()
        for version in ("4.1.0", "3.9.0"):
            up.install(f"v{version}")
            self.wait(up)
            self.assertEqual(up.activity["phase"], "ready", up.activity)
            self.assertEqual(up.pending()["version"], version)
            up.apply_pending()
            self.assertIn(
                version, (self.root / "server/mio_server/__init__.py").read_text(encoding="utf-8")
            )
            self.assertTrue((self.root / "server/data/runtime/keep.db").is_file())
            self.assertTrue((self.root / "data/layouts/mine.json").is_file())

    def test_signed_manifest_must_match_selected_tag(self):
        up = self.updater_for_catalog()
        original = up._fetch_manifest
        with patch.object(
            up,
            "_fetch_manifest",
            side_effect=lambda http, url: original(http, url.replace("v3.9.0", "v4.1.0")),
        ):
            up.install("v3.9.0")
            self.wait(up)
        self.assertEqual(up.activity["phase"], "failed")
        self.assertIn("不一致", up.activity["error"])
        self.assertIsNone(up.pending())

    def test_no_keys_or_dev_checkout_cannot_start_install(self):
        up = self.updater_for_catalog()
        up.keys = {}
        with self.assertRaisesRegex(UpdateError, "公钥"):
            up.install("v4.1.0")
        up.keys = TRUSTED
        (self.root / ".git").mkdir()
        with self.assertRaisesRegex(UpdateError, "开发目录"):
            up.install("v4.1.0")

    def test_cancel_staged_version_keeps_current_program(self):
        up = self.updater_for_catalog()
        up.install("v4.1.0")
        self.wait(up)
        up.cancel_pending()
        self.assertIsNone(up.pending())
        self.assertIn(
            "4.0.0", (self.root / "server/mio_server/__init__.py").read_text(encoding="utf-8")
        )
        self.assertFalse((up.dir / "staged").exists())

    def test_apply_rechecks_archive_and_ignores_untrusted_staged_files(self):
        up = self.updater_for_catalog()
        up.install("v4.1.0")
        self.wait(up)
        staged = up.dir / "staged/4.1.0/mio-studio-4.1.0/server/mio_server/__init__.py"
        staged.write_text("tampered", encoding="utf-8")
        up.apply_pending()
        self.assertNotIn(
            "tampered", (self.root / "server/mio_server/__init__.py").read_text(encoding="utf-8")
        )
        up.install("v3.9.0")
        self.wait(up)
        (up.dir / "mio-studio-3.9.0.zip").write_bytes(b"tampered")
        with self.assertRaisesRegex(UpdateError, "校验失败"):
            up.apply_pending()
        self.assertIn(
            "4.1.0", (self.root / "server/mio_server/__init__.py").read_text(encoding="utf-8")
        )

    def test_failed_dependency_setup_restores_program_and_previous_dependencies(self):
        up = self.updater_for_catalog()
        up.install("v4.1.0")
        self.wait(up)
        calls = []

        def validate():
            source = (self.root / "server/mio_server/__init__.py").read_text(encoding="utf-8")
            calls.append(source)
            if "4.1.0" in source:
                raise RuntimeError("installation failed")

        with self.assertRaisesRegex(RuntimeError, "installation failed"):
            up.apply_pending(validate)
        self.assertEqual(len(calls), 2)
        self.assertIn("4.0.0", calls[-1])
        self.assertTrue((self.root / "server/mio_server/stale.py").exists())
        self.assertTrue((self.root / "server/data/runtime/keep.db").is_file())

    def test_failed_dependency_recovery_must_block_launcher(self):
        up = self.updater_for_catalog()
        up.install("v4.1.0")
        self.wait(up)

        def fail():
            raise RuntimeError("no dependencies")

        with self.assertRaises(UpdateRecoveryError):
            up.apply_pending(fail)

    def test_rate_limit_is_actionable_and_does_not_clear_last_result(self):
        up = self.updater_for_catalog()
        up.check()
        original = up.last_check
        up.transport = httpx.MockTransport(lambda request: httpx.Response(403))
        up.start_check()
        self.wait(up)
        self.assertIn("稍后重试", up.activity["error"])
        self.assertEqual(up.last_check, original)


class CatalogApiTests(ApiCase):
    def test_catalog_preferences_and_invalid_install_inputs(self):
        self.ctx.updater.transport = httpx.MockTransport(
            lambda request: httpx.Response(200, json=[])
        )
        self.assertEqual(self.ok(self.client.get("/api/update/releases"))["items"], [])
        self.assertEqual(self.client.get("/api/update/releases?page=0").status_code, 422)
        self.assertFalse(
            self.ok(self.client.patch("/api/update/preferences", json={"auto_check": False}))[
                "auto_check"
            ]
        )
        self.assertEqual(
            self.client.patch("/api/update/preferences", json={"auto_check": "false"}).status_code,
            422,
        )
        self.assertEqual(self.client.post("/api/update/install", json={"tag": ""}).status_code, 422)
        self.assertFalse(self.ok(self.client.post("/api/update/check"))["last_check"]["available"])


if __name__ == "__main__":
    unittest.main()
