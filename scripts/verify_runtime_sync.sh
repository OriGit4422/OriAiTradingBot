#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${1:-http://localhost:5000}"

echo "== Local git state =="
echo "branch: $(git rev-parse --abbrev-ref HEAD)"
echo "commit: $(git rev-parse --short HEAD)"

echo

echo "== Runtime version endpoint =="
curl -sS "${BASE_URL}/api/system/version" || {
  echo "[error] cannot reach ${BASE_URL}/api/system/version"
  exit 1
}

echo

echo "== Runtime requirements endpoint =="
curl -sS "${BASE_URL}/api/system/requirements-status" || {
  echo "[error] cannot reach ${BASE_URL}/api/system/requirements-status"
  exit 1
}

echo

echo "== Runtime diagnostics endpoint =="
curl -sS "${BASE_URL}/api/system/diagnostics" || {
  echo "[error] cannot reach ${BASE_URL}/api/system/diagnostics"
  exit 1
}

echo

echo "[ok] Runtime looks reachable. Compare runtime gitCommit/gitBranch with local output above."
