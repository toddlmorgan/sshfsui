
import * as path from 'path';

import * as electron from 'electron'


const __dirname = import.meta.dirname;
const preloadPath = path.join(__dirname, 'preload.js');


export async function create(file, width, height, loadData) {
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

    electron.ipcMain.on('resize-to-content', (event, contentHeight) => {
        if (event.sender === win.webContents) {
            const [currentWidth] = win.getContentSize();
            win.setContentSize(currentWidth, Math.ceil(contentHeight));
        }
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
