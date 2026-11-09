#!/bin/bash
# Stops colima-dashboard and removes its launchd agent. Leaves ~/.config/colima-dashboard alone.
set -euo pipefail
LABEL="local.colima-dashboard"
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
rm -f "$HOME/Library/LaunchAgents/$LABEL.plist"
echo "Removed $LABEL."
