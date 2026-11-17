"""``python -m mio_server.update apply [--data DIR]`` — install a staged update before start-up.

The launchers run this right before ``python -m mio_server``; it exits 0 when there is nothing to
do, and never blocks start-up on failure (the error is printed and the old version starts).
"""

from __future__ import annotations

import argparse
import os
import subprocess
import sys
from pathlib import Path

from ..context import default_data_dir
from .updater import Updater, UpdateRecoveryError

INSTALL_ROOT = Path(__file__).resolve().parents[3]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="mio_server.update")
    parser.add_argument("command", choices=["apply", "status"])
    parser.add_argument("--data", default=str(default_data_dir()))
    parser.add_argument("--prepare-dependencies", action="store_true")
    args = parser.parse_args(argv)
    updater = Updater(Path(args.data), INSTALL_ROOT)
    if args.command == "status":
        print(updater.status())
        return 0
    try:

        def prepare():
            result = subprocess.run(
                [sys.executable, str(INSTALL_ROOT / "server/bootstrap.py")],
                cwd=INSTALL_ROOT,
                env={**os.environ, "MIO_SKIP_WEB_BUILD": "1", "PYTHONUTF8": "1"},
                check=False,
            )
            if result.returncode:
                raise RuntimeError("版本依赖安装失败")

        applied = updater.apply_pending(validate=prepare if args.prepare_dependencies else None)
    except UpdateRecoveryError as exc:
        print(f"[mio] {exc}", file=sys.stderr)
        return 1
    except Exception as exc:  # keep the old version running
        print(f"[mio] 更新安装失败，继续使用当前版本：{exc}", file=sys.stderr)
        return 0
    if applied:
        print(f"[mio] 已更新到 {applied['version']}（旧版本备份在 {applied['backup']}）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
