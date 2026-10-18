#!/usr/bin/env bash
set -euo pipefail

if ! git rev-parse --show-toplevel >/dev/null 2>&1; then
  echo "Blocked: not inside a Git repository."
  exit 1
fi

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

echo "Fetching origin main..."
git fetch origin main

if ! git rev-parse --verify --quiet origin/main >/dev/null; then
  echo "Blocked: origin/main does not exist after fetching."
  exit 1
fi

head_sha="$(git rev-parse --short HEAD)"
origin_main_sha="$(git rev-parse --short origin/main)"

if [ -n "$(git status --porcelain)" ]; then
  echo "Blocked: working tree has local changes. Commit, stash, or discard them before refreshing."
  git status --short
  exit 1
fi

if [ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ]; then
  echo "Fresh: already on latest origin/main ($origin_main_sha)."
  exit 0
fi

if git merge-base --is-ancestor HEAD origin/main; then
  echo "Updated: moving from $head_sha to latest origin/main ($origin_main_sha)."
  git switch --detach origin/main
  exit 0
fi

if git merge-base --is-ancestor origin/main HEAD; then
  echo "Blocked: current HEAD ($head_sha) is ahead of origin/main ($origin_main_sha)."
  exit 1
fi

echo "Blocked: current HEAD ($head_sha) has diverged from origin/main ($origin_main_sha)."
exit 1
