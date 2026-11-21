"""TEMP-only signed updates, real process loss, and offline launcher integration."""

from __future__ import annotations

import io
import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import unittest
import venv
import zipfile
from pathlib import Path
from unittest import mock

from mio_server.update import UpdateError, Updater, verify_manifest
from mio_server.update.recovery import host

from .test_update import ROOT, TRUSTED, manifest_for

# Child code is saved to TEMP, not shell-interpolated. Exit cuts occur *after*
# real filesystem operations and bypass all Python exception/finally cleanup.
CHILD = r"""
import importlib.util, json, os, sys, time
from pathlib import Path
root, data, mode, cut = Path(sys.argv[1]), Path(sys.argv[2]), sys.argv[3], sys.argv[4]
spec = importlib.util.spec_from_file_location("mio_update_bootstrap", root / "mio_update_bootstrap.py")
h = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = h
spec.loader.exec_module(h)
sys.path.insert(0, str(root / "server"))
if mode == "recover":
    if cut:
        move = h._move
        def killed_move(a, b):
            move(a, b)
            os._exit(72)
        h._move = killed_move
    h.recover(root)
else:
    from mio_server.update.manifest import verify_manifest
    from mio_server.update.keys import TRUSTED_KEYS
    if mode == "hold":
        with h.installation_lease(root):
            (root / "held").write_text("ready")
            while not (root / "release").exists():
                time.sleep(.01)
    else:
        count = [0]
        if mode == "pause":
            move = h._move
            def paused_move(a, b):
                move(a, b)
                if a == root / "server/mio_server":
                    (root / "held").touch()
                    while not (root / "release").exists():
                        time.sleep(.01)
            h._move = paused_move
        elif cut.startswith("move:"):
            move = h._move
            def killed_move(a, b):
                move(a, b)
                count[0] += 1
                if count[0] == int(cut.split(":")[1]):
                    os._exit(71)
            h._move = killed_move
        elif cut in {"commit:before", "commit:after"}:
            atomic = h.atomic_json
            def killed_atomic(path, value):
                if value.get("phase") == "committed" and cut.endswith("before"):
                    os._exit(71)
                atomic(path, value)
                if value.get("phase") == "committed" and cut.endswith("after"):
                    os._exit(71)
            h.atomic_json = killed_atomic
        h.apply_pending(root, data, lambda raw: verify_manifest(raw, TRUSTED_KEYS))
"""


class UpdateRecoveryTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.base = Path(temporary.name).resolve()
        self.root = self.base / "Mio 空格 & (test)!"
        self.root.mkdir()
        self.data = self.base / "工作区 空格 & 数据"
        self.child = self.base / "child.py"
        self.child.write_text(CHILD, encoding="utf-8")
        for name in ("mio_update_bootstrap.py", "start.bat", "start.sh"):
            shutil.copy2(ROOT / name, self.root / name)
        self.stable = {
            name: (self.root / name).read_bytes()
            for name in host.PRESERVE
            if (self.root / name).is_file()
        }
        for rel, value in self.program("4.0.0").items():
            path = self.root / rel
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(value)
        for rel in ("data/private.txt", "server/data/private.txt"):
            path = self.root / rel
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text("private", encoding="utf-8")
        self.data.mkdir()
        (self.data / "private.txt").write_text("chosen-private", encoding="utf-8")

    def program(self, version):
        files = {
            "server/mio_server/__init__.py": f'__version__ = "{version}"\n'.encode(),
            "server/mio_server/update/__init__.py": b"",
            "server/mio_server/update/keys.py": f"TRUSTED_KEYS = {TRUSTED!r}\n".encode(),
            # Demonstrate stable apply does not call the downgraded legacy installer.
            "server/mio_server/update/updater.py": b'raise RuntimeError("legacy installer")\n',
            "server/requirements.txt": version.encode(),
            "server/bootstrap.py": b"import sys\nsys.exit(0)\n",
            "web/dist/index.html": version.encode(),
        }
        for name in ("manifest.py", "ed25519.py"):
            files[f"server/mio_server/update/{name}"] = (
                ROOT / "server/mio_server/update" / name
            ).read_bytes()
        files["server/mio_server/__main__.py"] = (
            "import json, pathlib, sys\n"
            "args = sys.argv[1:]\n"
            "pathlib.Path('../observed.json').write_text(json.dumps(args), encoding='utf-8')\n"
        ).encode()
        return files

    def stage(self, version="4.1.0", extra=None, data=None):
        stream = io.BytesIO()
        with zipfile.ZipFile(stream, "w") as archive:
            for name, value in {
                **self.program(version),
                **(extra or {}),
                "start.bat": b"changed launcher",
                "start.sh": b"changed launcher",
                "mio_update_bootstrap.py": b"changed host",
            }.items():
                archive.writestr(f"mio-studio-{version}/{name}", value)
        raw = stream.getvalue()
        updater = Updater(data or self.data, self.root, current="4.0.0", keys=TRUSTED)
        updater.manifest = verify_manifest(manifest_for(raw, version), TRUSTED)
        updater.dir.mkdir(parents=True, exist_ok=True)
        (updater.dir / updater.manifest.package.name).write_bytes(raw)
        updater.stage()
        return updater

    def assert_version(self, version):
        for rel in (
            "server/mio_server/__init__.py",
            "server/requirements.txt",
            "web/dist/index.html",
        ):
            self.assertIn(version, (self.root / rel).read_text("utf-8"))
        for name, value in self.stable.items():
            self.assertEqual((self.root / name).read_bytes(), value, name)
        self.assertEqual((self.root / "data/private.txt").read_text(encoding="utf-8"), "private")
        self.assertEqual(
            (self.root / "server/data/private.txt").read_text(encoding="utf-8"), "private"
        )
        self.assertEqual((self.data / "private.txt").read_text(encoding="utf-8"), "chosen-private")

    def run_child(self, mode, cut="", *, expected=0):
        result = subprocess.run(
            [sys.executable, str(self.child), str(self.root), str(self.data), mode, cut],
            capture_output=True,
            timeout=20,
            env={**os.environ, "PYTHONUTF8": "1", "PYTHONDONTWRITEBYTECODE": "1"},
        )
        self.assertEqual(result.returncode, expected, result.stderr.decode("utf-8", "replace"))
        return result

    def test_every_real_rename_and_commit_cut_recovers_whole_version(self):
        # Three existing top-level program entries below server plus web: 8 moves.
        # Derive count from signed fixture entries, not production instrumentation.
        count = len(host.entries(self.root)) * 2
        for cut in [*(f"move:{i}" for i in range(1, count + 1)), "commit:before", "commit:after"]:
            with self.subTest(cut=cut):
                updater = self.stage()
                self.run_child("apply", cut, expected=71)
                self.run_child("recover")
                committed = cut == "commit:after"
                self.assert_version("4.1.0" if committed else "4.0.0")
                self.assertEqual(updater.pending() is None, committed)
                self.run_child("recover")
                self.assert_version("4.1.0" if committed else "4.0.0")
                if committed:
                    # Reset the fixture through the same signed downgrade mechanism.
                    self.stage("4.0.0").apply_pending()
                else:
                    updater.cancel_pending()

    def test_recovery_itself_can_be_killed_after_backup_restore(self):
        updater = self.stage()
        self.run_child("apply", "move:3", expected=71)
        self.run_child("recover", "kill", expected=72)
        self.run_child("recover")
        self.assert_version("4.0.0")
        self.assertIsNotNone(updater.pending())
        updater.apply_pending()
        self.assert_version("4.1.0")

    def test_missing_module_recovers_with_only_stable_stdlib_host(self):
        self.stage()
        # Entries are server/bootstrap.py then server/mio_server: third move backs
        # up the whole importable app, leaving it genuinely absent on disk.
        self.run_child("apply", "move:3", expected=71)
        self.assertFalse((self.root / "server/mio_server").exists())
        result = subprocess.run(
            [sys.executable, "-S", str(self.root / "mio_update_bootstrap.py"), "recover"],
            capture_output=True,
            timeout=10,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assert_version("4.0.0")

    def test_second_instance_cannot_apply_cancel_stage_or_download_during_apply(self):
        first = self.stage()
        second = Updater(self.data, self.root, keys=TRUSTED)
        second.manifest = first.manifest
        entered, release = threading.Event(), threading.Event()
        failure = []
        move = host._move

        def pause(source, target):
            move(source, target)
            if source == self.root / "server/mio_server":
                entered.set()
                if not release.wait(10):
                    raise RuntimeError("test timeout")

        def apply():
            try:
                first.apply_pending()
            except Exception as exc:
                failure.append(exc)

        with mock.patch.object(host, "_move", pause):
            worker = threading.Thread(target=apply)
            worker.start()
            try:
                self.assertTrue(entered.wait(5))
                for operation in (
                    second.apply_pending,
                    second.cancel_pending,
                    second.stage,
                    second.download,
                ):
                    with self.assertRaisesRegex(UpdateError, "正在进行"):
                        operation()
            finally:
                release.set()
                worker.join(10)
        self.assertFalse(worker.is_alive())
        self.assertFalse(failure, failure)
        self.assert_version("4.1.0")
        self.assertIsNone(second.apply_pending())

    def test_os_lease_protects_same_install_across_different_workspaces(self):
        self.stage()
        process = subprocess.Popen(
            [sys.executable, str(self.child), str(self.root), str(self.data), "hold", ""],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        self.addCleanup(lambda: process.poll() is None and process.kill())
        import time

        deadline = time.monotonic() + 10
        while not (self.root / "held").exists() and time.monotonic() < deadline:
            time.sleep(0.01)
        self.assertTrue((self.root / "held").exists())
        second = Updater(self.base / "other-workspace", self.root, keys=TRUSTED)
        try:
            with self.assertRaisesRegex(UpdateError, "正在进行"):
                second.apply_pending()
            self.assert_version("4.0.0")
        finally:
            (self.root / "release").touch()
            out, err = process.communicate(timeout=10)
        self.assertEqual(process.returncode, 0, (out, err))
        self.run_child("apply")
        self.assert_version("4.1.0")

    def test_second_process_blocks_before_importing_absent_module_then_can_downgrade(self):
        self.stage()
        other = self.base / "other data"
        self.stage("3.9.0", data=other)
        process = subprocess.Popen(
            [sys.executable, str(self.child), str(self.root), str(self.data), "pause", ""],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        self.addCleanup(lambda: process.poll() is None and process.kill())
        import time

        deadline = time.monotonic() + 10
        while not (self.root / "held").exists() and time.monotonic() < deadline:
            time.sleep(0.01)
        try:
            self.assertTrue((self.root / "held").exists())
            self.assertFalse((self.root / "server/mio_server").exists())
            result = subprocess.run(
                [
                    sys.executable,
                    str(self.root / "mio_update_bootstrap.py"),
                    "apply",
                    f"--data={other}",
                ],
                capture_output=True,
                timeout=10,
            )
            self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
            self.assertNotIn(b"ModuleNotFoundError", result.stderr)
            self.assertTrue((other / "updates/pending.json").is_file())
        finally:
            (self.root / "release").touch()
            out, err = process.communicate(timeout=10)
        self.assertEqual(process.returncode, 0, (out, err))
        self.assert_version("4.1.0")
        result = subprocess.run(
            [
                sys.executable,
                str(self.root / "mio_update_bootstrap.py"),
                "apply",
                "--data",
                str(other),
            ],
            capture_output=True,
            timeout=10,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assert_version("3.9.0")
        self.assertFalse((other / "updates/pending.json").exists())

    def test_invalid_journal_ownership_is_fatal_and_does_not_touch_other_root(self):
        self.stage()
        self.run_child("apply", "move:3", expected=71)
        path = self.root / ".mio-update/journal.json"
        original = json.loads(path.read_text("utf-8"))
        for replacement in (
            {"root": str(self.base)},
            {"transaction": "../other"},
            {"entries": [{"path": "../private.txt", "existed": True}]},
        ):
            path.write_text(json.dumps({**original, **replacement}), encoding="utf-8")
            with self.assertRaises(host.RecoveryError):
                host.recover(self.root)
            self.assertFalse((self.root / "server/mio_server").exists())
        path.write_text(json.dumps(original), encoding="utf-8")
        host.recover(self.root)
        self.assert_version("4.0.0")

    def test_linked_program_or_updates_paths_are_rejected_before_mutation(self):
        updater = self.stage()
        outside = self.base / "outside"
        outside.mkdir()
        marker = outside / "keep.txt"
        marker.write_text("private", encoding="utf-8")
        original = self.root / "web"
        saved = self.root / "saved-web"
        original.rename(saved)

        def link_directory(link):
            try:
                link.symlink_to(outside, target_is_directory=True)
            except OSError:
                if os.name != "nt":
                    raise
                # Junction creation needs no developer-mode/symlink privilege.
                result = subprocess.run(
                    [
                        os.environ.get("COMSPEC", "cmd.exe"),
                        "/d",
                        "/c",
                        "mklink",
                        "/J",
                        str(link),
                        str(outside),
                    ],
                    capture_output=True,
                    timeout=10,
                )
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

        def unlink_directory(link):
            if link.is_symlink():
                link.unlink()
            else:
                link.rmdir()  # Removes the junction, never its target.

        try:
            link_directory(original)
            with self.assertRaisesRegex(UpdateError, "链接"):
                updater.apply_pending()
            self.assertEqual(marker.read_text(encoding="utf-8"), "private")
            unlink_directory(original)
            saved.rename(original)
            linked_update = updater.dir / "unrelated.part"
            link_directory(linked_update)
            with self.assertRaisesRegex(UpdateError, "链接"):
                updater.cancel_pending()
            self.assertEqual(marker.read_text(encoding="utf-8"), "private")
            unlink_directory(linked_update)
        finally:
            if host._linked(original):
                unlink_directory(original)
            if saved.exists():
                saved.rename(original)

    def test_corrupt_archive_unknown_entry_and_workspace_overlap_preserve_old(self):
        updater = self.stage()
        (updater.dir / updater.manifest.package.name).write_bytes(b"bad")
        with self.assertRaisesRegex(UpdateError, "校验失败"):
            updater.apply_pending()
        self.assert_version("4.0.0")
        updater.cancel_pending()
        updater = self.stage(extra={"unknown-root/private.txt": b"bad"})
        with self.assertRaisesRegex(UpdateError, "程序路径"):
            updater.apply_pending()
        self.assert_version("4.0.0")
        updater.cancel_pending()
        updater = self.stage(data=self.root / "web/private-workspace")
        with self.assertRaisesRegex(UpdateError, "工作区"):
            updater.apply_pending()
        self.assert_version("4.0.0")

    def test_no_journal_recover_does_not_write_root(self):
        shutil.rmtree(self.root / ".mio-update", ignore_errors=True)
        self.assertFalse(host.recover(self.root))
        self.assertFalse((self.root / ".mio-update").exists())

    def test_workspace_aliases_cannot_hide_program_overlap(self):
        aliases = [self.root / "data/../web/private-workspace"]
        if os.name == "nt":
            import ctypes

            short_path = ctypes.WinDLL("kernel32", use_last_error=True).GetShortPathNameW
            short_path.argtypes = [ctypes.c_wchar_p, ctypes.c_wchar_p, ctypes.c_uint]
            short_path.restype = ctypes.c_uint
            size = short_path(str(self.root), None, 0)
            self.assertGreater(size, 0)
            buffer = ctypes.create_unicode_buffer(size)
            self.assertGreater(short_path(str(self.root), buffer, size), 0)
            short_root = Path(buffer.value)
            if short_root != self.root:  # Some Windows volumes disable 8.3 aliases.
                aliases.append(short_root / "web/private-workspace")
        for data in aliases:
            with self.subTest(data=data):
                updater = self.stage(data=data)
                marker = updater.dir.parent / "private.txt"
                marker.write_text("keep-private", encoding="utf-8")
                pending = (updater.dir / "pending.json").read_bytes()
                with self.assertRaisesRegex(UpdateError, "工作区"):
                    updater.apply_pending()
                self.assertEqual(marker.read_text(encoding="utf-8"), "keep-private")
                self.assertEqual((updater.dir / "pending.json").read_bytes(), pending)
                self.assert_version("4.0.0")
                updater.cancel_pending()

    def test_real_launcher_forwards_data_forms_and_preserves_stable_host_on_downgrade(self):
        # A TEMP venv plus no-op bootstrap: no pip, real app, network or service.
        venv.EnvBuilder(system_site_packages=True, with_pip=False).create(self.root / ".venv")
        for version, form in (("4.1.0", "separate"), ("3.9.0", "equals")):
            with self.subTest(form=form):
                updater = self.stage(version)
                args = ["--data", str(self.data)] if form == "separate" else [f"--data={self.data}"]
                command = (
                    [os.environ.get("COMSPEC", "cmd.exe"), "/d", "/v:off", "/c", ".\\start.bat"]
                    if os.name == "nt"
                    else ["sh", "./start.sh"]
                )
                result = subprocess.run(
                    [*command, "--check", *args],
                    cwd=self.root,
                    capture_output=True,
                    env={
                        **os.environ,
                        "MIO_NO_PAUSE": "1",
                        "MIO_V3_DATA": str(self.base / "wrong"),
                        "PYTHONUTF8": "1",
                        "PYTHONDONTWRITEBYTECODE": "1",
                    },
                    timeout=30,
                )
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                self.assert_version(version)
                self.assertIsNone(updater.pending())
                received = json.loads((self.root / "observed.json").read_text("utf-8"))
                self.assertEqual(
                    received, (["--open"] if os.name == "nt" else []) + ["--check", *args]
                )
        self.assertEqual(
            host.launch_data(["--port", "9000", "--data=relative dir"], self.root),
            self.root / "server/relative dir",
        )
        with mock.patch.dict(os.environ, {"MIO_V3_DATA": "environment dir"}):
            self.assertEqual(host.launch_data([], self.root), self.root / "server/environment dir")
        with mock.patch.dict(os.environ):
            os.environ.pop("MIO_V3_DATA", None)
            self.assertEqual(host.launch_data([], self.root), self.root / "server/data/runtime/v3")
