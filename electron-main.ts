import {app, BrowserWindow, dialog, ipcMain, Menu, Rectangle, screen, shell, WebContentsView} from 'electron';
import path from 'path';
import os from 'os';
import {promises as fs, statSync} from 'fs';
import type {CaptionsFileFormat, ParsedCaptionsResult, parseResponse, VTTCue} from 'media-captions';
import type {SrtSubtitleData, SubtitleData} from './shared/types/subtitle.type';
import type {MediaTrack} from './shared/types/media.type';
import {AnkiCard, AnkiExportRequest} from './src/app/model/anki.types';
import {v4 as uuidv4} from 'uuid';
import {ChildProcess, spawn} from 'child_process';
import {MpvManager} from './mpv-manager';
import {FontData, ParsedSubtitlesData} from './src/electron-api';
import {AppData, CoreConfig, Project, SubtitleSelection, SupportedLanguage} from './src/app/model/project.types';
import {
  assignTracksToSubtitles,
  dialoguesToAssSubtitleData,
  mergeIdenticalConsecutiveSubtitles,
  mergeKaraokeSubtitles
} from './shared/utils/subtitle-parsing';
import {PlaybackManager} from './playback-manager';
import type fontkit from 'fontkit';
import {SUPPORTED_MEDIA_TYPES, SUPPORTED_SUBTITLE_TYPES} from './src/app/model/video.types';

interface AvailableFont {
  family: string;
  style: string;
  isBold: boolean;
  isItalic: boolean;
  dataUri: string;
  source: 'mkv' | 'local' | 'system'; // Track where the font was found
}

interface RequiredFont {
  family: string;
  bold: boolean;
  italic: boolean;
}

const APP_DATA_KEY = 'yall-mp-app-data';
const APP_DATA_PATH = path.join(app.getPath('userData'), `${APP_DATA_KEY}.json`);
const PROJECTS_DIR = path.join(app.getPath('userData'), 'projects');
const FONT_CACHE_DIR = path.join(app.getPath('userData'), 'font-cache');
const USER_AGENT_OPTIONS = {
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
};

let playbackManager: PlaybackManager | null = null;
let mpvManager: MpvManager | null = null;
let mainWindow: BrowserWindow | null = null;
let uiWindow: BrowserWindow | null = null;
let videoWindow: BrowserWindow | null = null;
let subtitlesLookupWindow: BrowserWindow | null = null;
let subtitlesLookupView: WebContentsView | null = null;
let currentSubtitlesLookupContext: { clipSubtitleId: string; originalSelection: string; } | null = null;
let preMaximizeBounds: Electron.Rectangle | null = null;
let isFixingMaximize = false;
let isProgrammaticResize = false;
let isEnteringFullscreen = false;
let resizeDebounceTimer: NodeJS.Timeout | null = null;
let isFFmpegAvailable = false;
let ffmpegPath = '';
let ffprobePath = '';
let draggableHeaderZones: Rectangle[] = [];
let isInitialResizeComplete = false;
let hasRequestedInitialSeek = false;
let isVideoWindowVisible = false; // Has the video window been initialized and shown for the first time?
let isSaving = false;
let isRestoring = false;
let coreConfigToSave: CoreConfig | null = null;
const projectsToSave = new Map<string, Project>();
let showVideoTimeout: NodeJS.Timeout | null = null;
let initialAppBounds: Electron.Rectangle | null = null;
let pendingFilesToOpen: string[] = [];
const DRAGGABLE_ZONE_PADDING = 3; // 3px on all sides

async function ensureFFmpegPaths(): Promise<void> {
  if (ffmpegPath) {
    return;
  }

  console.log('Initializing FFmpeg/FFprobe paths for the first time...');
  const ffmpegStatic = (await import('ffmpeg-static')).default;
  const ffprobeStatic = (await import('ffprobe-static')).default;

  if (ffmpegStatic) {
    isFFmpegAvailable = true;
    ffmpegPath = ffmpegStatic.replace('app.asar', 'app.asar.unpacked');
    ffprobePath = ffprobeStatic.path.replace('app.asar', 'app.asar.unpacked');
  } else {
    console.warn('ffmpeg-static binary not found. Media features will be disabled.');
  }
}

function subtractRect(rect: Rectangle, hole: Rectangle): Rectangle[] {
  const result: Rectangle[] = [];

  // Check for intersection
  const intersects = rect.x < hole.x + hole.width &&
    rect.x + rect.width > hole.x &&
    rect.y < hole.y + hole.height &&
    rect.y + rect.height > hole.y;

  if (!intersects) {
    return [rect]; // No intersection, return original rectangle
  }

  // Top part
  if (rect.y < hole.y) {
    result.push({x: rect.x, y: rect.y, width: rect.width, height: hole.y - rect.y});
  }

  // Bottom part
  if (rect.y + rect.height > hole.y + hole.height) {
    result.push({
      x: rect.x,
      y: hole.y + hole.height,
      width: rect.width,
      height: (rect.y + rect.height) - (hole.y + hole.height)
    });
  }

  // Left part
  if (rect.x < hole.x) {
    result.push({x: rect.x, y: hole.y, width: hole.x - rect.x, height: hole.height});
  }

  // Right part
  if (rect.x + rect.width > hole.x + hole.width) {
    result.push({
      x: hole.x + hole.width,
      y: hole.y,
      width: (rect.x + rect.width) - (hole.x + hole.width),
      height: hole.height
    });
  }

  return result.filter(r => r.width > 0 && r.height > 0);
}

function updateUiWindowShape() {
  if (!uiWindow || !mainWindow || mainWindow.isFullScreen()) {
    uiWindow?.setShape([]);
    return;
  }

  const {width, height} = mainWindow.getBounds();
  if (width === 0 || height === 0) return;

  // Define all the logical holes without padding
  const unpaddedHoles: Rectangle[] = [
    {
      x: width - 170,
      y: 5,
      width: 165,
      height: 30
    }
  ];

  if (draggableHeaderZones && draggableHeaderZones.length > 0) {
    unpaddedHoles.push(...draggableHeaderZones);
  }

  // Create a new array of 'padded' holes
  const holes = unpaddedHoles.map(hole => ({
    x: hole.x + DRAGGABLE_ZONE_PADDING,
    y: hole.y + DRAGGABLE_ZONE_PADDING,
    width: hole.width - (DRAGGABLE_ZONE_PADDING * 2),
    height: hole.height - (DRAGGABLE_ZONE_PADDING * 2)
  })).filter(hole => hole.width > 0 && hole.height > 0); // Important: filter out any holes that become invalid after padding

  // Start with the entire window as one visible shape
  let visibleShapes: Rectangle[] = [{x: 0, y: 0, width, height}];

  // Iteratively subtract each PADDED hole
  for (const hole of holes) {
    let nextVisibleShapes: Rectangle[] = [];
    for (const shape of visibleShapes) {
      nextVisibleShapes.push(...subtractRect(shape, hole));
    }
    visibleShapes = nextVisibleShapes;
  }

  uiWindow.setShape(visibleShapes);
}

function tryShowVideoWindowAndNotifyUI() {
  // Safety check: Ensure mainWindow is actually visible before showing the video window.
  // This prevents the video window from showing up if the app was started minimized or hidden.
  if (mainWindow && mainWindow.isMinimized()) {
    return;
  }

  if (!isRestoring && isInitialResizeComplete && hasRequestedInitialSeek && videoWindow && !videoWindow.isDestroyed() && uiWindow && mainWindow) {
    console.log('[Main Process] All startup conditions met. Showing video window and notifying UI.');
    isVideoWindowVisible = true;

    safeShowVideoWindow();
    safeShowUiWindow();
    uiWindow.webContents.send('mpv:initial-seek-complete');

    // Reset flags to prevent this from ever running again for this project instance.
    isInitialResizeComplete = false;
    hasRequestedInitialSeek = false;
  }
}

function handleWindowEscape() {
  if (!mainWindow || mainWindow.isMinimized()) {
    return;
  }

  if (mainWindow.isFullScreen()) {
    mainWindow.setFullScreen(false);
    // Force focus back to UI after exiting fullscreen so shortcuts work immediately
    setTimeout(() => {
      if (uiWindow && !uiWindow.isDestroyed()) {
        uiWindow.focus();
      }
    }, 100);
  } else if (preMaximizeBounds) {
    mainWindow.setBounds(preMaximizeBounds);
    preMaximizeBounds = null;
    if (uiWindow) {
      uiWindow.webContents.send('window:maximized-state-changed', false);
    }
  } else {
    mainWindow.minimize();
  }
}

function blockDefaultBrowserShortcuts(event: Electron.Event, input: Electron.Input): void {
  // Block app reloading
  if (input.type === 'keyDown') {
    if (
      (input.control && input.key.toLowerCase() === 'r') ||
      input.key === 'F5'
    ) {
      event.preventDefault();
    }
  }

  // Block zooming
  if (input.control && input.type === 'keyDown') {
    if (input.key === '=' || input.key === '-' || input.key === '0') {
      event.preventDefault();
    }
  }

  // Block opening DevTools
  if (input.type === 'keyDown') {
    if (
      input.key === 'F12' ||
      (input.control && input.shift && input.key.toLowerCase() === 'i')
    ) {
      event.preventDefault();
    }
  }

  // Block "Find in Page"
  if (input.control && input.key.toLowerCase() === 'f' && input.type === 'keyDown') {
    event.preventDefault();
  }
}

