import * as child_process from "child_process";

import fixPath from 'fix-path';
import { app, Tray, Menu, nativeImage, ipcMain, shell } from 'electron'
import { promises as fs } from "fs";
import { existsSync } from "fs";
import commandExists from 'command-exists';
import untildify from 'untildify';

import * as config from './config.js';
import * as window from './window.js';

const appPath = app.getAppPath();

// Load HTML templates
const errorHTMLSSH = await fs.readFile(appPath + '/src/partials/error-ssh.html', { encoding: 'utf8' });
const errorHTMLSSHFS = await fs.readFile(appPath + '/src/partials/error-sshfs.html', { encoding: 'utf8' });
const errorHTMLTimeout = await fs.readFile(appPath + '/src/partials/error-timeout.html', { encoding: 'utf8' });

// Load icons
const icon = nativeImage.createFromPath(appPath + '/assets/tray.png');
const iconDisconnected = nativeImage.createFromPath(appPath + '/assets/disconnected.png');
const iconConnected = nativeImage.createFromPath(appPath + '/assets/connected.png');
const iconConnecting = nativeImage.createFromPath(appPath + '/assets/connecting.png');

// In-memory connection state: target.name → 'connecting' | 'connected' | 'disconnected'
const connectionStates = new Map();
// Item counts after mount: target.name → number
const mountItemCounts = new Map();
// Last error per target: target.name → string
const lastErrors = new Map();

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
    app.quit();
}

app.whenReady().then(main);

async function main() {
    fixPath();
    const error = await checkDependenciesAndMaybeReturnError();
    if (error) {
        await window.create('src/renderer/error.html', 320, 120, { html: true, content: error });
        return;
    }

    const tray = new Tray(icon);
    await updateTray(tray);

    // Auto-connect targets with autoconnect enabled
    const targets = config.fetchOrCreateEmptyConfig();
    for (const target of targets) {
        if (target.autoconnect) {
            const connected = await target.status();
            if (!connected) {
                connectionStates.set(target.name, 'connecting');
                await updateTray(tray);
                try {
                    await target.connect();
                    connectionStates.set(target.name, 'connected');
                    lastErrors.delete(target.name);
                    const count = await waitForMountContent(target.mount);
                    if (count > 0) mountItemCounts.set(target.name, count);
                } catch (e) {
                    connectionStates.set(target.name, 'disconnected');
                    const errMsg = `Auto-connect failed for ${target.name}: ${e.message}`;
                    lastErrors.set(target.name, errMsg);
                    console.error(errMsg);
                    await window.create('src/renderer/error.html', 480, 160, errMsg);
                }
            }
        }
    }
    await updateTray(tray);

    ipcMain.on('add', async (event, data) => {
        try {
            config.addTarget(data.name, data.url, data.mount, data.authType, data.password, data.port, data.identityFile, data.sshOptions, data.autoconnect || false);
        } catch (e) {
            await window.create('src/renderer/error.html', 480, 160, e.message);
        }
        await updateTray(tray);
    });
    ipcMain.on('edit', async (event, data) => {
        try {
            config.updateTarget(data.initialName, data.target.name, data.target.url, data.target.mount, data.target.authType, data.target.password, data.target.port, data.target.identityFile, data.target.sshOptions, data.target.autoconnect || false);
        } catch (e) {
            await window.create('src/renderer/error.html', 480, 160, e.message);
        }
        await updateTray(tray);
    });
    ipcMain.handle('validate', (event, data) => {
        const errors = [];
        if (data.port) {
            const p = parseInt(data.port, 10);
            if (isNaN(p) || p < 1 || p > 65535 || String(p) !== data.port) {
                errors.push('Port must be a number between 1 and 65535');
            }
        }
        if (data.identityFile) {
            const resolved = untildify(data.identityFile);
            if (!existsSync(resolved)) {
                errors.push('Identity file not found: ' + data.identityFile);
            }
        }
        return errors.length ? { valid: false, errors } : { valid: true };
    });
    ipcMain.handle('test-connection', async (event, data) => {
        try {
            await config.testSSHConnection(data.url, data.port, data.identityFile, data.authType, data.password, data.sshOptions);
            return { success: true };
        } catch (e) {
            return { success: false, error: e.message };
        }
    });
    ipcMain.on('save-settings', (event, data) => {
        config.saveDefaults(data);
    });
    app.on('window-all-closed', () => {
        updateTray(tray);
    });
}

async function checkDependenciesAndMaybeReturnError() {
    try {
        await commandExists('ssh');
    } catch {
        return errorHTMLSSH;
    }
    try {
        await commandExists('sshfs');
    } catch {
        return errorHTMLSSHFS;
    }
    try {
        await commandExists('timeout');
    } catch {
        return errorHTMLTimeout;
    }
}


