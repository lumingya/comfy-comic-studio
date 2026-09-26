"""``python -m mio_server`` — start the v3 API (and the built web UI if ``web/dist`` exists).

``--check`` builds the whole app against the data directory and exits (the launchers' self-test);
``--open`` opens the browser once the server is accepting connections.
"""

from __future__ import annotations

import argparse
import logging
import os
import socket
import sys
import threading
import time
import webbrowser
from collections.abc import Callable
from pathlib import Path

import uvicorn

from . import __version__
from .api import create_app
from .api.guard import host_allowed
from .context import AppContext, default_data_dir


def browser_host(host: str) -> str:
    return "127.0.0.1" if host in ("", "0.0.0.0", "::") else host


def trust_host(host: str) -> None:
    """``--host mybox.lan`` means the browser will send ``Host: mybox.lan``: allow that name."""
    if host and not host_allowed(host):
        known = os.environ.get("MIO_ALLOWED_HOSTS", "")
        os.environ["MIO_ALLOWED_HOSTS"] = f"{known},{host}" if known else host


def port_in_use(host: str, port: int) -> bool:
    try:
        with socket.create_connection((browser_host(host), port), timeout=0.5):
            return True
    except OSError:
        return False


def open_when_ready(
    url: str,
    host: str,
    port: int,
    *,
    timeout: float = 60,
    opener: Callable[[str], object] = webbrowser.open,
) -> bool:
    """Wait until ``host:port`` accepts connections, then open ``url``; False on timeout."""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if port_in_use(host, port):
            opener(url)
            return True
        time.sleep(0.3)
    return False


def check(data: str) -> int:
    ctx = AppContext.create(data, autostart=False)
    try:
        routes = len(create_app(ctx).routes)
    finally:
        ctx.close()
    print(f"[mio] check ok: {__version__}, {routes} routes, data {Path(data).resolve()}")
    return 0


def main(argv: list[str] | None = None) -> int:
    for stream in (sys.stdout, sys.stderr):
        stream.reconfigure(errors="backslashreplace")  # legacy console code pages
    parser = argparse.ArgumentParser(prog="mio_server")
    parser.add_argument("--host", default=os.environ.get("MIO_HOST", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=int(os.environ.get("MIO_PORT", "8788")))
    parser.add_argument("--data", default=str(default_data_dir()), help="runtime data directory")
    parser.add_argument("--open", action="store_true", help="open the browser when ready")
    parser.add_argument("--check", action="store_true", help="build the app, then exit")
    args = parser.parse_args(argv)
    if args.check:
        return check(args.data)
    url = f"http://{browser_host(args.host)}:{args.port}"
    if port_in_use(args.host, args.port):
        print(f"[mio] 端口 {args.port} 已被占用：可能已经在运行（{url}）。", file=sys.stderr)
        print("[mio] 换一个端口：start.bat --port 8790，或设置环境变量 MIO_PORT。", file=sys.stderr)
        return 2
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    trust_host(args.host)
    ctx = AppContext.create(args.data)
    print(f"[mio] {url}", flush=True)
    if args.open:
        threading.Thread(
            target=open_when_ready, args=(url, args.host, args.port), daemon=True
        ).start()
    try:
        uvicorn.run(create_app(ctx), host=args.host, port=args.port)
    finally:
        ctx.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
