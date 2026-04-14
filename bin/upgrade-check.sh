#!/usr/bin/env bash
# Fires from launchd/cron; delegates to the upstream-upgrade skill via `claude -p`.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

LOG_DIR="$HOME/.silly-code/logs"
mkdir -p "$LOG_DIR"
STAMP="$(date -u +%Y%m%d-%H%M%SZ)"
LOG="$LOG_DIR/upgrade-$STAMP.log"

ls -t "$LOG_DIR"/upgrade-*.log 2>/dev/null | tail -n +31 | xargs rm -f 2>/dev/null || true

{
  echo "=== $STAMP upgrade-check ==="

  if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    echo "not a git repo — skip"
    exit 0
  fi

  # Abort on any WIP — better to miss a slot than clobber user's work.
  if ! git diff --quiet || ! git diff --cached --quiet; then
    echo "uncommitted changes present — skipping this slot to protect WIP"
    echo "run 'git status' to inspect; commit / stash to let the next slot proceed"
    exit 0
  fi
  UNTRACKED=$(git ls-files --others --exclude-standard | head -3)
  if [ -n "$UNTRACKED" ]; then
    echo "untracked files present (agent will leave them alone):"
    echo "$UNTRACKED" | sed 's/^/  /'
  fi

  git fetch origin main --quiet 2>&1 || true
  LOCAL_SHA=$(git rev-parse HEAD 2>/dev/null)
  REMOTE_SHA=$(git rev-parse origin/main 2>/dev/null)
  if [ "$LOCAL_SHA" != "$REMOTE_SHA" ]; then
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

  if ! command -v claude >/dev/null 2>&1; then
    echo "no 'claude' binary in PATH — install Claude Code first"
    exit 1
  fi

  echo "invoking claude to handle upgrade $CURRENT → $LATEST..."

  PROMPT="Upstream @anthropic-ai/claude-code released $LATEST (current: $CURRENT). Invoke the upstream-upgrade skill to handle this end-to-end (ci-upgrade → fix → test → commit → push to main → post-run self-update). Non-interactive: no brainstorming, no AskUserQuestion, no skills that need user input. If you can't confidently resolve, stop and open a GitHub issue via gh CLI. Working dir: $ROOT_DIR."

  exec claude -p "$PROMPT" --dangerously-skip-permissions
} 2>&1 | tee "$LOG"
