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
echo -e "  ${C}     ╭──────╮${N}"
echo -e "  ${C}     │${G} ◕  ◕ ${C}│${N}"
echo -e "  ${C}     │${G}  ▽   ${C}│${N}"
echo -e "  ${C}     ╰─┬──┬─╯${N}"
echo -e "  ${C}       │  │${N}    ${B}silly-code${N} installer"
echo -e "  ${C}      ╱    ╲${N}"
echo ""

# ── Prerequisites ────────────────────────────────────────────
command -v git >/dev/null 2>&1 || err "git is required. Install it first."
command -v node >/dev/null 2>&1 || err "Node.js >= 20 is required. Install it first."
ok "Node: $(node --version)"

# ── ripgrep (required for file search) ───────────────────────
# Version is read from deps.json if available (post-clone), else fallback to hardcoded
_read_rg_version() {
  if [ -f "$INSTALL_DIR/deps.json" ]; then
    node -e "console.log(require('$INSTALL_DIR/deps.json').deps.ripgrep.version)" 2>/dev/null
  fi
}
if ! command -v rg >/dev/null 2>&1; then
  RG_VERSION=$(_read_rg_version)
  RG_VERSION="${RG_VERSION:-14.1.1}"
  info "Installing ripgrep ${RG_VERSION} to $BIN_DIR..."
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

# ── Fetch upstream binary ────────────────────────────────────
UPSTREAM_CLI="pipeline/upstream/package/cli.js"
if [ ! -f "$UPSTREAM_CLI" ]; then
  info "Fetching upstream Claude Code binary..."
  mkdir -p pipeline/upstream
  TMP_DIR=$(mktemp -d)
  TGZ_NAME=$(npm pack @anthropic-ai/claude-code --pack-destination "$TMP_DIR" 2>/dev/null | tail -1)
  TMP_TGZ="$TMP_DIR/$TGZ_NAME"
  [ ! -f "$TMP_TGZ" ] && TMP_TGZ=$(ls "$TMP_DIR"/anthropic-ai-claude-code-*.tgz 2>/dev/null | head -1)
  if [ -f "$TMP_TGZ" ]; then
    tar xzf "$TMP_TGZ" -C pipeline/upstream 2>/dev/null
  fi
  rm -rf "$TMP_DIR"
  [ -f "$UPSTREAM_CLI" ] && ok "Upstream binary fetched" || err "Failed to fetch upstream binary. Run: npm pack @anthropic-ai/claude-code"
fi

# ── Patch binary ─────────────────────────────────────────────
info "Building patched binary..."
node pipeline/patch.cjs || err "Patch build failed"
ok "Patched binary ready"

# ── Vendor ripgrep symlink ──────────────────────────────────
# The upstream binary looks for rg at vendor/ripgrep/<arch>-<platform>/rg
# relative to its package dir. Create symlink so the Grep tool works.
RG_BIN=$(command -v rg 2>/dev/null || echo "$BIN_DIR/rg")
if [ -x "$RG_BIN" ]; then
  _node_arch=$(uname -m | sed 's/x86_64/x64/; s/aarch64/arm64/')
  _node_plat=$(uname -s | tr '[:upper:]' '[:lower:]')
  RG_VENDOR_DIR="pipeline/build/vendor/ripgrep/${_node_arch}-${_node_plat}"
  mkdir -p "$RG_VENDOR_DIR"
  ln -sf "$RG_BIN" "$RG_VENDOR_DIR/rg"
  ok "Vendor ripgrep: $RG_VENDOR_DIR/rg → $RG_BIN"
fi

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
  if [ -n "$SHELL_RC" ] && ! grep -qF "$BIN_DIR" "$SHELL_RC" 2>/dev/null; then
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
  SELECTED=0
  OPTIONS=("GitHub Copilot     (GitHub Copilot subscription)"
           "OpenAI Codex       (ChatGPT Pro subscription)"
           "Claude             (Claude Pro/Max subscription)"
           "Skip for now")
  NUM_OPTIONS=${#OPTIONS[@]}

  # Draw menu
  _draw_menu() {
    # Move cursor up to redraw
    [ "$1" = "redraw" ] && printf '\033[%dA' "$NUM_OPTIONS"
    for i in $(seq 0 $((NUM_OPTIONS - 1))); do
      if [ "$i" -eq "$SELECTED" ]; then
        echo -e "  ${G}▸ ${OPTIONS[$i]}${N}"
      else
        echo -e "    ${OPTIONS[$i]}"
      fi
    done
  }

  echo -e "  ${B}Which provider do you want to use?${N}"
  echo -e "  ${C}(↑↓ to select, Enter to confirm)${N}"
  echo ""
  _draw_menu first

  # Read arrow keys
  while true; do
    # Read single keypress (supports piped stdin via /dev/tty)
    if [ -t 0 ]; then
      IFS= read -rsn1 KEY
    else
      IFS= read -rsn1 KEY < /dev/tty
    fi
    case "$KEY" in
      $'\x1b')  # Escape sequence (arrow keys)
        if [ -t 0 ]; then read -rsn2 SEQ; else read -rsn2 SEQ < /dev/tty; fi
        case "$SEQ" in
          '[A') # Up
            [ "$SELECTED" -gt 0 ] && SELECTED=$((SELECTED - 1))
            _draw_menu redraw
            ;;
          '[B') # Down
            [ "$SELECTED" -lt $((NUM_OPTIONS - 1)) ] && SELECTED=$((SELECTED + 1))
            _draw_menu redraw
            ;;
        esac
        ;;
      '')  # Enter
        break
        ;;
    esac
  done

  echo ""
  case "$SELECTED" in
    0) "$INSTALL_DIR/bin/silly" login copilot ;;
    1) "$INSTALL_DIR/bin/silly" login codex ;;
    2) "$INSTALL_DIR/bin/silly" login claude ;;
    *) info "Skipped. Run 'silly login <provider>' anytime." ;;
  esac
  echo ""
else
  info "Non-interactive mode — run 'silly login <provider>' after install."
  echo ""
fi

echo -e "  ${B}Launch:${N}"
echo -e "    ${G}sillyt${N}                # GitHub Copilot (GPT)"
echo -e "    ${G}sillyx${N}                # OpenAI Codex (GPT)"
echo -e "    ${G}sillye${N}                # Claude (Anthropic)"
echo ""
# ── Save dep check state ────────────────────────────────────
DATA_DIR="${SILLY_CODE_DATA:-$HOME/.silly-code}"
mkdir -p "$DATA_DIR"
echo "{\"lastChecked\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}" > "$DATA_DIR/deps-state.json"

echo -e "  ${B}Update:${N}    silly update          # check deps + self-update"
echo -e "  ${B}Reinstall:${N} curl -fsSL https://raw.githubusercontent.com/hilyfux/silly-code/main/install.sh | bash"
echo -e "  ${B}Uninstall:${N} silly uninstall"
echo ""
