const {contextBridge, ipcRenderer} = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // --- Window control
  windowMinimize: () => ipcRenderer.send('window:minimize'),
  windowToggleMaximize: () => ipcRenderer.send('window:toggle-maximize'),
  windowToggleFullScreen: () => ipcRenderer.send('window:toggle-fullscreen'),
  windowEscape: () => ipcRenderer.send('window:escape'),
  windowHandleDoubleClick: () => ipcRenderer.send('window:handle-double-click'),
  windowClose: () => ipcRenderer.send('window:close'),
  onWindowMaximizedStateChanged: (callback) => ipcRenderer.on('window:maximized-state-changed', (_event, value) => callback(value)),
  onWindowFullScreenStateChanged: (callback) => ipcRenderer.on('window:fullscreen-state-changed', (_event, value) => callback(value)),
  // --- Files
  openFileDialog: (options) => ipcRenderer.invoke('dialog:openFile', options),
  parseSubtitleFile: (filePath) => ipcRenderer.invoke('subtitle:parse', filePath),
  // --- Anki
  checkAnkiConnection: () => ipcRenderer.invoke('anki:check'),
  getAnkiDeckNames: () => ipcRenderer.invoke('anki:getDeckNames'),
  getAnkiNoteTypes: () => ipcRenderer.invoke('anki:getNoteTypes'),
  getAnkiNoteTypeFieldNames: (noteTypeName) => ipcRenderer.invoke('anki:getNoteTypeFieldNames', noteTypeName),
  exportAnkiCard: (exportRquest) => ipcRenderer.invoke('anki:exportAnkiCard', exportRquest),
  // --- FFmpeg
  checkFFmpegAvailability: () => ipcRenderer.invoke('ffmpeg:check'),
  // --- MPV
  mpvCreateViewport: (mediaPath) => ipcRenderer.invoke('mpv:createViewport', mediaPath),
  mpvHideVideoDuringResize: () => ipcRenderer.invoke('mpv:hideVideoDuringResize'),
  mpvFinishVideoResize: (rect) => ipcRenderer.invoke('mpv:finishVideoResize', rect),
  mpvCommand: (commandArray) => ipcRenderer.invoke('mpv:command', commandArray),
  mpvPlayClip: (request) => ipcRenderer.invoke('mpv:playClip', request),
  mpvGetProperty: (property) => ipcRenderer.invoke('mpv:getProperty', property),
  mpvSetProperty: (property, value) => ipcRenderer.invoke('mpv:setProperty', property, value),
  onMpvEvent: (callback) => ipcRenderer.on('mpv:event', (_event, value) => callback(value)),
  onMainWindowMoved: (callback) => ipcRenderer.on('mpv:mainWindowMovedOrResized', callback),
  onMpvManagerReady: (callback) => ipcRenderer.on('mpv:managerReady', callback),
});
