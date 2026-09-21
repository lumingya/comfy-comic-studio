"""Version comparison, release selection and the in-place update engine.

The engine is exercised against a real package ZIP built in a temporary
program directory, so the data-protection rules are verified on disk:
workspace files are never rewritten, catalog text is refreshed, every
replaced program file is backed up, and rollback restores the old version.
"""
import hashlib
import io
import json
import os
import sys
import tempfile
import unittest
import urllib.error
import zipfile
from contextlib import contextmanager
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from backend import mio_update  # noqa: E402


def compare(a, b):
    return mio_update.compare_versions(a, b)


class VersionTests(unittest.TestCase):
    def test_semver_ordering(self):
        self.assertEqual(compare("3.2.0", "3.2.0-dev.1"), 1)
        self.assertEqual(compare("3.2.0-dev.1", "3.2.0"), -1)
        self.assertEqual(compare("v3.2.0", "3.2.0"), 0)
        self.assertEqual(compare("3.2.0-dev.2", "3.2.0-dev.1"), 1)
        self.assertEqual(compare("3.2.0-dev.10", "3.2.0-dev.9"), 1)
        self.assertEqual(compare("3.2.0-beta", "3.2.0-alpha"), 1)
        self.assertEqual(compare("3.2.0-rc.1", "3.2.0-rc"), 1)
        self.assertEqual(compare("3.10.0", "3.9.9"), 1)
        self.assertEqual(compare("4.0.0", "3.99.99"), 1)
        self.assertEqual(compare("3.2.0+build.5", "3.2.0"), 0)
        self.assertEqual(compare("garbage", "0.0.1"), -1)
        self.assertEqual(compare("garbage", "nonsense"), 0)

    def test_prerelease_detection(self):
        self.assertTrue(mio_update.is_prerelease("3.2.0-dev.1"))
        self.assertFalse(mio_update.is_prerelease("3.2.0"))
        self.assertFalse(mio_update.is_prerelease("v3.2.1"))


def release(tag, prerelease=False, draft=False, asset=True, checksum=True, digest=None):
    assets = []
    version = tag.lstrip("v")
    if asset:
        item = {"name": f"mio-{version}-source.zip", "size": 1234, "browser_download_url": f"https://example.invalid/{tag}/mio-{version}-source.zip"}
        if digest:
            item["digest"] = digest
        assets.append(item)
    if checksum:
        assets.append({"name": f"mio-{version}-source.zip.sha256", "browser_download_url": f"https://example.invalid/{tag}/mio-{version}-source.zip.sha256"})
    return {"tag_name": tag, "name": "Mio " + tag, "prerelease": prerelease, "draft": draft, "body": "notes", "html_url": "https://example.invalid/" + tag, "published_at": "2026-09-20T00:00:00Z", "assets": assets}


