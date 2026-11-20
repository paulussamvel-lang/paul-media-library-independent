const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('mediaLibrary', {
  startDrag: (id) => ipcRenderer.send('asset:start-drag', id),
});
