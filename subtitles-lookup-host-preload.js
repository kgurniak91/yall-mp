const {contextBridge, ipcRenderer} = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  closeLookupWindow: () => ipcRenderer.send('lookup:close-window'),
  lookupGoBack: () => ipcRenderer.send('lookup:go-back'),
  lookupGoForward: () => ipcRenderer.send('lookup:go-forward'),
  onViewLoadingStateChange: (callback) => {
    const subscription = (_event, isLoading) => callback(isLoading);
    ipcRenderer.on('view:loading-state-change', subscription);
    return () => ipcRenderer.removeListener('view:loading-state-change', subscription);
  },
  onLookupShowToast: (callback) => {
    const subscription = (_event, message) => callback(message);
    ipcRenderer.on('lookup:show-toast', subscription);
    return () => ipcRenderer.removeListener('lookup:show-toast', subscription);
  },
  onNavigationStateChange: (callback) => {
    const subscription = (_event, state) => callback(state);
    ipcRenderer.on('lookup:nav-state-change', subscription);
    return () => ipcRenderer.removeListener('lookup:nav-state-change', subscription);
  },
  onLoadingMessageUpdate: (callback) => {
    const subscription = (_event, msg) => callback(msg);
    ipcRenderer.on('lookup:loading-message', subscription);
    return () => ipcRenderer.removeListener('lookup:loading-message', subscription);
  }
});