function createWindow() {
  const primaryDisplay = screen.getPrimaryDisplay();
  const workArea = primaryDisplay.workArea;

  // Calculate 90% of the work area's dimensions
  const initialWidth = Math.round(workArea.width * 0.9);
  const initialHeight = Math.round(workArea.height * 0.9);

  // Calculate centered position
  const initialX = Math.round(workArea.x + (workArea.width - initialWidth) / 2);
  const initialY = Math.round(workArea.y + (workArea.height - initialHeight) / 2);

  // Store the calculated initial bounds for later use (e.g., restoring from Aero Snap)
  initialAppBounds = {
    x: initialX,
    y: initialY,
    width: initialWidth,
    height: initialHeight
  };

  mainWindow = new BrowserWindow({
    ...initialAppBounds,
    transparent: false,
    backgroundColor: '#000000',
    frame: false,
    show: false,
  });

  const isDev = !app.isPackaged;

  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'Escape' && input.type === 'keyDown') {
      event.preventDefault();
      handleWindowEscape();
      return;
    }

    blockDefaultBrowserShortcuts(event, input);
  });

  mainWindow.on('focus', () => {
    // Defer focus transfer to next iteration of the event loop, after the current event loop phase completes.
    // This allows mainWindow to settle its focus state, preventing swallowed keyboard inputs during the transition.
    setImmediate(() => {
      if (uiWindow && !uiWindow.isDestroyed()) {
        uiWindow.focus();
      }
    });

    if (subtitlesLookupWindow && !subtitlesLookupWindow.isDestroyed() && subtitlesLookupWindow.isVisible()) {
      subtitlesLookupWindow.hide();
    }
  });

  uiWindow = new BrowserWindow({
    ...initialAppBounds,
    transparent: true,
    frame: false,
    parent: mainWindow,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
  });

  uiWindow.webContents.on('before-input-event', (event, input) => {
    blockDefaultBrowserShortcuts(event, input);
  });

  const syncWindowGeometry = () => {
    if (!mainWindow || !uiWindow || uiWindow.isDestroyed()) {
      return;
    }

    // If the main window is minimized, absolutely enforce that children are hidden too.
    if (mainWindow.isMinimized()) {
      if (videoWindow && !videoWindow.isDestroyed() && videoWindow.isVisible()) {
        safeHideVideoWindow();
        safeHideUiWindow();
      }
      if (uiWindow.isVisible()) {
        uiWindow.hide();
      }
      return;
    }

    // Hide video window immediately during movement to prevent visual desync
    if (!isRestoring && videoWindow && !videoWindow.isDestroyed() && videoWindow.isVisible()) {
      safeHideVideoWindow();
    }

    if (showVideoTimeout) {
      clearTimeout(showVideoTimeout);
    }

    const bounds = mainWindow.getBounds();

    isProgrammaticResize = true;

    // Enforce integer values to avoid sub-pixel errors:
    const sanitizedBounds = {
      x: Math.round(bounds.x),
      y: Math.round(bounds.y),
      width: Math.round(bounds.width),
      height: Math.round(bounds.height)
    };

    uiWindow.setBounds(sanitizedBounds);
    if (videoWindow && !videoWindow.isDestroyed()) {
      videoWindow.setBounds(sanitizedBounds);
    }

    isProgrammaticResize = false;

    if (uiWindow) {
      uiWindow.webContents.send('mpv:mainWindowMovedOrResized');
    }
    updateUiWindowShape();

    showVideoTimeout = setTimeout(() => {
      // Re-verify state before showing: if the user minimized the app during this 250ms delay, do NOT show the video.
      if (!isRestoring && videoWindow && !videoWindow.isDestroyed() && mainWindow && !mainWindow.isMinimized() && isVideoWindowVisible) {
        safeShowVideoWindow();
        safeShowUiWindow(); // Ensure UI comes back with video
      } else if (!isRestoring && uiWindow && !uiWindow.isDestroyed() && mainWindow && !mainWindow.isMinimized()) {
        // Fallback: If video isn't ready, at least show UI (e.g. if file not loaded yet)
        safeShowUiWindow();
      }
    }, 250);
  };

  mainWindow.on('resize', () => {
    // If user manually resizes window, invalidate the "restore" bounds.
    if (!isProgrammaticResize && !isEnteringFullscreen && !isFixingMaximize && !mainWindow?.isMaximized()) {
      if (preMaximizeBounds) {
        preMaximizeBounds = null;
        if (uiWindow) {
          uiWindow.webContents.send('window:maximized-state-changed', false);
        }
      }
    }

    // Always run the core geometry sync logic immediately
    syncWindowGeometry();

    // When in the process of entering fullscreen, handle the debounce logic
    if (isEnteringFullscreen) {
      if (resizeDebounceTimer) {
        clearTimeout(resizeDebounceTimer);
      }

      resizeDebounceTimer = setTimeout(() => {
        console.log('[Main Process] Fullscreen resize complete. Locking window resize.');
        if (mainWindow) {
          mainWindow.setResizable(false);
        }
        if (uiWindow) {
          uiWindow.setResizable(false);
        }

        // Reset the flag so this logic doesn't run on normal resizes
        isEnteringFullscreen = false;
      }, 100);
    }
  });

  mainWindow.on('move', syncWindowGeometry);

  uiWindow.on('resize', () => {
    // If this resize was caused by code, ignore it to prevent a loop.
    if (isProgrammaticResize || !mainWindow || !uiWindow) {
      return;
    }
    // Otherwise, a user resized the UI window. Force the main window to match it.
    mainWindow.setBounds(uiWindow.getBounds());
  });

  uiWindow.on('focus', () => {
    if (subtitlesLookupWindow && !subtitlesLookupWindow.isDestroyed() && subtitlesLookupWindow.isVisible()) {
      subtitlesLookupWindow.hide();
    }
  });

  // Dragging maximized window should unmaximize it automatically:
  mainWindow.on('will-move', (event) => {
    if (preMaximizeBounds && !isFixingMaximize && mainWindow) {
      event.preventDefault();
      const restoreBounds = preMaximizeBounds;
      preMaximizeBounds = null;
      if (uiWindow) {
        uiWindow.webContents.send('window:maximized-state-changed', false);
      }
      const cursorPos = screen.getCursorScreenPoint();
      const newX = Math.floor(cursorPos.x - (restoreBounds.width * (cursorPos.x / screen.getPrimaryDisplay().bounds.width)));
      const newY = cursorPos.y;
      mainWindow.setBounds({...restoreBounds, x: newX, y: newY});
    }
  });

  // Handle OS-level maximization when dropping window on screen edges, like Aero Snap on Windows:
  mainWindow.on('maximize', () => {
    if (!mainWindow) {
      return;
    }

    if (!preMaximizeBounds) {
      preMaximizeBounds = initialAppBounds;
    }

    isFixingMaximize = true;

    setTimeout(() => {
      if (mainWindow) {
        mainWindow.unmaximize();
        const display = screen.getDisplayMatching(mainWindow.getBounds());
        mainWindow.setBounds(display.workArea);
        syncWindowGeometry();
      }
      isFixingMaximize = false;
    }, 50);

    if (uiWindow) {
      uiWindow.webContents.send('window:maximized-state-changed', true);
    }
  });

  mainWindow.on('unmaximize', () => {
    if (isFixingMaximize) {
      return;
    }
    preMaximizeBounds = null;
    if (uiWindow) {
      uiWindow.webContents.send('window:maximized-state-changed', false);
    }
  });

  mainWindow.on('minimize', () => {
    isRestoring = true;
    safeHideVideoWindow();
    safeHideUiWindow();
  });

  mainWindow.on('restore', () => {
    // Ensure video and UI remain hidden during restore animation (OS might try to restore children automatically)
    safeHideVideoWindow();
    safeHideUiWindow();

    // Tell UI to show spinner immediately (reusing the resize event logic)
    if (uiWindow && !uiWindow.isDestroyed()) {
      uiWindow.webContents.send('mpv:mainWindowMovedOrResized');
    }

    // Wait for OS window animation to finish
    setTimeout(() => {
      // Check state again after the timeout. If the user minimized in the meantime, abort.
      if (!mainWindow || mainWindow.isMinimized()) {
        return;
      }

      isRestoring = false;
      syncWindowGeometry(); // Handles showing the video and UI properly
    }, 250);
  });

  mainWindow.on('closed', () => {
    mpvManager?.stop();
    // Child windows are destroyed automatically when the parent is closed, no need to close them explicitly.
    videoWindow = null;
    uiWindow = null;
    mainWindow = null;
  });

  mainWindow.on('ready-to-show', () => {
    if (uiWindow && mainWindow) {
      mainWindow.show();
      uiWindow.showInactive();
      updateUiWindowShape();
      uiWindow.hide();
      uiWindow.showInactive();
      uiWindow.webContents.send('window:maximized-state-changed', mainWindow.isMaximizable());

      if (!isDev) {
        uiWindow.focus();
      }
    }
  });

  mainWindow.on('enter-full-screen', () => {
    isEnteringFullscreen = true;

    if (uiWindow) {
      uiWindow.webContents.send('window:fullscreen-state-changed', true);
    }

    updateUiWindowShape();
  });

  mainWindow.on('leave-full-screen', () => {
    isEnteringFullscreen = false;

    if (mainWindow) {
      mainWindow.setResizable(true);
    }

    if (uiWindow) {
      uiWindow.setResizable(true);
      uiWindow.webContents.send('window:fullscreen-state-changed', false);
    }

    updateUiWindowShape();
  });

  const draggableHostPath = path.join(__dirname, './dist/yall-mp/browser/draggable-host.html');
  mainWindow.loadFile(draggableHostPath);

  const indexPath = path.join(__dirname, './dist/yall-mp/browser/index.html');
  uiWindow.loadFile(indexPath);

  if (isDev) {
    uiWindow.webContents.once('devtools-opened', () => {
      if (uiWindow && !uiWindow.isDestroyed()) {
        uiWindow.focus();
      }
    });

    uiWindow.webContents.openDevTools({mode: 'detach'});
  }
}

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    console.log('[Main] Second instance detected.');

    if (mainWindow) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }
      mainWindow.focus();
    }

    const files = getFilesFromArgv(commandLine);

    if (files.length > 0) {
      if (uiWindow && !uiWindow.isDestroyed()) {
        uiWindow.webContents.send('app:open-files', files);
        uiWindow.focus();
      } else {
        console.error('[Main] UI Window is missing or destroyed, cannot send files.');
      }
    } else {
      console.warn('[Main] No valid files found in command line arguments.');
    }
  });

  app.whenReady().then(() => {
    ensureProjectsDirExists();
    pendingFilesToOpen = getFilesFromArgv(process.argv); // Handle "Open with"

    ipcMain.handle('dialog:openFile', (_, options) => handleFileOpen(options));
    ipcMain.handle('subtitle:parse', (_, projectId, filePath) => handleSubtitleParse(projectId, filePath));
    ipcMain.handle('media:getMetadata', (_, filePath) => handleGetMediaMetadata(filePath));
    ipcMain.handle('media:extractSubtitleTrack', (_, projectId, mediaPath, trackIndex) => handleExtractSubtitleTrack(projectId, mediaPath, trackIndex));
    ipcMain.handle('anki:check', () => invokeAnkiConnect('version'));
    ipcMain.handle('anki:getDeckNames', () => invokeAnkiConnect('deckNames'));
    ipcMain.handle('anki:getNoteTypes', () => invokeAnkiConnect('modelNames'));
    ipcMain.handle('anki:getNoteTypeFieldNames', (_, modelName) => invokeAnkiConnect('modelFieldNames', {modelName}));
    ipcMain.handle('anki:exportAnkiCard', (_, exportRquest: AnkiExportRequest) => handleAnkiExport(exportRquest));
    ipcMain.handle('ffmpeg:check', async () => {
      await ensureFFmpegPaths();
      return isFFmpegAvailable;
    });
    ipcMain.handle('app:get-data', readAppData);
    ipcMain.handle('project:get-by-id', async (_, projectId: string) => {
      try {
        const projectPath = path.join(PROJECTS_DIR, `${projectId}.json`);
        const projectFile = await fs.readFile(projectPath, 'utf-8');
        return JSON.parse(projectFile);
      } catch (e) {
        console.error(`Could not load project file for ID ${projectId}.`, e);
        return null;
      }
    });

    ipcMain.handle('core-config:save', (_, coreConfig) => {
      coreConfigToSave = coreConfig;
      processSaveQueue();
    });

    ipcMain.handle('project:save', (_, project: Project) => {
      projectsToSave.set(project.id, project); // Map automatically handles overwriting with the latest data
      processSaveQueue();
    });

    ipcMain.handle('project:delete-file', async (_, projectId: string) => {
      const projectPath = path.join(PROJECTS_DIR, `${projectId}.json`);
      try {
        await fs.unlink(projectPath);
      } catch (error) {
        console.error(`Failed to delete project file for ${projectId}:`, error);
      }
    });

    ipcMain.on('window:minimize', () => {
      mainWindow?.minimize();
    });

    ipcMain.on('window:toggle-maximize', () => {
      if (!mainWindow) {
        return;
      }

      isProgrammaticResize = true;

      if (preMaximizeBounds) {
        mainWindow.setBounds(preMaximizeBounds);
        preMaximizeBounds = null;
        if (uiWindow) {
          uiWindow.webContents.send('window:maximized-state-changed', false);
        }
      } else {
        preMaximizeBounds = mainWindow.getBounds();
        const display = screen.getPrimaryDisplay();
        mainWindow.setBounds(display.workArea);
        if (uiWindow) {
          uiWindow.webContents.send('window:maximized-state-changed', true);
        }
      }

      isProgrammaticResize = false;
    });

    ipcMain.on('window:toggle-fullscreen', () => {
      if (mainWindow) {
        mainWindow.setFullScreen(!mainWindow.isFullScreen());
      }
    });

    ipcMain.on('window:handle-double-click', () => {
      if (!mainWindow) {
        return;
      }

      if (mainWindow.isFullScreen()) {
        mainWindow.setFullScreen(false);
      } else {
        mainWindow.setFullScreen(true);
      }
    });

    ipcMain.on('window:escape', () => {
      handleWindowEscape();
    });

    ipcMain.on('window:close', () => {
      mainWindow?.close();
    });

    ipcMain.on('window:update-draggable-zones', (_, rects: Rectangle[]) => {
      if (areRectsSimilar(draggableHeaderZones, rects)) {
        return;
      }
      draggableHeaderZones = rects;
      updateUiWindowShape();
    });

    ipcMain.handle('app:openInSystemBrowser', async (_, url: string) => {
      // Security: Validate the URL protocol before opening
      if (url.startsWith('http:') || url.startsWith('https:')) {
        await shell.openExternal(url);
      } else {
        console.warn(`Blocked attempt to open non-http(s) URL: ${url}`);
      }
    });

    ipcMain.handle('lookup:open-window', async (_, data: {
      url: string,
      clipSubtitleId: string,
      originalSelection: string
    }) => {
      const {url, clipSubtitleId, originalSelection} = data;
      currentSubtitlesLookupContext = {clipSubtitleId, originalSelection};

      const parentBounds = mainWindow!.getBounds();
      const lookupWidth = Math.round(parentBounds.width * 0.8);
      const lookupHeight = Math.round(parentBounds.height * 0.8);
      const lookupX = Math.round(parentBounds.x + (parentBounds.width - lookupWidth) / 2);
      const lookupY = Math.round(parentBounds.y + (parentBounds.height - lookupHeight) / 2);

      const TITLE_BAR_HEIGHT = 40; // 2.5rem
      const FOOTER_HEIGHT = 40; // 2.5rem
      const LOOKUP_PARTITION = 'in-memory:lookup_session';

      // Create the window and view ONCE, then detach/reattach the view on subsequent loads:
      if (subtitlesLookupWindow && !subtitlesLookupWindow.isDestroyed()) {
        subtitlesLookupWindow.setBounds({
          x: lookupX,
          y: lookupY,
          width: lookupWidth,
          height: lookupHeight
        });
        subtitlesLookupWindow.show();
        subtitlesLookupWindow.focus();

        // Detach the view to hide old content and reveal the host window
        if (subtitlesLookupView && subtitlesLookupWindow.contentView.children.includes(subtitlesLookupView)) {
          subtitlesLookupWindow.contentView.removeChildView(subtitlesLookupView);
        }

        // Now that the view is detached, the spinner in the host window will be visible
        subtitlesLookupWindow.webContents.send('view:loading-state-change', true);

        if (subtitlesLookupView) {
          // Load the new URL into the existing, but detached, view.
          await subtitlesLookupView.webContents.loadURL(url, USER_AGENT_OPTIONS).catch(err => {
            if (err.code !== 'ERR_ABORTED') {
              console.error('Subsequent lookup URL load failed:', err);
            }
          });
        }
      } else {
        subtitlesLookupWindow = new BrowserWindow({
          x: lookupX,
          y: lookupY,
          width: lookupWidth,
          height: lookupHeight,
          parent: mainWindow!,
          frame: false,
          show: false,
          title: 'Subtitles Lookup',
          backgroundColor: '#ffffff',
          webPreferences: {
            preload: path.join(__dirname, 'subtitles-lookup-host-preload.js'),
          }
        });

        await subtitlesLookupWindow.loadFile(path.join(__dirname, './dist/yall-mp/browser/subtitles-lookup-host.html'));
        subtitlesLookupWindow.show();
        subtitlesLookupWindow.focus();

        subtitlesLookupWindow.on('hide', () => {
          if (uiWindow && !uiWindow.isDestroyed()) {
            uiWindow.focus();
          }
        });

        subtitlesLookupWindow.on('close', (event) => {
          event.preventDefault();
          subtitlesLookupWindow?.hide();
        });

        const view = new WebContentsView({
          webPreferences: {
            preload: path.join(__dirname, 'subtitles-lookup-preload.js'),
            devTools: !app.isPackaged,
            partition: LOOKUP_PARTITION
          }
        });
        subtitlesLookupView = view;

        const updateViewBounds = () => {
          if (subtitlesLookupWindow && !subtitlesLookupWindow.isDestroyed()) {
            const [width, height] = subtitlesLookupWindow.getSize();
            view.setBounds({
              x: 0,
              y: TITLE_BAR_HEIGHT,
              width: width,
              height: height - TITLE_BAR_HEIGHT - FOOTER_HEIGHT
            });
          }
        };
        updateViewBounds();
        subtitlesLookupWindow.on('resize', updateViewBounds);

        view.webContents.on('did-finish-load', () => {
          if (subtitlesLookupWindow && !subtitlesLookupWindow.isDestroyed()) {
            subtitlesLookupWindow.webContents.send('view:loading-state-change', false);
            // Re-attach the view now that it has new content:
            if (!subtitlesLookupWindow.contentView.children.includes(view)) {
              subtitlesLookupWindow.contentView.addChildView(view);
            }
          }
        });

        view.webContents.on('did-fail-load', (_, errorCode, errorDescription) => {
          console.error(`Lookup view failed to load: ${errorDescription} (Code: ${errorCode})`);
          if (subtitlesLookupWindow && !subtitlesLookupWindow.isDestroyed()) {
            subtitlesLookupWindow.webContents.send('view:loading-state-change', false);
          }
        });

        // The spinner is showing by default on the host. Now load the initial URL:
        await view.webContents.loadURL(url, USER_AGENT_OPTIONS).catch(err => {
          if (err.code !== 'ERR_ABORTED') {
            console.error('Initial lookup URL load failed:', err);
          }
        });
      }
    });

    ipcMain.on('lookup:close-window', () => {
      subtitlesLookupWindow?.hide();
    });

    ipcMain.on('lookup:show-context-menu', (_, selectedText) => {
      const template = [
        {
          label: 'Add to Notes',
          click: () => {
            if (uiWindow && !uiWindow.isDestroyed() && currentSubtitlesLookupContext && selectedText) {
              uiWindow.webContents.send('project:add-note', {
                clipSubtitleId: currentSubtitlesLookupContext.clipSubtitleId,
                text: selectedText,
                selection: currentSubtitlesLookupContext.originalSelection
              });
              if (subtitlesLookupWindow && !subtitlesLookupWindow.isDestroyed()) {
                subtitlesLookupWindow.webContents.send('lookup:show-toast', 'Note added!');
              }
            } else {
              console.error('[Main Process] Could not send note: uiWindow or context is missing.');
            }
          }
        }
      ];
      const menu = Menu.buildFromTemplate(template);
      const parentWindow = subtitlesLookupWindow ?? undefined;
      menu.popup({window: parentWindow});
    });

    ipcMain.on('lookup:add-note', (_, {text}) => {
      if (uiWindow && !uiWindow.isDestroyed() && currentSubtitlesLookupContext) {
        uiWindow.webContents.send('project:add-note', {
          clipSubtitleId: currentSubtitlesLookupContext.clipSubtitleId,
          text: text,
          selection: currentSubtitlesLookupContext.originalSelection
        });
        if (subtitlesLookupWindow && !subtitlesLookupWindow.isDestroyed()) {
          subtitlesLookupWindow.webContents.send('lookup:show-toast', 'Note added!');
        }
      } else {
        console.error('[Main Process] Could not forward note: uiWindow or context is missing.');
      }
    });

    ipcMain.handle('mpv:createViewport', async (
      _,
      mediaPath: string,
      audioTrackIndex: number | null,
      subtitleSelection: SubtitleSelection,
      subtitleTracks: MediaTrack[],
      useMpvSubtitles: boolean,
      subtitlesVisible: boolean
    ) => {
      if (!uiWindow || !mainWindow) {
        return;
      }

      isInitialResizeComplete = false;
      hasRequestedInitialSeek = false;
      isVideoWindowVisible = false;

      // Clean up any old instances
      if (uiWindow && !uiWindow.isDestroyed()) {
        // Ensure state is reset to hidden when recreating the viewport
        uiWindow.webContents.send('mpv:video-visibility-change', false);
      }
      videoWindow?.close();
      mpvManager?.stop();

      // Create a new, borderless, independent window.
      videoWindow = new BrowserWindow({
        frame: false,
        show: false,
        skipTaskbar: true,
        transparent: true,
        resizable: false,
        focusable: false,
        parent: mainWindow,
      });

      videoWindow.setIgnoreMouseEvents(true);

      // Failsafe listener: even though focusable is false for videoWindow, if it somehow gets input, handle ESC.
      videoWindow.webContents.on('before-input-event', (event, input) => {
        if (input.key === 'Escape' && input.type === 'keyDown') {
          event.preventDefault();
          handleWindowEscape();
          return;
        }

        blockDefaultBrowserShortcuts(event, input);
      });

      // uiWindow is the child of videoWindow to always be on top and prevent stacking order issues:
      uiWindow.setParentWindow(videoWindow);

      mpvManager = new MpvManager(videoWindow);
      playbackManager = new PlaybackManager(mpvManager, uiWindow);

      playbackManager.on('repeat-seek-completed', () => {
        if (uiWindow && !uiWindow.isDestroyed()) {
          uiWindow.webContents.send('playback:repeat-seek-completed');
        }
      });

      mpvManager.on('status', (status) => {
        if (uiWindow) {
          uiWindow.webContents.send('mpv:event', status)
        }
      });

      const onMpvStatus = (status: any) => {
        // Listen for confirmation only if seek requested
        // This ignores the premature playback-restart at t=0.
        if (status.event === 'playback-restart' && hasRequestedInitialSeek) {
          console.log('[Main Process] Confirmed playback-restart AFTER seek request.');

          tryShowVideoWindowAndNotifyUI();

          // This is only needed once:
          mpvManager?.removeListener('status', onMpvStatus);
        }
      };
      mpvManager.on('status', onMpvStatus);

      mpvManager.on('error', (err) => console.error("MPV Error:", err));
      mpvManager.on('ready', () => {
        console.log('[Main Process] MpvManager is ready. Notifying renderer.');
        if (uiWindow) {
          uiWindow.webContents.send('mpv:managerReady');
        }
      });

      try {
        // Start MPV inside the child window's handle
        await mpvManager.start(mediaPath, audioTrackIndex, subtitleSelection, subtitleTracks, useMpvSubtitles, subtitlesVisible);
        mpvManager.observeProperty('time-pos');
        mpvManager.observeProperty('duration');
        mpvManager.observeProperty('pause');
      } catch (error) {
        console.error('[Main Process] Critical error during MPV startup:', error);
        // Re-throw the error so the renderer process's Promise is rejected.
        throw error;
      }
    });

    ipcMain.handle('mpv:finishVideoResize', async (_, containerRect: {
      x: number,
      y: number,
      width: number,
      height: number
    }) => {
      if (!videoWindow || !mainWindow || !mpvManager) {
        console.error('[Main Process] Resize called but a window is missing!');
        return;
      }

      try {
        // Get the video's aspect ratio from MPV.
        const videoAspectRatio = await mpvManager.getProperty('video-params/aspect');

        // Fallback if the aspect ratio isn't available yet.
        if (!videoAspectRatio || videoAspectRatio <= 0) {
          if (!videoWindow.isVisible()) {
            safeShowVideoWindow();
          }
          return;
        }

        // Perform the aspect ratio calculation.
        let newWidth = containerRect.width;
        let newHeight = newWidth / videoAspectRatio;

        if (newHeight > containerRect.height) {
          newHeight = containerRect.height;
          newWidth = newHeight * videoAspectRatio;
        }

        // Calculate the centered position.
        const [parentX, parentY] = mainWindow.getPosition();
        const offsetX = (containerRect.width - newWidth) / 2;
        const offsetY = (containerRect.height - newHeight) / 2;

        const finalBounds = {
          x: parentX + Math.round(containerRect.x) + Math.round(offsetX),
          y: parentY + Math.round(containerRect.y) + Math.round(offsetY),
          width: Math.round(newWidth),
          height: Math.round(newHeight),
        };

        // Set the final bounds on the video window.
        videoWindow.setBounds(finalBounds);

        if (!isInitialResizeComplete) {
          console.log('[Main Process] Initial resize is complete.');
          isInitialResizeComplete = true;
          tryShowVideoWindowAndNotifyUI();
        } else {
          if (!isRestoring && isVideoWindowVisible) {
            safeShowVideoWindow();
          }
        }
      } catch (e) {
        console.error("Error during viewport resize:", e);
      }
    });

    ipcMain.handle('mpv:command', (_, commandArray) => {
      console.log('[Main Process]  Received mpv:command:', commandArray);
      mpvManager?.sendCommand(commandArray);
    });

    ipcMain.handle('mpv:getProperty', (_, property) => {
      const value = mpvManager?.getProperty(property);
      console.log(`[Main Process] Received mpv:getProperty: ${property}=${value}`);
      return value;
    });

    ipcMain.handle('mpv:setProperty', (_, property, value) => {
      console.log(`[Main Process] Received mpv:setProperty: ${property}=${value}`);
      mpvManager?.setProperty(property, value);
    });

    ipcMain.handle('mpv:showSubtitles', () => mpvManager?.showSubtitles());
    ipcMain.handle('mpv:hideSubtitles', () => mpvManager?.hideSubtitles());

    ipcMain.handle('mpv:destroyViewport', () => {
      console.log('[Main Process] Received mpv:destroyViewport. Cleaning up.');

      mpvManager?.stop();
      mpvManager = null;
      playbackManager = null;

      // Reset UI parent window
      if (uiWindow && !uiWindow.isDestroyed() && mainWindow && !mainWindow.isDestroyed()) {
        uiWindow.setParentWindow(mainWindow);
      }

      // Cleanup subtitles lookup window if open
      if (subtitlesLookupWindow && !subtitlesLookupWindow.isDestroyed()) {
        subtitlesLookupWindow.destroy();
      }
      subtitlesLookupWindow = null;
      subtitlesLookupView = null;

      return new Promise<void>((resolve) => {
        // Defer the destruction of the videoWindow to the NEXT macrotask.
        // This guarantees that the re-parenting command above has been fully processed by Electron.
        setTimeout(() => {
          if (videoWindow && !videoWindow.isDestroyed()) {
            videoWindow.close();
          }
          videoWindow = null;
          console.log('[Main Process] Deferred videoWindow cleanup complete.');
          resolve();
        }, 50);
      });
    });

    ipcMain.handle('fonts:get-fonts', async (_, projectId: string) => {
      try {
        const fontFilePath = path.join(FONT_CACHE_DIR, `${projectId}.json`);
        const data = await fs.readFile(fontFilePath, 'utf-8');
        return JSON.parse(data);
      } catch (error) {
        // It's normal for a file not to exist if a project has no ASS subtitles
        return [];
      }
    });

    ipcMain.on('fonts:delete-fonts', async (_, projectId: string) => {
      try {
        const fontFilePath = path.join(FONT_CACHE_DIR, `${projectId}.json`);
        await fs.unlink(fontFilePath);
      } catch (error) {
        // Ignore errors if the file doesn't exist
      }
    });

    ipcMain.handle('project:generate-audio-peaks', async (_, projectId, mediaPath) => generateAudioPeaks(projectId, mediaPath));

    ipcMain.handle('fs:check-file-exists', async (_, filePath: string) => {
      if (!filePath) return false;
      try {
        await fs.access(filePath);
        return true;
      } catch {
        return false;
      }
    });

    ipcMain.on('playback:play', () => playbackManager?.play());
    ipcMain.on('playback:pause', () => playbackManager?.pause());
    ipcMain.on('playback:togglePlayPause', () => playbackManager?.togglePlayPause());
    ipcMain.on('playback:toggleSubtitles', () => playbackManager?.toggleSubtitles());
    ipcMain.on('playback:repeat', () => playbackManager?.repeat());
    ipcMain.on('playback:forceContinue', () => playbackManager?.forceContinue());
    ipcMain.on('playback:seek', (_, time) => {
      // Use this flag on first seek to coordinate showing the video window
      if (!hasRequestedInitialSeek) {
        hasRequestedInitialSeek = true;
      }
      playbackManager?.seek(time);
    });
    ipcMain.on('playback:updateSettings', (_, settings) => {
      playbackManager?.updateSettings(settings);
    });
    ipcMain.on('playback:updateClips', (_, clips) => {
      playbackManager?.updateClips(clips);
    });
    ipcMain.handle('playback:loadProject', (_, clips, settings, lastPlaybackTime) => playbackManager?.loadProject(clips, settings, lastPlaybackTime));
    ipcMain.handle('app:get-version', () => app.getVersion());

    ipcMain.handle('app:get-pending-files', () => {
      const files = [...pendingFilesToOpen];
      pendingFilesToOpen = []; // Clear after retrieval
      return files;
    });

    const naturalSort = (a: string, b: string) => {
      return new Intl.Collator(undefined, {numeric: true, sensitivity: 'base'}).compare(a, b);
    };

    ipcMain.handle('fs:find-adjacent-media', async (_, currentPath: string, direction: 'next' | 'previous') => {
      try {
        const currentDir = path.dirname(currentPath);
        const currentFileName = path.basename(currentPath);

        // Search for siblings (same directory)
        const siblings = await fs.readdir(currentDir);
        const mediaSiblings = siblings.filter(f => {
          const ext = path.extname(f).toLowerCase().replace('.', '');
          return SUPPORTED_MEDIA_TYPES.includes(ext);
        }).sort(naturalSort);

        const currentIndex = mediaSiblings.indexOf(currentFileName);
        const targetIndex = direction === 'next' ? currentIndex + 1 : currentIndex - 1;

        // If found in same folder, return it
        if (targetIndex >= 0 && targetIndex < mediaSiblings.length) {
          return path.join(currentDir, mediaSiblings[targetIndex]);
        }

        // Search for siblings (e.g., folder per episode support)
        // Only attempt this if user is at the edge of the current folder
        // ("Next" on the last file or "Prev" on the first file)
        const parentDir = path.dirname(currentDir);
        const parentItems = await fs.readdir(parentDir);

        // Get all directories in the parent folder
        const siblingDirs = parentItems.filter(item => {
          try {
            return statSync(path.join(parentDir, item)).isDirectory();
          } catch {
            return false;
          }
        }).sort(naturalSort);

        const currentDirName = path.basename(currentDir);
        const currentDirIndex = siblingDirs.indexOf(currentDirName);

        if (currentDirIndex === -1) {
          return null;
        }

        const targetDirIndex = direction === 'next' ? currentDirIndex + 1 : currentDirIndex - 1;

        if (targetDirIndex >= 0 && targetDirIndex < siblingDirs.length) {
          const targetDirName = siblingDirs[targetDirIndex];
          const targetDirPath = path.join(parentDir, targetDirName);

          // Look inside the next folder
          const targetDirFiles = await fs.readdir(targetDirPath);
          const targetMediaFiles = targetDirFiles.filter(f => {
            const ext = path.extname(f).toLowerCase().replace('.', '');
            return SUPPORTED_MEDIA_TYPES.includes(ext);
          }).sort(naturalSort);

          if (targetMediaFiles.length > 0) {
            // If going "Next", play the first file of the next folder.
            // If going "Previous", play the last file of the previous folder.
            const fileIndex = direction === 'next' ? 0 : targetMediaFiles.length - 1;
            return path.join(targetDirPath, targetMediaFiles[fileIndex]);
          }
        }

        return null;
      } catch (e) {
        console.error('Error finding adjacent media:', e);
        return null;
      }
    });

    ipcMain.handle('fs:find-companion-subtitle', async (_, mediaPath: string) => {
      try {
        const dir = path.dirname(mediaPath);
        const nameNoExt = path.parse(mediaPath).name;
        const files = await fs.readdir(dir);

        const candidates = files.filter(f => {
          const ext = path.extname(f).toLowerCase().replace('.', '');
          if (!SUPPORTED_SUBTITLE_TYPES.includes(ext)) {
            return false;
          }
          return f.startsWith(nameNoExt); // Basic check
        });

        // Sort candidates by length (shortest matching name is usually the "main" subtitle)
        // e.g., "Movie.srt" is preferred over "Movie.commentary.srt"
        candidates.sort((a, b) => a.length - b.length);

        if (candidates.length > 0) {
          return path.join(dir, candidates[0]);
        }
        return null;
      } catch (e) {
        return null;
      }
    });

    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

async function handleFileOpen(options: Electron.OpenDialogOptions) {
  const {canceled, filePaths} = await dialog.showOpenDialog(options);
  if (!canceled) {
    return filePaths;
  }
  return [];
}

async function handleSubtitleParse(projectId: string, filePath: string): Promise<ParsedSubtitlesData> {
  const {parseResponse} = await import('media-captions');
  const {compile, parse} = await import('ass-compiler');

  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const extension = path.extname(filePath).toLowerCase();

    if (extension === '.ass' || extension === '.ssa') {
      // Ensure the font cache directory exists
      await fs.mkdir(FONT_CACHE_DIR, {recursive: true});

      const parsed = parse(content);
      const compiled = compile(content, {});
      const playResY = compiled.info.PlayResY ? parseInt(compiled.info.PlayResY, 10) : 1080;
      const granularTimeline = dialoguesToAssSubtitleData(compiled.dialogues, parsed.events.dialogue, compiled.styles, playResY);
      const karaokeMergedTimeline = mergeKaraokeSubtitles(granularTimeline, parsed.events);
      const finalTimeline = mergeIdenticalConsecutiveSubtitles(karaokeMergedTimeline);
      const subtitlesWithTracks = assignTracksToSubtitles(finalTimeline);
      const requiredFonts = getRequiredFontsFromAss(content);
      const fonts = await loadFontData(requiredFonts, undefined, filePath);
      const fullText = getFullTextFromSubtitles(finalTimeline);
      const detectedLanguage = await detectLanguage(fullText);

      await fs.writeFile(path.join(FONT_CACHE_DIR, `${projectId}.json`), JSON.stringify(fonts));

      return {
        subtitles: subtitlesWithTracks,
        rawAssContent: content,
        styles: compiled.styles,
        detectedLanguage
      };
    } else {
      const response = new Response(content);
      const fileFormat = extension.replace('.', '');
      const result: ParsedCaptionsResult = await parseResponse(response, {type: fileFormat as CaptionsFileFormat});
      if (result.errors.length > 0) {
        console.warn('Encountered errors parsing subtitle file:', result.errors);
      }
      const subtitles: SrtSubtitleData[] = result.cues.map((cue: VTTCue) => ({
        type: 'srt',
        id: cue.id,
        startTime: cue.startTime,
        endTime: cue.endTime,
        text: cue.text,
        track: 0
      }));
      const processedSubtitles = preprocessSubtitles(subtitles);
      const fullText = getFullTextFromSubtitles(processedSubtitles);
      const detectedLanguage = await detectLanguage(fullText);

      return {
        subtitles: processedSubtitles,
        detectedLanguage
      };
    }
  } catch (error) {
    console.error(`Error reading or parsing subtitle file at ${filePath}:`, error);
    return {
      subtitles: [],
      detectedLanguage: 'other'
    };
  }
}

function preprocessSubtitles(subtitles: SubtitleData[]): SubtitleData[] {
  const sortedSubtitles = [...subtitles].sort((a, b) => a.startTime - b.startTime);

  if (sortedSubtitles.length === 0) {
    return [];
  }

  sortedSubtitles.forEach((sub: SubtitleData, i: number) => {
    if (i > 0) {
      const previousSubtitle = sortedSubtitles[i - 1];
      // If there's an overlap, truncate the previous subtitle
      if (sub.startTime < previousSubtitle.endTime) {
        previousSubtitle.endTime = sub.startTime;
      }
    }
  });

  // Filter out any subtitles that may have become zero-duration or negative-duration as a result of the truncation
  return sortedSubtitles.filter(sub => sub.endTime > sub.startTime);
}

async function invokeAnkiConnect(action: string, params = {}) {
  try {
    const response = await fetch('http://localhost:8765', {
      method: 'POST',
      body: JSON.stringify({action, version: 6, params})
    });
    const data = await response.json();
    if (data.error) {
      throw new Error(data.error);
    }
    return data.result;
  } catch (e) {
    console.error(`AnkiConnect action '${action}' failed:`, e);
    return null;
  }
}

async function handleAnkiExport(exportRequest: AnkiExportRequest) {
  await ensureFFmpegPaths();

  if (!isFFmpegAvailable) {
    return {cardId: null, error: 'FFmpeg is not available, cannot export media.'};
  }

  const {template, subtitleData, mediaPath, exportTime, notes, tags, suspend} = exportRequest;
  const tempDir = os.tmpdir();
  const uniqueId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  const finalFields: Record<string, string> = {};
  const generatedFiles: string[] = [];

  try {
    for (const mapping of template.fieldMappings) {
      switch (mapping.source) {
        case 'id':
          finalFields[mapping.destination] = uuidv4();
          break;

        case 'text':
          if (subtitleData.type === 'srt') {
            finalFields[mapping.destination] = subtitleData.text;
          } else { // 'ass'
            finalFields[mapping.destination] = subtitleData.parts.map(p => p.text).join('\n');
          }
          break;

        case 'audio':
          const audioPath = path.join(tempDir, `${uniqueId}.mp3`);
          generatedFiles.push(audioPath);

          const audioArgs = [
            '-i', mediaPath,                          // Input file
            '-ss', subtitleData.startTime.toString(), // Start time
            '-to', subtitleData.endTime.toString(),   // End time
            '-vn',                                    // No video
            '-acodec', 'libmp3lame',                  // Use MP3 codec
            '-q:a', '2',                              // Audio quality (VBR)
            audioPath
          ];

          await runFFmpeg(audioArgs);

          const audioFilename = await invokeAnkiConnect('storeMediaFile', {
            filename: path.basename(audioPath),
            path: audioPath
          });
          if (!audioFilename) {
            throw new Error('Failed to store audio file in Anki.');
          }
          finalFields[mapping.destination] = `[sound:${audioFilename}]`;
          break;

        case 'screenshot':
          const imagePath = path.join(tempDir, `${uniqueId}.jpg`);
          generatedFiles.push(imagePath);

          const imageArgs = [
            '-ss', exportTime.toString(), // Go to the start time of the clip
            '-i', mediaPath,              // Input file
            '-vframes', '1',              // Take just one frame
            '-q:v', '2',                  // Image quality
            imagePath
          ];

          await runFFmpeg(imageArgs);

          const imageFilename = await invokeAnkiConnect('storeMediaFile', {
            filename: path.basename(imagePath),
            path: imagePath
          });
          if (!imageFilename) {
            throw new Error('Failed to store image file in Anki.');
          }
          finalFields[mapping.destination] = `<img src="${imageFilename}">`;
          break;

        case 'video':
          const videoPath = path.join(tempDir, `${uniqueId}.webm`);
          generatedFiles.push(videoPath);

          const videoArgs = [
            '-i', mediaPath,                          // Input file
            '-ss', subtitleData.startTime.toString(), // Start time
            '-to', subtitleData.endTime.toString(),   // End time
            '-c:v', 'libvpx-vp9',                     // VP9 video codec
            '-crf', '32',                             // Constant Rate Factor for VP9
            '-b:v', '0',                              // Must be 0 when using CRF
            '-vf', 'scale=-2:480',                    // Scale to 480p height to keep size down
            '-c:a', 'libopus',                        // Opus audio codec
            '-b:a', '96k',                            // Audio bitrate
            videoPath
          ];

          await runFFmpeg(videoArgs);

          const videoFilename = await invokeAnkiConnect('storeMediaFile', {
            filename: path.basename(videoPath),
            path: videoPath
          });

          if (!videoFilename) {
            throw new Error('Failed to store video file in Anki.');
          }

          finalFields[mapping.destination] = `<video controls playsinline autoplay src="${videoFilename}"></video>`;
          break;

        case 'notes':
          finalFields[mapping.destination] = notes;
          break;
      }
    }

    const note: AnkiCard = {
      deckName: template.ankiDeck!,
      modelName: template.ankiNoteType!,
      fields: finalFields,
      tags,
      options: {
        allowDuplicate: true
      }
    };

    const cardId = await invokeAnkiConnect('addNote', {note});
    if (!cardId) {
      throw new Error('Failed to add note to Anki.');
    }

    if (suspend) {
      const suspendResult = await invokeAnkiConnect('suspend', {cards: [cardId]});
      if (suspendResult) {
        console.log(`[Anki Export] Suspended new card: ${cardId}`);
      }
    }

    return {cardId};
  } catch (error: any) {
    console.error('Anki export pipeline failed:', error);
    return {cardId: null, error: error.message};
  } finally {
    for (const file of generatedFiles) {
      await fs.unlink(file).catch(e => console.error(`Failed to delete temp file: ${file}`, e));
    }
  }
}

function runFFmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const process = spawn(ffmpegPath, args);

    let errorOutput = '';
    process.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });

    process.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        console.error(`FFmpeg exited with code ${code}`);
        console.error('FFmpeg stderr:', errorOutput);
        reject(new Error(`FFmpeg failed: ${errorOutput}`));
      }
    });

    process.on('error', (err) => {
      console.error('Failed to start FFmpeg process.', err);
      reject(err);
    });
  });
}

