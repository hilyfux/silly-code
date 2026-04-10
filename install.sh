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

# ── ripgrep (required for file search) ───────────────────────
if ! command -v rg >/dev/null 2>&1; then
  info "Installing ripgrep to $BIN_DIR..."
  RG_VERSION="14.1.1"
  case "$(uname -s)-$(uname -m)" in
    Darwin-arm64) RG_ARCH="aarch64-apple-darwin" ;;
    Darwin-x86_64) RG_ARCH="x86_64-apple-darwin" ;;
    Linux-x86_64) RG_ARCH="x86_64-unknown-linux-musl" ;;
    Linux-aarch64) RG_ARCH="aarch64-unknown-linux-gnu" ;;
    *) RG_ARCH="" ;;
  esac
  if [ -n "$RG_ARCH" ]; then
    RG_URL="https://github.com/BurntSushi/ripgrep/releases/download/${RG_VERSION}/ripgrep-${RG_VERSION}-${RG_ARCH}.tar.gz"
    mkdir -p "$BIN_DIR"
    if curl -fsSL "$RG_URL" | tar xz -C /tmp "ripgrep-${RG_VERSION}-${RG_ARCH}/rg" 2>/dev/null; then
      mv "/tmp/ripgrep-${RG_VERSION}-${RG_ARCH}/rg" "$BIN_DIR/rg"
      chmod +x "$BIN_DIR/rg"
      rm -rf "/tmp/ripgrep-${RG_VERSION}-${RG_ARCH}"
      ok "ripgrep ${RG_VERSION} installed to $BIN_DIR/rg"
    else
      warn "Failed to download ripgrep. Install manually: https://github.com/BurntSushi/ripgrep#installation"
    fi
  else
    warn "Unknown platform $(uname -s)-$(uname -m). Install ripgrep manually."
  fi
else
  ok "ripgrep: $(rg --version | head -1)"
fi

# ── Clone or update ──────────────────────────────────────────
if [ -d "$INSTALL_DIR/.git" ]; then
  info "Updating..."
  cd "$INSTALL_DIR"
  git pull --ff-only origin main 2>/dev/null || {
    warn "Pull failed (local changes or conflict). Doing a clean re-install..."
    cd /
    if [ -f "$INSTALL_DIR/bin/silly" ]; then
      rm -rf "$INSTALL_DIR"
      git clone --depth 1 "$REPO" "$INSTALL_DIR"
    else
      err "$INSTALL_DIR exists but is not a silly-code install. Remove it manually."
    fi
  }
else
  info "Cloning silly-code..."
  if [ -d "$INSTALL_DIR" ]; then
    # Safety: only remove if it looks like a previous silly-code install or is empty
    if [ -f "$INSTALL_DIR/package.json" ] || [ -f "$INSTALL_DIR/bin/silly" ] || [ -z "$(ls -A "$INSTALL_DIR" 2>/dev/null)" ]; then
      rm -rf "$INSTALL_DIR"
    else
      err "$INSTALL_DIR exists and is not a silly-code install. Remove it manually or set SILLY_CODE_HOME to a different path."
    fi
  fi
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
  case "${SHELL:-}" in
    */zsh)  [ -f "$HOME/.zshrc" ]  && SHELL_RC="$HOME/.zshrc" ;;
    */bash) [ -f "$HOME/.bashrc" ] && SHELL_RC="$HOME/.bashrc" ;;
  esac
  # Fallback: try both if $SHELL didn't match
  if [ -z "$SHELL_RC" ]; then
    [ -f "$HOME/.zshrc" ]  && SHELL_RC="$HOME/.zshrc"
    [ -z "$SHELL_RC" ] && [ -f "$HOME/.bashrc" ] && SHELL_RC="$HOME/.bashrc"
  fi
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
# Read from /dev/tty so it works even when piped (curl | bash).
# In non-interactive environments (CI, sandbox), skip gracefully.
# Detect if we can interact with user.
# - stdin is tty: direct run (./install.sh)
# - /dev/tty openable: piped run in real terminal (curl | bash)
# - neither: CI/sandbox, skip interaction
CAN_INTERACT=false
if [ -t 0 ]; then
  CAN_INTERACT=true
elif { true < /dev/tty; } 2>/dev/null; then
  CAN_INTERACT=true
fi

if [ "$CAN_INTERACT" = true ]; then
  echo -e "  ${B}Which provider do you want to use?${N}"
  echo ""
  echo "    1) GitHub Copilot     (GitHub Copilot subscription)"
  echo "    2) OpenAI Codex       (ChatGPT Pro subscription)"
  echo "    3) Claude             (Claude Pro/Max subscription)"
  echo "    s) Skip for now"
  echo ""
  printf "  Choose [1/2/3/s]: "
  if [ -t 0 ]; then read -r CHOICE; else read -r CHOICE < /dev/tty; fi
  echo ""
  case "$CHOICE" in
    1) "$INSTALL_DIR/bin/silly" login copilot ;;
    2) "$INSTALL_DIR/bin/silly" login codex ;;
    3) "$INSTALL_DIR/bin/silly" login claude ;;
    *) info "Skipped. Run 'silly login <provider>' anytime." ;;
  esac
  echo ""
else
  info "Non-interactive mode — run 'silly login <provider>' after install."
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
