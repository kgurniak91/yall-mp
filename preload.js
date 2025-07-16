const {contextBridge, ipcRenderer} = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  openFileDialog: (options) => ipcRenderer.invoke('dialog:openFile', options),
  parseSubtitleFile: (filePath) => ipcRenderer.invoke('subtitle:parse', filePath)
});
