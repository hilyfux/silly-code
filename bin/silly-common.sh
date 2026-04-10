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
