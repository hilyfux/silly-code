#!/usr/bin/env bash
# Fires from launchd/cron; three daily tasks:
#   1. Version alignment  — ci-upgrade fast-path or sillyx agent
#   2. Privacy audit      — always runs; findings escalate to sillyx
#   3. Self-optimization  — sillyx updates skills/KG after any non-trivial run
#
# Sillyx (OpenAI) handles all non-trivial work so scheduled tasks drain
# the ChatGPT Pro quota instead of the user's Claude subscription.

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

# ── Task 2: Privacy audit ─────────────────────────────────────────────────────
run_privacy_audit() {
  set +e
  PRIVACY_RAW="$(node pipeline/privacy-audit.cjs 2>&1)"
  PRIVACY_EXIT=$?
  set -e
  echo "$PRIVACY_RAW"
  return $PRIVACY_EXIT
}

cleanup_logs() {
  ls -t "$LOG_DIR"/upgrade-*.log 2>/dev/null | tail -n +31 | xargs rm -f 2>/dev/null || true
}

cleanup_logs

{
  echo "=== $STAMP daily-check ==="

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

  # ── Task 1: Version alignment ──────────────────────────────────────────────
  CURRENT=$(current_version)
  LATEST=$(latest_version)
  UPGRADE_STATUS="current"   # current | fast_path | needs_agent
  CI_EXIT=""

  if [ -z "$LATEST" ]; then
    echo "npm registry unreachable — will retry next slot"
    exit 0
  fi

  echo "current=$CURRENT latest=$LATEST"

  if [ "$CURRENT" = "$LATEST" ]; then
    echo "version already current — checking other tasks"
    UPGRADE_STATUS="current"
  else
    # Shell fast-path: try ci-upgrade.cjs first.
    echo "$CURRENT → $LATEST — trying ci-upgrade.cjs fast path..."
    CI_EXIT="$(capture_ci_exit)"

    case $CI_EXIT in
      0)
        echo "ci-upgrade says already current (race with another run)"
        UPGRADE_STATUS="current"
        ;;
      1)
        # Clean upgrade — commit + push without agent
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
        UPGRADE_STATUS="fast_path"
        ;;
      2)
        # Auto-fix incomplete — will need sillyx
        echo "ci-upgrade exit 2 — manual rename sweep needed, will invoke sillyx"
        UPGRADE_STATUS="needs_agent"
        # Reset partial state so agent starts clean
        if [ "$DRY_RUN" = "1" ]; then
          echo "dry-run: would run git reset --hard HEAD --quiet"
        else
          git reset --hard HEAD --quiet
        fi
        ;;
      *)
        echo "ci-upgrade exited $CI_EXIT (unexpected) — will retry next slot"
        git reset --hard HEAD --quiet 2>/dev/null || true
        exit 1
        ;;
    esac
  fi

  # ── Task 2: Privacy audit ──────────────────────────────────────────────────
  echo "--- privacy audit ---"
  PRIVACY_STATUS="clean"
  PRIVACY_FINDINGS=""
  if node pipeline/privacy-audit.cjs > /tmp/silly-privacy-audit.json 2>&1; then
    echo "privacy audit: clean"
  else
    PRIVACY_AUDIT_EXIT=$?
    if [ "$PRIVACY_AUDIT_EXIT" = "1" ]; then
      PRIVACY_STATUS="new_endpoints"
      PRIVACY_FINDINGS="$(cat /tmp/silly-privacy-audit.json 2>/dev/null || echo '{}')"
      echo "privacy audit: NEW UNBLOCKED ENDPOINTS FOUND"
      echo "$PRIVACY_FINDINGS"
    else
      echo "privacy audit: error (exit $PRIVACY_AUDIT_EXIT) — check binary"
    fi
  fi

  # ── Decide if sillyx agent is needed ──────────────────────────────────────
  AGENT_CMD="$(resolve_agent_cmd)"

  if [ "$UPGRADE_STATUS" != "needs_agent" ] && [ "$PRIVACY_STATUS" = "clean" ]; then
    echo "all tasks clean — no agent needed today"
    exit 0
  fi

  if [ -z "$AGENT_CMD" ]; then
    if [ "$UPGRADE_STATUS" = "needs_agent" ]; then
      echo "upgrade needs manual attention but no 'sillyx' binary available — stopping"
      exit 1
    fi
    echo "privacy findings noted but no sillyx binary — see .knowledge-graph/privacy-audit-latest.json"
    exit 0
  fi

  # ── Task 3: Invoke sillyx with self-contained daily prompt ────────────────
  echo "invoking sillyx agent for daily tasks..."
  SNAPSHOT="$(read_upgrade_snapshot)"

  # Build prompt sections
  UPGRADE_SECTION=""
  if [ "$UPGRADE_STATUS" = "needs_agent" ]; then
    UPGRADE_SECTION="
## TASK 1 — Version alignment (URGENT)
Upstream @anthropic-ai/claude-code released $LATEST (current: $CURRENT).
ci-upgrade.cjs just ran and exited 2 (partial failure — auto-fix incomplete).
Execute the manual rename sweep from the sillyx-behavior skill:
  Step 1: node pipeline/patch.cjs 2>&1 | grep '✗'
  Step 2: run the grep battery (python3 inline from the skill)
  Step 3: edit the 3 patch files with new MATCH constants
  Step 4: rebuild → test → commit → push"
  else
    UPGRADE_SECTION="
## TASK 1 — Version alignment
Already at $CURRENT (latest). No upgrade needed."
  fi

  PRIVACY_SECTION=""
  if [ "$PRIVACY_STATUS" = "new_endpoints" ]; then
    PRIVACY_SECTION="
## TASK 2 — Privacy audit (ACTION REQUIRED)
pipeline/privacy-audit.cjs found unblocked telemetry endpoints:
$PRIVACY_FINDINGS

Add blocking patches in pipeline/patches/privacy.cjs for each UNBLOCKED endpoint.
Pattern: intercept the fetch/xhr in the transport layer, same as patches 30-39.
After patching: node pipeline/patch.cjs && verify endpoint no longer hits network.
Commit the new privacy patches."
  else
    PRIVACY_SECTION="
## TASK 2 — Privacy audit
Clean — all known telemetry endpoints are blocked."
  fi

  PROMPT="You are sillyx running the daily silly-code maintenance protocol.

MANDATORY FIRST STEP: Load the sillyx-behavior skill (Skill tool, name='sillyx-behavior') before doing anything else.

Working dir: $ROOT_DIR

$UPGRADE_SECTION

$PRIVACY_SECTION

## TASK 3 — Self-optimization (ALWAYS run after tasks 1 and 2)
After completing the above tasks, update the skills to lock in what you learned:
1. If any variable renames were found: add a new column to the rename history table in .claude/skills/upstream-upgrade/SKILL.md
2. If any grep battery pattern returned NOT FOUND: fix it in the skill
3. Update .knowledge-graph/work-snapshot.md with today's findings summary
4. Commit all skill/KG updates with message: 'chore(kg): daily self-optimization YYYY-MM-DD'

Non-interactive: no AskUserQuestion, no stopping midway, no brainstorming. Show evidence for every claim. If you can't confidently resolve any task, open a GitHub issue via gh CLI and stop."

  if [ -n "$SNAPSHOT" ]; then
    PROMPT="$PROMPT

Recent knowledge graph snapshot:
$SNAPSHOT"
  fi

  note_or_exec "$AGENT_CMD" "$PROMPT"
  exit 0

} 2>&1 | tee "$LOG"
