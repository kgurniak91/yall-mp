const {contextBridge, ipcRenderer, webUtils} = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // --- Window control
  windowMinimize: () => ipcRenderer.send('window:minimize'),
  windowToggleMaximize: () => ipcRenderer.send('window:toggle-maximize'),
  windowToggleFullScreen: () => ipcRenderer.send('window:toggle-fullscreen'),
  windowEscape: () => ipcRenderer.send('window:escape'),
  windowHandleDoubleClick: () => ipcRenderer.send('window:handle-double-click'),
  windowClose: () => ipcRenderer.send('window:close'),
  onWindowMaximizedStateChanged: (callback) => {
    const subscription = (_event, value) => callback(value);
    ipcRenderer.on('window:maximized-state-changed', subscription);
    return () => ipcRenderer.removeListener('window:maximized-state-changed', subscription);
  },
  onWindowFullScreenStateChanged: (callback) => {
    const subscription = (_event, value) => callback(value);
    ipcRenderer.on('window:fullscreen-state-changed', subscription);
    return () => ipcRenderer.removeListener('window:fullscreen-state-changed', subscription);
  },
  windowUpdateDraggableZones: (shapes) => ipcRenderer.send('window:update-draggable-zones', shapes),
  openInSystemBrowser: (url) => ipcRenderer.invoke('app:openInSystemBrowser', url),
  // --- Subtitles Lookup
  openSubtitlesLookupWindow: (data) => ipcRenderer.invoke('lookup:open-window', data),
  onProjectAddNote: (callback) => {
    const subscription = (_event, value) => callback(value);
    ipcRenderer.on('project:add-note', subscription);
    return () => ipcRenderer.removeListener('project:add-note', subscription);
  },
  closeLookupWindow: () => ipcRenderer.send('lookup:close-window'),
  onViewLoadingStateChange: (callback) => {
    const subscription = (_event, isLoading) => callback(isLoading);
    ipcRenderer.on('view:loading-state-change', subscription);
    return () => ipcRenderer.removeListener('view:loading-state-change', subscription);
  },
  // --- Files
  openFileDialog: (options) => ipcRenderer.invoke('dialog:openFile', options),
  parseSubtitleFile: (projectId, filePath) => ipcRenderer.invoke('subtitle:parse', projectId, filePath),
  getMediaMetadata: (filePath) => ipcRenderer.invoke('media:getMetadata', filePath),
  extractSubtitleTrack: (projectId, mediaPath, trackIndex) => ipcRenderer.invoke('media:extractSubtitleTrack', projectId, mediaPath, trackIndex),
  getPathForFile: (file) => webUtils.getPathForFile(file),
  getProjectFonts: (projectId) => ipcRenderer.invoke('fonts:get-fonts', projectId),
  deleteProjectFonts: (projectId) => ipcRenderer.send('fonts:delete-fonts', projectId),
  // --- Anki
  checkAnkiConnection: () => ipcRenderer.invoke('anki:check'),
  getAnkiDeckNames: () => ipcRenderer.invoke('anki:getDeckNames'),
  getAnkiNoteTypes: () => ipcRenderer.invoke('anki:getNoteTypes'),
  getAnkiNoteTypeFieldNames: (noteTypeName) => ipcRenderer.invoke('anki:getNoteTypeFieldNames', noteTypeName),
  exportAnkiCard: (exportRquest) => ipcRenderer.invoke('anki:exportAnkiCard', exportRquest),
  // --- FFmpeg
  checkFFmpegAvailability: () => ipcRenderer.invoke('ffmpeg:check'),
  // --- MPV
  mpvCreateViewport: (mediaPath, audioTrackIndex, subtitleSelection, subtitleTracks, useMpvSubtitles, subtitlesVisible) => ipcRenderer.invoke(
    'mpv:createViewport', mediaPath, audioTrackIndex, subtitleSelection, subtitleTracks, useMpvSubtitles, subtitlesVisible
  ),
  mpvFinishVideoResize: (rect) => ipcRenderer.invoke('mpv:finishVideoResize', rect),
  mpvCommand: (commandArray) => ipcRenderer.invoke('mpv:command', commandArray),
  mpvGetProperty: (property) => ipcRenderer.invoke('mpv:getProperty', property),
  mpvSetProperty: (property, value) => ipcRenderer.invoke('mpv:setProperty', property, value),
  mpvShowSubtitles: () => ipcRenderer.invoke('mpv:showSubtitles'),
  mpvHideSubtitles: () => ipcRenderer.invoke('mpv:hideSubtitles'),
  onMpvDestroyViewport: () => ipcRenderer.send('mpv:destroyViewport'),
  onMpvEvent: (callback) => {
    const subscription = (_event, value) => callback(value);
    ipcRenderer.on('mpv:event', subscription);
    return () => ipcRenderer.removeListener('mpv:event', subscription); // return cleanup function
  },
  onMainWindowMoved: (callback) => {
    const subscription = () => callback();
    ipcRenderer.on('mpv:mainWindowMovedOrResized', subscription);
    return () => ipcRenderer.removeListener('mpv:mainWindowMovedOrResized', subscription);
  },
  onMpvManagerReady: (callback) => {
    const subscription = () => callback();
    ipcRenderer.on('mpv:managerReady', subscription);
    return () => ipcRenderer.removeListener('mpv:managerReady', subscription);
  },
  onMpvInitialSeekComplete: (callback) => {
    const subscription = () => callback();
    ipcRenderer.on('mpv:initial-seek-complete', subscription);
    return () => ipcRenderer.removeListener('mpv:initial-seek-complete', subscription); // return cleanup function
  },
  // --- Storage
  getAppData: () => ipcRenderer.invoke('app:get-data'),
  setAppData: (data) => ipcRenderer.invoke('app:set-data', data),
  // --- Playback
  playbackPlay: () => ipcRenderer.send('playback:play'),
  playbackPause: () => ipcRenderer.send('playback:pause'),
  playbackTogglePlayPause: () => ipcRenderer.send('playback:togglePlayPause'),
  playbackToggleSubtitles: () => ipcRenderer.send('playback:toggleSubtitles'),
  playbackRepeat: () => ipcRenderer.send('playback:repeat'),
  playbackForceContinue: () => ipcRenderer.send('playback:forceContinue'),
  playbackSeek: (time) => ipcRenderer.send('playback:seek', time),
  playbackLoadProject: (clips, settings) => ipcRenderer.invoke('playback:loadProject', clips, settings),
  playbackUpdateSettings: (settings) => ipcRenderer.send('playback:updateSettings', settings),
  playbackUpdateClips: (clips) => ipcRenderer.send('playback:updateClips', clips),
  onPlaybackStateUpdate: (callback) => {
    const subscription = (_event, value) => callback(value);
    ipcRenderer.on('playback:state-update', subscription);
    return () => ipcRenderer.removeListener('playback:state-update', subscription);
  },
});
