#!/bin/bash
# silly-code installer (open-source)
# Usage: curl -fsSL https://raw.githubusercontent.com/hilyfux/silly-code/main/install.sh | bash
#
# Source-install model: clones the repo, runs the patch pipeline locally,
# wires symlinks into ~/.local/bin. No dist tarball, no relocated .lib, no
# double-spawn — the launcher reads the patched binary in place.
set -euo pipefail

# ── palette ────────────────────────────────────────────────────────
# Warm-workshop theme. Only emit color when stdout is a real TTY — piping
# to file/logger gives a clean, colorless artifact.
if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  C_RESET=$'\e[0m' ; C_DIM=$'\e[2m' ; C_BOLD=$'\e[1m' ; C_ITAL=$'\e[3m'
  C_BRAND=$'\e[38;5;215m'   # warm amber / gold
  C_LIME=$'\e[38;5;192m'    # pale lime (mascot eyes)
  C_TAN=$'\e[38;5;180m'     # tan (mascot outline)
  C_OK=$'\e[38;5;114m'      # mint green
  C_INFO=$'\e[38;5;110m'    # sky
  C_WARN=$'\e[38;5;214m'    # bright amber
  C_ERR=$'\e[38;5;174m'     # coral
  C_MUTED=$'\e[38;5;244m'   # gray
else
  C_RESET=''; C_DIM=''; C_BOLD=''; C_ITAL=''
  C_BRAND=''; C_LIME=''; C_TAN=''
  C_OK=''; C_INFO=''; C_WARN=''; C_ERR=''; C_MUTED=''
fi

# ── helpers ────────────────────────────────────────────────────────
section() { printf "\n  ${C_BOLD}${C_BRAND}▸${C_RESET} ${C_BOLD}%s${C_RESET}\n" "$1"; }
row_ok()    { printf "      ${C_OK}✓${C_RESET} %b\n" "$*"; }
row_wait()  { printf "      ${C_INFO}⋯${C_RESET} %s${C_MUTED}…${C_RESET}\n" "$*"; }
row_warn()  { printf "      ${C_WARN}▲${C_RESET} %b\n" "$*"; }
row_err()   { printf "      ${C_ERR}✕${C_RESET} %b\n" "$*" >&2; exit 1; }
row_dim()   { printf "      ${C_MUTED}%s${C_RESET}\n" "$*"; }
divider()   { printf "\n  ${C_DIM}────────────────────────────────────────────────────${C_RESET}\n"; }
# Back-compat API for any sourced snippets that still call old names.
info()  { printf "      ${C_INFO}⋯${C_RESET} %b\n" "$*"; }
ok()    { row_ok "$*"; }
warn()  { row_warn "$*"; }
err()   { row_err "$*"; }

INSTALL_DIR="${SILLY_CODE_HOME:-$HOME/.local/share/silly-code}"
BIN_DIR="$HOME/.local/bin"
REPO_URL="${SILLY_CODE_REPO:-https://github.com/hilyfux/silly-code.git}"
BRANCH="${SILLY_CODE_BRANCH:-main}"

# ── banner ─────────────────────────────────────────────────────────
printf "\n"
printf "        ${C_TAN}╭──────╮${C_RESET}          ${C_BOLD}${C_BRAND}Silly Code${C_RESET}\n"
printf "        ${C_TAN}│${C_LIME} ◕  ◕ ${C_TAN}│${C_RESET}          ${C_MUTED}──────────${C_RESET}\n"
printf "        ${C_TAN}│${C_LIME}  ▽   ${C_TAN}│${C_RESET}          ${C_ITAL}${C_MUTED}multi-provider ai${C_RESET}\n"
printf "        ${C_TAN}╰─┬──┬─╯${C_RESET}          ${C_ITAL}${C_MUTED}first-time install${C_RESET}\n"
printf "          ${C_TAN}│  │${C_RESET}\n"
printf "         ${C_TAN}╱    ╲${C_RESET}\n"

# ── prerequisites ──────────────────────────────────────────────────
section "prerequisites"
command -v git  >/dev/null 2>&1 || row_err "git is required — install via your package manager"
command -v node >/dev/null 2>&1 || row_err "node.js ≥ 20 required — install via https://nodejs.org or package manager"
NODE_MAJOR=$(node -e "process.stdout.write(process.versions.node.split('.')[0])")
[ "$NODE_MAJOR" -ge 20 ] || row_err "node.js ≥ 20 required (found $(node --version))"
row_ok "git       ${C_MUTED}$(git --version | awk '{print $3}')${C_RESET}"
row_ok "node      ${C_MUTED}$(node --version)${C_RESET}"

