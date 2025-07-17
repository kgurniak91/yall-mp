import {app, BrowserWindow, dialog, ipcMain} from 'electron';
import path from 'path';
import {promises as fs} from 'fs';
import {CaptionsFileFormat, ParsedCaptionsResult, parseResponse, VTTCue} from 'media-captions';

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

async function handleSubtitleParse(filePath: string): Promise<null | VTTCue[]> {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const response = new Response(content);
    const extension = path.extname(filePath).replace('.', ''); // .srt -> srt
    const result: ParsedCaptionsResult = await parseResponse(response, {type: extension as CaptionsFileFormat});

    if (result.errors.length > 0) {
      console.warn('Encountered errors parsing subtitle file:', result.errors);
    }

    return preprocessCues(result.cues);
  } catch (error) {
    console.error(`Error reading or parsing subtitle file at ${filePath}:`, error);
    return null;
  }
}

function preprocessCues(cues: VTTCue[]): VTTCue[] {
  if (cues.length < 2) {
    return cues;
  }

  const sanitizedCues: VTTCue[] = [];
  // The first cue is always fine as-is.
  sanitizedCues.push(cues[0]);

  for (let i = 1; i < cues.length; i++) {
    const previousCue = sanitizedCues[i - 1];
    const currentCue = cues[i];

    if (currentCue.startTime <= previousCue.endTime) {
      // CONFLICT: The current cue starts too early, adjust it.
      const originalDuration = currentCue.endTime - currentCue.startTime;

      // Push the start time forward by the previous cue's end time plus the gap.
      const newStartTime = previousCue.endTime + FORCED_GAP_SECONDS;
      const newEndTime = newStartTime + originalDuration;
      const adjustedCue = new VTTCue(newStartTime, newEndTime, currentCue.text);
      adjustedCue.id = currentCue.id;

      sanitizedCues.push(adjustedCue);
    } else {
      // NO CONFLICT: The natural gap is sufficient. Add the cue as-is.
      sanitizedCues.push(currentCue);
    }
  }

  return sanitizedCues;
}
