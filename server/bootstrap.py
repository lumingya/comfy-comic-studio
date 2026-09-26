"""Launcher helper: make sure the server's runtime dependencies are installed in this interpreter.

``start.bat`` / ``start.sh`` run it with the virtualenv's Python (``.venv/.../python
server/bootstrap.py``) before starting the server.  Standard library only: it runs before anything
is installed.

Dependencies are (re)installed when the hash of ``requirements.txt`` differs from the stamp in the
environment, **or** when any required module cannot be imported, so a stale stamp, an interrupted
install or a hand-edited environment cannot leave the server without its packages.  Exit code 0
means the server can start; anything else is an error that has already been explained on stderr.
"""

from __future__ import annotations

import hashlib
import importlib
import importlib.util
import subprocess
import sys
from collections.abc import Callable, Iterable
from pathlib import Path

MIN_PYTHON = (3, 11)
REQUIREMENTS = Path(__file__).resolve().with_name("requirements.txt")
# import name -> distribution name, one per line of requirements.txt
MODULES = {
    "fastapi": "fastapi",
    "pydantic": "pydantic",
    "uvicorn": "uvicorn",
    "httpx": "httpx",
    "PIL": "Pillow",
}


def say(message: str) -> None:
    print(f"[mio] {message}", file=sys.stderr, flush=True)


def stamp_path() -> Path:
    return Path(sys.prefix) / ".mio-requirements"


def requirements_hash(requirements: Path) -> str:
    return hashlib.sha256(requirements.read_bytes()).hexdigest()


def missing_modules(names: Iterable[str] = MODULES) -> list[str]:
    importlib.invalidate_caches()
    return [name for name in names if importlib.util.find_spec(name) is None]


def pip_install(requirements: Path) -> int:
    command = [sys.executable, "-m", "pip", "install", "--disable-pip-version-check"]
    return subprocess.call([*command, "-r", str(requirements)])


def ensure(
    requirements: Path = REQUIREMENTS,
    stamp: Path | None = None,
    *,
    version: tuple[int, ...] = tuple(sys.version_info[:2]),
    install: Callable[[Path], int] = pip_install,
    probe: Callable[[], list[str]] = missing_modules,
) -> int:
    if tuple(version[:2]) < MIN_PYTHON:
        found = ".".join(map(str, version[:2]))
        say(f"需要 Python {MIN_PYTHON[0]}.{MIN_PYTHON[1]} 或更新版本（当前 {found}）。")
        say("请安装新版 Python，删除 .venv 文件夹后重新运行启动脚本。")
        return 3
    stamp = stamp or stamp_path()
    want = requirements_hash(requirements)
    have = stamp.read_text(encoding="utf-8").strip() if stamp.is_file() else ""
    missing = probe()
    if have == want and not missing:
        return 0
    reason = f"缺少 {', '.join(missing)}" if missing else "依赖清单有变化"
    say(f"正在安装依赖（{reason}），首次运行需要几分钟 ...")
    if install(requirements) != 0:
        say("依赖安装失败，请检查网络后重试（错误信息见上方）。")
        return 1
    missing = probe()
    if missing:
        say(f"安装后仍然无法导入：{', '.join(missing)}。请删除 .venv 文件夹后重新运行。")
        return 1
    try:
        stamp.write_text(want + "\n", encoding="utf-8")
    except OSError as exc:  # not fatal: the next start just checks again
        say(f"无法写入 {stamp}：{exc}")
    return 0


def main() -> int:
    for stream in (sys.stdout, sys.stderr):
        stream.reconfigure(errors="backslashreplace")  # legacy console code pages
    return ensure()


if __name__ == "__main__":
    raise SystemExit(main())
