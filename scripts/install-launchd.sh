#!/bin/bash
# Installs colima-dashboard as a launchd agent for the current user: starts at login,
# restarts if it crashes. Re-run after pulling changes to rebuild and restart.
set -euo pipefail

if [ "$(uname -s)" != "Darwin" ]; then
  echo "This installs a macOS launchd agent. On Linux, see the systemd example in the README." >&2
  exit 1
fi
command -v node >/dev/null || { echo "Node 24 or later is needed (brew install node)." >&2; exit 1; }
if [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 24 ]; then
  echo "Node 24 or later is needed; found $(node -v)." >&2
  exit 1
fi

LABEL="local.colima-dashboard"
REPO="$(cd "$(dirname "$0")/.." && pwd)"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/Library/Logs/colima-dashboard.log"
NODE="$(command -v node)"

cd "$REPO"
npm ci --no-audit --no-fund
npm run build

mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE</string>
    <string>$REPO/server/src/index.ts</string>
  </array>
  <key>WorkingDirectory</key>
  <string>$REPO</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    <key>NODE_ENV</key>
    <string>production</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>$LOG</string>
  <key>StandardErrorPath</key>
  <string>$LOG</string>
</dict>
</plist>
PLIST

# A password is needed before anyone can sign in.
if ! node -e 'const c=require(process.argv[1]);process.exit(c.passwordHash?0:1)' "${COLIMA_DASHBOARD_CONFIG:-${XDG_CONFIG_HOME:-$HOME/.config}/colima-dashboard/config.json}" 2>/dev/null; then
  if [ -t 0 ]; then
    echo "Choose a password for colima-dashboard:"
    npm run --silent set-password
  else
    echo "No password set yet: run 'npm run set-password' and then re-run this script." >&2
  fi
fi

DOMAIN="gui/$(id -u)"
if launchctl print "$DOMAIN/$LABEL" >/dev/null 2>&1; then
  launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
  # bootout returns before the job is fully gone; bootstrap fails if it's still there.
  for _ in $(seq 1 50); do
    launchctl print "$DOMAIN/$LABEL" >/dev/null 2>&1 || break
    sleep 0.2
  done
fi
launchctl bootstrap "$DOMAIN" "$PLIST"
echo "Installed $LABEL. Logs: $LOG"
