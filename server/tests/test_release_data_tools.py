import hashlib
import importlib.util
import json
import os
import re
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from . import shipped_data_fixture

TOOLS = Path(__file__).resolve().parents[2] / "tools"


def init_test_repository(root):
    try:
        subprocess.run(
            ["git", "init", str(root)],
            check=True,
            capture_output=True,
            encoding="utf-8",
            errors="replace",
        )
    except subprocess.CalledProcessError as exc:
        stderr = exc.stderr or ""
        for key, value in os.environ.items():
            if key.startswith("GIT_CONFIG_VALUE_") and value:
                stderr = stderr.replace(value, "<redacted>")
        for pattern in (
            r"(?im)(\bauthorization(?:\s*[:=]\s*|\s+))[^\r\n]*",
            r"""(?ix)(\b(?:bearer|basic)\s+|\b(?:token|password)(?:\s*[:=]\s*|\s+))
            (?:"[^"]*"|'[^']*'|[^\s,;]+)""",
        ):
            stderr = re.sub(pattern, r"\1<redacted>", stderr)
        exc.add_note(f"git init rc={exc.returncode}; stderr={stderr}")
        raise


def load_module(filename, name):
    spec = importlib.util.spec_from_file_location(name, TOOLS / filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


manifest_tool = load_module("check_distribution.py", "mio_check_distribution_test")
_old_checker = sys.modules.get("check_distribution")
sys.path.insert(0, str(TOOLS))
try:
    build_tool = load_module("build_distribution.py", "mio_build_distribution_test")
finally:
    sys.path.remove(str(TOOLS))
    if _old_checker is None:
        sys.modules.pop("check_distribution", None)
    else:
        sys.modules["check_distribution"] = _old_checker


class ReleaseDataToolsTests(unittest.TestCase):
    def test_git_init_failure_preserves_exception_and_redacts_diagnostics(self):
        root = Path("diagnostic-repository")
        secrets = (
            "configured-secret",
            "authorization-secret",
            "bearer-secret",
            "basic-secret",
            "token-secret",
            "password-secret",
        )
        stderr = (
            "fatal: cannot read C:/local/config\n"
            f"{secrets[0]}\nAuthorization: Bearer {secrets[1]}\n"
            f"Bearer {secrets[2]}\nBasic {secrets[3]}\n"
            f"token={secrets[4]} password: '{secrets[5]}'\n"
        )
        failure = subprocess.CalledProcessError(128, ["git", "init", str(root)], stderr=stderr)
        with (
            patch.object(
                os, "environ", {"GIT_CONFIG_VALUE_99": secrets[0], "GIT_CONFIG_VALUE_98": ""}
            ),
            patch.object(subprocess, "run", side_effect=failure) as run,
            self.assertRaises(subprocess.CalledProcessError) as caught,
        ):
            init_test_repository(root)
        self.assertIs(caught.exception, failure)
        self.assertEqual(caught.exception.returncode, 128)
        self.assertEqual(caught.exception.stderr, stderr)
        diagnostic = "\n".join(caught.exception.__notes__)
        self.assertIn("rc=128", diagnostic)
        self.assertIn("C:/local/config", diagnostic)
        self.assertIn("<redacted>", diagnostic)
        for secret in secrets:
            self.assertNotIn(secret, diagnostic)
        run.assert_called_once_with(
            ["git", "init", str(root)],
            check=True,
            capture_output=True,
            encoding="utf-8",
            errors="replace",
        )

    def test_verifies_manifest_and_rejects_modified_seed(self):
        with tempfile.TemporaryDirectory() as tmp:
            data = Path(tmp)
            seed = data / "storyboards" / "demo.json"
            seed.parent.mkdir()
            seed.write_text("seed", encoding="utf-8")
            manifest_path = data / "distribution.json"
            manifest_path.write_text(
                json.dumps(
                    {
                        "schema": "mio.distribution.v1",
                        "version": "test",
                        "files": {"storyboards/demo.json": hashlib.sha256(b"seed").hexdigest()},
                    }
                ),
                encoding="utf-8",
            )
            self.assertEqual(manifest_tool.verify(data)[1], [])
            seed.write_text("changed", encoding="utf-8")
            with self.assertRaisesRegex(manifest_tool.DistributionError, "Release data differs"):
                manifest_tool.require_verified_distribution(data)

    def test_build_distribution_adds_explicit_files_and_rechecks(self):
        with tempfile.TemporaryDirectory() as tmp:
            data = Path(tmp)
            (data / "initial.json").write_text("one", encoding="utf-8")
            (data / "distribution.json").write_text(
                json.dumps(
                    {
                        "schema": "mio.distribution.v1",
                        "version": "test",
                        "files": {"initial.json": hashlib.sha256(b"one").hexdigest()},
                    }
                ),
                encoding="utf-8",
            )
            (data / "extra.json").write_text("two", encoding="utf-8")
            self.assertEqual(build_tool.build(data, ("extra.json",)), 0)
            self.assertEqual(build_tool.build(data, check=True), 0)
            manifest = manifest_tool.distribution(data)
            self.assertEqual(manifest["files"]["extra.json"], hashlib.sha256(b"two").hexdigest())

    def test_build_refuses_to_bless_worktree_edits_without_approval(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            data = root / "data"
            data.mkdir()
            seed = data / "seed.json"
            seed.write_text("committed", encoding="utf-8")
            manifest_path = data / "distribution.json"
            manifest_path.write_text(
                json.dumps(
                    {
                        "schema": "mio.distribution.v1",
                        "version": "test",
                        "files": {"seed.json": hashlib.sha256(b"committed").hexdigest()},
                    }
                ),
                encoding="utf-8",
            )
            init_test_repository(root)
            subprocess.run(["git", "-C", str(root), "add", "."], check=True, capture_output=True)
            subprocess.run(
                [
                    "git",
                    "-C",
                    str(root),
                    "-c",
                    "user.name=Test",
                    "-c",
                    "user.email=test@example.com",
                    "commit",
                    "-m",
                    "seed",
                ],
                check=True,
                capture_output=True,
            )
            seed.write_text("local edit", encoding="utf-8")
            original_manifest = manifest_path.read_bytes()
            self.assertEqual(build_tool.build(data, repo_root=root), 1)
            self.assertEqual(manifest_path.read_bytes(), original_manifest)
            self.assertEqual(build_tool.build(data, repo_root=root, approve_changes=True), 0)

    def test_seed_fixture_uses_committed_bytes_when_local_copy_differs(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            data = root / "data"
            seed = data / "storyboards" / "demo.json"
            seed.parent.mkdir(parents=True)
            seed.write_text("committed", encoding="utf-8")
            (data / "distribution.json").write_text(
                json.dumps(
                    {
                        "schema": "mio.distribution.v1",
                        "version": "test",
                        "files": {
                            "storyboards/demo.json": hashlib.sha256(b"committed").hexdigest()
                        },
                    }
                ),
                encoding="utf-8",
            )
            init_test_repository(root)
            subprocess.run(["git", "-C", str(root), "add", "."], check=True, capture_output=True)
            subprocess.run(
                [
                    "git",
                    "-C",
                    str(root),
                    "-c",
                    "user.name=Test",
                    "-c",
                    "user.email=test@example.com",
                    "commit",
                    "-m",
                    "seed",
                ],
                check=True,
                capture_output=True,
            )
            seed.write_text("local edit", encoding="utf-8")
            destination = root / "fixture"
            with patch.object(shipped_data_fixture, "REPO", root):
                shipped_data_fixture.copy_shipped_data(destination)
            self.assertEqual(
                (destination / "storyboards/demo.json").read_text("utf-8"), "committed"
            )

    def test_manifest_paths_cannot_escape_data_directory(self):
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaises(manifest_tool.DistributionError):
                manifest_tool.owned_path(Path(tmp), "../private.json")

    def test_manifest_rejects_duplicate_members(self):
        with tempfile.TemporaryDirectory() as tmp:
            (Path(tmp) / "distribution.json").write_text(
                '{"schema":"mio.distribution.v1","version":"test","files":{},"files":{}}',
                encoding="utf-8",
            )
            with self.assertRaisesRegex(manifest_tool.DistributionError, "Duplicate JSON member"):
                manifest_tool.distribution(tmp)


if __name__ == "__main__":
    unittest.main()
