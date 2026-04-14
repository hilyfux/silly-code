#!/usr/bin/env bash
# install-upgrade-cron.sh — install the launchd (macOS) or cron (Linux) job
# that wakes Claude Code every 2 hours to check for upstream updates.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TRIGGER="$ROOT_DIR/bin/upgrade-check.sh"

if [ ! -x "$TRIGGER" ]; then
  chmod +x "$TRIGGER"
fi

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
  <key>StartInterval</key><integer>14400</integer>
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
  echo "  fires every 4h while your Mac is awake (skipped while asleep, catches up on wake)"
  echo "  logs: $LOG_DIR/upgrade-*.log"
  echo ""
  echo "  status   : silly cron status"
  echo "  run now  : silly cron run"
  echo "  uninstall: silly cron uninstall"

elif [[ "$(uname -s)" == "Linux" ]]; then
  TMPF=$(mktemp)
  crontab -l 2>/dev/null | grep -v "upgrade-check.sh" > "$TMPF" || true
  echo "17 */4 * * * $TRIGGER" >> "$TMPF"
  crontab "$TMPF"
  rm -f "$TMPF"
  echo "installed cron entry: '17 */4 * * * $TRIGGER'"
  echo "  fires every 4h at :17 while the machine is running"

else
  echo "unsupported OS: $(uname -s)"
  exit 1
fi
