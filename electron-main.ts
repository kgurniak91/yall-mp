import {app, BrowserWindow, dialog, ipcMain, Rectangle, screen} from 'electron';
import path from 'path';
import os from 'os';
import {promises as fs} from 'fs';
import {CaptionsFileFormat, ParsedCaptionsResult, parseResponse, VTTCue} from 'media-captions';
import type {AssSubtitleData, SrtSubtitleData, SubtitleData, SubtitlePart} from './shared/types/subtitle.type';
import type {MediaTrack} from './shared/types/media.type';
import {AnkiCard, AnkiExportRequest} from './src/app/model/anki.types';
import ffmpegStatic from 'ffmpeg-static';
import {v4 as uuidv4} from 'uuid';
import {ChildProcess, spawn} from 'child_process';
import {MpvManager} from './mpv-manager';
import {FontData, MpvClipRequest, ParsedSubtitlesData} from './src/electron-api';
import ffprobeStatic from 'ffprobe-static';
import languages from '@cospired/i18n-iso-languages';
import {compile, Dialogue} from 'ass-compiler';
import fontScanner from 'font-scanner';
import {Decoder} from 'ts-ebml';
import fontkit from 'fontkit';
import Levenshtein from 'fast-levenshtein';

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
const appDataPath = path.join(app.getPath('userData'), `${APP_DATA_KEY}.json`);

let mpvManager: MpvManager | null = null;
let mainWindow: BrowserWindow | null = null;
let uiWindow: BrowserWindow | null = null;
let videoWindow: BrowserWindow | null = null;
let preMaximizeBounds: Electron.Rectangle | null = null;
let isFullScreen = false;
let isFixingMaximize = false;
let isProgrammaticResize = false;
let isFFmpegAvailable = false;
let ffmpegPath = '';
let ffprobePath = '';
let draggableHeaderZones: Rectangle[] = [];
const initialBounds = {width: 1920, height: 1080};
const FORCED_GAP_SECONDS = 0.05;
const DRAGGABLE_ZONE_PADDING = 3; // 3px on all sides

