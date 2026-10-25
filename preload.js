const {contextBridge, ipcRenderer, sharedTexture, webUtils} = require('electron');

// --- Video frames. Both paths hand the page a VideoFrame (shared textures from the GPU path, BGRA pixels from the
// readback path), so the page has one draw routine. Without a subscriber only the newest frame is kept, because the
// first paused frame can arrive before the canvas exists.
const READBACK_CHANNEL = 'libmpv:readback-frame';
const PROBE_START_CHANNEL = 'libmpv:probe-start';
const PROBE_REPORT_CHANNEL = 'libmpv:probe';
let probeSink = null;
let pendingProbe = null;
let frameSink = null;
let heldFrame = null;
let droppedFrames = 0;

const deliverFrame = (frame) => {
  if (frameSink) {
    frameSink(frame);
    return;
  }
  heldFrame?.close();
  heldFrame = frame;
};

if (sharedTexture?.setSharedTextureReceiver) {
  sharedTexture.setSharedTextureReceiver(async ({importedSharedTexture}) => {
    try {
      // The VideoFrame keeps the texture alive; the slot goes back to the pool when the page closes the frame.
      deliverFrame(importedSharedTexture.getVideoFrame());
    } catch (error) {
      droppedFrames++;
    } finally {
      try {
        importedSharedTexture.release();
      } catch (error) {
        // already released
      }
    }
  });
}

ipcRenderer.on(READBACK_CHANNEL, (_event, message) => {
  try {
    deliverFrame(new VideoFrame(message.data, {
      format: 'BGRA', codedWidth: message.width, codedHeight: message.height, timestamp: 0
    }));
  } catch (error) {
    droppedFrames++;
  }
});

ipcRenderer.on(PROBE_START_CHANNEL, (_event, message) => {
  if (probeSink) {
    probeSink(message.frames);
  } else {
    pendingProbe = message.frames;
  }
});

