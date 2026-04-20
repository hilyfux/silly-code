# lib-deps.sh — runtime-deps helper shared by install.sh and silly-common.sh.
# Self-contained: no dependency on caller-defined err/info/warn/ok.

# $1: repo root. Returns 0 on success/skip, 1 on npm-install failure.
ensure_runtime_deps() {
  local root="$1"
  [ -f "$root/package.json" ] || return 0
  if [ -d "$root/node_modules/ws" ] && [ ! "$root/package.json" -nt "$root/node_modules" ]; then
    return 0
  fi
  echo "[silly] Installing runtime dependencies (this may take a minute)..." >&2
  (cd "$root" && npm install --no-audit --no-fund --ignore-scripts >/dev/null 2>&1) && return 0
  echo "[silly] npm install failed — run it manually in $root" >&2
  return 1
}