if (ffmpegStatic) {
  isFFmpegAvailable = true;
  ffmpegPath = ffmpegStatic.replace('app.asar', 'app.asar.unpacked');
  ffprobePath = ffprobeStatic.path.replace('app.asar', 'app.asar.unpacked');
} else {
  console.warn('ffmpeg-static binary not found. Anki export feature will be disabled.');
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
  if (!uiWindow || !mainWindow || isFullScreen) {
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

function createWindow() {
  mainWindow = new BrowserWindow({
    width: initialBounds.width,
    height: initialBounds.height,
    transparent: false,
    backgroundColor: '#000000',
    frame: false,
    show: false,
  });

  uiWindow = new BrowserWindow({
    width: initialBounds.width,
    height: initialBounds.height,
    transparent: true,
    frame: false,
    parent: mainWindow,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
  });

  const syncWindowGeometry = () => {
    if (!mainWindow || !uiWindow || (videoWindow && videoWindow.isDestroyed()) || mainWindow.isMinimized()) {
      return;
    }

    videoWindow?.hide();
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
  };

  mainWindow.on('resize', syncWindowGeometry);
  mainWindow.on('move', syncWindowGeometry);

  uiWindow.on('resize', () => {
    // If this resize was caused by code, ignore it to prevent a loop.
    if (isProgrammaticResize || !mainWindow || !uiWindow) {
      return;
    }
    // Otherwise, a user resized the UI window. Force the main window to match it.
    mainWindow.setBounds(uiWindow.getBounds());
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
    if (!preMaximizeBounds) {
      preMaximizeBounds = {...initialBounds, x: 50, y: 50};
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
    videoWindow?.hide();
    uiWindow?.hide();
  });

  mainWindow.on('restore', () => {
    videoWindow?.showInactive();
    uiWindow?.showInactive();
    syncWindowGeometry();
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
    }
  });

  mainWindow.on('enter-full-screen', () => {
    isFullScreen = true;
    if (uiWindow) {
      uiWindow.webContents.send('window:fullscreen-state-changed', true);
    }
    updateUiWindowShape();
  });

  mainWindow.on('leave-full-screen', () => {
    isFullScreen = false;
    if (uiWindow) {
      uiWindow.webContents.send('window:fullscreen-state-changed', false);
    }
    updateUiWindowShape();
  });

  const draggableHostPath = path.join(__dirname, './dist/yall-mp/browser/draggable-host.html');
  mainWindow.loadFile(draggableHostPath);

  const indexPath = path.join(__dirname, './dist/yall-mp/browser/index.html');
  uiWindow.loadFile(indexPath);

  uiWindow.webContents.openDevTools({mode: 'detach'});
}

app.whenReady().then(() => {
  ipcMain.handle('dialog:openFile', (_, options) => handleFileOpen(options));
  ipcMain.handle('subtitle:parse', (_, filePath) => handleSubtitleParse(filePath));
  ipcMain.handle('media:getMetadata', (_, filePath) => handleGetMediaMetadata(filePath));
  ipcMain.handle('media:extractSubtitleTrack', (_, mediaPath, trackIndex) => handleExtractSubtitleTrack(mediaPath, trackIndex));
  ipcMain.handle('anki:check', () => invokeAnkiConnect('version'));
  ipcMain.handle('anki:getDeckNames', () => invokeAnkiConnect('deckNames'));
  ipcMain.handle('anki:getNoteTypes', () => invokeAnkiConnect('modelNames'));
  ipcMain.handle('anki:getNoteTypeFieldNames', (_, modelName) => invokeAnkiConnect('modelFieldNames', {modelName}));
  ipcMain.handle('anki:exportAnkiCard', (_, exportRquest: AnkiExportRequest) => handleAnkiExport(exportRquest));
  ipcMain.handle('ffmpeg:check', () => isFFmpegAvailable);
  ipcMain.handle('app:get-data', readAppData);
  ipcMain.handle('app:set-data', saveAppData);

  ipcMain.on('window:minimize', () => {
    mainWindow?.minimize();
  });

  ipcMain.on('window:toggle-maximize', () => {
    if (!mainWindow) {
      return;
    }

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
  });

  ipcMain.on('window:toggle-fullscreen', () => {
    if (mainWindow) {
      mainWindow.setFullScreen(!isFullScreen);
    }
  });

  ipcMain.on('window:handle-double-click', () => {
    if (!mainWindow) {
      return;
    }

    if (isFullScreen) {
      mainWindow.setFullScreen(false);
    } else {
      mainWindow.setFullScreen(true);
    }
  });

  ipcMain.on('window:escape', () => {
    if (!mainWindow) {
      return;
    }

    if (isFullScreen) {
      // If fullscreen, exit fullscreen
      mainWindow.setFullScreen(false);
    } else if (preMaximizeBounds) {
      // If maximized, unmaximize
      mainWindow.setBounds(preMaximizeBounds);
      preMaximizeBounds = null;
      if (uiWindow) {
        uiWindow.webContents.send('window:maximized-state-changed', false);
      }
    } else {
      // If normal, minimize.
      mainWindow.minimize();
    }
  });

  ipcMain.on('window:close', () => {
    mainWindow?.close();
  });

  ipcMain.on('window:focus-app', () => {
    console.log('[Main Process] UI is ready, focusing main window.');
    if (mainWindow) {
      mainWindow.focus();
    }
  });

  ipcMain.on('window:update-draggable-zones', (_, rects: Rectangle[]) => {
    if (areRectsSimilar(draggableHeaderZones, rects)) {
      return;
    }
    draggableHeaderZones = rects;
    updateUiWindowShape();
  });

  ipcMain.handle('mpv:createViewport', async (_, mediaPath: string, audioTrackIndex: number | null) => {
    if (!uiWindow || !mainWindow) {
      return;
    }

    // Clean up any old instances
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

    // uiWindow is the child of videoWindow to always be on top and prevent stacking order issues:
    uiWindow.setParentWindow(videoWindow);

    mpvManager = new MpvManager(videoWindow);
    mpvManager.on('status', (status) => {
      if (uiWindow) {
        uiWindow.webContents.send('mpv:event', status)
      }
    });
    mpvManager.on('error', (err) => console.error("MPV Error:", err));
    mpvManager.on('ready', () => {
      console.log('[Main Process] MpvManager is ready. Notifying renderer.');
      if (uiWindow) {
        uiWindow.webContents.send('mpv:managerReady');
      }
    });

    // Start MPV inside the child window's handle
    await mpvManager.start(mediaPath, audioTrackIndex);
    mpvManager.observeProperty('time-pos');
    mpvManager.observeProperty('duration');
    mpvManager.observeProperty('pause');
  });

  ipcMain.handle('mpv:playClip', (_, request: MpvClipRequest) => {
    if (!mpvManager?.mediaPath) {
      return;
    }

    const command = [
      'loadfile',
      mpvManager.mediaPath,
      'replace', // play immediately
      -1,
      `start=${request.startTime},end=${request.endTime}`
    ];

    mpvManager.sendCommand(command);
    mpvManager.setProperty('speed', request.playbackRate);
    mpvManager.setProperty('pause', false);
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
          videoWindow.showInactive();
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

      if (!videoWindow.isVisible()) {
        videoWindow.showInactive();
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

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

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

async function handleSubtitleParse(filePath: string): Promise<ParsedSubtitlesData> {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const extension = path.extname(filePath).toLowerCase();

    if (extension === '.ass' || extension === '.ssa') {
      const compiled = compile(content, {});
      const timeline = buildSubtitleTimeline(compiled.dialogues);
      const mergedTimeline = mergeIdenticalConsecutiveSubtitles(timeline);
      const requiredFonts = getRequiredFontsFromAss(content);
      const fonts = await loadFontData(requiredFonts, undefined, filePath);

      return {
        subtitles: mergedTimeline,
        rawAssContent: content,
        styles: compiled.styles,
        fonts: fonts
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
      }));
      return {
        subtitles: preprocessSubtitles(subtitles)
      };
    }
  } catch (error) {
    console.error(`Error reading or parsing subtitle file at ${filePath}:`, error);
    return {
      subtitles: []
    };
  }
}

function preprocessSubtitles(subtitles: SubtitleData[]): SubtitleData[] {
  if (subtitles.length < 2) {
    return subtitles;
  }

  const sanitizedSubtitles: SubtitleData[] = [];
  // The first subtitle is always fine as-is.
  sanitizedSubtitles.push(subtitles[0]);

  for (let i = 1; i < subtitles.length; i++) {
    const previousSubtitle = sanitizedSubtitles[i - 1];
    const currentSubtitle = subtitles[i];

    if (currentSubtitle.startTime <= previousSubtitle.endTime) {
      // CONFLICT: The current subtitle starts too early, adjust it.
      const originalDuration = currentSubtitle.endTime - currentSubtitle.startTime;

      // Push the start time forward by the previous subtitle's end time plus the gap
      const newStartTime = previousSubtitle.endTime + FORCED_GAP_SECONDS;
      const newEndTime = newStartTime + originalDuration;
      const adjustedSubtitle: SubtitleData = {
        ...currentSubtitle,
        startTime: newStartTime,
        endTime: newEndTime
      }

      sanitizedSubtitles.push(adjustedSubtitle);
    } else {
      // NO CONFLICT: The natural gap is sufficient. Add the subtitle as-is.
      sanitizedSubtitles.push(currentSubtitle);
    }
  }

  return sanitizedSubtitles;
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
  if (!isFFmpegAvailable) {
    return {cardId: null, error: 'FFmpeg is not available, cannot export media.'};
  }

  const {template, subtitleData, mediaPath, exportTime} = exportRequest;
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
      }
    }

    const note: AnkiCard = {
      deckName: template.ankiDeck!,
      modelName: template.ankiNoteType!,
      fields: finalFields,
      tags: ['yall-mp'],
      options: {
        allowDuplicate: true
      }
    };

    const cardId = await invokeAnkiConnect('addNote', {note});
    if (!cardId) {
      throw new Error('Failed to add note to Anki.');
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

        if (stream.codec_type === 'audio') {
          audioTracks.push(finalTrack);
        } else if (stream.codec_type === 'subtitle') {
          subtitleTracks.push(finalTrack);
        }
      }
    }
    return {audioTracks, subtitleTracks};
  } catch (error) {
    console.error('Error probing media file:', error);
    return {audioTracks: [], subtitleTracks: []};
  }
}

