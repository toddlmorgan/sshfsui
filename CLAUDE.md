# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

sshfsui is a macOS/Linux tray application for mounting remote filesystems via SSHFS. Built with Electron 30.x + Electron Forge 7.4.x, ES modules throughout (`"type": "module"` in package.json). Uses Yarn for package management.

Fork of https://github.com/thekashifmalik/sshfsui — currently on branch `legacy` (main branch is `master`).

## Commands

**Development (recommended)**:
- **First-time setup**: `bin/install-local.sh` (deps → build → install to ~/Applications)
- **Update after changes**: `bin/update-local.sh` (quit → rebuild → reinstall)
- **Quick test**: `bin/run` or `yarn start` (dev mode, no install needed)
- **Run tests**: `bin/test` or `yarn test`

**Manual/CI**:
- **Install dependencies**: `bin/install-deps.sh`
- **Build only**: `bin/build-local.sh` (outputs to `out/make/`)
- **Package**: `yarn package`
- **Build installer**: `yarn make`

## Architecture

**Electron main process** (`src/index.js`):
- Entry point. Initializes app, creates system tray with dynamic menu, sets up IPC listeners for `'add'` and `'edit'` events.
- Checks for `ssh`, `sshfs`, `timeout` binaries at startup; shows error window if missing.
- Tray menu is rebuilt via `updateTray()` after every connect/disconnect/add/delete.
- IPC handlers pass `authType`, `password`, `port`, and `identityFile` through to config CRUD functions.

**Config & Target model** (`src/config.js`):
- `Target` class: `constructor(name, url, mount, authType = 'key', port = '', identityFile = '')` with methods `status()`, `connect()`, `testSSH()`, `disconnect()`, `cleanupSSHFS()`, `_decryptPassword()`, `_sshOpts()`.
- `_sshOpts()` builds SSH/SSHFS flags from `port` and `identityFile` (empty values produce no flags for backward compat).
- Config stored as flat files in `~/.sshfsui/{target-name}/` with `target` (URL), `mount` (path), `auth` (type), and optionally `credential` (encrypted password), `port`, and `identity` files.
- `fetchOrCreateEmptyConfig()`, `addTarget(name, url, mount, authType, password, port, identityFile)`, `deleteTarget(name)` — CRUD operations.
- Shell commands via `util.promisify(child_process.exec)` with `timeout` wrapper.
- Password auth: `connect()` uses `sshfs -o password_stdin` via `child_process.spawn` to pipe password via stdin (never exposed in process listing). `testSSH()` uses `sshpass -e` with `SSHPASS` env var.
- Passwords encrypted/decrypted via Electron's `safeStorage` API (backed by macOS Keychain). Credential files written with mode `0600`.
- Backward compatible: missing `auth` file defaults to `'key'` type; missing `port`/`identity` files default to `''` (use SSH defaults).

**Window factory** (`src/window.js`):
- `create(file, width, height, loadData)` — creates BrowserWindow with preload, sends `loadData` via IPC `'load'` event.

**Preload** (`src/preload.js`):
- CommonJS (required by Electron). Exposes `electronAPI` via `contextBridge`: `sendAdd`, `sendEdit`, `onLoad`.

**Renderer** (`src/renderer/`):
- `add.html/js` — form for new targets (name, url, mount, authType, password). Auth type select toggles password field visibility. Sends via `electronAPI.sendAdd()`.
- `edit.html/js` — edit form. Receives target data via `onLoad`, populates auth type. Sends via `electronAPI.sendEdit()`.
- `index.css` — shared styles using inline-block label/input/select layout (30%/46% widths).

**Forge config** (`forge.config.cjs`):
- CommonJS. Configures asar, makers for squirrel/deb/dmg/zip, Fuses plugin.
- Conditionally enables `osxSign` and `osxNotarize` unless `SKIP_SIGNING=1` env var is set.
- When `SKIP_SIGNING=1`: uses `maker-zip` instead of `maker-dmg` (avoids `macos-alias` native dep incompatibility with newer Node versions).
- Notarization only enabled when `APPLE_ID`, `APPLE_ID_PASSWORD`, and `TEAM_ID` env vars are all present (loaded via dotenv from `.env`).

**Scripts** (`bin/`):
- `run` — launches the app in development mode via `yarn run start`.
- `test` — runs tests via `yarn run test`.
- `install-deps.sh` — installs all runtime and build prerequisites (macOS via Homebrew, Linux via apt). Idempotent.
- `build-local.sh` — builds the app locally, auto-detecting code signing certificate availability. Outputs to `out/make/`.
- `install-local.sh` — **convenience**: runs `install-deps.sh` + `build-local.sh`, then installs to `~/Applications/`. First-time setup.
- `update-local.sh` — **convenience**: quits running app, rebuilds, and reinstalls to `~/Applications/`. Development iteration.
  - Multiple safety guardrails: verifies project directory, hardcoded app path, validates app bundle structure before deletion.
  - Only deletes from `~/Applications/sshfsui.app` (never `/Applications` or other locations).

## Code Style

- Mixed semicolon usage (preserve as-is per file)
- 4-space indentation
- Single quotes in JS, double quotes in HTML attributes
- No TypeScript, no linter configured
- `var` used in some places (e.g., `updateTray`), `const`/`let` elsewhere — match existing usage per file

## Key Dependencies

- `fix-path` — fixes $PATH in packaged Electron apps
- `untildify` — expands `~` in mount paths
- `command-exists` — checks for required binaries
- `sudo-prompt` — elevated mkdir for mount points
- `dotenv` — loads .env for signing credentials
- `safeStorage` (Electron built-in) — encrypts/decrypts passwords via OS keychain

## Prerequisites (runtime)

- `ssh` (OpenSSH)
- `sshfs` (via macFUSE/FUSE-T on macOS, apt on Linux)
- `timeout` (via coreutils on macOS)
- `sshpass` (only needed for password auth; via `esolitos/ipa` Homebrew tap on macOS)
