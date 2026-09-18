#!/bin/sh
set -eu
cd "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
if [ -x .venv/bin/python ]; then PYTHON=.venv/bin/python
elif command -v python3 >/dev/null 2>&1; then PYTHON=python3
else PYTHON=python
fi
"$PYTHON" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else "Mio requires Python 3.10 or newer")'
if ! "$PYTHON" -c 'from PIL import Image; assert (11,3) <= tuple(map(int,Image.__version__.split(".")[:2])) < (13,0)' 2>/dev/null; then
  echo "Install image dependencies first: $PYTHON -m pip install -r packaging/requirements.txt" >&2
  exit 1
fi
exec "$PYTHON" server.py
