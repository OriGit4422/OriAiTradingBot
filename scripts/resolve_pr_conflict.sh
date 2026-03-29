#!/usr/bin/env bash
set -euo pipefail

BASE_BRANCH="${1:-main}"
CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"

echo "[info] current branch: ${CURRENT_BRANCH}"
echo "[info] target base branch: ${BASE_BRANCH}"

echo "[step] fetching latest remote refs..."
git fetch origin

echo "[step] rebasing ${CURRENT_BRANCH} onto origin/${BASE_BRANCH}..."
if ! git rebase "origin/${BASE_BRANCH}"; then
  echo "[warn] rebase has conflicts. Resolve them, then run:"
  echo "       git add <resolved-files>"
  echo "       git rebase --continue"
  echo "[hint] to find conflict markers in source files:"
  echo "       rg -n '<<<<<<<|=======|>>>>>>>' --glob '!docs/**'"
  exit 1
fi

echo "[step] checking for unresolved conflict markers in source files..."
if rg -n '<<<<<<<|=======|>>>>>>>' --glob '!docs/**' >/dev/null; then
  echo "[error] conflict markers still exist in source files. Resolve them before pushing."
  exit 1
fi

echo "[step] done. push with:"
echo "       git push --force-with-lease origin ${CURRENT_BRANCH}"
