
import * as path from 'path';

import * as electron from 'electron'


const __dirname = import.meta.dirname;
const preloadPath = path.join(__dirname, 'preload.js');

// Track open windows by a key derived from the file and loadData
const openWindows = new Map();

function windowKey(file, loadData) {
    if (loadData && loadData.name) {
        return file + ':' + loadData.name;
    }
    return file;
}

export async function create(file, width, height, loadData) {
    const key = windowKey(file, loadData);
    const existing = openWindows.get(key);
    if (existing && !existing.isDestroyed()) {
        existing.focus();
        return;
    }

    const win = new electron.BrowserWindow({
        width: width,
        height: height,
        useContentSize: true,
        webPreferences: {
            preload: preloadPath,
        },
        resizable: false,
    });
    win.removeMenu();
    win.webContents.setWindowOpenHandler(openExternalAndDeny);
    openWindows.set(key, win);

    const resizeHandler = (event, contentHeight) => {
        if (event.sender === win.webContents) {
            const [currentWidth] = win.getContentSize();
            win.setContentSize(currentWidth, Math.ceil(contentHeight));
        }
    };
    electron.ipcMain.on('resize-to-content', resizeHandler);
    win.on('closed', () => {
        electron.ipcMain.removeListener('resize-to-content', resizeHandler);
        openWindows.delete(key);
    });

    await win.loadFile(file);
    if (loadData) {
        win.webContents.send('load', loadData);
    }
}


function openExternalAndDeny({ url }) {
    electron.shell.openExternal(url);
    return { action: 'deny' };
}
