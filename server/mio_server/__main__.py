"""``python -m mio_server`` — start the v3 API (and the built web UI if ``web/dist`` exists)."""

from __future__ import annotations

import argparse
import logging
import os

import uvicorn

from .api import create_app
from .context import AppContext, default_data_dir


def main() -> None:
    parser = argparse.ArgumentParser(prog="mio_server")
    parser.add_argument("--host", default=os.environ.get("MIO_HOST", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=int(os.environ.get("MIO_PORT", "8788")))
    parser.add_argument("--data", default=str(default_data_dir()), help="runtime data directory")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    ctx = AppContext.create(args.data)
    try:
        uvicorn.run(create_app(ctx), host=args.host, port=args.port)
    finally:
        ctx.close()


if __name__ == "__main__":
    main()
