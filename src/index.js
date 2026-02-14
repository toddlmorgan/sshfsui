import * as child_process from "child_process";

import fixPath from 'fix-path';
import { app, Tray, Menu, nativeImage, ipcMain } from 'electron'
import { promises as fs } from "fs";
import commandExists from 'command-exists';

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

app.whenReady().then(main);

async function main() {
    fixPath();
    const error = await checkDependenciesAndMaybeReturnError();
    if (error) {
        await window.create('src/renderer/error.html', 320, 120, error);
        return;
    }

    const tray = new Tray(icon);
    await updateTray(tray);

    ipcMain.on('add', (event, data) => {
        config.addTarget(data.name, data.url, data.mount, data.authType, data.password, data.port, data.identityFile);
    });
    ipcMain.on('edit', (event, data) => {
        config.deleteTarget(data.initialName);
        config.addTarget(data.target.name, data.target.url, data.target.mount, data.target.authType, data.target.password, data.target.port, data.target.identityFile);
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
        items.push({
            label: target.name,
            submenu: [
                {
                    icon: await target.status() ? iconConnected : iconDisconnected,
                    label: 'Status',
                    enabled: false,
                },
                {
                    label: await target.status() ? 'Disconnect' : 'Connect',
                    click: async () => {
                        const connected = await target.status();
                        if (connected) {
                            await target.disconnect();
                        } else {
                            try {
                                await target.connect();
                            } catch (e) {
                                await window.create('src/renderer/error.html', 320, 120, e.message);
                                return;
                            }
                        }
                        updateTray(tray);
                    },
                },
                {
                    label: 'Open Folder',
                    click: () => {
                        child_process.execSync('open ' + target.mount);
                    },
                },
                {
                    label: 'Edit',
                    enabled: !await target.status(),
                    click: async () => {
                        await window.create('src/renderer/edit.html', 360, 300, target);
                    },
                },
                {
                    label: 'Delete',
                    click: async () => {
                        config.deleteTarget(target.name);
                        await updateTray(tray);
                    },
                },
            ],
        })
    }

    items = items.concat([
        { type: 'separator' },
        {
            label: 'Add',
            click: async () => {
                await window.create('src/renderer/add.html', 360, 300);
            },
        },
        { label: 'Quit', click: app.quit },
    ])
    const contextMenu = Menu.buildFromTemplate(items);
    tray.setContextMenu(contextMenu);
}