# ripgrep: auto-fetch on mac/linux if missing
if ! command -v rg >/dev/null 2>&1; then
  RG_VERSION="14.1.1"
  case "$(uname -s)-$(uname -m)" in
    Darwin-arm64)  RG_ARCH="aarch64-apple-darwin" ;;
    Darwin-x86_64) RG_ARCH="x86_64-apple-darwin" ;;
    Linux-x86_64)  RG_ARCH="x86_64-unknown-linux-musl" ;;
    Linux-aarch64) RG_ARCH="aarch64-unknown-linux-gnu" ;;
    *) RG_ARCH="" ;;
  esac
  if [ -n "$RG_ARCH" ]; then
    row_wait "downloading ripgrep ${RG_VERSION}"
    RG_URL="https://github.com/BurntSushi/ripgrep/releases/download/${RG_VERSION}/ripgrep-${RG_VERSION}-${RG_ARCH}.tar.gz"
    mkdir -p "$BIN_DIR"
    if curl -fsSL "$RG_URL" | tar xz -C /tmp "ripgrep-${RG_VERSION}-${RG_ARCH}/rg" 2>/dev/null; then
      mv "/tmp/ripgrep-${RG_VERSION}-${RG_ARCH}/rg" "$BIN_DIR/rg" && chmod +x "$BIN_DIR/rg"
      rm -rf "/tmp/ripgrep-${RG_VERSION}-${RG_ARCH}"
      row_ok "ripgrep   ${C_MUTED}${RG_VERSION} (installed to \$HOME/.local/bin)${C_RESET}"
    else
      row_warn "ripgrep download failed — file search will be slow until installed manually"
    fi
  else
    row_warn "unknown platform $(uname -s)-$(uname -m) — install ripgrep manually"
  fi
else
  row_ok "ripgrep   ${C_MUTED}$(rg --version | head -1 | awk '{print $2}')${C_RESET}"
fi

# ── clone or update repo ──────────────────────────────────────────
section "repo"
if [ -d "$INSTALL_DIR/.git" ]; then
  row_wait "updating checkout"
  git -C "$INSTALL_DIR" fetch --quiet origin "$BRANCH"
  git -C "$INSTALL_DIR" reset --hard --quiet "origin/$BRANCH"
elif [ -d "$INSTALL_DIR" ]; then
  if [ -d "$INSTALL_DIR/versions" ] || \
     [ -f "$INSTALL_DIR/pipeline/build/cli-patched.js" ] || \
     [ -f "$INSTALL_DIR/bin/silly" ] || \
     [ -z "$(ls -A "$INSTALL_DIR" 2>/dev/null)" ]; then
    row_warn "replacing previous install at $INSTALL_DIR"
    rm -rf "$INSTALL_DIR"
    mkdir -p "$(dirname "$INSTALL_DIR")"
    row_wait "cloning ${REPO_URL##*/}"
    git clone --quiet --branch "$BRANCH" --depth 1 "$REPO_URL" "$INSTALL_DIR"
  else
    row_err "$INSTALL_DIR exists and is not a silly-code install — remove manually or set SILLY_CODE_HOME"
  fi
else
  row_wait "cloning ${REPO_URL##*/}"
  mkdir -p "$(dirname "$INSTALL_DIR")"
  git clone --quiet --branch "$BRANCH" --depth 1 "$REPO_URL" "$INSTALL_DIR"
fi
_head="$(git -C "$INSTALL_DIR" rev-parse --short HEAD)"
row_ok "${C_MUTED}$INSTALL_DIR${C_RESET}"
row_ok "${C_BRAND}$_head${C_RESET} ${C_MUTED}origin/$BRANCH${C_RESET}"

# ── build ─────────────────────────────────────────────────────────
section "build"

# Vendor ripgrep BEFORE patch.cjs — patch.cjs fail-fasts if vendor dir empty.
RG_BIN=$(command -v rg 2>/dev/null || echo "$BIN_DIR/rg")
if [ -x "$RG_BIN" ]; then
  _arch=$(uname -m | sed 's/x86_64/x64/; s/aarch64/arm64/')
  _plat=$(uname -s | tr '[:upper:]' '[:lower:]')
  RG_VENDOR_DIR="$INSTALL_DIR/pipeline/build/vendor/ripgrep/${_arch}-${_plat}"
  mkdir -p "$RG_VENDOR_DIR"
  ln -sf "$RG_BIN" "$RG_VENDOR_DIR/rg"
  row_ok "vendor/ripgrep/${_arch}-${_plat}/rg ${C_MUTED}→ $RG_BIN${C_RESET}"
fi

row_wait "applying patches"
_t_start=$(date +%s 2>/dev/null || echo 0)
( cd "$INSTALL_DIR" && node pipeline/patch.cjs >/dev/null )
_t_end=$(date +%s 2>/dev/null || echo 0)
_dur=$((_t_end - _t_start))
_patches=$(grep -c "^  ✓" "$INSTALL_DIR/pipeline/build/cli-patched.js" 2>/dev/null || echo "0")
# patch count from patch.cjs stderr is more reliable — but we swallowed it.
# Best-effort: count '✓' lines from a dry re-read of patch.cjs (expensive);
# instead read the patch files list as a proxy.
_patches=$(grep -rhE "^\\s+patch\\(" "$INSTALL_DIR/pipeline/patches/" 2>/dev/null | wc -l | tr -d ' ')
if [ "$_dur" -gt 0 ]; then
  row_ok "${_patches}+ patches applied ${C_MUTED}(${_dur}s)${C_RESET}"
