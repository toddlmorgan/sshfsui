#!/usr/bin/env bash
set -euo pipefail

# Local build script for sshfsui (macOS / Apple Silicon)
# Handles code signing detection and builds via electron-forge

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_DIR"

echo "=== sshfsui local build ==="
echo ""

# Load .env if present
if [[ -f .env ]]; then
    echo "Loading .env file..."
    set -a
    source .env
    set +a
fi

# Install node_modules if missing
if [[ ! -d node_modules ]]; then
    echo "Installing dependencies..."
    yarn install
    echo ""
fi

# Detect code signing certificate
HAS_CERT=false
if command -v security &>/dev/null; then
    if security find-identity -v -p codesigning 2>/dev/null | grep -q "Developer ID Application"; then
        HAS_CERT=true
        echo "Code signing certificate: found"
    else
        echo "Code signing certificate: not found"
    fi
else
    echo "Code signing: not available (not macOS)"
fi

echo ""

if [[ "$HAS_CERT" == "true" && -n "${APPLE_ID:-}" && -n "${APPLE_ID_PASSWORD:-}" && -n "${TEAM_ID:-}" ]]; then
    echo "Building with code signing and notarization..."
    yarn make
elif [[ "$HAS_CERT" == "true" ]]; then
    echo "WARNING: Certificate found but APPLE_ID, APPLE_ID_PASSWORD, or TEAM_ID not set."
    echo "Building with code signing but WITHOUT notarization..."
    echo "Set these in .env to enable notarization."
    echo ""
    # Build without notarization by unsetting the notarize vars
    unset APPLE_ID APPLE_ID_PASSWORD TEAM_ID
    yarn make
else
    echo "WARNING: No Developer ID certificate found. Building WITHOUT code signing."
    echo "The app will run locally but cannot be distributed."
    echo ""
    # Skip signing by removing osxSign/osxNotarize config via env
    CSC_IDENTITY_AUTO_DISCOVERY=false yarn make
fi

echo ""
echo "=== Build complete ==="
echo "Artifacts are in: $PROJECT_DIR/out/make/"
ls -la "$PROJECT_DIR/out/make/" 2>/dev/null || echo "(no output directory found)"
