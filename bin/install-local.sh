#!/usr/bin/env bash
set -euo pipefail

# Install script for local development
# Builds and installs sshfsui to ~/Applications/

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_DIR"

echo "=== sshfsui local install ==="
echo ""

# Ensure dependencies are installed
if ! command -v yarn &>/dev/null || ! command -v node &>/dev/null; then
    echo "Installing dependencies..."
    "$SCRIPT_DIR/install-deps.sh"
    echo ""
fi

# Build the app
echo "Building app..."
"$SCRIPT_DIR/build-local.sh"

if [[ $? -ne 0 ]]; then
    echo ""
    echo "ERROR: Build failed. Aborting installation."
    exit 1
fi

# Verify build output exists
ZIP_PATH=$(find "$PROJECT_DIR/out/make/zip/darwin" -name "sshfsui-darwin-*.zip" 2>/dev/null | head -1)
if [[ -z "$ZIP_PATH" ]]; then
    echo ""
    echo "ERROR: Could not find built app in out/make/zip/darwin/"
    exit 1
fi

echo ""
echo "=== Installing to ~/Applications/ ==="

# Create ~/Applications if it doesn't exist
mkdir -p ~/Applications

# Extract to temp directory first
TEMP_DIR=$(mktemp -d)
trap "rm -rf '$TEMP_DIR'" EXIT

unzip -q "$ZIP_PATH" -d "$TEMP_DIR"

# Verify we extracted exactly sshfsui.app
if [[ ! -d "$TEMP_DIR/sshfsui.app" ]]; then
    echo "ERROR: Expected sshfsui.app not found in ZIP"
    exit 1
fi

# Remove old version from ~/Applications if it exists
if [[ -d ~/Applications/sshfsui.app ]]; then
    echo "Removing old version from ~/Applications/sshfsui.app"
    rm -rf ~/Applications/sshfsui.app
fi

# Move new version
echo "Installing sshfsui.app to ~/Applications/"
mv "$TEMP_DIR/sshfsui.app" ~/Applications/

# Remove quarantine attribute (avoids "unsigned app" warning)
if command -v xattr &>/dev/null; then
    xattr -d com.apple.quarantine ~/Applications/sshfsui.app 2>/dev/null || true
fi

echo ""
echo "=== Installation complete ==="
echo "App installed to: ~/Applications/sshfsui.app"
echo ""
echo "To launch: open ~/Applications/sshfsui.app"
echo "Or: Double-click sshfsui in your ~/Applications folder"
