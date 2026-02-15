const { contextBridge, ipcRenderer } = require('electron/renderer')

contextBridge.exposeInMainWorld('electronAPI', {
    sendAdd: (data) => ipcRenderer.send('add', data),
    onLoad: (handler) => ipcRenderer.on('load', handler),
    sendEdit: (data) => ipcRenderer.send('edit', data),
    sendSettings: (data) => ipcRenderer.send('save-settings', data),
    validateTarget: (data) => ipcRenderer.invoke('validate', data),
    testConnection: (data) => ipcRenderer.invoke('test-connection', data),
    resizeToContent: (height) => ipcRenderer.send('resize-to-content', height),
})
