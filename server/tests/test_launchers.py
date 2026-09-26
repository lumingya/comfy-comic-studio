"""Root launchers (start.bat / start.sh), server/bootstrap.py and ``python -m mio_server --check``.

Three layers:

* static checks on the launcher bytes and constructs known to break cmd.exe;
* unit tests of the dependency bootstrap (stamp plus import probe, so a stale stamp cannot skip
  the install);
* real execution of the launcher with ``--check`` in a folder whose name has spaces, CJK and
  shell metacharacters (cmd.exe on Windows, sh elsewhere).  By default the fixture gets a
  ready ``.venv`` that sees this interpreter's packages; ``MIO_LAUNCHER_FULL=1`` (CI) starts
  from nothing, so the launcher creates ``.venv`` and installs the requirements from the network.
"""

from __future__ import annotations

import os
import re
import shutil
import socket
import subprocess
import sys
import tempfile
import unittest
import venv
from pathlib import Path
from unittest import mock

import bootstrap
from mio_server.__main__ import browser_host, open_when_ready

ROOT = Path(__file__).resolve().parents[2]
SERVER = ROOT / "server"
BAT = ROOT / "start.bat"
SH = ROOT / "start.sh"
FULL = os.environ.get("MIO_LAUNCHER_FULL") == "1"


def bat_text() -> str:
    return BAT.read_bytes().decode("ascii")


def bat_code_lines() -> list[str]:
    return [line for line in bat_text().split("\r\n") if not line.lower().startswith("rem ")]


class BatchFileTests(unittest.TestCase):
    def test_bytes_ascii_crlf_no_bom(self):
        data = BAT.read_bytes()
        self.assertTrue(data.startswith(b"@echo off\r\n"))
        data.decode("ascii")  # cmd reads the file in the console code page
        self.assertNotIn(b"\n", data.replace(b"\r\n", b""))
        self.assertNotIn(b"\r", data.replace(b"\r\n", b""))
        self.assertTrue(data.endswith(b"\r\n"))

    def test_git_keeps_crlf(self):
        self.assertIn("*.bat text eol=crlf", (ROOT / ".gitattributes").read_text("utf-8"))

    def test_goto_targets_exist(self):
        code = "\n".join(bat_code_lines())
        labels = set(re.findall(r"^:([\w-]+)\s*$", code, re.M))
        targets = set(re.findall(r"\bgoto\s+:?([\w-]+)", code, re.I)) - {"eof"}
        self.assertTrue(targets)
        self.assertLessEqual(targets, labels)

    def test_no_fragile_constructs(self):
        code = "\n".join(bat_code_lines()).lower()
        # for /f over a quoted command loses its outer quotes: the 4.0.0 launcher skipped the
        # dependency install because of it.
        self.assertNotIn("for /f", code)
        # delayed expansion eats "!" in folder names
        self.assertNotIn("enabledelayedexpansion", code)
        self.assertNotIn("setx", code)

    def test_variables_are_defined(self):
        code = "\n".join(bat_code_lines())
        defined = set(re.findall(r'^\s*set "(\w+)=', code, re.M)) | set(
            re.findall(r'\bset "(\w+)=', code)
        )
        used = set(re.findall(r"%(\w+)%", code))
        self.assertLessEqual(used, defined | {"CD"})

    def test_paths_are_quoted(self):
        for line in bat_code_lines():
            for var in ("%VPY%", "%CD%", "%~dp0"):
                for match in re.finditer(re.escape(var), line):
                    before = line[: match.start()]
                    self.assertEqual(before.count('"') % 2, 1, f"unquoted {var}: {line}")

    def test_parentheses_balanced_outside_quotes(self):
        for line in bat_code_lines():
            if line.lower().startswith("echo "):
                continue
            bare = re.sub(r'"[^"]*"', "", line)
            self.assertEqual(bare.count("("), bare.count(")"), line)

    def test_runs_bootstrap_update_and_server_in_order(self):
        code = "\n".join(bat_code_lines())
        steps = [
            '"%VPY%" server\\bootstrap.py',
            "if errorlevel 1 goto fail",
            '"%VPY%" -m mio_server.update apply',
            '"%VPY%" -m mio_server --open %*',
            "if errorlevel 1 goto crashed",
        ]
        positions = [code.index(step) for step in steps]
        self.assertEqual(positions, sorted(positions))
        self.assertIn("if not defined MIO_NO_PAUSE pause", code)


