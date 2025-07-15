import {app, BrowserWindow, dialog, ipcMain} from 'electron';
import path from 'path';

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
  ipcMain.handle('dialog:openFile', (event, options) => {
    return handleFileOpen(options);
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
  return []; // Return an empty array if the user cancels
}
