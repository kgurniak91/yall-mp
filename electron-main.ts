import {app, BrowserWindow, dialog, ipcMain} from 'electron';
import path from 'path';
import {promises as fs} from 'fs';
import {CaptionsFileFormat, ParsedCaptionsResult, parseResponse, VTTCue} from 'media-captions';
import type {SubtitleData} from './shared/types/subtitle.type';

const FORCED_GAP_SECONDS = 0.05;

function createWindow() {
  const win = new BrowserWindow({
    width: 1920,
    height: 1080,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
  });

  // Serve the Angular app
  const indexPath = path.join(__dirname, './dist/yall-mp/browser/index.html');
  win.loadFile(indexPath);

  // Open DevTools for debugging
  win.webContents.openDevTools();
}

app.whenReady().then(() => {
  ipcMain.handle('dialog:openFile', (_, options) => handleFileOpen(options));
  ipcMain.handle('subtitle:parse', (_, filePath) => handleSubtitleParse(filePath));
  ipcMain.handle('anki:check', () => invokeAnkiConnect('version'));
  ipcMain.handle('anki:getDeckNames', () => invokeAnkiConnect('deckNames'));
  ipcMain.handle('anki:getNoteTypes', () => invokeAnkiConnect('modelNames'));
  ipcMain.handle('anki:getNoteTypeFieldNames', (event, modelName) => invokeAnkiConnect('modelFieldNames', { modelName }));

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
  return []; // Return an empty array if the user cancels
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