class ShellScriptTests(unittest.TestCase):
    def test_lf_and_shebang(self):
        data = SH.read_bytes()
        self.assertTrue(data.startswith(b"#!/usr/bin/env sh\n"))
        self.assertNotIn(b"\r", data)

    @unittest.skipUnless(shutil.which("sh"), "needs sh")
    def test_syntax(self):
        result = subprocess.run(["sh", "-n", str(SH)], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_same_steps_as_bat(self):
        text = SH.read_text("utf-8")
        for step in (
            "set -e",
            '"$VPY" server/bootstrap.py',
            '"$VPY" -m mio_server.update apply',
            'exec "$VPY" -m mio_server "$@"',
        ):
            self.assertIn(step, text)

    def test_release_ships_launchers_and_bootstrap(self):
        sys.path.insert(0, str(ROOT / "tools"))
        try:
            import build_release
        finally:
            sys.path.remove(str(ROOT / "tools"))
        names = {p.relative_to(ROOT).as_posix() for p in build_release.files()}
        self.assertLessEqual({"start.bat", "start.sh", "server/bootstrap.py"}, names)
        self.assertIn("server/requirements.txt", names)


class BootstrapTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.dir = Path(tmp.name)
        self.req = self.dir / "requirements.txt"
        self.req.write_text("fastapi>=0.115\n", encoding="utf-8")
        self.stamp = self.dir / ".mio-requirements"
        self.installs = 0
        self.missing: list[list[str]] = []
        self.said: list[str] = []
        patcher = mock.patch.object(bootstrap, "say", self.said.append)
        patcher.start()
        self.addCleanup(patcher.stop)

    def run_ensure(self, missing_before, missing_after=(), install_rc=0, version=(3, 13)):
        self.missing = [list(missing_before), list(missing_after)]

        def probe():
            return self.missing.pop(0) if len(self.missing) > 1 else self.missing[0]

        def install(path):
            self.assertEqual(path, self.req)
            self.installs += 1
            return install_rc

        return bootstrap.ensure(self.req, self.stamp, version=version, install=install, probe=probe)

    def test_fresh_environment_installs_and_stamps(self):
        self.assertEqual(self.run_ensure(["fastapi", "uvicorn"]), 0)
        self.assertEqual(self.installs, 1)
        self.assertEqual(self.stamp.read_text().strip(), bootstrap.requirements_hash(self.req))

    def test_stamp_matches_but_module_missing_reinstalls(self):
        self.stamp.write_text(bootstrap.requirements_hash(self.req) + "\n")
        self.assertEqual(self.run_ensure(["pydantic"]), 0)
        self.assertEqual(self.installs, 1)
        self.assertIn("缺少 pydantic", self.said[0])

    def test_empty_stamp_and_missing_modules_is_not_up_to_date(self):
        self.stamp.write_text("")
        self.assertEqual(self.run_ensure(["uvicorn"]), 0)
        self.assertEqual(self.installs, 1)

    def test_up_to_date_does_nothing(self):
        self.stamp.write_text(bootstrap.requirements_hash(self.req) + "\n")
        self.assertEqual(self.run_ensure([]), 0)
        self.assertEqual(self.installs, 0)

    def test_changed_requirements_reinstall(self):
        self.stamp.write_text("0" * 64 + "\n")
        self.assertEqual(self.run_ensure([]), 0)
        self.assertEqual(self.installs, 1)

    def test_failed_install_keeps_old_stamp(self):
        self.stamp.write_text("old\n")
        self.assertEqual(self.run_ensure(["fastapi"], install_rc=1), 1)
        self.assertEqual(self.stamp.read_text(), "old\n")

    def test_still_missing_after_install_fails(self):
        self.assertEqual(self.run_ensure(["PIL"], missing_after=["PIL"]), 1)
        self.assertFalse(self.stamp.exists())

    def test_old_python_is_rejected_before_installing(self):
        self.assertEqual(self.run_ensure(["fastapi"], version=(3, 10)), 3)
        self.assertEqual(self.installs, 0)
        self.assertIn("3.10", self.said[0])

    def test_probe_and_module_list(self):
        self.assertEqual(
            bootstrap.missing_modules(["json", "no_such_module_mio"]), ["no_such_module_mio"]
        )
        self.assertEqual(bootstrap.missing_modules(), [])  # the test env has the runtime deps
        requirements = (SERVER / "requirements.txt").read_text("utf-8").lower()
        for dist in bootstrap.MODULES.values():
            self.assertIn(dist.lower(), requirements)


class ServerEntryTests(unittest.TestCase):
    def test_check_builds_app_and_exits(self):
        with tempfile.TemporaryDirectory() as tmp:
            data = Path(tmp) / "数据 dir"
            result = subprocess.run(
                [sys.executable, "-m", "mio_server", "--check", "--data", str(data)],
                cwd=SERVER,
                capture_output=True,
                timeout=120,
            )
            out = result.stdout.decode("utf-8", "replace") + result.stderr.decode(
                "utf-8", "replace"
            )
            self.assertEqual(result.returncode, 0, out)
            self.assertIn("[mio] check ok", out)
            self.assertTrue((data / "mio.sqlite3").exists())

    def test_open_when_ready(self):
        opened: list[str] = []
        with socket.socket() as server:
            server.bind(("127.0.0.1", 0))
            server.listen()
            port = server.getsockname()[1]
            url = f"http://127.0.0.1:{port}"
            self.assertTrue(open_when_ready(url, "0.0.0.0", port, opener=opened.append))
        self.assertEqual(opened, [url])
        self.assertFalse(open_when_ready(url, "127.0.0.1", port, timeout=0.4, opener=opened.append))
        self.assertEqual(len(opened), 1)
        self.assertEqual(browser_host("::"), "127.0.0.1")


class LauncherExecutionTests(unittest.TestCase):
    """Copy the launcher and server into an awkward folder and run ``<launcher> --check``."""

    def fixture(self) -> Path:
        tmp = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.addCleanup(tmp.cleanup)
        folder = Path(tmp.name) / "Mio 空格 & (test)!"
        (folder / "server").mkdir(parents=True)
        for name in ("start.bat", "start.sh"):
            shutil.copy2(ROOT / name, folder / name)
        for name in ("bootstrap.py", "requirements.txt"):
            shutil.copy2(SERVER / name, folder / "server" / name)
        shutil.copytree(
            SERVER / "mio_server",
            folder / "server" / "mio_server",
            ignore=shutil.ignore_patterns("__pycache__", "data"),
        )
        if not FULL:
            # A ready environment that sees this interpreter's packages; no stamp, so the
            # launcher still runs pip, which finds everything installed (no network needed).
            venv.EnvBuilder(system_site_packages=True, with_pip=False).create(folder / ".venv")
        return folder

    def launch(self, folder: Path, *args: str, **extra_env: str) -> tuple[int, str]:
        if os.name == "nt":
            # No quotes before the script name: cmd /c strips the first and last quote.
            command = [os.environ.get("COMSPEC", "cmd.exe"), "/d", "/v:off", "/c", ".\\start.bat"]
        else:
            command = ["sh", "./start.sh"]
        env = {**os.environ, "MIO_NO_PAUSE": "1", "PYTHONDONTWRITEBYTECODE": "1", **extra_env}
        env.pop("MIO_V3_DATA", None)
        env.pop("PYTHONPATH", None)
        result = subprocess.run(
            [*command, *args],
            cwd=folder,
            env=env,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            timeout=900 if FULL else 300,
        )
        return result.returncode, result.stdout.decode("utf-8", "replace")

    def usable_base_packages(self) -> bool:
        """The quick fixture needs pip and the deps in the base site-packages (not --user)."""
        if FULL:
            return True
        probe = "import pip, fastapi, uvicorn, pydantic, httpx, PIL"
        env = {k: v for k, v in os.environ.items() if k != "PYTHONPATH"}
        quiet = {"stdout": subprocess.DEVNULL, "stderr": subprocess.DEVNULL}
        return subprocess.run([sys.executable, "-s", "-c", probe], env=env, **quiet).returncode == 0

    def test_check_from_awkward_folder(self):
        if not self.usable_base_packages():
            self.skipTest("runtime deps are not in the base site-packages")
        folder = self.fixture()
        data = folder / "运行 数据"
        code, out = self.launch(folder, "--check", "--data", str(data))
        self.assertEqual(code, 0, out)
        self.assertIn("[mio] check ok", out)
        self.assertTrue((data / "mio.sqlite3").exists(), out)
        venv_dir = folder / ".venv"
        stamp = venv_dir / ".mio-requirements"
        self.assertEqual(
            stamp.read_text("utf-8").strip(),
            bootstrap.requirements_hash(SERVER / "requirements.txt"),
            out,
        )
        # Second start: everything current, no installer run.
        code, out = self.launch(folder, "--check", "--data", str(data))
        self.assertEqual(code, 0, out)
        self.assertNotIn("正在安装依赖", out)

    def test_bootstrap_failure_stops_the_launcher(self):
        if not self.usable_base_packages():
            self.skipTest("runtime deps are not in the base site-packages")
        folder = self.fixture()
        # A requirement that cannot be installed: the launcher must stop, not start the server.
        (folder / "server" / "requirements.txt").write_text(
            "mio-no-such-package-for-tests==0.0.0\n", encoding="utf-8"
        )
        (folder / "server" / "bootstrap.py").write_text(
            (SERVER / "bootstrap.py")
            .read_text("utf-8")
            .replace('"PIL": "Pillow",', '"PIL": "Pillow",\n    "mio_no_such_module": "x",'),
            encoding="utf-8",
        )
        code, out = self.launch(folder, "--check", PIP_NO_INDEX="1")
        self.assertNotEqual(code, 0, out)
        self.assertNotIn("check ok", out)
        self.assertIn("[mio]", out)


if __name__ == "__main__":
    unittest.main()