async function runFfprobe(args: string[]): Promise<any> {
  return new Promise((resolve, reject) => {
    const process: ChildProcess = spawn(ffprobePath, args);
    let stdout = '';
    let stderr = '';

    process.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    process.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    process.on('close', (code) => {
      if (code === 0) {
        try {
          resolve(JSON.parse(stdout));
        } catch (e) {
          reject(new Error('Failed to parse ffprobe output.'));
        }
      } else {
        reject(new Error(`ffprobe exited with code ${code}: ${stderr}`));
      }
    });

    process.on('error', (err) => {
      reject(err);
    });
  });
}

async function handleGetMediaMetadata(filePath: string) {
  await ensureFFmpegPaths();

  if (!isFFmpegAvailable) {
    return {audioTracks: [], subtitleTracks: []};
  }
  try {
    const probeResult = await runFfprobe([
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_streams',
      filePath
    ]);

    const audioTracks: MediaTrack[] = [];
    const subtitleTracks: MediaTrack[] = [];
    let videoWidth: number | undefined;
    let videoHeight: number | undefined;

    if (probeResult && probeResult.streams) {
      for (const stream of probeResult.streams) {
        const baseTrack = {
          index: stream.index,
          language: stream.tags?.language,
          title: stream.tags?.title
        };

        const {label, code} = getLanguageInfo(baseTrack);

        const finalTrack: MediaTrack = {
          ...baseTrack,
          label: label,
          languageCode: code
        };

        if (stream.codec_type === 'video') {
          videoWidth = stream.width;
          videoHeight = stream.height;
        } else if (stream.codec_type === 'audio') {
          audioTracks.push(finalTrack);
        } else if (stream.codec_type === 'subtitle') {
          subtitleTracks.push(finalTrack);
        }
      }
    }
    return {audioTracks, subtitleTracks, videoWidth, videoHeight};
  } catch (error) {
    console.error('Error probing media file:', error);
    return {audioTracks: [], subtitleTracks: [], videoWidth: undefined, videoHeight: undefined};
  }
}

