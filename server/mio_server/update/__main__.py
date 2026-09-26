"""``python -m mio_server.update apply [--data DIR]`` — install a staged update before start-up.

The launchers run this right before ``python -m mio_server``; it exits 0 when there is nothing to
do, and never blocks start-up on failure (the error is printed and the old version starts).
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from ..context import default_data_dir
from .updater import Updater

INSTALL_ROOT = Path(__file__).resolve().parents[3]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="mio_server.update")
    parser.add_argument("command", choices=["apply", "status"])
    parser.add_argument("--data", default=str(default_data_dir()))
    args = parser.parse_args(argv)
    updater = Updater(Path(args.data), INSTALL_ROOT)
    if args.command == "status":
        print(updater.status())
        return 0
    try:
        applied = updater.apply_pending()
    except Exception as exc:  # keep the old version running
        print(f"[mio] 更新安装失败，继续使用当前版本：{exc}", file=sys.stderr)
        return 0
    if applied:
        print(f"[mio] 已更新到 {applied['version']}（旧版本备份在 {applied['backup']}）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
