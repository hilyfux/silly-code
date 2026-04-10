#!/bin/bash
# silly-code uninstaller
# Usage: curl -fsSL https://raw.githubusercontent.com/hilyfux/silly-code/main/uninstall.sh | bash
set -euo pipefail

G='\033[0;32m' Y='\033[0;33m' C='\033[0;36m' R='\033[0;31m' B='\033[1m' N='\033[0m'
info()  { echo -e "${C}[silly]${N} $*"; }
ok()    { echo -e "${G}[silly]${N} $*"; }
warn()  { echo -e "${Y}[silly]${N} $*"; }

echo ""
echo -e "  ${B}silly-code${N} uninstaller"
echo ""

REMOVED=0

# ── Current install location ────────────────────────────────
INSTALL_DIR="${SILLY_CODE_HOME:-$HOME/.local/share/silly-code}"
if [ -d "$INSTALL_DIR" ]; then
  info "Removing source: $INSTALL_DIR"
  rm -rf "$INSTALL_DIR"
  ok "Removed $INSTALL_DIR"
  REMOVED=$((REMOVED + 1))
fi

# ── Legacy / old install locations ──────────────────────────
# Users who cloned to home directory
for OLD_DIR in \
  "$HOME/silly-code" \
  "$HOME/Desktop/silly-code" \
  "$HOME/Projects/silly-code" \
  "$HOME/Code/silly-code" \
  "$HOME/dev/silly-code" \
  "$HOME/src/silly-code" \
  "$HOME/.silly-code-src" \
; do
  if [ -d "$OLD_DIR" ] && [ -f "$OLD_DIR/bin/silly" ]; then
    info "Removing legacy install: $OLD_DIR"
    rm -rf "$OLD_DIR"
    ok "Removed $OLD_DIR"
    REMOVED=$((REMOVED + 1))
  fi
done

# ── Global commands (~/.local/bin) ──────────────────────────
BIN_DIR="$HOME/.local/bin"
for cmd in silly sillyt sillyx sillye; do
  if [ -f "$BIN_DIR/$cmd" ]; then
    rm -f "$BIN_DIR/$cmd"
    ok "Removed $BIN_DIR/$cmd"
    REMOVED=$((REMOVED + 1))
  fi
done

# ── Auth tokens ─────────────────────────────────────────────
DATA_DIR="$HOME/.silly-code"
if [ -d "$DATA_DIR" ]; then
  if [ -e /dev/tty ]; then
    printf "  Remove saved tokens in %s? [y/N]: " "$DATA_DIR"
    read -r CONFIRM < /dev/tty
  else
    CONFIRM="n"
  fi
  if [[ "$CONFIRM" =~ ^[Yy]$ ]]; then
    rm -rf "$DATA_DIR"
    ok "Removed tokens: $DATA_DIR"
    REMOVED=$((REMOVED + 1))
  else
    info "Kept tokens: $DATA_DIR"
  fi
fi

# ── Claude Code config referencing silly-code ────────────────
CLAUDE_DIR="$HOME/.claude"
if [ -d "$CLAUDE_DIR" ]; then
  info "Note: ~/.claude/ left intact (shared with Claude Code)"
fi

# ── npm global (if someone installed via npm by mistake) ─────
if command -v npm >/dev/null 2>&1; then
  NPM_GLOBAL="$(npm root -g 2>/dev/null || true)"
  if [ -d "$NPM_GLOBAL/silly-code" ]; then
    info "Removing npm global: silly-code"
    npm uninstall -g silly-code 2>/dev/null || true
    ok "Removed npm global silly-code"
    REMOVED=$((REMOVED + 1))
  fi
fi

# ── Summary ──────────────────────────────────────────────────
echo ""
if [ "$REMOVED" -eq 0 ]; then
  info "Nothing found to remove. silly-code may not be installed."
else
  ok "Uninstall complete. Removed $REMOVED item(s)."
fi
echo ""
