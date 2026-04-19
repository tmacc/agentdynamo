#!/usr/bin/env zsh
set -euo pipefail

# T3 Code managed file. Reapply Worktree Readiness to regenerate this file.
# Manual edits may be overwritten the next time Worktree Readiness is applied.

SCRIPT_DIR=${0:A:h}
WORKTREE_ROOT=${SCRIPT_DIR:h:h}
LOCAL_ENV_PATH="$WORKTREE_ROOT/.t3code/worktree.local.env"

if [[ -f "$LOCAL_ENV_PATH" ]]; then
  source "$LOCAL_ENV_PATH"
fi

export PORT="${T3CODE_PRIMARY_PORT:-${PORT:-41000}}"
export HOST="${HOST:-127.0.0.1}"

cd "$WORKTREE_ROOT"
exec PORT="$T3CODE_PRIMARY_PORT" HOST="$HOST" bun run dev