async function handleExtractSubtitleTrack(mediaPath: string, trackIndex: number): Promise<ParsedSubtitlesData> {
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
            const compiled = compile(subtitleContent, {});
            const timeline = buildSubtitleTimeline(compiled.dialogues);
            const mergedTimeline = mergeIdenticalConsecutiveSubtitles(timeline);
            const requiredFonts = getRequiredFontsFromAss(subtitleContent);
            const fonts = await loadFontData(requiredFonts, mediaPath, undefined);

            resolve({
              subtitles: mergedTimeline,
              rawAssContent: subtitleContent,
              styles: compiled.styles,
              fonts: fonts
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
              text: cue.text
            }));
            resolve({
              subtitles: preprocessSubtitles(subtitles)
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

async function readAppData() {
  try {
    const data = await fs.readFile(appDataPath, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    console.log('Could not read app data (file might not exist yet), returning null.');
    return null;
  }
}

async function saveAppData(_: any, data: any) {
  try {
    await fs.writeFile(appDataPath, JSON.stringify(data, null, 2), 'utf-8');
  } catch (error) {
    console.error('Failed to save app data.', error);
  }
}

function buildSubtitleTimeline(dialogues: Dialogue[]): AssSubtitleData[] {
  if (dialogues.length === 0) {
    return [];
  }

  const timestamps = new Set<number>();
  dialogues.forEach(d => {
    timestamps.add(d.start);
    timestamps.add(d.end);
  });
  const sortedTimestamps = Array.from(timestamps).sort((a, b) => a - b);

  const finalSubtitles: AssSubtitleData[] = [];

  for (let i = 0; i < sortedTimestamps.length - 1; i++) {
    const startTime = sortedTimestamps[i];
    const endTime = sortedTimestamps[i + 1];
    const midPoint = startTime + 0.01;

    if (endTime <= startTime) continue;

    const activeDialogues = dialogues.filter(d => midPoint >= d.start && midPoint < d.end);

    if (activeDialogues.length > 0) {
      const uniqueParts = new Map<string, SubtitlePart>();
      activeDialogues.forEach(d => {
        const text = d.slices
          .flatMap(slice => slice.fragments)
          .map(fragment => fragment.text.replace(/\\N/g, '\n'))
          .join('');

        if (!text.trim()) return;

        const key = `${d.style}::${text}`;
        if (!uniqueParts.has(key)) {
          uniqueParts.set(key, {text, style: d.style});
        }
      });

      const parts = Array.from(uniqueParts.values());
      if (parts.length > 0) {
        finalSubtitles.push({
          type: 'ass',
          id: uuidv4(),
          startTime,
          endTime,
          parts
        });
      }
    }
  }

  return finalSubtitles;
}

function arePartsEqual(a: SubtitleData, b: SubtitleData): boolean {
  // If the types are different, they can't be equal.
  if (a.type !== b.type) {
    return false;
  }

  // If both are SRT, compare their text content.
  if (a.type === 'srt' && b.type === 'srt') {
    return a.text === b.text;
  }

  // If both are ASS, compare their parts arrays.
  if (a.type === 'ass' && b.type === 'ass') {
    const partsA = a.parts;
    const partsB = b.parts;

    if (partsA.length !== partsB.length) {
      return false;
    }
    const sortedA = [...partsA].sort((x, y) => (x.style + x.text).localeCompare(y.style + y.text));
    const sortedB = [...partsB].sort((x, y) => (x.style + x.text).localeCompare(y.style + y.text));

    for (let i = 0; i < sortedA.length; i++) {
      if (sortedA[i].text !== sortedB[i].text || sortedA[i].style !== sortedB[i].style) {
        return false;
      }
    }
    return true;
  }

  // Fallback for any other case (should not be reached with current types).
  return false;
}

function mergeIdenticalConsecutiveSubtitles(subtitles: SubtitleData[]): SubtitleData[] {
  if (subtitles.length < 2) {
    return subtitles;
  }

  const merged: SubtitleData[] = [];
  let current = {...subtitles[0]};

  for (let i = 1; i < subtitles.length; i++) {
    const next = subtitles[i];

    // Check if the next subtitle is consecutive and has the exact same content.
    if (Math.abs(next.startTime - current.endTime) < 0.01 && arePartsEqual(current, next)) {
      // If they are identical, just extend the end time of the current subtitle.
      current.endTime = next.endTime;
    } else {
      // If they are different, push the completed current subtitle and start a new one.
      merged.push(current);
      current = {...next};
    }
  }

  // Push the very last subtitle after the loop finishes.
  merged.push(current);

  return merged;
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

      // Give a large penalty if the font is a known bad fuzzy match (e.g. Arial for Kozuka)
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
    const arial = availableFonts.find(f => f.family === 'Arial' && !f.isBold && !f.isItalic);
    if (arial) {
      for (const req of remainingForFallback) {
        console.warn(`[Fonts] Could not find a good match for "${req.family}". Defaulting to Arial.`);
        foundFonts.set(req.family, arial.dataUri);
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
