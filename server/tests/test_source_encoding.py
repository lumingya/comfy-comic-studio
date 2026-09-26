"""Every text file operation in server/, clients/ and tools/ names its encoding.

Without ``encoding=`` Python uses the locale code page (cp1252, cp936 ...) on Windows, so UTF-8
files with non-ASCII text fail to load or are written unreadable on some machines.  CI found
this on the Windows runner; this AST check catches it on every platform:

* builtin ``open(...)`` in text mode, ``path.open("w")``, ``read_text()`` / ``write_text()``;
* ``subprocess.run(..., text=True)`` and friends without ``encoding=``.
"""

from __future__ import annotations

import ast
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SCANNED = ("server", "clients", "tools")
SKIP_PARTS = {"node_modules", "__pycache__", ".venv", "data"}
SUBPROCESS_CALLS = {"run", "check_output", "check_call", "call", "Popen"}
MODE_CHARS = set("rwxabt+")


def _mode(call: ast.Call, position: int) -> str | None:
    for kw in call.keywords:
        if kw.arg == "mode" and isinstance(kw.value, ast.Constant):
            return kw.value.value
    if len(call.args) > position and isinstance(call.args[position], ast.Constant):
        value = call.args[position].value
        return value if isinstance(value, str) else None
    return None


def _has_encoding(call: ast.Call, position: int) -> bool:
    return any(kw.arg == "encoding" for kw in call.keywords) or len(call.args) > position


def problems(source: str) -> list[tuple[int, str]]:
    found = []
    for node in ast.walk(ast.parse(source)):
        if not isinstance(node, ast.Call):
            continue
        func = node.func
        if isinstance(func, ast.Name) and func.id == "open":
            mode = _mode(node, 1) or "r"
            if "b" not in mode and not _has_encoding(node, 3):
                found.append((node.lineno, "open() without encoding"))
        elif isinstance(func, ast.Attribute):
            if func.attr == "read_text" and not _has_encoding(node, 0):
                found.append((node.lineno, "read_text() without encoding"))
            elif func.attr == "write_text" and not _has_encoding(node, 1):
                found.append((node.lineno, "write_text() without encoding"))
            elif func.attr == "open":
                mode = _mode(node, 0)
                is_path_mode = mode is not None and set(mode) <= MODE_CHARS
                if is_path_mode and "b" not in mode and not _has_encoding(node, 2):
                    found.append((node.lineno, "Path.open() without encoding"))
            elif (
                func.attr in SUBPROCESS_CALLS
                and isinstance(func.value, ast.Name)
                and func.value.id == "subprocess"
            ):
                text = any(
                    kw.arg in ("text", "universal_newlines")
                    and isinstance(kw.value, ast.Constant)
                    and kw.value.value
                    for kw in node.keywords
                )
                if text and not any(kw.arg == "encoding" for kw in node.keywords):
                    found.append((node.lineno, "subprocess text=True without encoding"))
    return found


class SourceEncodingTests(unittest.TestCase):
    def test_checker_catches_and_allows(self):
        bad = (
            "open('a')\nopen('a', 'w')\np.read_text()\np.write_text('x')\np.open('w')\n"
            "subprocess.run(['x'], text=True)\n"
        )
        self.assertEqual([line for line, _ in problems(bad)], [1, 2, 3, 4, 5, 6])
        good = (
            "open('a', 'rb')\nopen('a', encoding='utf-8')\np.read_text('utf-8')\n"
            "p.write_text('x', encoding='utf-8')\np.open('wb')\nImage.open(buf)\n"
            "os.open(path, flags)\nsubprocess.run(['x'], text=True, encoding='utf-8')\n"
            "Dialogue(text=True)\n"
        )
        self.assertEqual(problems(good), [])

    def test_repository_sources(self):
        report = []
        for top in SCANNED:
            for path in sorted((ROOT / top).rglob("*.py")):
                if set(path.relative_to(ROOT).parts) & SKIP_PARTS:
                    continue
                for line, what in problems(path.read_text(encoding="utf-8")):
                    report.append(f"{path.relative_to(ROOT).as_posix()}:{line}: {what}")
        self.assertEqual(report, [], "\n" + "\n".join(report))


if __name__ == "__main__":
    unittest.main()
