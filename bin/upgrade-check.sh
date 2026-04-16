#!/usr/bin/env bash
# Fires from launchd/cron; delegates to the upstream-upgrade skill via `sillyx -p`
# so scheduled upgrades always consume the Codex quota instead of the user's
# Claude subscription.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

DRY_RUN="${SILLY_UPGRADE_CHECK_DRY_RUN:-0}"
ASSUME_CLEAN="${SILLY_UPGRADE_CHECK_ASSUME_CLEAN:-0}"
ASSUME_SYNCED="${SILLY_UPGRADE_CHECK_ASSUME_SYNCED:-0}"
OVERRIDE_CURRENT="${SILLY_UPGRADE_CHECK_CURRENT_VERSION:-}"
OVERRIDE_LATEST="${SILLY_UPGRADE_CHECK_LATEST_VERSION:-}"
OVERRIDE_CI_EXIT="${SILLY_UPGRADE_CHECK_CI_EXIT:-}"
OVERRIDE_AGENT_CMD="${SILLY_UPGRADE_CHECK_AGENT_CMD:-}"
NO_EXEC="${SILLY_UPGRADE_CHECK_NO_EXEC:-0}"
LOG_DIR="${SILLY_UPGRADE_CHECK_LOG_DIR:-$HOME/.silly-code/logs}"
mkdir -p "$LOG_DIR"
STAMP="$(date -u +%Y%m%d-%H%M%SZ)"
LOG="$LOG_DIR/upgrade-$STAMP.log"

run_or_note() {
  if [ "$DRY_RUN" = "1" ]; then
    echo "dry-run: would run $*"
    return 0
  fi
  "$@"
}

note_or_exec() {
  local agent_cmd="$1"
  local prompt="$2"
  if [ "$NO_EXEC" = "1" ]; then
    echo "dry-run: would exec $agent_cmd -p <prompt> --dangerously-skip-permissions"
    echo "dry-run: prompt=$prompt"
    return 0
  fi
  exec "$agent_cmd" -p "$prompt" --dangerously-skip-permissions
}

capture_ci_exit() {
  if [ -n "$OVERRIDE_CI_EXIT" ]; then
    echo "$OVERRIDE_CI_EXIT"
    return 0
  fi
  set +e
  node pipeline/ci-upgrade.cjs
  local ci_exit=$?
  set -e
  echo "$ci_exit"
}

current_version() {
  if [ -n "$OVERRIDE_CURRENT" ]; then
    echo "$OVERRIDE_CURRENT"
    return 0
  fi
  node -p "require('./deps.json').deps.upstream.version" 2>/dev/null
}

latest_version() {
  if [ -n "$OVERRIDE_LATEST" ]; then
    echo "$OVERRIDE_LATEST"
    return 0
  fi
  npm view @anthropic-ai/claude-code version 2>/dev/null || echo ""
}

resolve_agent_cmd() {
  if [ -n "$OVERRIDE_AGENT_CMD" ]; then
    echo "$OVERRIDE_AGENT_CMD"
    return 0
  fi
  command -v sillyx 2>/dev/null || true
}

read_upgrade_snapshot() {
  local snapshot_file="$ROOT_DIR/.knowledge-graph/work-snapshot.md"
  if [ ! -f "$snapshot_file" ]; then
    return 0
  fi
  python3 - <<'PY' "$snapshot_file"
from pathlib import Path
import sys
text = Path(sys.argv[1]).read_text().strip()
if not text:
    print("")
else:
    text = text.replace("\r", "")
    print(text[:4000])
PY
}

cleanup_logs() {
  ls -t "$LOG_DIR"/upgrade-*.log 2>/dev/null | tail -n +31 | xargs rm -f 2>/dev/null || true
}

cleanup_logs

