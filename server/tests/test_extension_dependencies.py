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

from packaging.requirements import Requirement
from packaging.utils import canonicalize_name

from mio_server.extensions.dependencies import RequirementError, _satisfied, ensure_requirements


class ExtensionRequirementsTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.folder = Path(self.temporary.name) / "sample"
        self.folder.mkdir()
        # Never inspect or mutate the developer's shared Python environment in these tests.
        distributions = mock.patch(
            "mio_server.extensions.dependencies.importlib.metadata.distributions", return_value=[]
        )
        distributions.start()
        self.addCleanup(distributions.stop)

    def tearDown(self):
        self.temporary.cleanup()

    def write(self, source: str):
        (self.folder / "requirements.txt").write_text(source, encoding="utf-8")

    def test_missing_packages_install_with_the_current_python(self):
        self.write("sample-lib[cli]>=2.0  # reviewed dependency\n")
        completed = subprocess.CompletedProcess([], 0, "", "")
        installed = False

        def distribution(name):
            if not installed:
                raise PackageNotFoundError(name)
            return SimpleNamespace(version="2.0", requires=[])

        def run(command, **kwargs):
            nonlocal installed
            if "--dry-run" in command:
                report = Path(command[command.index("--report") + 1])
                report.write_text(
                    json.dumps(
                        {"install": [{"metadata": {"name": "sample-lib", "version": "2.0"}}]}
                    ),
                    encoding="utf-8",
                )
            else:
                installed = True
            return completed

        with (
            mock.patch("mio_server.extensions.dependencies._satisfied", side_effect=[False, True]),
            mock.patch("mio_server.extensions.dependencies.subprocess.run", side_effect=run) as run,
            mock.patch(
                "mio_server.extensions.dependencies.importlib.metadata.distribution",
                side_effect=distribution,
            ),
        ):
            installed = ensure_requirements(self.folder)
        self.assertEqual(installed, ("sample-lib[cli]>=2.0",))
        self.assertEqual(run.call_count, 2)
        self.assertEqual(run.call_args.args[0][-1], "sample-lib==2.0")
        self.assertIn("--no-deps", run.call_args.args[0])
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

    def test_missing_transitive_dependency_invokes_pip_and_is_checked_after_install(self):
        self.write("sample-lib>=2\n")
        distributions = {
            "sample-lib": SimpleNamespace(version="2.1", requires=["dependency-lib>=3"]),
        }

        def distribution(name):
            if name not in distributions:
                raise PackageNotFoundError(name)
            return distributions[name]

        def run(command, **kwargs):
            if "--dry-run" in command:
                report = Path(command[command.index("--report") + 1])
                report.write_text(
                    json.dumps(
                        {"install": [{"metadata": {"name": "dependency-lib", "version": "3.2"}}]}
                    ),
                    encoding="utf-8",
                )
            else:
                distributions["dependency-lib"] = SimpleNamespace(version="3.2", requires=[])
            return subprocess.CompletedProcess(command, 0, "", "")

        with (
            mock.patch(
                "mio_server.extensions.dependencies.importlib.metadata.distribution",
                side_effect=distribution,
            ),
            mock.patch("mio_server.extensions.dependencies.subprocess.run", side_effect=run) as pip,
        ):
            self.assertEqual(ensure_requirements(self.folder), ("sample-lib>=2",))
        self.assertEqual(pip.call_count, 2)
        self.assertIn("--dry-run", pip.call_args_list[0].args[0])
        self.assertEqual(pip.call_args_list[1].args[0][-1], "dependency-lib==3.2")

    def test_preflight_refuses_to_upgrade_incompatible_transitive_dependency(self):
        self.write("sample-lib>=2\n")
        distributions = {
            "sample-lib": SimpleNamespace(version="2.1", requires=["dependency-lib>=3"]),
            "dependency-lib": SimpleNamespace(version="2.2", requires=[]),
        }

        def run(command, **kwargs):
            report = Path(command[command.index("--report") + 1])
            report.write_text(
                json.dumps(
                    {"install": [{"metadata": {"name": "dependency-lib", "version": "3.2"}}]}
                ),
                encoding="utf-8",
            )
            return subprocess.CompletedProcess(command, 0, "", "")

        with (
            mock.patch(
                "mio_server.extensions.dependencies.importlib.metadata.distribution",
                side_effect=lambda name: distributions[name],
            ),
            mock.patch("mio_server.extensions.dependencies.subprocess.run", side_effect=run) as pip,
        ):
            with self.assertRaisesRegex(RequirementError, "版本冲突"):
                ensure_requirements(self.folder)
        pip.assert_called_once()

    def test_nested_dependencies_are_checked_and_inapplicable_markers_are_skipped(self):
        distributions = {
            "sample-lib": SimpleNamespace(
                version="2.1",
                requires=["middle-lib>=1", 'ignored-lib; python_version < "0"'],
            ),
            "middle-lib": SimpleNamespace(version="1.0", requires=["leaf-lib>=3"]),
            "leaf-lib": SimpleNamespace(version="3.2", requires=[]),
        }
        with mock.patch(
            "mio_server.extensions.dependencies.importlib.metadata.distribution",
            side_effect=lambda name: distributions[name],
        ) as metadata:
            self.assertTrue(_satisfied(Requirement("sample-lib>=2")))
            self.assertEqual(
                [call.args[0] for call in metadata.call_args_list],
                ["sample-lib", "middle-lib", "leaf-lib"],
            )
            distributions["leaf-lib"] = SimpleNamespace(version="2.0", requires=[])
            self.assertFalse(_satisfied(Requirement("sample-lib>=2")))

    def test_unselected_extras_are_not_required(self):
        self.write("sample-lib>=2\n")
        distributions = {
            "sample-lib": SimpleNamespace(
                version="2.1",
                requires=["base-lib>=1", 'optional-lib>=3; extra == "cli"'],
            ),
            "base-lib": SimpleNamespace(version="1.0", requires=[]),
        }
        with (
            mock.patch(
                "mio_server.extensions.dependencies.importlib.metadata.distribution",
                side_effect=lambda name: distributions[name],
            ) as metadata,
            mock.patch("mio_server.extensions.dependencies.subprocess.run") as pip,
        ):
            self.assertEqual(ensure_requirements(self.folder), ())
        self.assertEqual(
            [call.args[0] for call in metadata.call_args_list], ["sample-lib", "base-lib"]
        )
        pip.assert_not_called()

    def test_selected_extras_keep_base_requirements_and_follow_nested_extras(self):
        distributions = {
            "sample-lib": SimpleNamespace(
                version="2.1",
                requires=[
                    'base-lib>=1; extra != "cli"',
                    'optional-lib[json]>=3; extra == "cli"',
                ],
            ),
            "base-lib": SimpleNamespace(version="1.0", requires=[]),
            "optional-lib": SimpleNamespace(
                version="3.2", requires=['json-lib>=1; extra == "json"']
            ),
            "json-lib": SimpleNamespace(version="1.0", requires=[]),
        }
        with mock.patch(
            "mio_server.extensions.dependencies.importlib.metadata.distribution",
            side_effect=lambda name: distributions[name],
        ) as metadata:
            self.assertTrue(_satisfied(Requirement("sample-lib[cli]>=2")))
            self.assertEqual(
                [call.args[0] for call in metadata.call_args_list],
                ["sample-lib", "base-lib", "optional-lib", "json-lib"],
            )
            distributions["base-lib"] = SimpleNamespace(version="0.5", requires=[])
            self.assertFalse(_satisfied(Requirement("sample-lib[cli]>=2")))

    def test_dependency_cycles_terminate_without_hiding_missing_dependencies(self):
        distributions = {
            "sample-lib": SimpleNamespace(version="2.1", requires=["other-lib>=1"]),
            "other-lib": SimpleNamespace(version="1.0", requires=["Sample_Lib>=2"]),
        }

        def distribution(name):
            if name not in distributions:
                raise PackageNotFoundError(name)
            return distributions[name]

        with mock.patch(
            "mio_server.extensions.dependencies.importlib.metadata.distribution",
            side_effect=distribution,
        ) as metadata:
            self.assertTrue(_satisfied(Requirement("sample-lib>=2")))
            self.assertEqual(metadata.call_count, 2)
            distributions["other-lib"].requires.append("missing-lib>=1")
            self.assertFalse(_satisfied(Requirement("sample-lib>=2")))

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

    def test_exact_plan_and_every_host_version_are_constraints_for_no_deps_install(self):
        self.write("sample-lib[cli]>=2\n")
        host = SimpleNamespace(metadata={"Name": "Host_Pkg"}, version="1.2", requires=[])
        distributions = {"host-pkg": host}
        observed = {}

        def distribution(name):
            try:
                return distributions[canonicalize_name(name)]
            except KeyError:
                raise PackageNotFoundError(name) from None

        def run(command, **kwargs):
            if "--dry-run" in command:
                report = Path(command[command.index("--report") + 1])
                report.write_text(
                    json.dumps(
                        {
                            "install": [
                                {"metadata": {"name": "Sample_Lib", "version": "2.0"}},
                                {"metadata": {"name": "child-lib", "version": "3.4"}},
                            ]
                        }
                    ),
                    encoding="utf-8",
                )
            else:
                constraints = Path(command[command.index("--constraint") + 1])
                observed.update(path=constraints, contents=constraints.read_text(encoding="utf-8"))
                distributions["sample-lib"] = SimpleNamespace(
                    version="2.0", requires=['child-lib>=3; extra == "cli"']
                )
                distributions["child-lib"] = SimpleNamespace(version="3.4", requires=[])
            return subprocess.CompletedProcess(command, 0, "", "")

        with (
            mock.patch(
                "mio_server.extensions.dependencies.importlib.metadata.distributions",
                return_value=[host],
            ),
            mock.patch(
                "mio_server.extensions.dependencies.importlib.metadata.distribution",
                side_effect=distribution,
            ),
            mock.patch("mio_server.extensions.dependencies.subprocess.run", side_effect=run) as pip,
        ):
            self.assertEqual(ensure_requirements(self.folder), ("sample-lib[cli]>=2",))
        command = pip.call_args_list[1].args[0]
        self.assertIn("--no-deps", command)
        self.assertEqual(command[-2:], ["child-lib==3.4", "sample-lib==2.0"])
        self.assertNotIn("sample-lib[cli]>=2", command)
        self.assertEqual(observed["contents"], "child-lib==3.4\nhost-pkg==1.2\nsample-lib==2.0\n")
        self.assertFalse(observed["path"].parent.exists())

    def test_invalid_duplicate_and_unexpressible_plans_never_reach_install(self):
        self.write("sample-lib>=2\n")
        valid = {"metadata": {"name": "sample-lib", "version": "2.0"}}
        invalid_actions = [
            [],
            [None],
            [{"metadata": []}],
            [{"metadata": {"name": "sample-lib --upgrade", "version": "2"}}],
            [{"metadata": {"name": "-sample", "version": "2"}}],
            [{"metadata": {"name": "sample-lib", "version": "invalid"}}],
            [{"metadata": {"name": "sample-lib", "version": " 2.0"}}],
            [{"metadata": {"name": "sample-lib", "version": "1.0"}}],
            [valid, {"metadata": {"name": "Sample_Lib", "version": "2.0"}}],
            [valid, {"metadata": {"name": "Sample_Lib", "version": "3.0"}}],
            [{**valid, "is_direct": True}],
            [{**valid, "is_direct": "false"}],
            [{**valid, "download_info": []}],
            [{**valid, "download_info": {"dir_info": {"editable": True}}}],
            [{**valid, "download_info": {"vcs_info": {"vcs": "git"}}}],
            [{"metadata": {"name": "unrelated-lib", "version": "1.0"}}],
        ]
        for actions in invalid_actions:
            with self.subTest(actions=actions):

                def run(command, **kwargs):
                    report = Path(command[command.index("--report") + 1])
                    report.write_text(json.dumps({"install": actions}), encoding="utf-8")
                    return subprocess.CompletedProcess(command, 0, "", "")

                with (
                    mock.patch("mio_server.extensions.dependencies._satisfied", return_value=False),
                    mock.patch(
                        "mio_server.extensions.dependencies.importlib.metadata.distribution",
                        side_effect=PackageNotFoundError,
                    ),
                    mock.patch(
                        "mio_server.extensions.dependencies.subprocess.run", side_effect=run
                    ) as pip,
                ):
                    with self.assertRaises(RequirementError):
                        ensure_requirements(self.folder)
                pip.assert_called_once()

    def test_report_with_duplicate_json_keys_never_reaches_install(self):
        self.write("sample-lib>=2\n")

        def run(command, **kwargs):
            report = Path(command[command.index("--report") + 1])
            report.write_text('{"install": [], "install": []}', encoding="utf-8")
            return subprocess.CompletedProcess(command, 0, "", "")

        with (
            mock.patch("mio_server.extensions.dependencies._satisfied", return_value=False),
            mock.patch("mio_server.extensions.dependencies.subprocess.run", side_effect=run) as pip,
        ):
            with self.assertRaisesRegex(RequirementError, "有效计划"):
                ensure_requirements(self.folder)
        pip.assert_called_once()

    def test_shared_environment_change_during_preflight_blocks_install(self):
        self.write("sample-lib>=2\n")
        appeared = SimpleNamespace(metadata={"Name": "appeared-lib"}, version="1.0")

        def run(command, **kwargs):
            report = Path(command[command.index("--report") + 1])
            report.write_text(
                json.dumps({"install": [{"metadata": {"name": "sample-lib", "version": "2"}}]}),
                encoding="utf-8",
            )
            return subprocess.CompletedProcess(command, 0, "", "")

        with (
            mock.patch("mio_server.extensions.dependencies._satisfied", return_value=False),
            mock.patch(
                "mio_server.extensions.dependencies.importlib.metadata.distributions",
                side_effect=[[], [appeared]],
            ),
            mock.patch(
                "mio_server.extensions.dependencies.importlib.metadata.distribution",
                side_effect=PackageNotFoundError,
            ),
            mock.patch("mio_server.extensions.dependencies.subprocess.run", side_effect=run) as pip,
        ):
            with self.assertRaisesRegex(RequirementError, "预检查期间发生变化"):
                ensure_requirements(self.folder)
        pip.assert_called_once()

    def test_broad_requirement_does_not_hide_an_install_version_different_from_the_plan(self):
        self.write("sample-lib>=2\n")
        installed = False

        def distribution(name):
            if installed:
                return SimpleNamespace(version="2.1", requires=[])
            raise PackageNotFoundError(name)

        def run(command, **kwargs):
            nonlocal installed
            if "--dry-run" in command:
                report = Path(command[command.index("--report") + 1])
                report.write_text(
                    json.dumps(
                        {"install": [{"metadata": {"name": "sample-lib", "version": "2.0"}}]}
                    ),
                    encoding="utf-8",
                )
            else:
                installed = True
            return subprocess.CompletedProcess(command, 0, "", "")

        with (
            mock.patch(
                "mio_server.extensions.dependencies.importlib.metadata.distribution",
                side_effect=distribution,
            ),
            mock.patch("mio_server.extensions.dependencies.subprocess.run", side_effect=run) as pip,
        ):
            with self.assertRaisesRegex(RequirementError, "固定版本不符"):
                ensure_requirements(self.folder)
        self.assertEqual(pip.call_count, 2)

    def test_ambiguous_or_invalid_host_package_metadata_blocks_preflight(self):
        self.write("sample-lib>=2\n")
        for installed in (
            [SimpleNamespace(metadata={"Name": None}, version="1.0")],
            [SimpleNamespace(metadata={"Name": "host-lib"}, version="unknown")],
            [
                SimpleNamespace(metadata={"Name": "host-lib"}, version="1.0"),
                SimpleNamespace(metadata={"Name": "Host_Lib"}, version="2.0"),
            ],
        ):
            with self.subTest(installed=installed):
                with (
                    mock.patch("mio_server.extensions.dependencies._satisfied", return_value=False),
                    mock.patch(
                        "mio_server.extensions.dependencies.importlib.metadata.distributions",
                        return_value=installed,
                    ),
                    mock.patch("mio_server.extensions.dependencies.subprocess.run") as pip,
                ):
                    with self.assertRaises(RequirementError):
                        ensure_requirements(self.folder)
                pip.assert_not_called()

    def test_nested_cycle_with_an_extra_and_different_version_constraint_is_checked(self):
        distributions = {
            "sample-lib": SimpleNamespace(version="2.1", requires=["Middle_Lib[cli]>=1"]),
            "middle-lib": SimpleNamespace(
                version="1.0",
                requires=[
                    "sample-lib>=1",
                    'leaf-lib>=3; extra == "cli"',
                    'never-lib; python_version < "0"',
                ],
            ),
            "leaf-lib": SimpleNamespace(version="3.2", requires=["middle-lib>=2"]),
        }
        with mock.patch(
            "mio_server.extensions.dependencies.importlib.metadata.distribution",
            side_effect=lambda name: distributions[canonicalize_name(name)],
        ):
            self.assertFalse(_satisfied(Requirement("sample-lib>=2")))
            distributions["leaf-lib"].requires = ["middle-lib>=1"]
            self.assertTrue(_satisfied(Requirement("sample-lib>=2")))

    def test_installed_metadata_cannot_satisfy_a_transitive_direct_url(self):
        distributions = {
            "sample-lib": SimpleNamespace(
                version="2.1", requires=["child-lib @ https://example.invalid/child.whl"]
            ),
            "child-lib": SimpleNamespace(version="3.2", requires=[]),
        }
        with mock.patch(
            "mio_server.extensions.dependencies.importlib.metadata.distribution",
            side_effect=lambda name: distributions[name],
        ):
            self.assertFalse(_satisfied(Requirement("sample-lib>=2")))


if __name__ == "__main__":
    unittest.main()
