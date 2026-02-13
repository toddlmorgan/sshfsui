#!/usr/bin/env bash
set -euo pipefail

# Dependency installation script for sshfsui
# Supports macOS (via Homebrew) and Linux (via apt)

echo "=== sshfsui dependency installer ==="
echo ""

install_summary=()

if [[ "$(uname)" == "Darwin" ]]; then
    echo "Detected: macOS"
    echo ""

    # Install Homebrew if missing
    if ! command -v brew &>/dev/null; then
        echo "Installing Homebrew..."
        /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
        install_summary+=("Homebrew")
    else
        echo "Homebrew: already installed"
    fi

    # openssh
    if ! brew list openssh &>/dev/null; then
        echo "Installing openssh..."
        brew install openssh
        install_summary+=("openssh")
    else
        echo "openssh: already installed"
    fi

    # macFUSE or FUSE-T
    if ! brew list --cask macfuse &>/dev/null && ! brew list --cask fuse-t &>/dev/null; then
        echo "Installing macFUSE..."
        brew install --cask macfuse
        install_summary+=("macfuse")
    else
        echo "macFUSE/FUSE-T: already installed"
    fi

    # sshfs
    if ! command -v sshfs &>/dev/null; then
        echo "Installing sshfs..."
        brew install sshfs
        install_summary+=("sshfs")
    else
        echo "sshfs: already installed"
    fi

    # coreutils (provides timeout)
    if ! brew list coreutils &>/dev/null; then
        echo "Installing coreutils (for timeout)..."
        brew install coreutils
        install_summary+=("coreutils")
    else
        echo "coreutils: already installed"
    fi

    # node
    if ! command -v node &>/dev/null; then
        echo "Installing node..."
        brew install node
        install_summary+=("node")
    else
        echo "node: already installed ($(node --version))"
    fi

    # yarn
    if ! command -v yarn &>/dev/null; then
        echo "Installing yarn..."
        brew install yarn
        install_summary+=("yarn")
    else
        echo "yarn: already installed ($(yarn --version))"
    fi

    # sshpass (from tap, needed for password auth)
    if ! command -v sshpass &>/dev/null; then
        echo "Installing sshpass..."
        brew install esolitos/ipa/sshpass
        install_summary+=("sshpass")
    else
        echo "sshpass: already installed"
    fi

elif [[ "$(uname)" == "Linux" ]]; then
    echo "Detected: Linux"
    echo ""

    PKGS=()

    command -v ssh &>/dev/null || PKGS+=(openssh-client)
    command -v sshfs &>/dev/null || PKGS+=(sshfs)
    command -v timeout &>/dev/null || PKGS+=(coreutils)
    command -v node &>/dev/null || PKGS+=(nodejs)
    command -v yarn &>/dev/null || PKGS+=(yarn)
    command -v sshpass &>/dev/null || PKGS+=(sshpass)

    if [[ ${#PKGS[@]} -gt 0 ]]; then
        echo "Installing: ${PKGS[*]}"
        sudo apt-get update
        sudo apt-get install -y "${PKGS[@]}"
        install_summary=("${PKGS[@]}")
    else
        echo "All dependencies already installed"
    fi
else
    echo "Unsupported platform: $(uname)"
    exit 1
fi

echo ""
echo "=== Summary ==="
if [[ ${#install_summary[@]} -gt 0 ]]; then
    echo "Installed: ${install_summary[*]}"
else
    echo "All dependencies were already installed. Nothing to do."
fi
echo "Done."
