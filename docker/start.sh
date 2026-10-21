#!/usr/bin/env bash
# Container entrypoint: install pinned deps into a persistent venv, then run.
# The compose file mounts ./venv at /app/.venv so restarts skip pip.
set -euo pipefail

APP_DIR="${APP_DIR:-/app}"
REQ_FILE="${REQ_FILE:-$APP_DIR/requirements.txt}"
VENV_DIR="${VENV_DIR:-$APP_DIR/.venv}"
STAMP="$VENV_DIR/.req.sha256"

# Linux venvs use bin/, Windows uses Scripts/. The latter only matters for
# local smoke tests; the container always takes the bin/ branch.
resolve_bin() {
  if [ -x "$VENV_DIR/bin/python" ] || [ -x "$VENV_DIR/bin/python.exe" ]; then
    printf '%s\n' "$VENV_DIR/bin"
  else
    printf '%s\n' "$VENV_DIR/Scripts"
  fi
}

BIN_DIR="$(resolve_bin)"
want="$(sha256sum "$REQ_FILE" | cut -d' ' -f1)"
have="$(cat "$STAMP" 2>/dev/null || true)"

if [ "$want" != "$have" ] || [ ! -x "$BIN_DIR/uvicorn" ]; then
  echo "[teleprompter] installing dependencies from $REQ_FILE ..."
  python -m venv "$VENV_DIR"
  BIN_DIR="$(resolve_bin)"
  "$BIN_DIR/pip" install --no-cache-dir --disable-pip-version-check -r "$REQ_FILE"
  printf '%s\n' "$want" > "$STAMP"
  echo "[teleprompter] dependencies ready"
fi

echo "[teleprompter] starting on ${HOST:-0.0.0.0}:${PORT:-8000}"
exec "$BIN_DIR/uvicorn" app.main:app \
  --host "${HOST:-0.0.0.0}" \
  --port "${PORT:-8000}" \
  --app-dir "$APP_DIR"
