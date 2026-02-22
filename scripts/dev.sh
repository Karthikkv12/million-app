#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

CMD="${1:-start}"

# Prefer a repo-local venv, then the parent-folder venv (common in this workspace).
PYTHON_BIN=""
for candidate in "$ROOT_DIR/.venv/bin/python" "$ROOT_DIR/../.venv/bin/python"; do
  if [[ -x "$candidate" ]]; then
    PYTHON_BIN="$candidate"
    break
  fi
done

if [[ -z "$PYTHON_BIN" ]]; then
  if command -v python3 >/dev/null 2>&1; then
    PYTHON_BIN="python3"
  else
    PYTHON_BIN="python"
  fi
fi

API_HOST="${API_HOST:-127.0.0.1}"
API_PORT="${API_PORT:-8000}"
WEB_PORT="${WEB_PORT:-3000}"  # Next.js dev server

export PYTHONPATH="$ROOT_DIR"
export API_BASE_URL="${API_BASE_URL:-http://${API_HOST}:${API_PORT}}"

API_PID_FILE="$ROOT_DIR/.uvicorn.pid"
WEB_PID_FILE="$ROOT_DIR/.nextjs.pid"

is_pid_running() {
  local pid="$1"
  [[ -n "$pid" ]] && kill -0 "$pid" >/dev/null 2>&1
}

read_pidfile() {
  local f="$1"
  if [[ -f "$f" ]]; then
    tr -d '[:space:]' <"$f" || true
  fi
}

stop_pidfile() {
  local f="$1"
  local pid
  pid="$(read_pidfile "$f")"
  if is_pid_running "$pid"; then
    kill "$pid" >/dev/null 2>&1 || true
    # Give it a moment to exit cleanly.
    for _ in $(seq 1 20); do
      if ! is_pid_running "$pid"; then
        break
      fi
      sleep 0.1
    done
    if is_pid_running "$pid"; then
      kill -9 "$pid" >/dev/null 2>&1 || true
    fi
  fi
  rm -f "$f" >/dev/null 2>&1 || true
}

stop_all() {
  stop_pidfile "$WEB_PID_FILE"
  stop_pidfile "$API_PID_FILE"

  # Best-effort: also free the ports (in case pidfiles were lost).
  if command -v lsof >/dev/null 2>&1; then
    for port in "$API_PORT" "$WEB_PORT"; do
      old_pid="$(lsof -nP -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null | head -n 1 || true)"
      if [[ -n "$old_pid" ]]; then
        kill "$old_pid" >/dev/null 2>&1 || true
      fi
    done
  fi
}

status() {
  local api_pid web_pid
  api_pid="$(read_pidfile "$API_PID_FILE")"
  web_pid="$(read_pidfile "$WEB_PID_FILE")"

  if is_pid_running "$api_pid"; then
    echo "[dev] API: running (pid=$api_pid) http://${API_HOST}:${API_PORT}"
  else
    echo "[dev] API: stopped http://${API_HOST}:${API_PORT}"
  fi

  if is_pid_running "$web_pid"; then
    echo "[dev] Web (Next.js): running (pid=$web_pid) http://127.0.0.1:${WEB_PORT}"
  else
    echo "[dev] Web (Next.js): stopped http://127.0.0.1:${WEB_PORT}"
  fi

  if command -v lsof >/dev/null 2>&1; then
    lsof -nP -iTCP:"$API_PORT" -sTCP:LISTEN || true
    lsof -nP -iTCP:"$WEB_PORT" -sTCP:LISTEN || true
  fi
}

case "$CMD" in
  start) ;;
  stop)
    stop_all
    echo "[dev] Stopped"
    exit 0
    ;;
  status)
    status
    exit 0
    ;;
  *)
    echo "Usage: $(basename "$0") [start|stop|status]" >&2
    exit 2
    ;;
esac

stop_all

echo "[dev] Using python: $PYTHON_BIN"
echo "[dev] Starting API: http://${API_HOST}:${API_PORT}"
"$PYTHON_BIN" -m uvicorn backend_api.main:app --host "$API_HOST" --port "$API_PORT" --reload &
API_PID=$!
echo "$API_PID" >"$API_PID_FILE"

cleanup() {
  stop_all
}
trap cleanup EXIT INT TERM

# Wait for API health.
if command -v curl >/dev/null 2>&1; then
  for _ in $(seq 1 40); do
    if curl -fsS -m 1 "http://${API_HOST}:${API_PORT}/health" >/dev/null 2>&1; then
      break
    fi
    sleep 0.25
  done
fi

echo "[dev] Starting Next.js: http://127.0.0.1:${WEB_PORT}"
cd "$ROOT_DIR/web" && npm run dev -- --port "$WEB_PORT" &
WEB_PID=$!
cd "$ROOT_DIR"
echo "$WEB_PID" >"$WEB_PID_FILE"

wait "$API_PID" "$WEB_PID"
