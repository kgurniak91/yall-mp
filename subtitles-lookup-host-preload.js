const {contextBridge, ipcRenderer} = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  closeLookupWindow: () => ipcRenderer.send('lookup:close-window'),
  onViewLoadingStateChange: (callback) => {
    const subscription = (_event, isLoading) => callback(isLoading);
    ipcRenderer.on('view:loading-state-change', subscription);
    return () => ipcRenderer.removeListener('view:loading-state-change', subscription);
  },
  onLookupShowToast: (callback) => {
    const subscription = (_event, message) => callback(message);
    ipcRenderer.on('lookup:show-toast', subscription);
    return () => ipcRenderer.removeListener('lookup:show-toast', subscription);
  }
});
