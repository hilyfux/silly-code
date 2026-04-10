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
# Version is read from deps.json if available (post-clone), else fallback to hardcoded
_read_rg_version() {
  if [ -f "$INSTALL_DIR/deps.json" ]; then
    python3 -c "import json; print(json.load(open('$INSTALL_DIR/deps.json'))['deps']['ripgrep']['version'])" 2>/dev/null
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
  TMP_TGZ=$(mktemp)
  npm pack @anthropic-ai/claude-code --pack-destination "$(dirname "$TMP_TGZ")" >/dev/null 2>&1 || {
    # Fallback: try the tgz in the repo root
    if ls anthropic-ai-claude-code-*.tgz 1>/dev/null 2>&1; then
      TMP_TGZ=$(ls anthropic-ai-claude-code-*.tgz | head -1)
    else
      err "Failed to fetch upstream binary. Run: npm pack @anthropic-ai/claude-code"
    fi
  }
  tar xzf "$TMP_TGZ" -C pipeline/upstream 2>/dev/null
  [ -f "$UPSTREAM_CLI" ] && ok "Upstream binary fetched" || err "Failed to extract upstream binary"
  rm -f "$TMP_TGZ" 2>/dev/null
fi

# ── Patch binary ─────────────────────────────────────────────
info "Building patched binary..."
node pipeline/patch.cjs || err "Patch build failed"
ok "Patched binary ready"

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
echo "    sillyt                # Copilot"
echo "    sillyx                # Codex"
echo "    sillye                # Claude"
echo ""
# ── Save dep check state ────────────────────────────────────
DATA_DIR="${SILLY_CODE_DATA:-$HOME/.silly-code}"
mkdir -p "$DATA_DIR"
echo "{\"lastChecked\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}" > "$DATA_DIR/deps-state.json"

echo -e "  ${B}Update:${N}    silly update          # check deps + self-update"
echo -e "  ${B}Reinstall:${N} curl -fsSL https://raw.githubusercontent.com/hilyfux/silly-code/main/install.sh | bash"
echo -e "  ${B}Uninstall:${N} silly uninstall"
echo ""
