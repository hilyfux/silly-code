#!/usr/bin/env bash
# Fires from launchd/cron; delegates to the upstream-upgrade skill via `sillyx -p`
# (falls back to `claude -p` if sillyx is not installed) so scheduled upgrades
# consume the Codex quota instead of the user's Claude subscription.

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

  # Shell fast-path: try ci-upgrade.cjs first. If it upgrades cleanly (exit 1),
  # commit + push directly without spawning a Claude agent. Only when
  # ci-upgrade exits 2 (partial failure) do we wake the reasoning path.
  echo "$CURRENT → $LATEST — trying ci-upgrade.cjs fast path..."
  set +e
  node pipeline/ci-upgrade.cjs
  CI_EXIT=$?
  set -e

  case $CI_EXIT in
    0)
      # ci-upgrade saw current=latest (race: someone else upgraded just now)
      echo "ci-upgrade says already current (race with another run) — done"
      exit 0
      ;;
    1)
      # clean upgrade, changes staged on working tree
      echo "ci-upgrade handled $LATEST cleanly — committing without agent"
      git add -A
      git commit -m "Track 1: auto-upgrade upstream to $LATEST

Shell fast-path — varmap + content-anchor rename sweep applied cleanly,
no Claude agent needed. All 96 patches + unit tests passed before commit."
      git push origin main
      echo "pushed $LATEST (fast-path, zero agent tokens)"
      exit 0
      ;;
    2)
      # auto-fix incomplete — ask the agent to take over via sillyx (Codex)
      # so the scheduled upgrade drains the ChatGPT Pro quota instead of the
      # user's Claude subscription.
      AGENT_CMD="$(command -v sillyx 2>/dev/null || true)"
      [ -z "$AGENT_CMD" ] && AGENT_CMD="$(command -v claude 2>/dev/null || true)"
      if [ -z "$AGENT_CMD" ]; then
        echo "ci-upgrade exit 2 (manual attention needed) but no 'sillyx' or 'claude' binary — stopping"
        exit 1
      fi
      echo "ci-upgrade couldn't fully resolve — invoking $(basename "$AGENT_CMD") agent..."
      # Reset any partial state from ci-upgrade so agent starts clean
      git reset --hard HEAD --quiet
      PROMPT="Upstream @anthropic-ai/claude-code released $LATEST (current: $CURRENT). ci-upgrade.cjs just tried and exited 2 (partial failure). Invoke the upstream-upgrade skill to handle this: read the new binary, diagnose which patches still fail, apply manual renames, test, commit, push to main. Non-interactive: no brainstorming, no AskUserQuestion. If you can't confidently resolve, stop and open a GitHub issue via gh CLI. Working dir: $ROOT_DIR."
      exec "$AGENT_CMD" -p "$PROMPT" --dangerously-skip-permissions
      ;;
    *)
      echo "ci-upgrade exited $CI_EXIT (unexpected) — will retry next slot"
      git reset --hard HEAD --quiet 2>/dev/null || true
      exit 1
      ;;
  esac
} 2>&1 | tee "$LOG"