else
  row_ok "patches applied"
fi
_size=$(ls -l "$INSTALL_DIR/pipeline/build/cli-patched.js" 2>/dev/null | awk '{print $5}')
_size_mb=$(awk "BEGIN{printf \"%.1f\", $_size/1048576}")
row_ok "pipeline/build/cli-patched.js ${C_MUTED}${_size_mb} MB${C_RESET}"

if [ ! -f "$INSTALL_DIR/pipeline/build/node_modules/ws/package.json" ]; then
  row_err "vendored ws missing after patch.cjs — repo corrupt. Reinstall via the URL above."
fi

# ── commands ──────────────────────────────────────────────────────
section "commands"
mkdir -p "$BIN_DIR"
for cmd in silly sillyx sillye sillyxs sillyes; do
  cat > "$BIN_DIR/$cmd" <<WRAPPER
#!/bin/bash
exec "$INSTALL_DIR/bin/$cmd" "\$@"
WRAPPER
  chmod +x "$BIN_DIR/$cmd"
done
row_ok "${C_BRAND}silly${C_RESET}  ${C_BRAND}sillyx${C_RESET}  ${C_BRAND}sillye${C_RESET}  ${C_MUTED}sillyxs${C_RESET}  ${C_MUTED}sillyes${C_RESET}"
row_dim "installed to $BIN_DIR"

# ── PATH check ────────────────────────────────────────────────────
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
    row_warn "added to PATH in ${C_MUTED}$SHELL_RC${C_RESET} — run: ${C_BRAND}source $SHELL_RC${C_RESET}"
  else
    row_warn "add to shell profile: ${C_BRAND}export PATH=\"$BIN_DIR:\$PATH\"${C_RESET}"
  fi
fi

# ── state ─────────────────────────────────────────────────────────
DATA_DIR="${SILLY_CODE_DATA:-$HOME/.silly-code}"
mkdir -p "$DATA_DIR"
echo "{\"lastChecked\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}" > "$DATA_DIR/deps-state.json"

divider

# ── interactive login ─────────────────────────────────────────────
CAN_INTERACT=false
if [ -t 0 ]; then
  CAN_INTERACT=true
elif { true < /dev/tty; } 2>/dev/null; then
  CAN_INTERACT=true
fi

if [ "$CAN_INTERACT" = true ]; then
  SELECTED=0
  OPTIONS=("openai codex      ${C_MUTED}ChatGPT Pro subscription${C_RESET}"
           "anthropic claude  ${C_MUTED}Claude Pro / Max subscription${C_RESET}"
           "skip              ${C_MUTED}configure later with 'silly login <provider>'${C_RESET}")
  NUM_OPTIONS=${#OPTIONS[@]}

  _draw_menu() {
    [ "$1" = "redraw" ] && printf '\033[%dA' "$NUM_OPTIONS"
    for i in $(seq 0 $((NUM_OPTIONS - 1))); do
      if [ "$i" -eq "$SELECTED" ]; then
        printf "      ${C_BRAND}▸${C_RESET} ${C_BOLD}%b${C_RESET}\n" "${OPTIONS[$i]}"
      else
        printf "        %b\n" "${OPTIONS[$i]}"
      fi
    done
  }

  printf "\n  ${C_BOLD}choose your first provider${C_RESET}\n"
  printf "  ${C_MUTED}↑↓ select · Enter confirm${C_RESET}\n\n"
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

  printf "\n"
  case "$SELECTED" in
    0) "$INSTALL_DIR/bin/silly" login codex ;;
    1) "$INSTALL_DIR/bin/silly" login claude ;;
    *) row_dim "skipped — run 'silly login <provider>' anytime" ;;
  esac
  printf "\n"
else
  row_dim "non-interactive mode — run 'silly login <provider>' after install"
  printf "\n"
fi

# ── quickstart ────────────────────────────────────────────────────
printf "  ${C_BOLD}ready${C_RESET}  ${C_MUTED}· type:${C_RESET}\n\n"
printf "      ${C_BRAND}sillyx${C_RESET}              ${C_MUTED}openai codex · gpt${C_RESET}\n"
printf "      ${C_BRAND}sillye${C_RESET}              ${C_MUTED}anthropic · claude${C_RESET}\n"
printf "      ${C_DIM}${C_MUTED}sillyxs / sillyes   same, --dangerously-skip-permissions${C_RESET}\n"
printf "\n"
printf "  ${C_MUTED}update:     ${C_RESET}${C_BRAND}silly update${C_RESET}        ${C_MUTED}git pull + rebuild${C_RESET}\n"
printf "  ${C_MUTED}reinstall:  ${C_RESET}${C_DIM}curl -fsSL https://raw.githubusercontent.com/hilyfux/silly-code/main/install.sh | bash${C_RESET}\n"
printf "  ${C_MUTED}uninstall:  ${C_RESET}${C_BRAND}silly uninstall${C_RESET}\n"
printf "\n"
