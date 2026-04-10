#!/bin/bash
# silly-code installer
# Usage: curl -fsSL https://raw.githubusercontent.com/hilyfux/silly-code/main/install.sh | bash
set -euo pipefail

G='\033[0;32m' Y='\033[0;33m' C='\033[0;36m' R='\033[0;31m' B='\033[1m' N='\033[0m'
info()  { echo -e "${C}[silly]${N} $*"; }
ok()    { echo -e "${G}[silly]${N} $*"; }
warn()  { echo -e "${Y}[silly]${N} $*"; }
err()   { echo -e "${R}[silly]${N} $*" >&2; exit 1; }

INSTALL_DIR="${SILLY_CODE_HOME:-$HOME/.local/share/silly-code}"
BIN_DIR="$HOME/.local/bin"
REPO="https://github.com/hilyfux/silly-code.git"

echo ""
echo -e "  ${B}silly-code${N} installer"
echo ""

# ── Prerequisites ────────────────────────────────────────────
command -v git >/dev/null 2>&1 || err "git is required. Install it first."

if ! command -v bun >/dev/null 2>&1; then
  info "Installing Bun..."
  curl -fsSL https://bun.sh/install | bash
  export PATH="$HOME/.bun/bin:$HOME/.local/bin:$PATH"
  command -v bun >/dev/null 2>&1 || err "Bun installation failed."
  ok "Bun installed: $(bun --version)"
else
  ok "Bun: $(bun --version)"
fi

# ── Clone or update ──────────────────────────────────────────
if [ -d "$INSTALL_DIR/.git" ]; then
  info "Updating..."
  cd "$INSTALL_DIR"
  git pull --ff-only origin main 2>/dev/null || {
    warn "Pull failed, re-cloning..."
    cd / && rm -rf "$INSTALL_DIR"
    git clone --depth 1 "$REPO" "$INSTALL_DIR"
  }
else
  info "Cloning silly-code..."
  rm -rf "$INSTALL_DIR"
  git clone --depth 1 "$REPO" "$INSTALL_DIR"
fi
cd "$INSTALL_DIR"
ok "Source: $INSTALL_DIR"

# ── Dependencies ─────────────────────────────────────────────
info "Installing dependencies..."
bun install --frozen-lockfile 2>/dev/null || bun install
ok "Dependencies installed"

# ── .env ─────────────────────────────────────────────────────
[ ! -f .env ] && cp .env.example .env 2>/dev/null || true

# ── Install commands ─────────────────────────────────────────
mkdir -p "$BIN_DIR"
for cmd in silly sillyt sillyx sillye; do
  cat > "$BIN_DIR/$cmd" << WRAPPER
#!/bin/bash
exec "$INSTALL_DIR/bin/$cmd" "\$@"
WRAPPER
  chmod +x "$BIN_DIR/$cmd"
done
ok "Commands: $BIN_DIR/{silly,sillyt,sillyx,sillye}"

# ── PATH check ───────────────────────────────────────────────
if ! echo "$PATH" | tr ':' '\n' | grep -q "^$BIN_DIR$"; then
  SHELL_RC=""
  [ -f "$HOME/.zshrc" ] && SHELL_RC="$HOME/.zshrc"
  [ -f "$HOME/.bashrc" ] && SHELL_RC="$HOME/.bashrc"
  if [ -n "$SHELL_RC" ]; then
    echo "export PATH=\"$BIN_DIR:\$PATH\"" >> "$SHELL_RC"
    ok "Added $BIN_DIR to PATH in $SHELL_RC"
    warn "Run: source $SHELL_RC  (or restart terminal)"
  else
    warn "Add to your shell profile: export PATH=\"$BIN_DIR:\$PATH\""
  fi
fi

# ── Verify ───────────────────────────────────────────────────
echo ""
ok "Installation complete!"
echo ""

# ── Interactive login ────────────────────────────────────────
# Read from /dev/tty so it works even when piped (curl | bash)
if [ -e /dev/tty ]; then
  echo -e "  ${B}Which provider do you want to use?${N}"
  echo ""
  echo "    1) GitHub Copilot     (GitHub Copilot subscription)"
  echo "    2) OpenAI Codex       (ChatGPT Pro subscription)"
  echo "    3) Claude             (Claude Pro/Max subscription)"
  echo "    s) Skip for now"
  echo ""
  printf "  Choose [1/2/3/s]: "
  read -r CHOICE < /dev/tty
  echo ""
  case "$CHOICE" in
    1) "$INSTALL_DIR/bin/silly" login copilot < /dev/tty ;;
    2) "$INSTALL_DIR/bin/silly" login codex < /dev/tty ;;
    3) "$INSTALL_DIR/bin/silly" login claude < /dev/tty ;;
    *) info "Skipped. Run 'silly login <provider>' anytime." ;;
  esac
  echo ""
fi

echo -e "  ${B}Launch:${N}"
echo "    sillyt                # Copilot"
echo "    sillyx                # Codex"
echo "    sillye                # Claude"
echo ""
echo -e "  ${B}Update:${N}    curl -fsSL https://raw.githubusercontent.com/hilyfux/silly-code/main/install.sh | bash"
echo -e "  ${B}Uninstall:${N} curl -fsSL https://raw.githubusercontent.com/hilyfux/silly-code/main/uninstall.sh | bash"
echo ""