async function handleExtractSubtitleTrack(projectId: string, mediaPath: string, trackIndex: number): Promise<ParsedSubtitlesData> {
  const {parseResponse} = await import('media-captions');
  const {compile, parse} = await import('ass-compiler');
  await ensureFFmpegPaths();

  return new Promise(async (resolve, reject) => {
    const probeResult = await runFfprobe(['-v', 'quiet', '-print_format', 'json', '-show_streams', mediaPath]);
    const subtitleStream = probeResult.streams.find((s: any) => s.index === trackIndex);
    const codec = subtitleStream?.codec_name;
    let outputFormat = 'srt';
    if (codec === 'ass' || codec === 'ssa') {
      outputFormat = 'ass';
    }
    const args = ['-i', mediaPath, '-map', `0:${trackIndex}`, '-c:s', outputFormat, '-f', outputFormat, '-'];
    const ffmpegProcess = spawn(ffmpegPath, args);
    let subtitleContent = '';
    ffmpegProcess.stdout.on('data', (data) => {
      subtitleContent += data.toString();
    });
    let errorOutput = '';
    ffmpegProcess.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });
    ffmpegProcess.on('error', (err) => {
      reject(err);
    });

    ffmpegProcess.on('close', async (code) => {
      if (code === 0) {
        try {
          if (outputFormat === 'ass') {
            // Ensure the font cache directory exists
            await fs.mkdir(FONT_CACHE_DIR, {recursive: true});

            const parsed = parse(subtitleContent);
            const compiled = compile(subtitleContent, {});
            const playResY = compiled.info.PlayResY ? parseInt(compiled.info.PlayResY, 10) : 1080;
            const granularTimeline = dialoguesToAssSubtitleData(compiled.dialogues, parsed.events.dialogue, compiled.styles, playResY);
            const karaokeMergedTimeline = mergeKaraokeSubtitles(granularTimeline, parsed.events);
            const finalTimeline = mergeIdenticalConsecutiveSubtitles(karaokeMergedTimeline);
            const subtitlesWithTracks = assignTracksToSubtitles(finalTimeline);
            const requiredFonts = getRequiredFontsFromAss(subtitleContent);
            const fonts = await loadFontData(requiredFonts, mediaPath, undefined);
            const fullText = getFullTextFromSubtitles(finalTimeline);
            const detectedLanguage = await detectLanguage(fullText);

            await fs.writeFile(path.join(FONT_CACHE_DIR, `${projectId}.json`), JSON.stringify(fonts));

            resolve({
              subtitles: subtitlesWithTracks,
              rawAssContent: subtitleContent,
              styles: compiled.styles,
              detectedLanguage
            });
          } else {
            const response = new Response(subtitleContent);
            const result: ParsedCaptionsResult = await parseResponse(response, {type: 'srt'});
            if (result.errors.length > 0) {
              console.warn('Encountered errors parsing extracted subtitle stream:', result.errors);
            }
            const subtitles: SrtSubtitleData[] = result.cues.map((cue: VTTCue) => ({
              type: 'srt',
              id: cue.id,
              startTime: cue.startTime,
              endTime: cue.endTime,
              text: cue.text,
              track: 0
            }));
            const processedSubtitles = preprocessSubtitles(subtitles);
            const fullText = getFullTextFromSubtitles(processedSubtitles);
            const detectedLanguage = await detectLanguage(fullText);

            resolve({
              subtitles: processedSubtitles,
              detectedLanguage
            });
          }
        } catch (e) {
          reject(new Error(`Failed to parse extracted subtitle stream: ${e}`));
        }
      } else {
        reject(new Error(`ffmpeg failed to extract subtitle track with code ${code}: ${errorOutput}`));
      }
    });
  });
}

