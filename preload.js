const {contextBridge, ipcRenderer} = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
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
  mpvLoad: (mediaPath) => ipcRenderer.invoke('mpv:load', mediaPath),
  mpvCommand: (commandArray) => ipcRenderer.invoke('mpv:command', commandArray),
  mpvSetProperty: (property, value) => ipcRenderer.invoke('mpv:setProperty', property, value),
  onMpvEvent: (callback) => ipcRenderer.on('mpv-event', (_event, value) => callback(value)),
  mpvResize: (rect) => ipcRenderer.invoke('mpv:resize', rect),
});
