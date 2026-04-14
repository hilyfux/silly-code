#!/usr/bin/env bash
# upgrade-check.sh — invoked by launchd every 2 hours.
#
# Cheap early exit if already current. Otherwise wakes Claude Code and lets
# the upstream-upgrade skill do the full reasoning loop: read the new
# binary, diagnose renames, patch, test, commit, push to main directly.
# Release workflow picks up the push and tags automatically.
#
# This is the PRIMARY iteration path. The GitHub Actions workflow is a
# fallback watchdog that opens Issues when Claude Code hasn't run recently.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

LOG_DIR="$HOME/.silly-code/logs"
mkdir -p "$LOG_DIR"
STAMP="$(date -u +%Y%m%d-%H%M%SZ)"
LOG="$LOG_DIR/upgrade-$STAMP.log"

# Prune old logs (keep last 30)
ls -t "$LOG_DIR"/upgrade-*.log 2>/dev/null | tail -n +31 | xargs rm -f 2>/dev/null || true

{
  echo "=== $STAMP upgrade-check ==="

  # Must be a git repo
  if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    echo "not a git repo — skip"
    exit 0
  fi

  # Safety: abort if the working tree has uncommitted changes or untracked
  # non-trivial files. Better to skip this slot than to clobber WIP.
  if ! git diff --quiet || ! git diff --cached --quiet; then
    echo "uncommitted changes present — skipping this slot to protect WIP"
    echo "run 'git status' to inspect; commit / stash to let the next slot proceed"
    exit 0
  fi
  # Untracked files are allowed (agent will ignore them) — but warn for visibility
  UNTRACKED=$(git ls-files --others --exclude-standard | head -3)
  if [ -n "$UNTRACKED" ]; then
    echo "untracked files present (agent will leave them alone):"
    echo "$UNTRACKED" | sed 's/^/  /'
  fi

  # Pull latest from origin
  git fetch origin main --quiet 2>&1 || true
  LOCAL_SHA=$(git rev-parse HEAD 2>/dev/null)
  REMOTE_SHA=$(git rev-parse origin/main 2>/dev/null)
  if [ "$LOCAL_SHA" != "$REMOTE_SHA" ]; then
    # Local has commits ahead of or diverged from origin/main — also abort
    echo "local HEAD ($LOCAL_SHA) != origin/main ($REMOTE_SHA) — skipping"
    exit 0
  fi

  CURRENT=$(node -p "require('./deps.json').deps.upstream.version" 2>/dev/null)
  LATEST=$(npm view @anthropic-ai/claude-code version 2>/dev/null || echo "")

  if [ -z "$LATEST" ]; then
    echo "npm registry unreachable — will retry next slot"
    exit 0
  fi

  echo "current=$CURRENT latest=$LATEST"

  if [ "$CURRENT" = "$LATEST" ]; then
    echo "already current — nothing to do"
    exit 0
  fi

  # Pick the Claude Code CLI to invoke.
  # Prefer standalone `claude` (user's Claude Max) over `sillyt` (avoid self-edit loops).
  if command -v claude >/dev/null 2>&1; then
    CMD=claude
  else
    echo "no 'claude' binary in PATH — install Claude Code first"
    exit 1
  fi

  echo "invoking $CMD to handle upgrade $CURRENT → $LATEST..."

  # Compose the prompt that wakes up the upstream-upgrade skill.
  # Dangerously skip permissions because launchd runs headless — no human to
  # approve file edits mid-flight. The agent operates inside this repo only.
  PROMPT="Upstream @anthropic-ai/claude-code released $LATEST (we are on $CURRENT).

This is a mechanical, playbook-driven task — do NOT invoke brainstorming, AskUserQuestion, or any skill that requires user input. The user is not watching. Follow the upstream-upgrade skill directly and make concrete decisions yourself.

Use the upstream-upgrade skill to handle the full upgrade end-to-end:
1. Run node pipeline/ci-upgrade.cjs — if it exits 1 (upgraded cleanly), verify tests and skip to step 4
2. If ci-upgrade exit is 2 (partial failure), read the failing patches and the new binary at pipeline/upstream/package/cli.js, use the grep battery from the skill to find renamed identifiers, apply the changes to pipeline/patches/*.cjs. Handle chained renames per the skill's two-phase technique.
3. Run node pipeline/patch.cjs until 82/82 pass. Run both unit tests (tests/base.test.cjs, tests/schema.test.cjs). Do the --version smoke test.
4. Run the Optimization scan from the skill (the 6 probes). Batch trivial fixes into the upgrade commit; separate non-trivial ones into follow-up commits.
5. Commit with a clear message listing the variable renames. Push directly to origin/main (no PR).
6. Run the MANDATORY Post-run self-update of the skill — add the new version column to the rename history, note any new feature scars, log troubleshooting for anything >5 min of friction.
7. If you cannot confidently resolve, stop and use gh CLI to open an issue titled 'upstream $LATEST: manual attention needed' with a summary of what you tried.

Working directory is already $ROOT_DIR. Report the final state (pushed SHA and tag, or stopped with reason)."

  exec "$CMD" -p "$PROMPT" --dangerously-skip-permissions
} 2>&1 | tee "$LOG"
