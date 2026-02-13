# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

sshfsui is a macOS/Linux tray application for mounting remote filesystems via SSHFS. Built with Electron 30.x + Electron Forge 7.4.x, ES modules throughout (`"type": "module"` in package.json). Uses Yarn for package management.

Fork of https://github.com/thekashifmalik/sshfsui — currently on branch `legacy` (main branch is `master`).

## Commands

- **Run**: `bin/run` or `yarn start` (launches via `electron-forge start`)
- **Test**: `bin/test` or `yarn test` (runs `node */**.test.js`)
- **Package**: `yarn package`
- **Build installer**: `yarn make`

## Architecture

**Electron main process** (`src/index.js`):
- Entry point. Initializes app, creates system tray with dynamic menu, sets up IPC listeners for `'add'` and `'edit'` events.
- Checks for `ssh`, `sshfs`, `timeout` binaries at startup; shows error window if missing.
- Tray menu is rebuilt via `updateTray()` after every connect/disconnect/add/delete.

**Config & Target model** (`src/config.js`):
- `Target` class: `constructor(name, url, mount)` with methods `status()`, `connect()`, `testSSH()`, `disconnect()`, `cleanupSSHFS()`.
- Config stored as flat files in `~/.sshfsui/{target-name}/` with `target` (URL) and `mount` (path) files.
- `fetchOrCreateEmptyConfig()`, `addTarget(name, url, mount)`, `deleteTarget(name)` — CRUD operations.
- Shell commands via `util.promisify(child_process.exec)` with `timeout` wrapper.

**Window factory** (`src/window.js`):
- `create(file, width, height, loadData)` — creates BrowserWindow with preload, sends `loadData` via IPC `'load'` event.

**Preload** (`src/preload.js`):
- CommonJS (required by Electron). Exposes `electronAPI` via `contextBridge`: `sendAdd`, `sendEdit`, `onLoad`.

**Renderer** (`src/renderer/`):
- `add.html/js` — form for new targets (name, url, mount). Sends via `electronAPI.sendAdd()`.
- `edit.html/js` — edit form. Receives target data via `onLoad`, sends via `electronAPI.sendEdit()`.
- `index.css` — shared styles using inline-block label/input layout (30%/46% widths).

**Forge config** (`forge.config.cjs`):
- CommonJS. Configures asar, osxSign, osxNotarize (reads APPLE_ID/APPLE_ID_PASSWORD/TEAM_ID from env via dotenv), makers for squirrel/deb/dmg, Fuses plugin.

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

## Prerequisites (runtime)

- `ssh` (OpenSSH)
- `sshfs` (via macFUSE/FUSE-T on macOS, apt on Linux)
- `timeout` (via coreutils on macOS)
