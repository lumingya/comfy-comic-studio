"""P5: Ed25519, signed release manifests, the updater and the release builder."""

from __future__ import annotations

import hashlib
import importlib.util
import io
import json
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

import httpx

from mio_server.update import (
    UpdateError,
    Updater,
    ed25519,
    parse_version,
    sign_manifest,
    verify_manifest,
)
from mio_server.update.manifest import key_id

from .api_harness import ApiCase
from .release_fixture import write_release_seed

ROOT = Path(__file__).resolve().parents[2]
# RFC 8032 §7.1, test 1
SK = bytes.fromhex("9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60")
PK = "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a"
SIG = (
    "e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b4"
    "6bd25bf5f0595bbe24655141438e7a100b"
)
TRUSTED = {key_id(PK): PK}


class Ed25519Tests(unittest.TestCase):
    def test_rfc8032_vector(self):
        self.assertEqual(ed25519.public_key(SK).hex(), PK)
        self.assertEqual(ed25519.sign(SK, b"").hex(), SIG)
        self.assertTrue(ed25519.verify(bytes.fromhex(PK), b"", bytes.fromhex(SIG)))
        self.assertFalse(ed25519.verify(bytes.fromhex(PK), b"x", bytes.fromhex(SIG)))
        bad = bytearray.fromhex(SIG)
        bad[5] ^= 1
        self.assertFalse(ed25519.verify(bytes.fromhex(PK), b"", bytes(bad)))

    def test_generated_pair_round_trip(self):
        secret, public = ed25519.generate()
        sig = ed25519.sign(secret, "发布 4.0.0".encode())
        self.assertTrue(ed25519.verify(public, "发布 4.0.0".encode(), sig))


def release_zip(version="4.1.0") -> bytes:
    buf = io.BytesIO()
    top = f"mio-studio-{version}"
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr(f"{top}/server/mio_server/__init__.py", f'__version__ = "{version}"\n')
        zf.writestr(f"{top}/server/requirements.txt", "fastapi\n")
        zf.writestr(f"{top}/web/dist/index.html", "<html>new</html>")
        zf.writestr(f"{top}/start.sh", "#!/bin/sh\n")
    return buf.getvalue()


def manifest_for(data: bytes, version="4.1.0", secret=SK) -> bytes:
    body = {
        "version": version,
        "notes": "新版本",
        "package": {
            "name": f"mio-studio-{version}.zip",
            "url": f"https://example.test/mio-studio-{version}.zip",
            "sha256": hashlib.sha256(data).hexdigest(),
            "size": len(data),
        },
    }
    return json.dumps(sign_manifest(body, secret)).encode()


class ManifestTests(unittest.TestCase):
    def test_verify(self):
        raw = manifest_for(b"zip")
        self.assertEqual(verify_manifest(raw, TRUSTED).version, "4.1.0")
        with self.assertRaisesRegex(UpdateError, "没有内置发布公钥"):
            verify_manifest(raw, {})
        other, _ = ed25519.generate()
        with self.assertRaisesRegex(UpdateError, "未受信任"):
            verify_manifest(manifest_for(b"zip", secret=other), TRUSTED)
        tampered = json.loads(raw)
        tampered["package"]["url"] = "https://evil.test/x.zip"
        with self.assertRaisesRegex(UpdateError, "签名无效"):
            verify_manifest(json.dumps(tampered).encode(), TRUSTED)

    def test_version_order(self):
        order = ["3.9.9", "4.0.0-beta.1", "4.0.0", "4.0.1", "4.10.0"]
        self.assertEqual(sorted(order, key=parse_version), order)


class UpdaterTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name) / "install"
        self.data = Path(tmp.name) / "data"
        for rel, text in {
            "server/mio_server/__init__.py": '__version__ = "4.0.0"\n',
            "server/mio_server/stale.py": "old\n",
            "server/data/runtime/keep.db": "user data",
            "data/layouts/mine.json": "{}",
            "web/dist/index.html": "<html>old</html>",
        }.items():
            (self.root / rel).parent.mkdir(parents=True, exist_ok=True)
            (self.root / rel).write_text(text, encoding="utf-8")

    def updater(self, zip_bytes: bytes, manifest: bytes) -> Updater:
        def handler(request: httpx.Request) -> httpx.Response:
            if request.url.path.endswith(".json"):
                return httpx.Response(200, content=manifest)
            return httpx.Response(200, content=zip_bytes)

        return Updater(
            self.data,
            self.root,
            current="4.0.0",
            keys=TRUSTED,
            transport=httpx.MockTransport(handler),
        )

    def test_check_download_stage_apply(self):
        data = release_zip()
        up = self.updater(data, manifest_for(data))
        self.assertTrue(up.check("https://example.test/mio-release.json")["available"])
        up.download()
        pending = up.stage()
        self.assertEqual(pending["version"], "4.1.0")
        applied = up.apply_pending()
        self.assertIn(
            '"4.1.0"', (self.root / "server/mio_server/__init__.py").read_text(encoding="utf-8")
        )
        self.assertFalse((self.root / "server/mio_server/stale.py").exists())
        self.assertEqual(
            (self.root / "server/data/runtime/keep.db").read_text(encoding="utf-8"), "user data"
        )
        self.assertTrue((self.root / "data/layouts/mine.json").exists())
        self.assertEqual(
            (self.root / "web/dist/index.html").read_text(encoding="utf-8"), "<html>new</html>"
        )
        backup = Path(applied["backup"])
        self.assertTrue((backup / "server/mio_server/stale.py").exists())
        self.assertIsNone(up.pending())
        self.assertIsNone(up.apply_pending())

    def test_same_version_is_not_offered(self):
        data = release_zip("4.0.0")
        up = self.updater(data, manifest_for(data, "4.0.0"))
        self.assertFalse(up.check("https://example.test/m.json")["available"])
        with self.assertRaises(UpdateError):
            up.download()

    def test_corrupt_download_and_traversal_are_rejected(self):
        data = release_zip()
        up = self.updater(data + b"x", manifest_for(data))
        up.check("https://example.test/m.json")
        with self.assertRaisesRegex(UpdateError, "校验失败"):
            up.download()
        self.assertEqual(list((self.data / "updates").glob("*.zip")), [])

        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as zf:
            zf.writestr("../evil.txt", "x")
        evil = buf.getvalue()
        up = self.updater(evil, manifest_for(evil))
        up.check("https://example.test/m.json")
        up.download()
        with self.assertRaisesRegex(UpdateError, "越界"):
            up.stage()

    def test_git_checkout_refuses(self):
        (self.root / ".git").mkdir()
        data = release_zip()
        up = self.updater(data, manifest_for(data))
        up.check("https://example.test/m.json")
        up.download()
        with self.assertRaisesRegex(UpdateError, "git"):
            up.stage()


class UpdateApiTests(ApiCase):
    def test_status_and_unverifiable_feed(self):
        status = self.ok(self.client.get("/api/update"))
        self.assertEqual(status["current"], "4.0.0")
        self.assertFalse(status["keys_configured"])  # shipped without a key until one is made
        self.ctx.updater.transport = httpx.MockTransport(
            lambda r: httpx.Response(200, content=manifest_for(b"zip"))
        )
        res = self.client.post("/api/update/check")
        self.assertEqual(res.status_code, 400)
        self.assertIn("公钥", res.json()["detail"])


