import { join } from 'node:path';
import { app, BrowserWindow, Menu, session } from 'electron';
import { registerIpcHandlers } from './ipc';
import {
  contentSecurityPolicy,
  packagedRendererUrl,
  validateDevelopmentRendererUrl,
} from './security';

const rendererHtmlPath = join(__dirname, '../renderer/index.html');

function expectedRendererUrl(): URL {
  if (app.isPackaged) return packagedRendererUrl(rendererHtmlPath);
  const configured = process.env.ELECTRON_RENDERER_URL;
  if (configured === undefined) return packagedRendererUrl(rendererHtmlPath);
  return validateDevelopmentRendererUrl(configured);
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 924,
    height: 1000,
    minWidth: 700,
    minHeight: 600,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event, url) => {
    if (url !== win.webContents.getURL()) event.preventDefault();
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    win.loadFile(rendererHtmlPath);
  }
}

app.whenReady().then(() => {
  // No app menu — GP2SNG has no File/Edit/View/Window actions to offer, so hide
  // Electron's default menu bar entirely.
  Menu.setApplicationMenu(null);
  const rendererUrl = expectedRendererUrl();
  const usesDevelopmentServer = process.env.ELECTRON_RENDERER_URL !== undefined;
  const policy = contentSecurityPolicy(
    !usesDevelopmentServer,
    usesDevelopmentServer ? rendererUrl : undefined,
  );
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [policy],
      },
    });
  });
  registerIpcHandlers(rendererUrl);
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
