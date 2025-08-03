import {app, BrowserWindow, dialog, ipcMain} from 'electron';
import path from 'path';
import os from 'os';
import {promises as fs} from 'fs';
import {CaptionsFileFormat, ParsedCaptionsResult, parseResponse, VTTCue} from 'media-captions';
import type {SubtitleData} from './shared/types/subtitle.type';
import {AnkiCard, AnkiExportRequest} from './src/app/model/anki.types';
import ffmpegStatic from 'ffmpeg-static';
import {v4 as uuidv4} from 'uuid';
import {spawn} from 'child_process';
import {MpvManager} from './mpv-manager';

let mpvManager: MpvManager | null = null;
let mainWindow: BrowserWindow | null = null;
let videoWindow: BrowserWindow | null = null;
let backgroundWindow: BrowserWindow | null = null;

let isFFmpegAvailable = false;
let ffmpegPath = '';

if (ffmpegStatic) {
  isFFmpegAvailable = true;
  ffmpegPath = ffmpegStatic.replace('app.asar', 'app.asar.unpacked');
} else {
  console.warn('ffmpeg-static binary not found. Anki export feature will be disabled.');
}

const FORCED_GAP_SECONDS = 0.05;

function createWindow() {
  backgroundWindow = new BrowserWindow({
    width: 1920,
    height: 1080,
    transparent: false,
    backgroundColor: '#000000',
    frame: false,
    show: false, // Start hidden
    skipTaskbar: true,
    focusable: false, // Never interactive
  });

  mainWindow = new BrowserWindow({
    width: 1920,
    height: 1080,
    transparent: true,
    frame: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
  });

  // Sync positions of all windows
  const syncWindowPositions = () => {
    if (!mainWindow || !backgroundWindow) {
      return;
    }
    const bounds = mainWindow.getBounds();
    backgroundWindow.setBounds(bounds);
    mainWindow.webContents.send('mpv:mainWindowMovedOrResized');
  };
  mainWindow.on('resize', syncWindowPositions);
  mainWindow.on('move', syncWindowPositions);

  mainWindow.on('focus', () => {
    // Bring the windows to the front in the correct stacking order.
    backgroundWindow?.moveTop();
    videoWindow?.moveTop();
    mainWindow?.moveTop();
  });

  mainWindow.on('minimize', () => {
    videoWindow?.hide();
    backgroundWindow?.hide();
  });

  mainWindow.on('restore', () => {
    // showInactive prevents the windows from stealing focus
    backgroundWindow?.showInactive();
    videoWindow?.showInactive();
  });

  // When the main window is gone, ensure everything is cleaned up
  mainWindow.on('closed', () => {
    mpvManager?.stop();
    videoWindow?.close();
    backgroundWindow?.close();
    mainWindow = null;
  });

  // Serve the Angular app
  const indexPath = path.join(__dirname, './dist/yall-mp/browser/index.html');
  mainWindow.loadFile(indexPath);
  backgroundWindow.show();

  // Open DevTools for debugging in a separate window
  mainWindow.webContents.openDevTools({mode: 'detach'});
}

app.whenReady().then(() => {
  ipcMain.handle('dialog:openFile', (_, options) => handleFileOpen(options));
  ipcMain.handle('subtitle:parse', (_, filePath) => handleSubtitleParse(filePath));
  ipcMain.handle('anki:check', () => invokeAnkiConnect('version'));
  ipcMain.handle('anki:getDeckNames', () => invokeAnkiConnect('deckNames'));
  ipcMain.handle('anki:getNoteTypes', () => invokeAnkiConnect('modelNames'));
  ipcMain.handle('anki:getNoteTypeFieldNames', (_, modelName) => invokeAnkiConnect('modelFieldNames', {modelName}));
  ipcMain.handle('anki:exportAnkiCard', (_, exportRquest: AnkiExportRequest) => handleAnkiExport(exportRquest));
  ipcMain.handle('ffmpeg:check', () => isFFmpegAvailable);

  ipcMain.handle('mpv:createViewport', async (_, mediaPath: string) => {
    if (!mainWindow) {
      return;
    }

    // Clean up any old instances
    videoWindow?.close();
    mpvManager?.stop();

    // Create a new, borderless, independent window.
    videoWindow = new BrowserWindow({
      frame: false,
      show: false,
      skipTaskbar: true, // Don't show a separate icon on the taskbar
      transparent: true,
    });

    // Stacking order setup
    videoWindow.setAlwaysOnTop(false);
    mainWindow.moveTop();

    mpvManager = new MpvManager(videoWindow);
    mpvManager.on('status', (status) => mainWindow?.webContents.send('mpv:event', status));
    mpvManager.on('error', (err) => console.error("MPV Error:", err));
    mpvManager.on('ready', () => {
      console.log('[Main Process] MpvManager is ready. Notifying renderer.');
      mainWindow?.webContents.send('mpv:managerReady');
    });

    // Start MPV inside the child window's handle
    await mpvManager.start(mediaPath);
    mpvManager.observeProperty('time-pos');
    mpvManager.observeProperty('duration');
    mpvManager.observeProperty('pause');
  });

  ipcMain.handle('mpv:resizeViewport', async (_, containerRect: {
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

async function handleSubtitleParse(filePath: string): Promise<SubtitleData[]> {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const response = new Response(content);
    const extension = path.extname(filePath).replace('.', ''); // .srt -> srt
    const result: ParsedCaptionsResult = await parseResponse(response, {type: extension as CaptionsFileFormat});

    if (result.errors.length > 0) {
      console.warn('Encountered errors parsing subtitle file:', result.errors);
    }

    const subtitles: SubtitleData[] = result.cues.map((vttCue: VTTCue) => ({
      id: vttCue.id,
      startTime: vttCue.startTime,
      endTime: vttCue.endTime,
      text: vttCue.text
    }));

    return preprocessSubtitles(subtitles);
  } catch (error) {
    console.error(`Error reading or parsing subtitle file at ${filePath}:`, error);
    return [];
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
          finalFields[mapping.destination] = subtitleData.text;
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