{
  echo "=== $STAMP upgrade-check ==="

  if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    echo "not a git repo — skip"
    exit 0
  fi

  # Abort on any WIP — better to miss a slot than clobber user's work.
  if [ "$ASSUME_CLEAN" != "1" ] && { ! git diff --quiet || ! git diff --cached --quiet; }; then
    echo "uncommitted changes present — skipping this slot to protect WIP"
    echo "run 'git status' to inspect; commit / stash to let the next slot proceed"
    exit 0
  fi
  if [ "$ASSUME_CLEAN" = "1" ]; then
    echo "dry-run: assuming clean tracked worktree"
  fi
  UNTRACKED=$(git ls-files --others --exclude-standard | head -3)
  if [ -n "$UNTRACKED" ]; then
    echo "untracked files present (agent will leave them alone):"
    echo "$UNTRACKED" | sed 's/^/  /'
  fi

  if [ "$ASSUME_SYNCED" = "1" ]; then
    echo "dry-run: assuming HEAD matches origin/main"
  else
    git fetch origin main --quiet 2>&1 || true
    LOCAL_SHA=$(git rev-parse HEAD 2>/dev/null)
    REMOTE_SHA=$(git rev-parse origin/main 2>/dev/null)
    if [ "$LOCAL_SHA" != "$REMOTE_SHA" ]; then
      echo "local HEAD ($LOCAL_SHA) != origin/main ($REMOTE_SHA) — skipping"
      exit 0
    fi
  fi

  CURRENT=$(current_version)
  LATEST=$(latest_version)
  CI_EXIT=""

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
  # commit + push directly without spawning an interactive agent. Only when
  # ci-upgrade exits 2 (partial failure) do we wake the reasoning path.
  echo "$CURRENT → $LATEST — trying ci-upgrade.cjs fast path..."
  CI_EXIT="$(capture_ci_exit)"

  case $CI_EXIT in
    0)
      # ci-upgrade saw current=latest (race: someone else upgraded just now)
      echo "ci-upgrade says already current (race with another run) — done"
      exit 0
      ;;
    1)
      # clean upgrade, changes staged on working tree
      echo "ci-upgrade handled $LATEST cleanly — committing without agent"
      run_or_note git add -A
      if [ "$DRY_RUN" = "1" ]; then
        echo "dry-run: would commit Track 1: auto-upgrade upstream to $LATEST"
      else
        git commit -m "Track 1: auto-upgrade upstream to $LATEST

Shell fast-path — varmap + content-anchor rename sweep applied cleanly,
no Claude agent needed. All 96 patches + unit tests passed before commit."
      fi
      run_or_note git push origin main
      echo "pushed $LATEST (fast-path, zero agent tokens)"
      exit 0
      ;;
    2)
      # auto-fix incomplete — ask sillyx (Codex) to take over so the scheduled
      # upgrade always drains the ChatGPT Pro quota instead of the user's Claude
      # subscription.
      AGENT_CMD="$(resolve_agent_cmd)"
      if [ -z "$AGENT_CMD" ]; then
        echo "ci-upgrade exit 2 (manual attention needed) but no 'sillyx' binary is available — stopping"
        exit 1
      fi
      echo "ci-upgrade couldn't fully resolve — invoking sillyx agent..."
      # Reset any partial state from ci-upgrade so agent starts clean
      if [ "$DRY_RUN" = "1" ]; then
        echo "dry-run: would run git reset --hard HEAD --quiet"
      else
        git reset --hard HEAD --quiet
      fi
      SNAPSHOT="$(read_upgrade_snapshot)"
      PROMPT="Upstream @anthropic-ai/claude-code released $LATEST (current: $CURRENT). ci-upgrade.cjs just tried and exited 2 (partial failure).

MANDATORY FIRST STEP: Load the sillyx-behavior skill (Skill tool, name='sillyx-behavior') before doing anything else. It contains the complete manual rename sweep procedure you must follow.

Then: read the new binary with the grep battery from the skill, diagnose which patches still fail, apply manual renames to the three patch files (branding.cjs / equality.cjs / provider-engine.cjs), rebuild until 0 FAIL, run all tests, commit, push to main.

Non-interactive: no brainstorming, no AskUserQuestion, no stopping midway. Show evidence (patch count, version output, test results) in the commit message. Working dir: $ROOT_DIR."
      if [ -n "$SNAPSHOT" ]; then
        PROMPT="$PROMPT

Recent upgrade knowledge graph snapshot:
$SNAPSHOT"
      fi
      PROMPT="$PROMPT

If you can't confidently resolve, stop and open a GitHub issue via gh CLI."
      note_or_exec "$AGENT_CMD" "$PROMPT"
      exit 0
      ;;
    *)
      echo "ci-upgrade exited $CI_EXIT (unexpected) — will retry next slot"
      git reset --hard HEAD --quiet 2>/dev/null || true
      exit 1
      ;;
  esac
} 2>&1 | tee "$LOG"
