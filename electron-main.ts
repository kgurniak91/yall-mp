import {app, BrowserWindow, dialog, ipcMain, screen} from 'electron';
import path from 'path';
import os from 'os';
import {promises as fs} from 'fs';
import {CaptionsFileFormat, ParsedCaptionsResult, parseResponse, VTTCue} from 'media-captions';
import type {SubtitleData, SubtitlePart} from './shared/types/subtitle.type';
import type {MediaTrack} from './shared/types/media.type';
import {AnkiCard, AnkiExportRequest} from './src/app/model/anki.types';
import ffmpegStatic from 'ffmpeg-static';
import {v4 as uuidv4} from 'uuid';
import {ChildProcess, spawn} from 'child_process';
import {MpvManager} from './mpv-manager';
import {MpvClipRequest} from './src/electron-api';
import ffprobeStatic from 'ffprobe-static';
import languages from '@cospired/i18n-iso-languages';
import {compile, Dialogue} from 'ass-compiler';

const APP_DATA_KEY = 'yall-mp-app-data';
const appDataPath = path.join(app.getPath('userData'), `${APP_DATA_KEY}.json`);

let mpvManager: MpvManager | null = null;
let mainWindow: BrowserWindow | null = null;
let videoWindow: BrowserWindow | null = null;
let backgroundWindow: BrowserWindow | null = null;
let preMaximizeBounds: Electron.Rectangle | null = null;
let isFullScreen = false;

let isFFmpegAvailable = false;
let ffmpegPath = '';
let ffprobePath = '';

