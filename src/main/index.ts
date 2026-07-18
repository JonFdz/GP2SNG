import { join } from 'node:path';
import { app, BrowserWindow, Menu } from 'electron';
import { registerIpcHandlers } from './ipc';

function createWindow(): void {
  const win = new BrowserWindow({
    width: 924,
    height: 1000,
    minWidth: 700,
    minHeight: 600,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
    },
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

app.whenReady().then(() => {
  // No app menu — GP2SNG has no File/Edit/View/Window actions to offer, so hide
  // Electron's default menu bar entirely.
  Menu.setApplicationMenu(null);
  registerIpcHandlers();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
