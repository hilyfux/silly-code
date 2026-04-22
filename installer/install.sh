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
DIST_REPO="hilyfux/silly-code"
DOWNLOAD_URL="https://github.com/${DIST_REPO}/releases/latest/download/silly-code.tar.gz"

echo ""
echo -e "  ${C}     ╭──────╮${N}"
echo -e "  ${C}     │${G} ◕  ◕ ${C}│${N}"
echo -e "  ${C}     │${G}  ▽   ${C}│${N}"
echo -e "  ${C}     ╰─┬──┬─╯${N}"
echo -e "  ${C}       │  │${N}    ${B}silly-code${N} installer"
echo -e "  ${C}      ╱    ╲${N}"
echo ""

# ── Prerequisites ────────────────────────────────────────────
command -v node >/dev/null 2>&1 || err "Node.js >= 20 is required. Install it first."
NODE_MAJOR=$(node -e "process.stdout.write(process.versions.node.split('.')[0])")
[ "$NODE_MAJOR" -ge 20 ] || err "Node.js >= 20 required (found $(node --version))."
ok "Node: $(node --version)"

# ── ripgrep ───────────────────────────────────────────────────
_rg_version_from_deps() {
  [ -f "$INSTALL_DIR/deps.json" ] && node -p "require('$INSTALL_DIR/deps.json').deps.ripgrep.version" 2>/dev/null || true
}
if ! command -v rg >/dev/null 2>&1; then
  RG_VERSION=$(_rg_version_from_deps); RG_VERSION="${RG_VERSION:-14.1.1}"
  info "Installing ripgrep ${RG_VERSION} to $BIN_DIR..."
  case "$(uname -s)-$(uname -m)" in
    Darwin-arm64)  RG_ARCH="aarch64-apple-darwin" ;;
    Darwin-x86_64) RG_ARCH="x86_64-apple-darwin" ;;
    Linux-x86_64)  RG_ARCH="x86_64-unknown-linux-musl" ;;
    Linux-aarch64) RG_ARCH="aarch64-unknown-linux-gnu" ;;
    *) RG_ARCH="" ;;
  esac
  if [ -n "$RG_ARCH" ]; then
    RG_URL="https://github.com/BurntSushi/ripgrep/releases/download/${RG_VERSION}/ripgrep-${RG_VERSION}-${RG_ARCH}.tar.gz"
    mkdir -p "$BIN_DIR"
    if curl -fsSL "$RG_URL" | tar xz -C /tmp "ripgrep-${RG_VERSION}-${RG_ARCH}/rg" 2>/dev/null; then
      mv "/tmp/ripgrep-${RG_VERSION}-${RG_ARCH}/rg" "$BIN_DIR/rg" && chmod +x "$BIN_DIR/rg"
      rm -rf "/tmp/ripgrep-${RG_VERSION}-${RG_ARCH}"
      ok "ripgrep ${RG_VERSION} installed"
    else
      warn "Failed to download ripgrep. Install manually: https://github.com/BurntSushi/ripgrep#installation"
    fi
  else
    warn "Unknown platform $(uname -s)-$(uname -m). Install ripgrep manually."
  fi
else
  ok "ripgrep: $(rg --version | head -1)"
fi

# ── Download dist tarball ─────────────────────────────────────
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

info "Downloading silly-code..."
curl -fsSL "$DOWNLOAD_URL" -o "$TMP/silly-code.tar.gz" \
  || err "Download failed. Visit https://github.com/${DIST_REPO}/releases"

# ── Extract ───────────────────────────────────────────────────
if [ -d "$INSTALL_DIR" ]; then
  if [ -d "$INSTALL_DIR/versions" ] || \
     [ -f "$INSTALL_DIR/pipeline/build/cli-patched.js" ] || \
     [ -f "$INSTALL_DIR/bin/silly" ] || \
     [ -d "$INSTALL_DIR/.git" ] || \
     [ -z "$(ls -A "$INSTALL_DIR" 2>/dev/null)" ]; then
    rm -rf "$INSTALL_DIR"
  else
    err "$INSTALL_DIR exists and is not a silly-code install. Remove it manually or set SILLY_CODE_HOME."
  fi
fi
mkdir -p "$INSTALL_DIR"
tar -xzf "$TMP/silly-code.tar.gz" -C "$INSTALL_DIR" --strip-components=1
ok "Installed: $INSTALL_DIR"

# ── Runtime deps ──────────────────────────────────────────────────────────────
# Dist and dev installs share the same helper; it installs runtime deps only when needed.
if [ -f "$INSTALL_DIR/bin/.lib/lib-deps.sh" ]; then
  source "$INSTALL_DIR/bin/.lib/lib-deps.sh"
  ensure_runtime_deps "$INSTALL_DIR" || warn "npm install failed — sillyx/sillye may not work"
fi