if (ffmpegStatic) {
  isFFmpegAvailable = true;
  ffmpegPath = ffmpegStatic.replace('app.asar', 'app.asar.unpacked');
  ffprobePath = ffprobeStatic.path.replace('app.asar', 'app.asar.unpacked');
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
    if (!mainWindow || !backgroundWindow || mainWindow.isMinimized()) {
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
    syncWindowPositions();
  });

  // When the main window is gone, ensure everything is cleaned up
  mainWindow.on('closed', () => {
    mpvManager?.stop();
    videoWindow?.close();
    backgroundWindow?.close();
    mainWindow = null;
  });

  mainWindow.on('ready-to-show', () => {
    mainWindow?.webContents.send('window:maximized-state-changed', mainWindow.isMaximized());
  });

  mainWindow.on('maximize', () => {
    mainWindow?.webContents.send('window:maximized-state-changed', true);
  });

  mainWindow.on('unmaximize', () => {
    mainWindow?.webContents.send('window:maximized-state-changed', false);
  });

  mainWindow.on('enter-full-screen', () => {
    isFullScreen = true;
    mainWindow?.webContents.send('window:fullscreen-state-changed', true);
  });

  mainWindow.on('leave-full-screen', () => {
    isFullScreen = false;
    mainWindow?.webContents.send('window:fullscreen-state-changed', false);
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
      mainWindow.webContents.send('window:maximized-state-changed', false);
    } else {
      preMaximizeBounds = mainWindow.getBounds();
      const display = screen.getPrimaryDisplay();
      mainWindow.setBounds(display.workArea);
      mainWindow.webContents.send('window:maximized-state-changed', true);
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
      mainWindow.webContents.send('window:maximized-state-changed', false);
    } else {
      // If normal, minimize.
      mainWindow.minimize();
    }
  });

  ipcMain.on('window:close', () => {
    mainWindow?.close();
  });

  ipcMain.handle('mpv:createViewport', async (_, mediaPath: string, audioTrackIndex: number | null) => {
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

  ipcMain.handle('mpv:hideVideoDuringResize', () => {
    videoWindow?.hide();
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

async function handleSubtitleParse(filePath: string): Promise<SubtitleData[]> {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const extension = path.extname(filePath).toLowerCase();

    if (extension === '.ass' || extension === '.ssa') {
      const compiled = compile(content, {});
      const timeline = buildSubtitleTimeline(compiled.dialogues);
      return mergeIdenticalConsecutiveSubtitles(timeline);
    } else {
      const response = new Response(content);
      const fileFormat = extension.replace('.', '');
      const result: ParsedCaptionsResult = await parseResponse(response, {type: fileFormat as CaptionsFileFormat});
      if (result.errors.length > 0) {
        console.warn('Encountered errors parsing subtitle file:', result.errors);
      }
      const subtitles: SubtitleData[] = result.cues.map((cue: VTTCue) => ({
        id: cue.id,
        startTime: cue.startTime,
        endTime: cue.endTime,
        text: cue.text,
        parts: [{ text: cue.text, style: 'Default' }]
      }));
      return preprocessSubtitles(subtitles);
    }
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

async function handleExtractSubtitleTrack(mediaPath: string, trackIndex: number): Promise<SubtitleData[]> {
  return new Promise(async (resolve, reject) => {
    const probeResult = await runFfprobe([ '-v', 'quiet', '-print_format', 'json', '-show_streams', mediaPath ]);
    const subtitleStream = probeResult.streams.find((s: any) => s.index === trackIndex);
    const codec = subtitleStream?.codec_name;
    let outputFormat = 'srt';
    if (codec === 'ass' || codec === 'ssa') {
      outputFormat = 'ass';
    }
    const args = [ '-i', mediaPath, '-map', `0:${trackIndex}`, '-c:s', outputFormat, '-f', outputFormat, '-' ];
    const ffmpegProcess = spawn(ffmpegPath, args);
    let subtitleContent = '';
    ffmpegProcess.stdout.on('data', (data) => { subtitleContent += data.toString(); });
    let errorOutput = '';
    ffmpegProcess.stderr.on('data', (data) => { errorOutput += data.toString(); });
    ffmpegProcess.on('error', (err) => { reject(err); });

    ffmpegProcess.on('close', async (code) => {
      if (code === 0) {
        try {
          if (outputFormat === 'ass') {
            const compiled = compile(subtitleContent, {});
            const timeline = buildSubtitleTimeline(compiled.dialogues);
            const mergedTimeline = mergeIdenticalConsecutiveSubtitles(timeline);
            resolve(mergedTimeline);
          } else {
            const response = new Response(subtitleContent);
            const result: ParsedCaptionsResult = await parseResponse(response, {type: 'srt'});
            if (result.errors.length > 0) {
              console.warn('Encountered errors parsing extracted subtitle stream:', result.errors);
            }
            const subtitles: SubtitleData[] = result.cues.map((cue: VTTCue) => ({
              id: cue.id,
              startTime: cue.startTime,
              endTime: cue.endTime,
              text: cue.text,
              parts: [{ text: cue.text, style: 'Default' }]
            }));
            resolve(preprocessSubtitles(subtitles));
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

function buildSubtitleTimeline(dialogues: Dialogue[]): SubtitleData[] {
  if (dialogues.length === 0) {
    return [];
  }

  const timestamps = new Set<number>();
  dialogues.forEach(d => {
    timestamps.add(d.start);
    timestamps.add(d.end);
  });
  const sortedTimestamps = Array.from(timestamps).sort((a, b) => a - b);

  const finalSubtitles: SubtitleData[] = [];

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

        // Create a unique key based on both style and text content.
        const key = `${d.style}::${text}`;

        if (!uniqueParts.has(key)) {
          uniqueParts.set(key, { text, style: d.style });
        }
      });

      const parts = Array.from(uniqueParts.values());
      const combinedText = parts.map(p => p.text).join('\n');

      finalSubtitles.push({
        id: uuidv4(),
        startTime,
        endTime,
        text: combinedText,
        parts,
      });
    }
  }

  return finalSubtitles;
}

function arePartsEqual(partsA: SubtitlePart[], partsB: SubtitlePart[]): boolean {
  if (partsA.length !== partsB.length) {
    return false;
  }
  const sortedA = [...partsA].sort((a, b) => (a.style + a.text).localeCompare(b.style + b.text));
  const sortedB = [...partsB].sort((a, b) => (a.style + a.text).localeCompare(b.style + b.text));

  for (let i = 0; i < sortedA.length; i++) {
    if (sortedA[i].text !== sortedB[i].text || sortedA[i].style !== sortedB[i].style) {
      return false;
    }
  }
  return true;
}

function mergeIdenticalConsecutiveSubtitles(subtitles: SubtitleData[]): SubtitleData[] {
  if (subtitles.length < 2) {
    return subtitles;
  }

  const merged: SubtitleData[] = [];
  let current = { ...subtitles[0] };

  for (let i = 1; i < subtitles.length; i++) {
    const next = subtitles[i];

    // Check if the next subtitle is consecutive and has the exact same parts.
    if (Math.abs(next.startTime - current.endTime) < 0.01 && arePartsEqual(current.parts || [], next.parts || [])) {
      // If they are identical, just extend the end time of the current subtitle.
      current.endTime = next.endTime;
    } else {
      // If they are different, push the completed current subtitle and start a new one.
      merged.push(current);
      current = { ...next };
    }
  }

  // Push the very last subtitle after the loop finishes.
  merged.push(current);

  return merged;
}
