#!/usr/bin/env bash
set -euo pipefail

# Update script for local development
# Safely quits, removes old version, rebuilds, and reinstalls sshfsui
# MULTIPLE SAFETY GUARDRAILS to prevent accidental deletion

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_DIR"

echo "=== sshfsui local update ==="
echo ""

# SAFETY GUARDRAIL 1: Verify we're in the sshfsui project directory
if [[ ! -f "$PROJECT_DIR/package.json" ]] || ! grep -q '"name": "sshfsui"' "$PROJECT_DIR/package.json" 2>/dev/null; then
    echo "ERROR: Not in sshfsui project directory!"
    echo "Current directory: $PROJECT_DIR"
    echo "This script must be run from the sshfsui project."
    exit 1
fi

# SAFETY GUARDRAIL 2: Define the exact app path with hardcoded app name
readonly APP_NAME="sshfsui.app"
readonly USER_APPS_DIR="$HOME/Applications"
readonly APP_PATH="$USER_APPS_DIR/$APP_NAME"

# SAFETY GUARDRAIL 3: Verify APP_PATH is exactly what we expect (no wildcards, no variables in critical parts)
if [[ "$APP_PATH" != "$HOME/Applications/sshfsui.app" ]]; then
    echo "ERROR: APP_PATH safety check failed!"
    echo "Expected: $HOME/Applications/sshfsui.app"
    echo "Got: $APP_PATH"
    exit 1
fi

# SAFETY GUARDRAIL 4: Ensure we're only targeting ~/Applications (not /Applications or anywhere else)
if [[ ! "$APP_PATH" =~ ^$HOME/Applications/sshfsui\.app$ ]]; then
    echo "ERROR: APP_PATH does not match expected pattern!"
    echo "Path: $APP_PATH"
    exit 1
fi

# SAFETY GUARDRAIL 5: If app exists, verify it's actually the sshfsui.app bundle
if [[ -e "$APP_PATH" ]]; then
    if [[ ! -d "$APP_PATH" ]]; then
        echo "ERROR: $APP_PATH exists but is not a directory!"
        echo "Refusing to delete."
        exit 1
    fi

    if [[ ! -d "$APP_PATH/Contents" ]] || [[ ! -f "$APP_PATH/Contents/Info.plist" ]]; then
        echo "ERROR: $APP_PATH does not look like a macOS app bundle!"
        echo "Missing Contents/Info.plist"
        echo "Refusing to delete."
        exit 1
    fi

    # Verify it's actually sshfsui by checking bundle identifier or executable name
    if [[ ! -f "$APP_PATH/Contents/MacOS/sshfsui" ]]; then
        echo "WARNING: $APP_PATH does not contain Contents/MacOS/sshfsui"
        echo "This may not be the sshfsui app."
        read -p "Continue anyway? (y/N) " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            echo "Aborted."
            exit 1
        fi
    fi
fi

# Check if app is running and attempt to quit it
echo "Checking if sshfsui is running..."
if pgrep -x "sshfsui" > /dev/null; then
    echo "sshfsui is running. Attempting to quit..."
    osascript -e 'quit app "sshfsui"' 2>/dev/null || true

    # Wait up to 5 seconds for it to quit
    for i in {1..10}; do
        if ! pgrep -x "sshfsui" > /dev/null; then
            echo "sshfsui quit successfully."
            break
        fi
        sleep 0.5
    done

    # If still running, warn and abort
    if pgrep -x "sshfsui" > /dev/null; then
        echo "ERROR: sshfsui is still running after quit attempt."
        echo "Please quit the app manually from the tray menu and try again."
        exit 1
    fi
fi

# Remove old version (with all safety checks passed)
if [[ -d "$APP_PATH" ]]; then
    echo "Removing old version: $APP_PATH"
    # SAFETY: One final check before rm -rf
    if [[ "$APP_PATH" == "$HOME/Applications/sshfsui.app" ]]; then
        rm -rf "$APP_PATH"
    else
        echo "ERROR: Final safety check failed before deletion!"
        exit 1
    fi
    echo "Old version removed."
else
    echo "No existing installation found at $APP_PATH"
fi

# Build and install new version
echo ""
echo "Building and installing new version..."
"$SCRIPT_DIR/install-local.sh"

echo ""
echo "=== Update complete ==="
echo "New version installed to: $APP_PATH"
