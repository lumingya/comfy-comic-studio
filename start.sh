#!/usr/bin/env sh
# Mio Comic Studio launcher (macOS / Linux).  First run creates .venv and installs dependencies.
# Arguments go to the server, e.g.  ./start.sh --port 8790   or   ./start.sh --check
# Dependency checks live in server/bootstrap.py; server/tests/test_launchers.py runs this for real.
set -e
cd "$(dirname "$0")"
PY="${PYTHON:-python3}"
command -v "$PY" >/dev/null 2>&1 || PY=python
if [ ! -x .venv/bin/python ]; then
  echo "[mio] creating .venv ..."
  "$PY" -m venv .venv
fi
VPY="$PWD/.venv/bin/python"
"$VPY" server/bootstrap.py
[ -f web/dist/index.html ] || echo "[mio] web/dist not built: API only (npm ci --prefix web && npm --prefix web run build)"
cd server
"$VPY" -m mio_server.update apply
exec "$VPY" -m mio_server "$@"
