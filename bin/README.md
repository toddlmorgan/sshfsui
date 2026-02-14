# Developer Scripts

This directory contains convenience scripts for building and developing sshfsui.

## Quick Reference

| Script | Purpose | When to Use |
|--------|---------|-------------|
| `bin/run` | Launch in dev mode | Testing changes without building |
| `bin/test` | Run tests | Verify code changes |
| `bin/install-deps.sh` | Install prerequisites | First time setup, CI/CD |
| `bin/install-local.sh` | Build + install to ~/Applications | First time developer setup |
| `bin/update-local.sh` | Rebuild + reinstall | After making code changes |
| `bin/build-local.sh` | Build only (no install) | Creating distributable artifacts |

## Typical Development Workflow

### First Time Setup

```bash
bin/install-local.sh
```

This runs:
1. `bin/install-deps.sh` — installs Node, Yarn, sshfs, sshpass, etc.
2. `bin/build-local.sh` — builds the app
3. Extracts and installs to `~/Applications/sshfsui.app`
4. Removes macOS quarantine attribute

### Iterating on Code Changes

```bash
# Make your code changes, then:
bin/update-local.sh
```

This safely:
1. Verifies you're in the sshfsui project directory
2. Checks the app path is exactly `~/Applications/sshfsui.app`
3. Validates the app bundle structure
4. Quits the running app (if any)
5. Removes the old version
6. Rebuilds and reinstalls the new version

**Safety**: Multiple guardrails prevent accidental deletion of wrong files or locations.

### Quick Testing (No Install)

```bash
# Launch in development mode
bin/run

# Or use yarn directly
yarn start
```

This launches the app without building/installing. Perfect for rapid iteration with hot reload.

## Script Details

### `install-deps.sh`

Installs all runtime and build prerequisites:
- **macOS**: Uses Homebrew to install openssh, macfuse, sshfs, coreutils, node, yarn, sshpass
- **Linux**: Uses apt to install equivalent packages
- **Idempotent**: Skips packages that are already installed

### `build-local.sh`

Builds the app with automatic code signing detection:
- Detects Apple Developer ID certificate in keychain
- **With cert + .env credentials**: Builds signed + notarized `.dmg`
- **With cert only**: Builds signed `.dmg` (no notarization)
- **Without cert**: Builds unsigned `.zip` (uses `SKIP_SIGNING=1`)

Output: `out/make/zip/darwin/x64/sshfsui-darwin-x64-0.10.0.zip` (or `.dmg` if signed)

### `install-local.sh`

Convenience wrapper that:
1. Ensures dependencies are installed (`install-deps.sh`)
2. Builds the app (`build-local.sh`)
3. Extracts the built `.zip`
4. Installs to `~/Applications/sshfsui.app`
5. Removes quarantine attribute (bypasses "unsigned app" warning)

### `update-local.sh`

Safe update script with multiple guardrails:

**Safety checks:**
1. Verifies current directory is the sshfsui project
2. Hardcodes app path as `~/Applications/sshfsui.app` (no variables)
3. Regex validation of the app path
4. Verifies target is a directory, not a file
5. Checks for `Contents/Info.plist` (valid macOS app bundle)
6. Verifies `Contents/MacOS/sshfsui` executable exists
7. Only deletes if all checks pass AND final path matches exactly

**Process:**
1. Runs all safety checks
2. Attempts to quit the app via AppleScript
3. Waits up to 5 seconds for graceful quit
4. Aborts if app is still running
5. Removes old version (with final safety check)
6. Calls `install-local.sh` to rebuild and reinstall

**Error handling:**
- Exits immediately on any error (`set -euo pipefail`)
- Validates build output exists before attempting install
- Uses temp directory for extraction (cleaned up on exit)

## Environment Variables

### For `build-local.sh` and `forge.config.cjs`

- `SKIP_SIGNING=1` — Skip code signing entirely (auto-set when no cert detected)
- `APPLE_ID` — Your Apple ID email (for notarization)
- `APPLE_ID_PASSWORD` — App-specific password (for notarization)
- `TEAM_ID` — Your Apple Developer Team ID (for notarization)

Create a `.env` file in the project root to set these for local builds.

## Troubleshooting

### "No Developer ID certificate found"

This is normal for local development. The app will build as an unsigned `.zip` file. You can still install and run it locally.

To sign the app:
1. Enroll in the Apple Developer Program
2. Create a "Developer ID Application" certificate
3. Install the certificate in your macOS Keychain

### "Cannot be opened because the developer cannot be verified"

For manual installs (not using `install-local.sh`):
```bash
xattr -d com.apple.quarantine ~/Applications/sshfsui.app
```

Or right-click the app → "Open" → confirm in the security dialog.

### Build fails with "macos-alias" errors

This is expected with Node 25+. The build script automatically uses ZIP maker instead of DMG when signing is disabled. No action needed.

### App doesn't quit during `update-local.sh`

Manually quit from the tray menu, then run `update-local.sh` again.
