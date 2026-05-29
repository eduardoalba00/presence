#!/usr/bin/env bash
#
# Resync the current branch onto main after a squash-merge.
#
# Squash-merging dev -> main creates a brand-new commit on main that shares no
# history with dev, so afterward dev looks "diverged" (N ahead / M behind) even
# though its content is already on main. This fast-forwards the current branch
# onto the latest main and force-pushes it, so dev tracks main again and the
# next PR shows a clean diff.
#
# Usage:
#   scripts/resync.sh [main-branch]     # default main-branch: main
#
# Safety:
#   - Refuses to run while you're on the main branch itself.
#   - Refuses to run with uncommitted tracked changes (untracked files are left
#     alone -- reset --hard does not touch them).
#   - Uses --force-with-lease so it won't clobber commits pushed by someone else.

set -euo pipefail

MAIN="${1:-main}"
REMOTE="origin"

branch="$(git rev-parse --abbrev-ref HEAD)"

if [ "$branch" = "$MAIN" ]; then
  echo "error: you are on '$MAIN'. Switch to the branch you want to resync (e.g. dev)." >&2
  exit 1
fi

if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "error: you have uncommitted changes. Commit or stash them first." >&2
  exit 1
fi

echo "Fetching $REMOTE ..."
git fetch "$REMOTE"

echo "Resetting '$branch' to '$REMOTE/$MAIN' ..."
git reset --hard "$REMOTE/$MAIN"

echo "Force-pushing '$branch' ..."
git push --force-with-lease "$REMOTE" "$branch"

echo "Done: '$branch' is now in sync with '$REMOTE/$MAIN'."