function getLanguageInfo(track: Omit<MediaTrack, 'label' | 'code'>): { label: string, code?: string } {
  const languages = require('@cospired/i18n-iso-languages');

  const originalCode = track.language;
  let langName: string | undefined = '';
  let standardCode: string | undefined;

  if (originalCode) {
    if (languages.isValid(originalCode)) {
      langName = languages.getName(originalCode, 'en');
      standardCode = languages.toAlpha2(originalCode);
    }
  }

  const title = track.title;
  let displayLabel: string;

  if (langName && title) {
    displayLabel = `${langName}, ${title}`;
  } else if (langName) {
    displayLabel = langName;
  } else if (title) {
    displayLabel = title;
  } else if (originalCode) {
    displayLabel = `Unknown Language (${originalCode.toUpperCase()})`;
  } else {
    displayLabel = `Track ${track.index}`;
  }

  return {label: displayLabel, code: standardCode};
}

async function readAppData(): Promise<AppData | null> {
  try {
    const coreConfigFile = await fs.readFile(APP_DATA_PATH, 'utf-8');
    const coreConfig: CoreConfig = JSON.parse(coreConfigFile);

    if (!coreConfig) {
      return null;
    }

    let currentProject: Project | null = null;
    if (coreConfig.lastOpenedProjectId) {
      try {
        const projectPath = path.join(PROJECTS_DIR, `${coreConfig.lastOpenedProjectId}.json`);
        const projectFile = await fs.readFile(projectPath, 'utf-8');
        currentProject = JSON.parse(projectFile);
      } catch (e) {
        console.warn(`Could not load last opened project file for ID ${coreConfig.lastOpenedProjectId}. It may have been deleted.`);
      }
    }

    return {
      projects: coreConfig.projects || [],
      currentProject,
      globalSettings: coreConfig.globalSettings,
      ankiSettings: coreConfig.ankiSettings,
    };
  } catch (error) {
    console.log('Could not read app data (file might not exist yet). Returning null.');
    return null;
  }
}

