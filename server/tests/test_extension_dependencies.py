"""The extension requirements file has a narrow, mockable install seam."""

from __future__ import annotations

import json
import subprocess
import tempfile
import unittest
from importlib.metadata import PackageNotFoundError
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

from mio_server.extensions.dependencies import RequirementError, ensure_requirements


class ExtensionRequirementsTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.folder = Path(self.temporary.name) / "sample"
        self.folder.mkdir()

    def tearDown(self):
        self.temporary.cleanup()

    def write(self, source: str):
        (self.folder / "requirements.txt").write_text(source, encoding="utf-8")

    def test_missing_packages_install_with_the_current_python(self):
        self.write("sample-lib[cli]>=2.0  # reviewed dependency\n")
        completed = subprocess.CompletedProcess([], 0, "", "")

        def run(command, **kwargs):
            if "--dry-run" in command:
                report = Path(command[command.index("--report") + 1])
                report.write_text(
                    json.dumps(
                        {"install": [{"metadata": {"name": "sample-lib", "version": "2.0"}}]}
                    ),
                    encoding="utf-8",
                )
            return completed

        with (
            mock.patch("mio_server.extensions.dependencies._satisfied", side_effect=[False, True]),
            mock.patch("mio_server.extensions.dependencies.subprocess.run", side_effect=run) as run,
            mock.patch(
                "mio_server.extensions.dependencies.importlib.metadata.distribution",
                side_effect=PackageNotFoundError,
            ),
        ):
            installed = ensure_requirements(self.folder)
        self.assertEqual(installed, ("sample-lib[cli]>=2.0",))
        self.assertEqual(run.call_count, 2)
        self.assertEqual(run.call_args.args[0][-1], "sample-lib[cli]>=2.0")
        self.assertIn("--no-input", run.call_args.args[0])
        self.assertEqual(run.call_args.kwargs["timeout"], 300)

    def test_satisfied_packages_do_not_invoke_pip(self):
        self.write("sample-lib>=2.0\n")
        with (
            mock.patch("mio_server.extensions.dependencies._satisfied", return_value=True),
            mock.patch("mio_server.extensions.dependencies.subprocess.run") as run,
        ):
            self.assertEqual(ensure_requirements(self.folder), ())
        run.assert_not_called()

    def test_installed_extras_require_their_marked_dependencies(self):
        from packaging.requirements import Requirement

        from mio_server.extensions.dependencies import _satisfied

        distributions = {
            "sample-lib": SimpleNamespace(
                version="2.1",
                requires=['dependency-lib>=3; extra == "cli"'],
            ),
            "dependency-lib": SimpleNamespace(version="3.2", requires=[]),
        }
        with mock.patch(
            "mio_server.extensions.dependencies.importlib.metadata.distribution",
            side_effect=lambda name: distributions[name],
        ):
            self.assertTrue(_satisfied(Requirement("sample-lib[cli]>=2")))
            distributions["dependency-lib"] = SimpleNamespace(version="2.2", requires=[])
            self.assertFalse(_satisfied(Requirement("sample-lib[cli]>=2")))

    def test_options_urls_and_local_paths_are_rejected(self):
        for source in (
            "--index-url https://example.invalid/simple\n",
            "sample-lib @ https://example.invalid/sample.whl\n",
            "../sample-lib\n",
        ):
            with self.subTest(source=source):
                self.write(source)
                with self.assertRaises(RequirementError):
                    ensure_requirements(self.folder)

    def test_duplicate_requirements_and_oversized_files_are_rejected(self):
        self.write("Sample_Lib>=1\nsample-lib<3\n")
        with self.assertRaisesRegex(RequirementError, "重复"):
            ensure_requirements(self.folder)
        self.write("x" * (64 * 1024 + 1))
        with self.assertRaisesRegex(RequirementError, "64 KB"):
            ensure_requirements(self.folder)

    def test_pip_failure_is_reported_without_echoing_output(self):
        self.write("sample-lib>=2.0\n")
        completed = subprocess.CompletedProcess([], 1, "", "private index credentials")
        with (
            mock.patch("mio_server.extensions.dependencies._satisfied", return_value=False),
            mock.patch("mio_server.extensions.dependencies.subprocess.run", return_value=completed),
        ):
            with self.assertRaises(RequirementError) as caught:
                ensure_requirements(self.folder)
        self.assertNotIn("private index credentials", str(caught.exception))

    def test_preflight_refuses_to_replace_an_unrelated_installed_package(self):
        self.write("sample-lib>=2.0\n")
        completed = subprocess.CompletedProcess([], 0, "", "")

        def run(command, **kwargs):
            report = Path(command[command.index("--report") + 1])
            report.write_text(
                json.dumps({"install": [{"metadata": {"name": "other-lib", "version": "3.0"}}]}),
                encoding="utf-8",
            )
            return completed

        installed = SimpleNamespace(version="2.0")
        with (
            mock.patch("mio_server.extensions.dependencies._satisfied", return_value=False),
            mock.patch("mio_server.extensions.dependencies.subprocess.run", side_effect=run) as pip,
            mock.patch(
                "mio_server.extensions.dependencies.importlib.metadata.distribution",
                return_value=installed,
            ),
        ):
            with self.assertRaisesRegex(RequirementError, "Mio 共用环境"):
                ensure_requirements(self.folder)
        pip.assert_called_once()

    def test_preflight_refuses_to_replace_an_incompatible_direct_dependency(self):
        self.write("sample-lib>=2.0\n")
        completed = subprocess.CompletedProcess([], 0, "", "")

        def run(command, **kwargs):
            report = Path(command[command.index("--report") + 1])
            report.write_text(
                json.dumps({"install": [{"metadata": {"name": "sample-lib", "version": "2.0"}}]}),
                encoding="utf-8",
            )
            return completed

        with (
            mock.patch("mio_server.extensions.dependencies._satisfied", return_value=False),
            mock.patch("mio_server.extensions.dependencies.subprocess.run", side_effect=run) as pip,
            mock.patch(
                "mio_server.extensions.dependencies.importlib.metadata.distribution",
                return_value=SimpleNamespace(version="1.0"),
            ),
        ):
            with self.assertRaisesRegex(RequirementError, "版本冲突"):
                ensure_requirements(self.folder)
        pip.assert_called_once()


if __name__ == "__main__":
    unittest.main()