async function updateTray(tray) {
    const targets = config.fetchOrCreateEmptyConfig();

    var items = [
        {
            label: 'SSHFS UI',
            enabled: false,
        },
        {
            label: 'v' + app.getVersion(),
            enabled: false,
        },
        { type: 'separator' },
    ];

    for (const target of targets) {
        const state = connectionStates.get(target.name);
        const isConnecting = state === 'connecting';
        const connected = isConnecting ? false : await target.status();

        // Determine status icon
        let statusIcon;
        if (isConnecting) {
            statusIcon = iconConnecting;
        } else if (connected) {
            statusIcon = iconConnected;
        } else {
            statusIcon = iconDisconnected;
        }

        // Build status label
        let statusLabel = 'Status';
        if (isConnecting) {
            statusLabel = 'Connecting...';
        } else if (connected) {
            const count = mountItemCounts.get(target.name);
            statusLabel = count ? `Connected (${count} items)` : 'Connected';
        } else {
            statusLabel = 'Disconnected';
        }
        if (target.autoconnect) statusLabel += ' (auto)';

        const submenuItems = [
            {
                icon: statusIcon,
                label: statusLabel,
                enabled: false,
            },
            {
                label: isConnecting ? 'Connecting...' : (connected ? 'Disconnect' : 'Connect'),
                enabled: !isConnecting,
                click: async () => {
                    const currentlyConnected = await target.status();
                    if (currentlyConnected) {
                        try {
                            await target.disconnect();
                            connectionStates.set(target.name, 'disconnected');
                            mountItemCounts.delete(target.name);
                            lastErrors.delete(target.name);
                        } catch (e) {
                            const errMsg = `Disconnect failed: ${e.message}`;
                            lastErrors.set(target.name, errMsg);
                            await window.create('src/renderer/error.html', 480, 160, errMsg);
                        }
                    } else {
                        if (connectionStates.get(target.name) === 'connecting') return;
                        connectionStates.set(target.name, 'connecting');
                        lastErrors.delete(target.name);
                        await updateTray(tray);
                        try {
                            await target.connect();
                            connectionStates.set(target.name, 'connected');
                            const count = await waitForMountContent(target.mount);
                            if (count > 0) mountItemCounts.set(target.name, count);
                        } catch (e) {
                            connectionStates.set(target.name, 'disconnected');
                            lastErrors.set(target.name, e.message);
                            await window.create('src/renderer/error.html', 480, 160, e.message);
                        }
                    }
                    updateTray(tray);
                },
            },
            {
                label: 'Open Folder',
                enabled: !isConnecting,
                click: () => {
                    const absoluteMount = untildify(target.mount);
                    child_process.spawn('open', [absoluteMount], { detached: true, stdio: 'ignore' });
                },
            },
            {
                label: 'Edit',
                enabled: !connected && !isConnecting,
                click: async () => {
                    await window.create('src/renderer/edit.html', 560, 100, target);
                },
            },
            {
                label: 'Delete',
                click: async () => {
                    config.deleteTarget(target.name);
                    connectionStates.delete(target.name);
                    mountItemCounts.delete(target.name);
                    lastErrors.delete(target.name);
                    await updateTray(tray);
                },
            },
        ];

        // Show last error if there is one
        const lastError = lastErrors.get(target.name);
        if (lastError) {
            submenuItems.push({ type: 'separator' });
            submenuItems.push({
                label: 'Last Error: ' + (lastError.length > 60 ? lastError.substring(0, 60) + '...' : lastError),
                enabled: false,
            });
            submenuItems.push({
                label: 'Show Full Error',
                click: async () => {
                    await window.create('src/renderer/error.html', 480, 160, lastError);
                },
            });
        }

        items.push({
            label: target.name,
            submenu: submenuItems,
        })
    }

    items = items.concat([
        { type: 'separator' },
        {
            label: 'Add',
            click: async () => {
                await window.create('src/renderer/add.html', 560, 100, config.fetchDefaults());
            },
        },
        {
            label: 'Settings',
            click: async () => {
                await window.create('src/renderer/settings.html', 560, 100, config.fetchDefaults());
            },
        },
        {
            label: 'View Log',
            click: () => {
                const logFile = config.getLogPath();
                shell.showItemInFolder(logFile);
            },
        },
        { label: 'Quit', click: app.quit },
    ])
    const contextMenu = Menu.buildFromTemplate(items);
    tray.setContextMenu(contextMenu);
}

async function waitForMountContent(mountPath, maxWait = 5000, interval = 500) {
    const absolute = untildify(mountPath);
    const start = Date.now();
    while (Date.now() - start < maxWait) {
        try {
            const entries = await fs.readdir(absolute);
            if (entries.length > 0) return entries.length;
        } catch { }
        await new Promise(r => setTimeout(r, interval));
    }
    // Final attempt
    try {
        const entries = await fs.readdir(absolute);
        return entries.length;
    } catch { return 0; }
}
