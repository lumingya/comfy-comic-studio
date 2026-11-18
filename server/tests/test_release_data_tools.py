import hashlib
import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from . import shipped_data_fixture

TOOLS = Path(__file__).resolve().parents[2] / "tools"


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
            subprocess.run(["git", "init", str(root)], check=True, capture_output=True)
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
            subprocess.run(["git", "init", str(root)], check=True, capture_output=True)
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