class ReleaseSelectionTests(unittest.TestCase):
    def test_prefers_highest_version_and_respects_prerelease_flag(self):
        releases = [release("v3.1.0"), release("v3.3.0-rc.1", prerelease=True), release("v3.2.0"), release("v9.9.9", draft=True), {"tag_name": "nightly", "assets": []}]
        self.assertEqual(mio_update.select_release(releases, False)["tag_name"], "v3.2.0")
        self.assertEqual(mio_update.select_release(releases, True)["tag_name"], "v3.3.0-rc.1")
        self.assertIsNone(mio_update.select_release([release("v1.0.0", draft=True)], True))

    def test_check_reports_update_and_blockers(self):
        with tempfile.TemporaryDirectory() as folder:
            base = Path(folder)
            (base / "package.json").write_text(json.dumps({"version": "3.2.0-dev.1"}), "utf-8")
            (base / "server.py").write_text("# stub", "utf-8")
            data = base / "data"
            data.mkdir()
            result = mio_update.check_for_update(base, data, fetch=lambda url: [release("v3.2.0"), release("v3.2.1-dev.1", prerelease=True)])
            self.assertEqual(result["current"], "3.2.0-dev.1")
            self.assertTrue(result["includePrerelease"], "a dev build opts into pre-releases by default")
            self.assertEqual(result["latest"]["version"], "3.2.1-dev.1")
            self.assertTrue(result["updateAvailable"])
            self.assertTrue(result["canApply"])
            stable = mio_update.check_for_update(base, data, include_prerelease=False, fetch=lambda url: [release("v3.2.0"), release("v3.2.1-dev.1", prerelease=True)])
            self.assertEqual(stable["latest"]["version"], "3.2.0")
            current = mio_update.check_for_update(base, data, fetch=lambda url: [release("v3.2.0-dev.1")])
            self.assertFalse(current["updateAvailable"])
            self.assertFalse(current["canApply"])
            missing = mio_update.check_for_update(base, data, fetch=lambda url: [release("v3.5.0", asset=False)])
            self.assertTrue(missing["updateAvailable"])
            self.assertFalse(missing["canApply"])
            self.assertTrue(any("手动下载" in text for text in missing["blockers"]))
            unverifiable = mio_update.check_for_update(base, data, fetch=lambda url: [release("v3.5.0", checksum=False)])
            self.assertFalse(unverifiable["canApply"])
            digest_ok = mio_update.check_for_update(base, data, fetch=lambda url: [release("v3.5.0", checksum=False, digest="sha256:" + "a" * 64)])
            self.assertTrue(digest_ok["canApply"])
            empty = mio_update.check_for_update(base, data, fetch=lambda url: [])
            self.assertIsNone(empty["latest"])
            self.assertFalse(empty["updateAvailable"])

    def test_network_errors_become_readable_messages(self):
        limited = urllib.error.HTTPError("u", 403, "rate limited", {"X-RateLimit-Remaining": "0"}, io.BytesIO())
        self.assertEqual(mio_update._network_error(limited).status, 429)
        self.assertEqual(mio_update._network_error(urllib.error.HTTPError("u", 404, "nf", {}, io.BytesIO())).status, 404)
        self.assertEqual(mio_update._network_error(urllib.error.URLError("dns")).status, 503)


def write_tree(root, files):
    for rel, content in files.items():
        path = Path(root, *rel.split("/"))
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content.encode("utf-8") if isinstance(content, str) else content)


def build_package(target, version, files):
    """Mirror tools/package_project.py: single root folder + PACKAGE_MANIFEST.json with sha256 per file."""
    name = f"mio-{version}-source"
    manifest = {"name": "Mio", "version": version, "files": {rel: hashlib.sha256(body.encode("utf-8")).hexdigest() for rel, body in files.items()}}
    with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as archive:
        for rel, body in files.items():
            archive.writestr(name + "/" + rel, body)
        archive.writestr(name + "/PACKAGE_MANIFEST.json", json.dumps(manifest))
    return manifest


NEW_FILES = {
    "server.py": "print('new server')\n",
    "package.json": json.dumps({"version": "3.3.0"}),
    "js/app.js": "// new app\n",
    "js/context-menu.js": "// brand new module\n",
    "start.sh": "#!/bin/sh\necho new\n",
    "data/distribution.json": json.dumps({"schema": "mio.distribution.v1", "version": "3.3.0", "files": {}}),
    "data/catalog/captions.json": json.dumps({"hello": "new caption"}),
    "data/settings/workspace.json": json.dumps({"shipped": "new default"}),
    "data/storyboards/demo.json": json.dumps({"title": "new demo"}),
}


