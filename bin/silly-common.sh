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
  # Slide the 24h window forward so next launch short-circuits
  touch "$state_file" 2>/dev/null
}
_silly_check_deps 2>/dev/null || true

# Prints a one-line notice if origin/main has a newer commit than this clone.
# Skipped when stdout isn't a TTY, or SILLY_QUIET is set. Network probe
# runs in the background; its result lands in a cache file for NEXT launch.
_silly_check_update() {
  [ -t 1 ] || return 0
  [ -z "${SILLY_QUIET:-}" ] || return 0

  local data_dir="${SILLY_CODE_DATA:-$HOME/.silly-code}"
  local cache="$data_dir/.remote-sha"

  # Fast path: no cache → skip the git fork entirely; just trigger refresh
  if [ ! -f "$cache" ]; then
    _silly_refresh_remote_sha "$data_dir" "$cache"
    return 0
  fi

  local root_dir local_sha remote_sha
  root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
  local_sha=$(cd "$root_dir" && git rev-parse --short HEAD 2>/dev/null) || return 0
  remote_sha=$(head -1 "$cache" 2>/dev/null | tr -d '[:space:]')
  if [ -n "$remote_sha" ] && [ "$remote_sha" != "$local_sha" ]; then
    echo -e "${Y}[silly]${N} update available (local $local_sha → remote $remote_sha) — run 'silly update apply'" >&2
  fi

  local now file_age
  now=$(date +%s)
  if stat -f %m "$cache" >/dev/null 2>&1; then
    file_age=$(stat -f %m "$cache")
  else
    file_age=$(stat -c %Y "$cache" 2>/dev/null || echo 0)
  fi
  [ $((now - file_age)) -ge 86400 ] && _silly_refresh_remote_sha "$data_dir" "$cache"
}

_silly_refresh_remote_sha() {
  local data_dir="$1" cache="$2"
  mkdir -p "$data_dir" 2>/dev/null
  (
    remote=$(curl -fsSL --max-time 2 \
      -H "Accept: application/vnd.github.v3+json" \
      "https://api.github.com/repos/hilyfux/silly-code/commits/main" 2>/dev/null \
      | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{console.log((JSON.parse(d).sha||'').slice(0,7))}catch{}})" 2>/dev/null)
    if [ -n "$remote" ] && [ ${#remote} = 7 ]; then
      echo "$remote" > "$cache"
    else
      # Touch anyway so we back off for 24h on transient failure
      touch "$cache" 2>/dev/null
    fi
  ) </dev/null >/dev/null 2>&1 &
  disown 2>/dev/null || true
}
_silly_check_update 2>/dev/null || true

# ── Auth file constants ───────────────────────────────────
# Canonical filenames for provider tokens in $SILLY_CODE_DATA.
# Adapters write -auth.json on refresh; login writes -oauth.json.
# Both must be checked for login detection.
# NOTE: these names are also hardcoded in provider adapters (string-injected,
#       can't share modules) and login.mjs. Keep them in sync manually.
CODEX_AUTH="codex-auth.json"
CODEX_OAUTH="codex-oauth.json"
CLAUDE_OAUTH="claude-oauth.json"
CLAUDE_CRED="$HOME/.claude/.credentials.json"

# shellcheck source=bin/lib-deps.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib-deps.sh"

ensure_patched_binary() {
  local root="${1:-$ROOT_DIR}"
  PATCHED="$root/pipeline/build/cli-patched.js"
  ensure_runtime_deps "$root"
  if [ ! -f "$PATCHED" ]; then
    info "Building patched binary (first run)..."
    node "$root/pipeline/patch.cjs" || { err "Patch build failed"; exit 1; }
  fi
}
