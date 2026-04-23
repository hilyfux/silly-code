# lib-deps.sh — runtime dep verifier shared by silly-common.sh + silly.
# Self-contained: no dependency on caller-defined err/info/warn/ok.
#
# Open-source install model (Iter 102): vendored ws lives in repo at
# vendor/ws/, deployed by patch.cjs to pipeline/build/node_modules/ws.
# Zero downloads at install time, zero downloads at runtime. If the dep
# is missing the install is broken — point at reinstall instead of
# silently fetching, which would mask the underlying corruption.

# $1: repo root. Returns 0 when ws is present, 1 otherwise.
check_runtime_deps() {
  local root="$1"
  if [ -f "$root/pipeline/build/node_modules/ws/package.json" ]; then
    return 0
  fi
  echo "[silly] Runtime dep missing: pipeline/build/node_modules/ws" >&2
  echo "[silly] The install is incomplete. Reinstall:" >&2
  echo "[silly]   curl -fsSL https://raw.githubusercontent.com/hilyfux/silly-code/main/install.sh | bash" >&2
  return 1
}
