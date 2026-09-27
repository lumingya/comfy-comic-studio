"""Launcher helper: make sure the server's runtime dependencies are installed in this interpreter.

``start.bat`` / ``start.sh`` run it with the virtualenv's Python (``.venv/.../python
server/bootstrap.py``) before starting the server.  Standard library only: it runs before anything
is installed.

Dependencies are (re)installed when the hash of ``requirements.txt`` differs from the stamp in the
environment, **or** when any required module cannot be imported, so a stale stamp, an interrupted
install or a hand-edited environment cannot leave the server without its packages.  Exit code 0
means the server can start; anything else is an error that has already been explained on stderr.

It then keeps the web UI current: when ``web/src`` (or the build config) is newer than
``web/dist/index.html``, it runs ``npm run build`` (``npm ci`` first if ``node_modules`` is
missing), so ``start.bat`` always shows the frontend in the working tree.  That step never blocks
start-up: without Node.js, or if the build fails, the previous ``web/dist`` is served.  Set
``MIO_SKIP_WEB_BUILD=1`` to turn it off.
"""

from __future__ import annotations

import hashlib
import importlib
import importlib.util
import os
import shutil
import subprocess
import sys
from collections.abc import Callable, Iterable
from pathlib import Path

MIN_PYTHON = (3, 11)
REQUIREMENTS = Path(__file__).resolve().with_name("requirements.txt")
WEB = Path(__file__).resolve().parents[1] / "web"
# What a UI build depends on, besides web/src.
WEB_INPUTS = ("index.html", "package.json", "package-lock.json", "vite.config.ts", "tsconfig.json")
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
    # pip crashes printing non-ASCII paths when stdio uses a legacy code page (cp1252 ...)
    env = {**os.environ, "PYTHONUTF8": "1"}
    return subprocess.call([*command, "-r", str(requirements)], env=env)


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


def newest_source(web: Path) -> float:
    """Latest mtime among the UI sources (0 when this is not a source checkout)."""
    src = web / "src"
    if not src.is_dir():
        return 0.0
    times = [p.stat().st_mtime for p in src.rglob("*") if p.is_file()]
    times += [(web / n).stat().st_mtime for n in WEB_INPUTS if (web / n).is_file()]
    return max(times, default=0.0)


def web_is_stale(web: Path = WEB) -> bool:
    newest = newest_source(web)
    if not newest:
        return False
    index = web / "dist" / "index.html"
    return not index.is_file() or index.stat().st_mtime < newest


def npm_run(web: Path, *args: str) -> int:
    npm = shutil.which("npm")
    if not npm:
        return 127
    return subprocess.call([npm, *args], cwd=web)


def ensure_web(
    web: Path = WEB,
    *,
    run: Callable[..., int] = npm_run,
    have_npm: Callable[[], bool] = lambda: shutil.which("npm") is not None,
) -> int:
    """Rebuild ``web/dist`` when the sources are newer.  Returns 0 unless a build was tried and
    failed (start-up goes on either way)."""
    if os.environ.get("MIO_SKIP_WEB_BUILD") == "1" or not web_is_stale(web):
        return 0
    if not have_npm():
        say("界面源码比 web/dist 新，但没找到 Node.js（npm），继续使用旧的界面。")
        say("安装 Node.js 20+ 后重新运行启动脚本即可自动构建：https://nodejs.org/")
        return 0
    if not (web / "node_modules").is_dir():
        say("正在安装界面依赖（npm ci），首次需要一两分钟 ...")
        if run(web, "ci", "--no-audit", "--no-fund") != 0:
            say("界面依赖安装失败，继续使用旧的界面（错误信息见上方）。")
            return 1
    say("界面有更新，正在构建 web/dist ...")
    if run(web, "run", "build") != 0:
        say("界面构建失败，继续使用旧的界面（错误信息见上方）。")
        return 1
    return 0


def main() -> int:
    for stream in (sys.stdout, sys.stderr):
        stream.reconfigure(errors="backslashreplace")  # legacy console code pages
    code = ensure()
    if code == 0:
        ensure_web()
    return code


if __name__ == "__main__":
    raise SystemExit(main())