class BuildReleaseTests(unittest.TestCase):
    def load(self):
        spec = importlib.util.spec_from_file_location(
            "build_release", ROOT / "tools/build_release.py"
        )
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module

    def fixture(self, root):
        shipped = write_release_seed(root)
        for name in (
            "server/mio_server/__init__.py",
            "clients/python/mio_client.py",
            "start.bat",
            "server/tests/test_private.py",
            "server/data/private.json",
            "server/mio_server/__pycache__/cached.pyc",
            "legacy/server.py",
            "data/albums/personal/album.json",
            "data/settings/secrets.json",
        ):
            path = root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text("fixture content", encoding="utf-8")
        return shipped

    def test_package_contents_and_reproducible_zip(self):
        br = self.load()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            shipped = self.fixture(root)
            a, b = root / "a.zip", root / "b.zip"
            with patch.object(br, "ROOT", root):
                search_path = sys.path[:]
                tools_module = sys.modules.get("tools")
                names = [p.relative_to(root).as_posix() for p in br.files()]
                self.assertEqual(sys.path, search_path)
                self.assertIs(sys.modules.get("tools"), tools_module)
                self.assertIn("server/mio_server/__init__.py", names)
                self.assertIn("clients/python/mio_client.py", names)
                self.assertIn("start.bat", names)
                self.assertFalse(
                    [n for n in names if "/tests/" in n or n.startswith("server/data/")]
                )
                self.assertFalse(
                    [n for n in names if "__pycache__" in n or n.startswith("legacy/")]
                )
                self.assertEqual(
                    {n for n in names if n.startswith("data/")},
                    {"data/distribution.json", *("data/" + name for name in shipped)},
                )
                br.build_zip(a, "4.0.0")
                br.build_zip(b, "4.0.0")
            self.assertEqual(a.read_bytes(), b.read_bytes())
            with zipfile.ZipFile(a) as archive:
                for name, raw in shipped.items():
                    self.assertEqual(archive.read("mio-studio-4.0.0/data/" + name), raw)

    def test_edited_missing_unsafe_or_linked_seed_files_fail_closed(self):
        br = self.load()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            shipped = self.fixture(root)
            manifest_path = root / "data/distribution.json"
            original_manifest = manifest_path.read_text("utf-8")
            name = next(iter(shipped))
            path = root / "data" / name
            with patch.object(br, "ROOT", root):
                path.write_bytes(b"personal edits must not ship")
                with self.assertRaisesRegex(Exception, "Release data differs"):
                    br.files()
                path.unlink()
                with self.assertRaisesRegex(Exception, "Release data differs"):
                    br.files()
                path.write_bytes(shipped[name])
                manifest = json.loads(original_manifest)
                manifest["files"]["../private.json"] = "a" * 64
                manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
                with self.assertRaisesRegex(Exception, "Unsafe resource path"):
                    br.files()
                manifest_path.write_text(original_manifest, encoding="utf-8")
                original_link_check = Path.is_symlink
                with patch.object(
                    Path, "is_symlink", lambda p: p == path or original_link_check(p)
                ):
                    with self.assertRaisesRegex(Exception, "Symbolic links"):
                        br.files()

    def test_seed_change_after_enumeration_is_not_written_to_release(self):
        br = self.load()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            shipped = self.fixture(root)
            seed = root / "data" / next(iter(shipped))
            original_files = br.files

            def change_after_validation():
                paths = original_files()
                seed.write_bytes(b"personal edit during packaging")
                return paths

            with patch.object(br, "ROOT", root), patch.object(br, "files", change_after_validation):
                with self.assertRaisesRegex(ValueError, "changed while packaging"):
                    br.build_zip(root / "release.zip", "4.0.0")
            with zipfile.ZipFile(root / "release.zip") as archive:
                self.assertNotIn("mio-studio-4.0.0/data/albums/demo/album.json", archive.namelist())

    def test_manifest_addition_after_enumeration_does_not_create_incomplete_release(self):
        br = self.load()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.fixture(root)
            manifest_path = root / "data/distribution.json"
            original_files = br.files

            def add_after_validation():
                paths = original_files()
                raw = b"new reviewed image"
                name = "albums/demo/images/new.webp"
                (root / "data" / name).write_bytes(raw)
                manifest = json.loads(manifest_path.read_bytes())
                manifest["files"][name] = hashlib.sha256(raw).hexdigest()
                manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
                return paths

            target = root / "release.zip"
            with patch.object(br, "ROOT", root), patch.object(br, "files", add_after_validation):
                with self.assertRaisesRegex(ValueError, "manifest changed while packaging"):
                    br.build_zip(target, "4.0.0")
            self.assertFalse(target.exists())


if __name__ == "__main__":
    unittest.main()