# ── Vendor ripgrep symlink ─────────────────────────────────────
RG_BIN=$(command -v rg 2>/dev/null || echo "$BIN_DIR/rg")
if [ -x "$RG_BIN" ]; then
  _arch=$(uname -m | sed 's/x86_64/x64/; s/aarch64/arm64/')
  _plat=$(uname -s | tr '[:upper:]' '[:lower:]')
  RG_VENDOR_DIR="$INSTALL_DIR/pipeline/build/vendor/ripgrep/${_arch}-${_plat}"
  mkdir -p "$RG_VENDOR_DIR"
  ln -sf "$RG_BIN" "$RG_VENDOR_DIR/rg"
fi

# ── Install commands ───────────────────────────────────────────
mkdir -p "$BIN_DIR"
for cmd in silly sillyx sillye sillyxs sillyes; do
  cat > "$BIN_DIR/$cmd" << WRAPPER
#!/bin/bash
exec "$INSTALL_DIR/bin/$cmd" "\$@"
WRAPPER
  chmod +x "$BIN_DIR/$cmd"
done
ok "Commands: $BIN_DIR/{silly,sillyx,sillye,sillyxs,sillyes}"

# ── PATH check ────────────────────────────────────────────────
if ! echo "$PATH" | tr ':' '\n' | grep -q "^$BIN_DIR$"; then
  SHELL_RC=""
  case "${SHELL:-}" in
    */zsh)  [ -f "$HOME/.zshrc" ]  && SHELL_RC="$HOME/.zshrc" ;;
    */bash) [ -f "$HOME/.bashrc" ] && SHELL_RC="$HOME/.bashrc" ;;
  esac
  [ -z "$SHELL_RC" ] && [ -f "$HOME/.zshrc" ]  && SHELL_RC="$HOME/.zshrc"
  [ -z "$SHELL_RC" ] && [ -f "$HOME/.bashrc" ] && SHELL_RC="$HOME/.bashrc"
  if [ -n "$SHELL_RC" ] && ! grep -qF "$BIN_DIR" "$SHELL_RC" 2>/dev/null; then
    echo "export PATH=\"$BIN_DIR:\$PATH\"" >> "$SHELL_RC"
    ok "Added $BIN_DIR to PATH in $SHELL_RC"
    warn "Run: source $SHELL_RC  (or restart terminal)"
  else
    warn "Add to your shell profile: export PATH=\"$BIN_DIR:\$PATH\""
  fi
fi

# ── Save state ────────────────────────────────────────────────
DATA_DIR="${SILLY_CODE_DATA:-$HOME/.silly-code}"
mkdir -p "$DATA_DIR"
echo "{\"lastChecked\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}" > "$DATA_DIR/deps-state.json"

echo ""
ok "Installation complete!"
echo ""

# ── Interactive login ──────────────────────────────────────────
CAN_INTERACT=false
if [ -t 0 ]; then
  CAN_INTERACT=true
elif { true < /dev/tty; } 2>/dev/null; then
  CAN_INTERACT=true
fi

if [ "$CAN_INTERACT" = true ]; then
  SELECTED=0
  OPTIONS=("OpenAI Codex       (ChatGPT Pro subscription)"
           "Claude             (Claude Pro/Max subscription)"
           "Skip for now")
  NUM_OPTIONS=${#OPTIONS[@]}

  _draw_menu() {
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

  while true; do
    if [ -t 0 ]; then IFS= read -rsn1 KEY
    else IFS= read -rsn1 KEY < /dev/tty; fi
    case "$KEY" in
      $'\x1b')
        if [ -t 0 ]; then read -rsn2 SEQ; else read -rsn2 SEQ < /dev/tty; fi
        case "$SEQ" in
          '[A') [ "$SELECTED" -gt 0 ] && SELECTED=$((SELECTED - 1)); _draw_menu redraw ;;
          '[B') [ "$SELECTED" -lt $((NUM_OPTIONS - 1)) ] && SELECTED=$((SELECTED + 1)); _draw_menu redraw ;;
        esac ;;
      '') break ;;
    esac
  done

  echo ""
  case "$SELECTED" in
    0) "$INSTALL_DIR/bin/silly" login codex ;;
    1) "$INSTALL_DIR/bin/silly" login claude ;;
    *) info "Skipped. Run 'silly login <provider>' anytime." ;;
  esac
  echo ""
else
  info "Non-interactive mode — run 'silly login <provider>' after install."
  echo ""
fi

echo -e "  ${B}Launch:${N}"
echo -e "    ${G}sillyx${N}                # OpenAI Codex (GPT)"
echo -e "    ${G}sillye${N}                # Claude (Anthropic)"
echo -e "    ${G}sillyxs/es${N}            # same providers, --dangerously-skip-permissions"
echo ""
echo -e "  ${B}Update:${N}    silly update"
echo -e "  ${B}Reinstall:${N} curl -fsSL https://raw.githubusercontent.com/hilyfux/silly-code/main/install.sh | bash"
echo -e "  ${B}Uninstall:${N} silly uninstall"
echo ""
