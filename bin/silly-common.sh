# silly-common.sh — shared config for all silly-code launchers
# Source this file, don't execute it directly.

# ── Logging ─────────────────────────────────────────────────
G='\033[0;32m' Y='\033[0;33m' C='\033[0;36m' R='\033[0;31m' B='\033[1m' N='\033[0m'
info()  { echo -e "${C}[silly]${N} $*"; }
ok()    { echo -e "${G}[silly]${N} $*"; }
warn()  { echo -e "${Y}[silly]${N} $*"; }
err()   { echo -e "${R}[silly]${N} $*" >&2; }

# ── PATH: ensure common binary locations are reachable ──────
# Homebrew (macOS Intel + Apple Silicon), Linuxbrew, user local bin
for P in /opt/homebrew/bin /usr/local/bin /home/linuxbrew/.linuxbrew/bin "$HOME/.local/bin"; do
  case ":$PATH:" in *":$P:"*) ;; *) [ -d "$P" ] && export PATH="$P:$PATH" ;; esac
done

# ── Feature flags: DISABLED in source mode (v2.1.87 snapshot)
# Many flags reference modules from newer versions (108 "missing modules").
# Enable flags only after the corresponding module stubs/implementations exist.
# For now, we rely on the base functionality which is already full-featured.
# ── Stable core flags (tested, safe for daily use) ──────────
SILLY_FEATURES=(
  # UI / interaction
  --feature=AWAY_SUMMARY
  --feature=HISTORY_PICKER
  --feature=HOOK_PROMPTS
  --feature=KAIROS_BRIEF
  --feature=MESSAGE_ACTIONS
  --feature=NEW_INIT
  --feature=QUICK_SEARCH
  --feature=TOKEN_BUDGET
  --feature=ULTRAPLAN
  --feature=ULTRATHINK
  --feature=VOICE_MODE
  # Agent / memory
  --feature=EXTRACT_MEMORIES
  --feature=BUILTIN_EXPLORE_PLAN_AGENTS
  --feature=VERIFICATION_AGENT
  # Code intelligence
  --feature=BASH_CLASSIFIER
  --feature=CACHED_MICROCOMPACT
  --feature=COMPACTION_REMINDERS
  --feature=CONNECTOR_TEXT
  --feature=PROMPT_CACHE_BREAK_DETECTION
  --feature=TREE_SITTER_BASH
  --feature=UNATTENDED_RETRY
  # MCP
  --feature=MCP_RICH_OUTPUT
  # Auto mode
  --feature=TRANSCRIPT_CLASSIFIER
  # Sessions
  --feature=BG_SESSIONS
  --feature=WORKFLOW_SCRIPTS
  --feature=TEMPLATES
  --feature=EXPERIMENTAL_SKILL_SEARCH
  # Scheduling (required for /loop)
  --feature=AGENT_TRIGGERS
)

# ── Experimental flags (opt-in via SILLY_EXPERIMENTAL=1) ────
# These are implemented but not yet validated in real daily use.
# Enable all with: export SILLY_EXPERIMENTAL=1
if [[ "${SILLY_EXPERIMENTAL:-0}" == "1" ]]; then
  SILLY_FEATURES+=(
    --feature=KAIROS              # Full assistant mode (stub impl)
    --feature=KAIROS_CHANNELS     # Channel notifications
    --feature=COORDINATOR_MODE    # Multi-agent orchestration
    --feature=PROACTIVE           # Proactive suggestions
    --feature=DAEMON              # Background daemon
    --feature=UDS_INBOX           # Cross-session IPC
    --feature=TERMINAL_PANEL      # Terminal capture panels
    --feature=FORK_SUBAGENT       # Session fork
    --feature=MONITOR_TOOL        # Process monitoring
    --feature=WEB_BROWSER_TOOL    # Web page fetching
    --feature=AGENT_MEMORY_SNAPSHOT
    --feature=AGENT_TRIGGERS_REMOTE
    --feature=BRIDGE_MODE
    --feature=CCR_AUTO_CONNECT
    --feature=CCR_MIRROR
    --feature=CCR_REMOTE_SETUP
    --feature=LODESTONE
    --feature=SHOT_STATS
    --feature=TEAMMEM
    --feature=NATIVE_CLIPBOARD_IMAGE
    --feature=POWERSHELL_AUTO_MODE
    --feature=TREE_SITTER_BASH_SHADOW
  )
fi

# ── Default permission mode ─────────────────────────────────
# bypassPermissions by default — no confirmation prompts.
# User can override: sillyt --permission-mode default
SILLY_DEFAULT_ARGS=(
  --permission-mode bypassPermissions
)

# ── Lightweight startup dep check ──────────────────────────
# Non-blocking: only warns, never blocks launch.
# Checks at most once per day (reads deps-state.json timestamp).
_silly_check_deps() {
  local data_dir="${SILLY_CODE_DATA:-$HOME/.silly-code}"
  local state_file="$data_dir/deps-state.json"
  local now
  now=$(date +%s)

  # Skip if checked within last 24h
  if [ -f "$state_file" ]; then
    local last_ts
    last_ts=$(python3 -c "
import json, sys
from datetime import datetime
try:
    d = json.load(open('$state_file'))
    t = datetime.fromisoformat(d['lastChecked'].replace('Z','+00:00'))
    print(int(t.timestamp()))
except: print(0)
" 2>/dev/null || echo 0)
    if [ $((now - last_ts)) -lt 86400 ]; then
      return 0
    fi
  fi

  # Quick local checks only (no network)
  local root_dir
  root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
  local deps_json="$root_dir/deps.json"
  [ -f "$deps_json" ] || return 0

  if ! command -v rg >/dev/null 2>&1; then
    warn "ripgrep not found — file search will be slow. Run: silly update"
  fi
}
# Run check (suppress all errors)
_silly_check_deps 2>/dev/null || true

# To enable all flags, build with: bun run build:dev:full
# This compiles a binary with dead-code elimination that removes missing modules.
