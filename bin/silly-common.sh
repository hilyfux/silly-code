# silly-common.sh — shared config for all silly-code launchers
# Source this file, don't execute it directly.

# Feature flags: DISABLED in source mode (v2.1.87 snapshot)
# Many flags reference modules from newer versions (108 "missing modules").
# Enable flags only after the corresponding module stubs/implementations exist.
# For now, we rely on the base functionality which is already full-featured.
SILLY_FEATURES=(
  # Safe flags verified to work:
  --feature=VOICE_MODE
)

# To enable all flags, build with: bun run build:dev:full
# This compiles a binary with dead-code elimination that removes missing modules.
