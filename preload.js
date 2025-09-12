const {contextBridge, ipcRenderer, webUtils} = require('electron');

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
  windowUpdateDraggableZones: (shapes) => ipcRenderer.send('window:update-draggable-zones', shapes),
  // --- Files
  openFileDialog: (options) => ipcRenderer.invoke('dialog:openFile', options),
  parseSubtitleFile: (filePath) => ipcRenderer.invoke('subtitle:parse', filePath),
  getMediaMetadata: (filePath) => ipcRenderer.invoke('media:getMetadata', filePath),
  extractSubtitleTrack: (mediaPath, trackIndex) => ipcRenderer.invoke('media:extractSubtitleTrack', mediaPath, trackIndex),
  getPathForFile: (file) => webUtils.getPathForFile(file),
  // --- Anki
  checkAnkiConnection: () => ipcRenderer.invoke('anki:check'),
  getAnkiDeckNames: () => ipcRenderer.invoke('anki:getDeckNames'),
  getAnkiNoteTypes: () => ipcRenderer.invoke('anki:getNoteTypes'),
  getAnkiNoteTypeFieldNames: (noteTypeName) => ipcRenderer.invoke('anki:getNoteTypeFieldNames', noteTypeName),
  exportAnkiCard: (exportRquest) => ipcRenderer.invoke('anki:exportAnkiCard', exportRquest),
  // --- FFmpeg
  checkFFmpegAvailability: () => ipcRenderer.invoke('ffmpeg:check'),
  // --- MPV
  mpvCreateViewport: (mediaPath, audioTrackIndex, subtitleSelection, useMpvSubtitles) => ipcRenderer.invoke(
    'mpv:createViewport', mediaPath, audioTrackIndex, subtitleSelection, useMpvSubtitles
  ),
  mpvFinishVideoResize: (rect) => ipcRenderer.invoke('mpv:finishVideoResize', rect),
  mpvCommand: (commandArray) => ipcRenderer.invoke('mpv:command', commandArray),
  mpvPlayClip: (request) => ipcRenderer.invoke('mpv:playClip', request),
  mpvGetProperty: (property) => ipcRenderer.invoke('mpv:getProperty', property),
  mpvSetProperty: (property, value) => ipcRenderer.invoke('mpv:setProperty', property, value),
  mpvSeekAndPause: (seekTime) => ipcRenderer.invoke('mpv:seekAndPause', seekTime),
  onMpvEvent: (callback) => {
    const subscription = (_event, value) => callback(value);
    ipcRenderer.on('mpv:event', subscription);
    return () => ipcRenderer.removeListener('mpv:event', subscription); // return cleanup function
  },
  onMainWindowMoved: (callback) => ipcRenderer.on('mpv:mainWindowMovedOrResized', callback),
  onMpvManagerReady: (callback) => ipcRenderer.on('mpv:managerReady', callback),
  onMpvInitialSeekComplete: (callback) => {
    const subscription = () => callback();
    ipcRenderer.on('mpv:initial-seek-complete', subscription);
    return () => ipcRenderer.removeListener('mpv:initial-seek-complete', subscription); // return cleanup function
  },
  // --- Storage
  getAppData: () => ipcRenderer.invoke('app:get-data'),
  setAppData: (data) => ipcRenderer.invoke('app:set-data', data),
});