class InstallEngineTests(unittest.TestCase):
    @contextmanager
    def program(self, data_inside=True, previous_manifest=True):
        with tempfile.TemporaryDirectory() as folder:
            base = Path(folder) / "mio"
            base.mkdir()
            old_files = {
                "server.py": "print('old server')\n",
                "package.json": json.dumps({"version": "3.2.0"}),
                "js/app.js": "// old app\n",
                "js/legacy.js": "// removed upstream\n",
                "start.sh": "#!/bin/sh\necho old\n",
                "data/distribution.json": json.dumps({"schema": "mio.distribution.v1", "version": "3.2.0", "files": {}}),
                "data/catalog/captions.json": json.dumps({"hello": "old caption"}),
                "data/settings/workspace.json": json.dumps({"identity": "USER EDITED"}),
                "data/storyboards/demo.json": json.dumps({"title": "user changed demo"}),
                "data/albums/mine/album.json": json.dumps({"title": "my album"}),
                "secrets.json": "{\"token\": \"private\"}",
            }
            write_tree(base, old_files)
            os.chmod(base / "start.sh", 0o755)
            if previous_manifest:
                (base / "PACKAGE_MANIFEST.json").write_text(json.dumps({"version": "3.2.0", "files": {rel: "x" for rel in old_files if not rel.startswith("secrets")}}), "utf-8")
            if data_inside:
                data_dir = base / "data"
                (data_dir / "runtime").mkdir(parents=True)
                (data_dir / "runtime" / "content-installed.json").write_text("{}", "utf-8")
            else:
                data_dir = Path(folder) / "workspace"
                data_dir.mkdir()
            archive = Path(folder) / "mio-3.3.0-source.zip"
            build_package(archive, "3.3.0", NEW_FILES)
            yield base, data_dir, archive

    def test_apply_replaces_program_files_only_and_rollback_restores(self):
        with self.program() as (base, data_dir, archive):
            root, manifest = mio_update.safe_extract(archive, base / mio_update.UPDATE_DIR / "stage")
            old_manifest = json.loads((base / "PACKAGE_MANIFEST.json").read_text("utf-8"))
            plan = mio_update.plan_install(base, data_dir, manifest, old_manifest)
            self.assertEqual(plan["policy"], "catalog")
            self.assertIn("data/catalog/captions.json", plan["writes"])
            self.assertIn("data/distribution.json", plan["writes"])
            self.assertNotIn("data/settings/workspace.json", plan["writes"])
            self.assertNotIn("data/storyboards/demo.json", plan["writes"])
            self.assertEqual(plan["removals"], ["js/legacy.js"])
            backup = base / mio_update.UPDATE_DIR / "backup-test"
            record = mio_update.apply_plan(base, root, plan, backup, manifest, "3.2.0", "3.3.0")
            self.assertEqual((base / "server.py").read_text("utf-8"), "print('new server')\n")
            self.assertEqual((base / "js/context-menu.js").read_text("utf-8"), "// brand new module\n")
            self.assertFalse((base / "js/legacy.js").exists())
            self.assertEqual(json.loads((base / "data/catalog/captions.json").read_text("utf-8"))["hello"], "new caption")
            self.assertEqual(json.loads((base / "data/settings/workspace.json").read_text("utf-8"))["identity"], "USER EDITED")
            self.assertEqual(json.loads((base / "data/storyboards/demo.json").read_text("utf-8"))["title"], "user changed demo")
            self.assertTrue((base / "data/albums/mine/album.json").exists())
            self.assertEqual((base / "secrets.json").read_text("utf-8"), "{\"token\": \"private\"}")
            self.assertTrue(os.access(base / "start.sh", os.X_OK), "executable bit survives replacement")
            self.assertEqual(mio_update.current_version(base), "3.3.0")
            self.assertEqual(sorted(record["removed"]), ["js/legacy.js"])
            self.assertIn("js/context-menu.js", record["added"])
            self.assertEqual((backup / "js/legacy.js").read_text("utf-8"), "// removed upstream\n")
            self.assertEqual((backup / "server.py").read_text("utf-8"), "print('old server')\n")
            mio_update.rollback(base, backup)
            self.assertEqual((base / "server.py").read_text("utf-8"), "print('old server')\n")
            self.assertTrue((base / "js/legacy.js").exists())
            self.assertFalse((base / "js/context-menu.js").exists())
            self.assertEqual(mio_update.current_version(base), "3.2.0")
            self.assertEqual(json.loads((base / "PACKAGE_MANIFEST.json").read_text("utf-8"))["version"], "3.2.0")

    def test_pristine_shipped_data_is_refreshed_for_external_workspaces(self):
        with self.program(data_inside=False) as (base, data_dir, archive):
            root, manifest = mio_update.safe_extract(archive, base / mio_update.UPDATE_DIR / "stage")
            plan = mio_update.plan_install(base, data_dir, manifest, None)
            self.assertEqual(plan["policy"], "refresh")
            self.assertIn("data/settings/workspace.json", plan["writes"])
            self.assertEqual(plan["removals"], [], "no previous manifest means nothing is deleted")
            mio_update.apply_plan(base, root, plan, base / mio_update.UPDATE_DIR / "backup-x", manifest, "3.2.0", "3.3.0")
            self.assertEqual(json.loads((base / "data/settings/workspace.json").read_text("utf-8"))["shipped"], "new default")
            self.assertTrue((base / "js/legacy.js").exists())
            self.assertTrue((base / "data/albums/mine/album.json").exists(), "files outside the manifest are never removed")

    def test_zip_slip_and_tampering_are_rejected(self):
        with tempfile.TemporaryDirectory() as folder:
            evil = Path(folder) / "evil.zip"
            with zipfile.ZipFile(evil, "w") as archive:
                archive.writestr("mio-1-source/server.py", "x")
                archive.writestr("mio-1-source/../escape.txt", "x")
            with self.assertRaises(mio_update.UpdateError):
                mio_update.safe_extract(evil, Path(folder) / "stage")
            signed = Path(folder) / "signed.zip"
            build_package(signed, "1.0.0", {"server.py": "ok", "js/app.js": "ok"})
            tampered = Path(folder) / "tampered.zip"
            with zipfile.ZipFile(signed) as source, zipfile.ZipFile(tampered, "w") as archive:
                for info in source.infolist():
                    body = source.read(info)
                    archive.writestr(info.filename, b"modified after signing" if info.filename.endswith("js/app.js") else body)
            with self.assertRaises(mio_update.UpdateError):
                mio_update.safe_extract(tampered, Path(folder) / "stage2")
            two_roots = Path(folder) / "two.zip"
            with zipfile.ZipFile(two_roots, "w") as archive:
                archive.writestr("a/server.py", "x")
                archive.writestr("b/server.py", "x")
            with self.assertRaises(mio_update.UpdateError):
                mio_update.safe_extract(two_roots, Path(folder) / "stage3")

    def test_service_refuses_apply_without_matching_check(self):
        with self.program() as (base, data_dir, archive):
            svc = mio_update.UpdateService(base, data_dir)
            with self.assertRaises(mio_update.UpdateError):
                svc.start("3.3.0")
            svc.last_check = mio_update.check_for_update(base, data_dir, fetch=lambda url: [release("v3.3.0")])
            with self.assertRaises(mio_update.UpdateError):
                svc.start("9.9.9")
            status = svc.status()
            self.assertEqual(status["current"], "3.2.0")
            self.assertEqual(status["install"]["kind"], "package")
            self.assertTrue(status["install"]["canApply"])

    def test_checksum_sources(self):
        good = "b" * 64

        @contextmanager
        def opener(url, timeout=0, accept=""):
            yield io.BytesIO((good + "  mio-1-source.zip\n").encode("utf-8"))

        self.assertEqual(mio_update.expected_checksum({"checksumUrl": "https://x/y.sha256", "asset": {}}, opener=opener), good)
        self.assertEqual(mio_update.expected_checksum({"checksumUrl": None, "asset": {"digest": "sha256:" + good}}), good)
        with self.assertRaises(mio_update.UpdateError):
            mio_update.expected_checksum({"checksumUrl": None, "asset": {}})


if __name__ == "__main__":
    unittest.main()
