// Lightweight Electron main process for screenshot capture.
// Opens the Add form window directly on startup.
// Usage: electron scripts/screenshot-main.cjs

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

const srcRenderer = path.join(__dirname, '..', 'src', 'renderer');
const preloadPath = path.join(__dirname, '..', 'src', 'preload.js');

app.whenReady().then(async () => {
    const win = new BrowserWindow({
        width: 560,
        height: 100,
        useContentSize: true,
        webPreferences: {
            preload: preloadPath,
        },
        resizable: false,
    });
    win.removeMenu();

    // Handle resize-to-content from the renderer
    ipcMain.on('resize-to-content', (event, height) => {
        if (event.sender === win.webContents) {
            const [w] = win.getContentSize();
            win.setContentSize(w, Math.ceil(height));
        }
    });

    await win.loadFile(path.join(srcRenderer, 'add.html'));
    // Send empty defaults so the onLoad handler runs
    win.webContents.send('load', { mountroot: '', identity: '', sshoptions: '', port: '' });
});

app.on('window-all-closed', () => {
    // Playwright controls the lifecycle
});
