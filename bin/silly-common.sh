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

  # Skip if state file modified within last 24h (avoids python3 subprocess)
  if [ -f "$state_file" ]; then
    local file_age
    if stat -f %m "$state_file" >/dev/null 2>&1; then
      file_age=$(stat -f %m "$state_file")  # macOS
    else
      file_age=$(stat -c %Y "$state_file" 2>/dev/null || echo 0)  # Linux
    fi
    if [ $((now - file_age)) -lt 86400 ]; then
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

# ── Ensure patched binary exists ──────────────────────────
ensure_patched_binary() {
  local root="${1:-$ROOT_DIR}"
  PATCHED="$root/pipeline/build/cli-patched.js"
  if [ ! -f "$PATCHED" ]; then
    info "Building patched binary (first run)..."
    node "$root/pipeline/patch.cjs" || { err "Patch build failed"; exit 1; }
  fi
}
