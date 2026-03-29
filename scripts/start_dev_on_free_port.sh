#!/usr/bin/env bash
set -euo pipefail

PORT_TO_USE="${1:-5000}"

if command -v lsof >/dev/null 2>&1; then
  PIDS="$(lsof -t -iTCP:${PORT_TO_USE} -sTCP:LISTEN || true)"
  if [ -n "${PIDS}" ]; then
    echo "[info] Port ${PORT_TO_USE} is in use by PID(s): ${PIDS}. Stopping..."
    kill ${PIDS} || true
    sleep 1
  fi
fi

export PORT="${PORT_TO_USE}"
echo "[info] Starting dev server on port ${PORT}..."
npm run dev
