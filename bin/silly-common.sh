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
SILLY_FEATURES=(
  # ── All 54 verified-safe feature flags (FEATURES.md audit 2026-03-31) ──
  # Interaction / UI
  --feature=AWAY_SUMMARY
  --feature=HISTORY_PICKER
  --feature=HOOK_PROMPTS
  --feature=KAIROS_BRIEF
  --feature=KAIROS_CHANNELS
  --feature=LODESTONE
  --feature=MESSAGE_ACTIONS
  --feature=NEW_INIT
  --feature=QUICK_SEARCH
  --feature=SHOT_STATS
  --feature=TOKEN_BUDGET
  --feature=ULTRAPLAN
  --feature=ULTRATHINK
  --feature=VOICE_MODE
  # Agent / Memory / Planning
  --feature=AGENT_MEMORY_SNAPSHOT
  --feature=AGENT_TRIGGERS
  --feature=AGENT_TRIGGERS_REMOTE
  --feature=BUILTIN_EXPLORE_PLAN_AGENTS
  --feature=EXTRACT_MEMORIES
  --feature=VERIFICATION_AGENT
  # Build / Compile intelligence
  --feature=BASH_CLASSIFIER
  --feature=CACHED_MICROCOMPACT
  --feature=COMPACTION_REMINDERS
  --feature=CONNECTOR_TEXT
  --feature=NATIVE_CLIPBOARD_IMAGE
  --feature=POWERSHELL_AUTO_MODE
  --feature=PROMPT_CACHE_BREAK_DETECTION
  --feature=TREE_SITTER_BASH
  --feature=TREE_SITTER_BASH_SHADOW
  --feature=UNATTENDED_RETRY
  # Remote / Bridge
  --feature=BRIDGE_MODE
  --feature=CCR_AUTO_CONNECT
  --feature=CCR_MIRROR
  --feature=CCR_REMOTE_SETUP
  # MCP
  --feature=MCP_RICH_OUTPUT
  # Auto mode / classifier
  --feature=TRANSCRIPT_CLASSIFIER
  # Newly implemented modules
  --feature=BG_SESSIONS
  --feature=FORK_SUBAGENT
  --feature=MONITOR_TOOL
  --feature=WORKFLOW_SCRIPTS
  --feature=TEMPLATES
  --feature=DAEMON
  --feature=WEB_BROWSER_TOOL
  --feature=PROACTIVE
  --feature=EXPERIMENTAL_SKILL_SEARCH
  --feature=KAIROS
  --feature=COORDINATOR_MODE
  # Other
  --feature=TEAMMEM
)

# ── Default permission mode ─────────────────────────────────
# bypassPermissions by default — no confirmation prompts.
# User can override: sillyt --permission-mode default
SILLY_DEFAULT_ARGS=(
  --permission-mode bypassPermissions
)

# To enable all flags, build with: bun run build:dev:full
# This compiles a binary with dead-code elimination that removes missing modules.
