"""Print read-only static extension package diagnostics as JSON."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "server"))

from mio_server.extensions.ctk import main  # noqa: E402

if __name__ == "__main__":
    raise SystemExit(main(kind="extension"))
