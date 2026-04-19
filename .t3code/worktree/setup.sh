#!/usr/bin/env zsh
set -euo pipefail

# T3 Code managed file. Reapply Worktree Readiness to regenerate this file.
# Manual edits may be overwritten the next time Worktree Readiness is applied.

SCRIPT_DIR=${0:A:h}
WORKTREE_ROOT=${SCRIPT_DIR:h:h}
PROJECT_ROOT=${T3CODE_PROJECT_ROOT:-$WORKTREE_ROOT}
LOCAL_ENV_PATH="$WORKTREE_ROOT/.t3code/worktree.local.env"

mkdir -p "$WORKTREE_ROOT/.t3code"
if [[ ! -f "$LOCAL_ENV_PATH" ]]; then
  echo "Missing $LOCAL_ENV_PATH. Re-run Setup worktree from T3 Code."
  exit 1
fi

source "$LOCAL_ENV_PATH"

cd "$WORKTREE_ROOT"
bun install

echo "Worktree path: $WORKTREE_ROOT"
echo "Primary port: ${T3CODE_PRIMARY_PORT:-unknown}"
echo "App URL: http://127.0.0.1:${T3CODE_PRIMARY_PORT:-unknown}"
