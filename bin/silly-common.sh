# silly-common.sh — shared config for all silly-code launchers
# Source this file, don't execute it directly.

# ── Logging ─────────────────────────────────────────────────
G='\033[0;32m' Y='\033[0;33m' C='\033[0;36m' R='\033[0;31m' B='\033[1m' N='\033[0m'
info()  { echo -e "${C}[silly]${N} $*"; }
ok()    { echo -e "${G}[silly]${N} $*"; }
warn()  { echo -e "${Y}[silly]${N} $*"; }
err()   { echo -e "${R}[silly]${N} $*" >&2; }

# ── Feature flags: DISABLED in source mode (v2.1.87 snapshot)
# Many flags reference modules from newer versions (108 "missing modules").
# Enable flags only after the corresponding module stubs/implementations exist.
# For now, we rely on the base functionality which is already full-featured.
SILLY_FEATURES=(
  # Safe flags verified to work:
  --feature=VOICE_MODE
)

# ── Default permission mode ─────────────────────────────────
# bypassPermissions by default — no confirmation prompts.
# User can override: sillyt --permission-mode default
SILLY_DEFAULT_ARGS=(
  --permission-mode bypassPermissions
)

# To enable all flags, build with: bun run build:dev:full
# This compiles a binary with dead-code elimination that removes missing modules.
