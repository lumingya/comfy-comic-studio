#!/usr/bin/env sh
# Mio Comic Studio launcher (macOS / Linux).  First run creates .venv and installs dependencies.
set -e
cd "$(dirname "$0")"
PY="${PYTHON:-python3}"
command -v "$PY" >/dev/null 2>&1 || PY=python
if [ ! -x .venv/bin/python ]; then
  echo "[mio] creating .venv ..."
  "$PY" -m venv .venv
fi
VPY="$PWD/.venv/bin/python"
STAMP=.venv/.mio-requirements
WANT=$("$VPY" -c "import hashlib;print(hashlib.sha256(open('server/requirements.txt','rb').read()).hexdigest())")
if [ ! -f "$STAMP" ] || [ "$(cat "$STAMP")" != "$WANT" ]; then
  echo "[mio] installing dependencies ..."
  "$VPY" -m pip install -q -r server/requirements.txt
  echo "$WANT" > "$STAMP"
fi
[ -f web/dist/index.html ] || echo "[mio] web/dist not built: API only (npm ci --prefix web && npm --prefix web run build)"
cd server
"$VPY" -m mio_server.update apply
echo "[mio] http://127.0.0.1:${MIO_PORT:-8788}"
exec "$VPY" -m mio_server "$@"
