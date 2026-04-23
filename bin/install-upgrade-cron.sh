#!/usr/bin/env bash
# install-upgrade-cron.sh — install the launchd (macOS) or cron (Linux) job
# that wakes Claude Code every 2 hours to check for upstream updates.

set -euo pipefail

# macOS launchd agents can't read paths under ~/Desktop, ~/Documents, ~/Downloads
# (TCC sandbox). Prefer the ~/.local/share/silly-code/ install copy — it's in
# ~/Library territory and launchd reads it without "Full Disk Access" grants.
INSTALL_ROOT="$HOME/.local/share/silly-code"
_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# dist tarball: bin/.lib/install-upgrade-cron.sh — go up TWO to install root
# dev repo:    bin/install-upgrade-cron.sh       — go up ONE
if [ "$(basename "$_SCRIPT_DIR")" = ".lib" ]; then
  SRC_ROOT="$(cd "$_SCRIPT_DIR/../.." && pwd)"
else
  SRC_ROOT="$(cd "$_SCRIPT_DIR/.." && pwd)"
fi

# Resolve trigger path under a given root: prefer bin/.lib/ (dist), fall back to bin/ (dev)
_trigger_for() {
  if   [ -x "$1/bin/.lib/upgrade-check.sh" ]; then echo "$1/bin/.lib/upgrade-check.sh"
  elif [ -x "$1/bin/upgrade-check.sh" ];      then echo "$1/bin/upgrade-check.sh"
  fi
}

if [ -n "$(_trigger_for "$INSTALL_ROOT")" ]; then
  ROOT_DIR="$INSTALL_ROOT"
elif [[ "$SRC_ROOT" == "$HOME/Desktop/"* || "$SRC_ROOT" == "$HOME/Documents/"* || "$SRC_ROOT" == "$HOME/Downloads/"* ]]; then
  echo "error: source tree at $SRC_ROOT is under a TCC-protected directory."
  echo "       run 'silly update apply' first so ~/.local/share/silly-code/ is populated,"
  echo "       then retry 'silly cron install'." >&2
  exit 1
else
  ROOT_DIR="$SRC_ROOT"
fi

TRIGGER="$(_trigger_for "$ROOT_DIR")"
[ -n "$TRIGGER" ] || { echo "error: upgrade-check.sh not found under $ROOT_DIR" >&2; exit 1; }
[ -x "$TRIGGER" ] || chmod +x "$TRIGGER"

if [[ "$(uname -s)" == "Darwin" ]]; then
  LABEL="com.silly-code.upgrade-check"
  PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
  LOG_DIR="$HOME/.silly-code/logs"
  mkdir -p "$LOG_DIR" "$HOME/Library/LaunchAgents"

  cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>-l</string>
    <string>-c</string>
    <string>$TRIGGER</string>
  </array>
  <key>StartCalendarInterval</key>
  <array>
    <dict>
      <key>Hour</key><integer>14</integer>
      <key>Minute</key><integer>7</integer>
    </dict>
    <dict>
      <key>Hour</key><integer>6</integer>
      <key>Minute</key><integer>7</integer>
    </dict>
  </array>
  <key>RunAtLoad</key><false/>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    <key>HOME</key><string>$HOME</string>
  </dict>
  <key>StandardOutPath</key><string>$LOG_DIR/cron-stdout.log</string>
  <key>StandardErrorPath</key><string>$LOG_DIR/cron-stderr.log</string>
  <key>ProcessType</key><string>Background</string>
  <key>Nice</key><integer>10</integer>
</dict>
</plist>
EOF

  launchctl unload "$PLIST" 2>/dev/null || true
  launchctl load -w "$PLIST"
  echo "installed launchd agent: $PLIST"
  echo "  fires at 06:07 and 14:07 local time — catches upstream's two release waves"
  echo "  (00-05 UTC + 18-21 UTC). Missed fires during sleep catch up on wake."
  echo "  logs: $LOG_DIR/upgrade-*.log"
  echo ""
  echo "  status   : silly cron status"
  echo "  run now  : silly cron run"
  echo "  uninstall: silly cron uninstall"

elif [[ "$(uname -s)" == "Linux" ]]; then
  TMPF=$(mktemp)
  crontab -l 2>/dev/null | grep -v "upgrade-check.sh" > "$TMPF" || true
  echo "7 6,22 * * * $TRIGGER" >> "$TMPF"
  crontab "$TMPF"
  rm -f "$TMPF"
  echo "installed cron entry: '7 6,22 * * * $TRIGGER'"
  echo "  fires at 06:07 + 22:07 UTC — catches both upstream release waves"

else
  echo "unsupported OS: $(uname -s)"
  exit 1
fi
