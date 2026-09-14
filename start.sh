#!/bin/sh
set -eu
cd "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
if [ -x .venv/bin/python ]; then PYTHON=.venv/bin/python
elif command -v python3 >/dev/null 2>&1; then PYTHON=python3
else PYTHON=python
fi
"$PYTHON" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else "Mio requires Python 3.10 or newer")'
exec "$PYTHON" server.py