async function ensureProjectsDirExists() {
  try {
    await fs.mkdir(PROJECTS_DIR, {recursive: true});
  } catch (error) {
    console.error('Failed to create projects directory:', error);
  }
}

async function processSaveQueue() {
  if (isSaving) {
    return;
  }

  isSaving = true;

  try {
    // Prioritize saving core config
    if (coreConfigToSave) {
      const configData = coreConfigToSave;
      await fs.writeFile(APP_DATA_PATH, JSON.stringify(configData, null, 2), 'utf-8');
      coreConfigToSave = null;
    }

    // Save one project from the queue
    if (projectsToSave.size > 0) {
      const [[projectId, projectData]] = projectsToSave; // Destructure 1st entry from map of projects
      const projectPath = path.join(PROJECTS_DIR, `${projectId}.json`);
      await fs.writeFile(projectPath, JSON.stringify(projectData, null, 2), 'utf-8');
      projectsToSave.delete(projectId);
    }
  } catch (error) {
    console.error('Failed during save operation:', error);
  } finally {
    isSaving = false;
    // If there are more items, process them in the next tick
    if (coreConfigToSave || projectsToSave.size > 0) {
      process.nextTick(processSaveQueue);
    }
  }
}

function getRequiredFontsFromAss(assContent: string): RequiredFont[] {
  const requiredFonts = new Map<string, RequiredFont>(); // Use a map to store unique font styles

  const addFont = (family: string, bold: boolean, italic: boolean) => {
    const key = `${family}-${bold}-${italic}`;
    if (!requiredFonts.has(key)) {
      requiredFonts.set(key, {family, bold, italic});
    }
  };

  const stylesSection = assContent.match(/\[V4\+ Styles\]\s*([\s\S]*?)(?=\s*\[|$)/i);
  if (stylesSection) {
    // Format: Name, Fontname, Fontsize, ..., Bold, Italic, ...
    const styleLines = stylesSection[1].split('\n').filter(line => line.toLowerCase().startsWith('style:'));
    styleLines.forEach(line => {
      const parts = line.split(',');
      if (parts.length > 8) {
        const family = parts[1].trim();
        const bold = parts[7].trim() === '-1';
        const italic = parts[8].trim() === '-1';
        addFont(family, bold, italic);
      }
    });
  }

  const eventsSection = assContent.match(/\[Events\]\s*([\s\S]*?)(?=\s*\[|$)/i);
  if (eventsSection) {
    const fnTagRegex = /\\fn([^\\}]+)/g;
    let match;
    while ((match = fnTagRegex.exec(eventsSection[1])) !== null) {
      // For \fn overrides, assume a non-bold, non-italic style unless other tags are present
      // Handles common use cases without full tag parsing
      addFont(match[1].trim(), false, false);
    }
  }

  return Array.from(requiredFonts.values());
}

const normalizeFontName = (name: string) => {
  return path.parse(name).name.toLowerCase().replace(/[^a-z0-9]/g, '');
};

async function extractAttachmentsWithEbml(mediaPath: string): Promise<Map<string, {
  fileName: string,
  fileData: Buffer
}>> {
  const {Decoder} = await import('ts-ebml');

  console.log('[Fonts] Parsing MKV with ts-ebml to find attachments...');
  const fileBuffer = await fs.readFile(mediaPath);
  const decoder = new Decoder();
  const ebmlElements = decoder.decode(fileBuffer);

  const attachmentMap = new Map<string, { fileName: string, fileData: Buffer }>();
  const fontExtensions = ['.ttf', '.otf', '.ttc', '.woff', '.woff2'];

  let inAttachments = false;
  let inAttachedFile = false;
  let wasAttachmentsSectionFound = false;
  let currentAttachment: {
    fileName?: string;
    fileData?: Buffer;
    fileMediaType?: string;
  } = {};

  for (const el of ebmlElements) {
    if (el.name === 'Attachments') {
      wasAttachmentsSectionFound = true;
      if (el.type === 'm' && !el.isEnd) {
        inAttachments = true;
      } else if (el.type === 'm' && el.isEnd) {
        inAttachments = false;
      }
      continue;
    }

    if (inAttachments) {
      if (el.name === 'AttachedFile') {
        if (el.type === 'm' && !el.isEnd) {
          inAttachedFile = true;
          currentAttachment = {}; // Reset for the new attachment
        } else if (el.type === 'm' && el.isEnd) {
          const {fileName, fileData, fileMediaType} = currentAttachment;
          const mimeType = fileMediaType?.toLowerCase() || '';

          const isFontMime = mimeType.includes('font') || mimeType.includes('opentype');
          const isFontExtension = fileName ? fontExtensions.includes(path.extname(fileName).toLowerCase()) : false;
          const isGenericMime = mimeType.includes('application/octet-stream');

          if (fileName && fileData && (isFontMime || (isGenericMime && isFontExtension))) {
            const normalized = normalizeFontName(fileName);
            attachmentMap.set(normalized, {fileName, fileData});
            console.log(`[Fonts] Found font attachment in MKV: ${fileName} (${(fileData.length / 1024).toFixed(2)} KB)`);
          }
          inAttachedFile = false;
        }
      } else if (inAttachedFile) {
        // Accept both 's' (ASCII) and '8' (UTF-8) for string types.
        if (el.name === 'FileName' && (el.type === 's' || el.type === '8')) {
          currentAttachment.fileName = el.value;
        } else if (el.name === 'FileMediaType' && (el.type === 's' || el.type === '8')) {
          currentAttachment.fileMediaType = el.value;
        } else if (el.name === 'FileData' && el.type === 'b') {
          currentAttachment.fileData = el.value;
        }
      }
    }
  }

  if (!wasAttachmentsSectionFound) {
    console.log('[Fonts] No "Attachments" section found in the MKV file.');
  } else if (attachmentMap.size === 0) {
    console.log('[Fonts] "Attachments" section was found, but it appears to contain no valid font files.');
  } else {
    console.log(`[Fonts] Successfully extracted ${attachmentMap.size} font files.`);
  }

  return attachmentMap;
}

async function loadFontData(
  requiredFonts: RequiredFont[],
  mediaPath?: string,
  assFilePath?: string
): Promise<FontData[]> {
  const Levenshtein = (await import('fast-levenshtein')).default;
  const fontScanner = (await import('font-scanner')).default;
  const fontkit = (await import('fontkit')).default;

  console.log(`[Fonts] Starting search for ${requiredFonts.length} required font styles.`);
  const foundFonts = new Map<string, string>();
  const availableFonts: AvailableFont[] = [];
  const fontExtensions = ['.ttf', '.otf', '.ttc', '.woff', '.woff2'];

  const convertBufferToDataUri = (buffer: Buffer, extension: string): string | null => {
    let mimeType = '';
    const ext = extension.toLowerCase();
    if (['.ttf', '.ttf-t', '.t', '.ttc'].includes(ext)) mimeType = 'font/truetype';
    else if (['.otf'].includes(ext)) mimeType = 'font/opentype';
    else if (['.woff'].includes(ext)) mimeType = 'font/woff';
    else if (['.woff2'].includes(ext)) mimeType = 'font/woff2';
    else return null;
    const base64 = buffer.toString('base64');
    return `data:${mimeType};base64,${base64}`;
  };

  const addFontToDatabase = (fontBuffer: Buffer, fileName: string, source: 'mkv' | 'local' | 'system') => {
    try {
      const createdFont = fontkit.create(fontBuffer);
      const fontsToProcess: fontkit.Font[] = 'fonts' in createdFont ? createdFont.fonts : [createdFont];
      for (const font of fontsToProcess) {
        const dataUri = convertBufferToDataUri(fontBuffer, path.extname(fileName));
        if (dataUri) {
          availableFonts.push({
            family: font.familyName,
            style: font.subfamilyName,
            isBold: font['OS/2'].fsSelection.bold,
            isItalic: font['OS/2'].fsSelection.italic,
            dataUri: dataUri,
            source: source,
          });
        }
      }
    } catch (e) {
      console.warn(`[Fonts] Failed to parse font file "${fileName}" from ${source}:`, e);
    }
  };

  // Gather candidates from all sources

  // From MKV attachments
  if (mediaPath && path.extname(mediaPath).toLowerCase() === '.mkv') {
    const attachmentMap = await extractAttachmentsWithEbml(mediaPath);
    for (const attachment of Array.from(attachmentMap.values())) {
      addFontToDatabase(attachment.fileData, attachment.fileName, 'mkv');
    }
  }

  // From local files (if external .ass)
  if (assFilePath) {
    const subDir = path.dirname(assFilePath);
    try {
      const files = await fs.readdir(subDir);
      for (const file of files) {
        if (fontExtensions.includes(path.extname(file).toLowerCase())) {
          const fontPath = path.join(subDir, file);
          const fontBuffer = await fs.readFile(fontPath);
          addFontToDatabase(fontBuffer, file, 'local');
        }
      }
    } catch (e) {
      /* ignore */
    }
  }

  // From system fonts (only search for needed fonts)
  console.log(`[Fonts] Pre-caching potential system font matches...`);
  for (const req of requiredFonts) {
    try {
      const font = await fontScanner.findFont({family: req.family, italic: req.italic, weight: req.bold ? 700 : 400});
      if (font) {
        const fontBuffer = await fs.readFile(font.path);
        addFontToDatabase(fontBuffer, path.basename(font.path), 'system');
      }
    } catch (e) {
      /* Not found, that's fine */
    }
  }

  // Score and decide for each requirement
  const requirementsMet = new Set<RequiredFont>();
  for (const req of requiredFonts) {
    let bestMatch: { font: AvailableFont | null; score: number } = {font: null, score: Infinity};

    for (const available of availableFonts) {
      const familyDistance = Levenshtein.get(req.family, available.family);

      // Give a large penalty if the font is a known bad fuzzy match (e.g., Arial for Kozuka)
      const isUnrelated = familyDistance > (req.family.length / 2);
      const unrelatedPenalty = isUnrelated ? 100 : 0;

      let stylePenalty = 0;
      if (req.bold !== available.isBold) stylePenalty += 2;
      if (req.italic !== available.isItalic) stylePenalty += 2;

      // Prioritize sources: MKV/Local > System
      const sourcePenalty = available.source === 'system' ? 1 : 0;

      const totalScore = familyDistance + stylePenalty + sourcePenalty + unrelatedPenalty;

      if (totalScore < bestMatch.score) {
        bestMatch = {font: available, score: totalScore};
      }
    }

    // A reasonable score means it's a good match.
    if (bestMatch.font && bestMatch.score < 10) {
      const matchType = bestMatch.font.family === req.family ? "Found" : `Fuzzy matched "${req.family}" to`;
      console.log(`[Fonts] ${matchType} "${bestMatch.font.family}" (Style: ${bestMatch.font.style}) from ${bestMatch.font.source}. Score: ${bestMatch.score}`);
      foundFonts.set(req.family, bestMatch.font.dataUri);
      requirementsMet.add(req);
    }
  }

  // Final fallback
  const remainingForFallback = requiredFonts.filter(r => !foundFonts.has(r.family));
  if (remainingForFallback.length > 0) {
    let notoFallbackUri: string | null = null;
    try {
      const notoPath = path.join(__dirname, 'dist', 'yall-mp', 'browser', 'media', 'noto-sans-latin-wght-normal.woff2');
      const fontBuffer = await fs.readFile(notoPath);
      notoFallbackUri = `data:font/woff2;base64,${fontBuffer.toString('base64')}`;
      console.log('[Fonts] Successfully loaded bundled Noto Sans Variable as a fallback option.');
    } catch (e) {
      console.warn('[Fonts] Could not load bundled Noto Sans Variable for fallback, will proceed to system fonts.', e);
    }

    if (notoFallbackUri) {
      for (const req of remainingForFallback) {
        console.warn(`[Fonts] Could not find a good match for "${req.family}". Defaulting to bundled Noto Sans.`);
        foundFonts.set(req.family, notoFallbackUri);
      }
    } else {
      const arial = availableFonts.find(f => f.family === 'Arial' && !f.isBold && !f.isItalic);
      if (arial) {
        for (const req of remainingForFallback) {
          console.warn(`[Fonts] Could not find a good match for "${req.family}". Defaulting to Arial.`);
          foundFonts.set(req.family, arial.dataUri);
        }
      }
    }
  }

  const fontData: FontData[] = [];
  for (const [fontFamily, dataUri] of foundFonts.entries()) {
    fontData.push({fontFamily, dataUri});
  }

  const finalNotFound = requiredFonts.filter(req => !foundFonts.has(req.family));
  if (finalNotFound.length > 0) {
    console.error(`[Fonts] CRITICAL: Could not find any font source for: ${finalNotFound.map(f => f.family).join(', ')}`);
  }

  console.log(`[Fonts] Search finished. Required: ${requiredFonts.length}. Found: ${fontData.length}.`);
  return fontData;
}

function areRectsSimilar(rectsA: Rectangle[], rectsB: Rectangle[], tolerance: number = 5): boolean {
  if (rectsA.length !== rectsB.length) {
    return false;
  }

  if (rectsA.length === 0) {
    return true;
  }

  const sortedA = [...rectsA].sort((a, b) => a.x - b.x);
  const sortedB = [...rectsB].sort((a, b) => a.x - b.x);

  for (let i = 0; i < sortedA.length; i++) {
    const rectA = sortedA[i];
    const rectB = sortedB[i];

    if (
      Math.abs(rectA.x - rectB.x) > tolerance ||
      Math.abs(rectA.y - rectB.y) > tolerance ||
      Math.abs(rectA.width - rectB.width) > tolerance ||
      Math.abs(rectA.height - rectB.height) > tolerance
    ) {
      return false;
    }
  }

  return true;
}

function getFullTextFromSubtitles(subtitles: SubtitleData[]): string {
  return subtitles.map(sub => {
    if (sub.type === 'srt') {
      return sub.text;
    } else { // ass
      return sub.parts.map(p => p.text).join('\n');
    }
  }).join('\n');
}

async function detectLanguage(text: string): Promise<SupportedLanguage> {
  const {francAll} = await import('franc-all');

  const supportedSpecialCaseLanguages: SupportedLanguage[] = ['jpn', 'cmn', 'zho', 'tha'];
  const langResults = francAll(text, {minLength: 3, only: supportedSpecialCaseLanguages});
  const topLang = langResults.length > 0 ? langResults[0][0] : 'und';

  if (topLang === 'jpn') return 'jpn';
  if (topLang === 'cmn') return 'cmn';
  if (topLang === 'zho') return 'zho';
  if (topLang === 'tha') return 'tha';

  return 'other';
}

async function generateAudioPeaks(projectId: string, mediaPath: string): Promise<number[][] | null> {
  await ensureFFmpegPaths();

  const platform = process.platform;
  const basePath = app.isPackaged ? process.resourcesPath : app.getAppPath();
  let audiowaveformPath = '';

  if (platform === 'win32') {
    audiowaveformPath = path.join(basePath, 'electron-resources', 'windows', 'audiowaveform.exe');
  } else {
    // TODO: Add paths for macOS and Linux
  }

  for (const exePath of [audiowaveformPath, ffmpegPath]) {
    try {
      await fs.access(exePath);
    } catch (error) {
      console.error(`[Peaks] Executable not found at ${exePath}`);
      return null;
    }
  }

  console.log(`[Peaks] Generating waveform peaks for project ${projectId} using a WAV pipe.`);

  return new Promise((resolve, reject) => {
    // -f wav: Output format is WAV.
    // -ar 16000: Downsample to 16kHz. Still very fast, but slightly better quality than 8kHz.
    const ffmpegArgs = ['-i', mediaPath, '-vn', '-f', 'wav', '-ac', '1', '-ar', '16000', '-'];

    // When reading from a pipe (stdin), audiowaveform needs to be explicitly told the input format
    const audiowaveformArgs = [
      '--input-format', 'wav',
      '-i', '-',
      '--output-format', 'json',
      '--pixels-per-second', '100',
      '--bits', '16'
    ];

    const ffmpegProcess = spawn(ffmpegPath, ffmpegArgs);
    const audiowaveformProcess = spawn(audiowaveformPath, audiowaveformArgs);

    // Pipe the output of ffmpeg to the input of audiowaveform
    ffmpegProcess.stdout.pipe(audiowaveformProcess.stdin);

    let jsonData = '';
    const ffmpegError: string[] = [];
    const audiowaveformError: string[] = [];

    audiowaveformProcess.stdout.on('data', (data) => {
      jsonData += data.toString();
    });

    ffmpegProcess.stderr.on('data', (data) => ffmpegError.push(data.toString()));
    audiowaveformProcess.stderr.on('data', (data) => audiowaveformError.push(data.toString()));

    const killProcesses = () => {
      if (!ffmpegProcess.killed) ffmpegProcess.kill();
      if (!audiowaveformProcess.killed) audiowaveformProcess.kill();
    };

    ffmpegProcess.on('error', (err) => {
      killProcesses();
      reject(err);
    });

    audiowaveformProcess.on('error', (err) => {
      killProcesses();
      reject(err);
    });

    audiowaveformProcess.on('close', (code) => {
      killProcesses();

      if (code === 0) {
        if (!jsonData) {
          const combinedError = `FFMPEG Stderr:\n${ffmpegError.join('')}\n\nAUDIOWAVEFORM Stderr:\n${audiowaveformError.join('')}`;
          console.error(`[Peaks] Pipeline failed: audiowaveform received no data from ffmpeg.`);
          console.error(combinedError);
          reject(new Error('FFmpeg failed to provide audio data.'));
          return;
        }
        try {
          const waveformData = JSON.parse(jsonData);
          const rawPeaks = waveformData.data;
          const scale = waveformData.bits === 16 ? 32768 : 128; // Output is 8-bit, so scale will be 128
          const normalizedPeaks: number[] = rawPeaks.map((p: number) => p / scale);

          const peaks = [normalizedPeaks];
          console.log(`[Peaks] Successfully generated and normalized ${normalizedPeaks.length} data points.`);
          resolve(peaks);
        } catch (e) {
          console.error('[Peaks] Failed to parse JSON from audiowaveform output.', e);
          reject(new Error('Failed to parse waveform data.'));
        }
      } else {
        const combinedError = `FFMPEG Stderr:\n${ffmpegError.join('')}\n\nAUDIOWAVEFORM Stderr:\n${audiowaveformError.join('')}`;
        console.error(`[Peaks] Pipeline failed. audiowaveform process exited with code ${code}.`);
        console.error(`[Peaks] Combined Stderr:\n${combinedError}`);
        const relevantError = (audiowaveformError.join('').trim() || ffmpegError.join('').trim() || `Waveform generation failed.`).split('\n').pop();
        reject(new Error(relevantError));
      }
    });
  });
}

function getFilesFromArgv(argv: string[]): string[] {
  return argv.filter(arg => {
    try {
      if (arg.startsWith('--') || arg.toLowerCase().endsWith('electron.exe') || arg.includes('electron-main.js')) {
        return false;
      }
      const stat = statSync(arg);
      if (stat.isFile()) {
        const ext = path.extname(arg).toLowerCase().replace('.', '');
        return SUPPORTED_MEDIA_TYPES.includes(ext) || SUPPORTED_SUBTITLE_TYPES.includes(ext);
      }
      return false;
    } catch (e) {
      return false;
    }
  });
}

function safeHideVideoWindow() {
  if (videoWindow && !videoWindow.isDestroyed()) {
    videoWindow.setOpacity(0);
    videoWindow.hide();
    if (uiWindow && !uiWindow.isDestroyed()) {
      uiWindow.webContents.send('mpv:video-visibility-change', false);
    }
  }
}

function safeShowVideoWindow() {
  if (videoWindow && !videoWindow.isDestroyed()) {
    videoWindow.setOpacity(1);
    videoWindow.showInactive();
    if (uiWindow && !uiWindow.isDestroyed()) {
      uiWindow.webContents.send('mpv:video-visibility-change', true);
    }
  }
}

function safeHideUiWindow() {
  if (uiWindow && !uiWindow.isDestroyed()) {
    uiWindow.setOpacity(0);
    // Do NOT call uiWindow.hide() here because the renderer must remain active and process IPC events (like resizing/spinner logic),
    // just make visually invisible to the user to prevent graphical artifacts.
  }
}

function safeShowUiWindow() {
  if (uiWindow && !uiWindow.isDestroyed()) {
    uiWindow.setOpacity(1);
    uiWindow.showInactive();
    uiWindow.focus();
  }
}