contextBridge.exposeInMainWorld('electronAPI', {
  // --- App
  getAppVersion: () => ipcRenderer.invoke('app:get-version'),
  appSetTheme: (theme) => ipcRenderer.send('app:set-theme', theme),
  // --- Window control
  windowMinimize: () => ipcRenderer.send('window:minimize'),
  windowToggleMaximize: () => ipcRenderer.send('window:toggle-maximize'),
  windowToggleFullScreen: () => ipcRenderer.send('window:toggle-fullscreen'),
  windowEscape: () => ipcRenderer.send('window:escape'),
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
  onLookupWindowStateChange: (callback) => {
    const subscription = (_event, isVisible) => callback(isVisible);
    ipcRenderer.on('lookup:window-state-changed', subscription);
    return () => ipcRenderer.removeListener('lookup:window-state-changed', subscription);
  },
  clearLookupData: () => ipcRenderer.invoke('lookup:clear-data'),
  // --- Files
  openFileDialog: (options) => ipcRenderer.invoke('dialog:openFile', options),
  parseSubtitleFile: (projectId, filePath) => ipcRenderer.invoke('subtitle:parse', projectId, filePath),
  getMediaMetadata: (filePath) => ipcRenderer.invoke('media:getMetadata', filePath),
  extractSubtitleTrack: (projectId, mediaPath, trackIndex) => ipcRenderer.invoke('media:extractSubtitleTrack', projectId, mediaPath, trackIndex),
  getPathForFile: (file) => webUtils.getPathForFile(file),
  getProjectFonts: (projectId) => ipcRenderer.invoke('fonts:get-fonts', projectId),
  deleteProjectFonts: (projectId) => ipcRenderer.send('fonts:delete-fonts', projectId),
  checkFileExists: (filePath) => ipcRenderer.invoke('fs:check-file-exists', filePath),
  generateAudioPeaks: (projectId, mediaPath, audioTrackIndex) => ipcRenderer.invoke('project:generate-audio-peaks', projectId, mediaPath, audioTrackIndex),
  findAdjacentMedia: (currentPath, direction) => ipcRenderer.invoke('fs:find-adjacent-media', currentPath, direction),
  findCompanionSubtitle: (mediaPath) => ipcRenderer.invoke('fs:find-companion-subtitle', mediaPath),
  // --- File Association ("Open with")
  getPendingOpenFiles: () => ipcRenderer.invoke('app:get-pending-files'),
  onAppOpenFiles: (callback) => {
    const subscription = (_event, filePaths) => callback(filePaths);
    ipcRenderer.on('app:open-files', subscription);
    return () => ipcRenderer.removeListener('app:open-files', subscription);
  },
  // --- Anki
  checkAnkiConnection: () => ipcRenderer.invoke('anki:check'),
  getAnkiDeckNames: () => ipcRenderer.invoke('anki:getDeckNames'),
  getAnkiNoteTypes: () => ipcRenderer.invoke('anki:getNoteTypes'),
  getAnkiNoteTypeFieldNames: (noteTypeName) => ipcRenderer.invoke('anki:getNoteTypeFieldNames', noteTypeName),
  exportAnkiCardBatch: (batchRequest) => ipcRenderer.invoke('anki:exportAnkiCardBatch', batchRequest),
  // --- FFmpeg
  checkFFmpegAvailability: () => ipcRenderer.invoke('ffmpeg:check'),
  // --- MPV
  mpvCreateViewport: (mediaPath, audioTrackIndex, subtitleSelection, subtitleTracks, useMpvSubtitles, subtitlesVisible, hardwareAcceleration, volume, isMuted) => ipcRenderer.invoke(
    'mpv:createViewport', mediaPath, audioTrackIndex, subtitleSelection, subtitleTracks, useMpvSubtitles, subtitlesVisible, hardwareAcceleration, volume, isMuted
  ),
  mpvCommand: (commandArray) => ipcRenderer.invoke('mpv:command', commandArray),
  mpvGetProperty: (property) => ipcRenderer.invoke('mpv:getProperty', property),
  mpvSetProperty: (property, value) => ipcRenderer.invoke('mpv:setProperty', property, value),
  mpvShowSubtitles: () => ipcRenderer.invoke('mpv:showSubtitles'),
  mpvHideSubtitles: () => ipcRenderer.invoke('mpv:hideSubtitles'),
  onMpvDestroyViewport: () => ipcRenderer.invoke('mpv:destroyViewport'),
  onMpvEvent: (callback) => {
    const subscription = (_event, value) => callback(value);
    ipcRenderer.on('mpv:event', subscription);
    return () => ipcRenderer.removeListener('mpv:event', subscription); // return cleanup function
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
  // --- Video surface
  onVideoFrame: (callback) => {
    frameSink = callback;
    if (heldFrame) {
      const frame = heldFrame;
      heldFrame = null;
      callback(frame);
    }
    return () => {
      if (frameSink === callback) {
        frameSink = null;
      }
    };
  },
  // Main asks for the next `frames` drawn frames to be checked for black; the page answers through `videoProbeReport`.
  onVideoProbeStart: (callback) => {
    probeSink = callback;
    if (pendingProbe !== null) {
      const frames = pendingProbe;
      pendingProbe = null;
      callback(frames);
    }
    return () => {
      if (probeSink === callback) {
        probeSink = null;
      }
    };
  },
  videoProbeReport: (black) => ipcRenderer.send(PROBE_REPORT_CHANNEL, black === true),
  getDroppedVideoFrames: () => droppedFrames,
  videoSurfaceSetSize: (width, height) => ipcRenderer.send('video:set-canvas-size', width, height),
  // --- Storage
  getAppData: () => ipcRenderer.invoke('app:get-data'),
  getProjectById: (projectId) => ipcRenderer.invoke('project:get-by-id', projectId),
  saveProject: (project) => ipcRenderer.invoke('project:save', project),
  updateProjectFields: (projectId, fields) => ipcRenderer.invoke('project:update-fields', projectId, fields),
  deleteProjectFile: (projectId) => ipcRenderer.invoke('project:delete-file', projectId),
  saveCoreConfig: (config) => ipcRenderer.invoke('core-config:save', config),
  // --- Playback
  playbackPlay: () => ipcRenderer.send('playback:play'),
  playbackPause: () => ipcRenderer.send('playback:pause'),
  playbackTogglePlayPause: () => ipcRenderer.send('playback:togglePlayPause'),
  playbackToggleSubtitles: () => ipcRenderer.send('playback:toggleSubtitles'),
  playbackRepeat: () => ipcRenderer.send('playback:repeat'),
  playbackForceContinue: () => ipcRenderer.send('playback:forceContinue'),
  playbackSeek: (time, isNavigation) => ipcRenderer.send('playback:seek', time, isNavigation),
  playbackLoadProject: (clips, settings, lastPlaybackTime, cinemaMode) => ipcRenderer.invoke('playback:loadProject', clips, settings, lastPlaybackTime, cinemaMode),
  playbackUpdateSettings: (settings) => ipcRenderer.send('playback:updateSettings', settings),
  playbackUpdateClips: (clips, currentTime) => ipcRenderer.send('playback:updateClips', clips, currentTime),
  playbackSetCinemaMode: (options) => ipcRenderer.send('playback:setCinemaMode', options),
  onPlaybackStateUpdate: (callback) => {
    const subscription = (_event, value) => callback(value);
    ipcRenderer.on('playback:state-update', subscription);
    return () => ipcRenderer.removeListener('playback:state-update', subscription);
  },
  onRepeatSeekCompleted: (callback) => {
    const subscription = () => callback();
    ipcRenderer.on('playback:repeat-seek-completed', subscription);
    return () => ipcRenderer.removeListener('playback:repeat-seek-completed', subscription);
  },
  playbackSetSpeedOverride: (isActive) => ipcRenderer.send('playback:setSpeedOverride', isActive),
  playbackSetVolume: (volume) => ipcRenderer.send('playback:setVolume', volume),
  playbackSetMute: (mute) => ipcRenderer.send('playback:setMute', mute),
  // --- Yomitan
  getYomitanExtensionId: () => ipcRenderer.invoke('yomitan:get-extension-id'),
  getYomitanSettingsUrl: () => ipcRenderer.invoke('yomitan:get-settings-url'),
  invokeExtension: (message) => ipcRenderer.invoke('yomitan:invoke', message),
  setYomitanLanguageFull: (iso) => ipcRenderer.invoke('yomitan:set-language-full', iso),
  showContextMenu: (options) => ipcRenderer.invoke('yomitan:show-context-menu', options),
  invokeExtensionReadyCheck: () => ipcRenderer.invoke('yomitan:is-ready'),
});
