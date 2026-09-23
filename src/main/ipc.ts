import { access, readFile, writeFile } from 'node:fs/promises';
import { app, dialog, type IpcMainInvokeEvent, ipcMain } from 'electron';
import type { MidiMap, PersistedSettings } from '../shared/types/index';
import {
  readGlobalMap,
  readSettings,
  resolveDataDir,
  writeGlobalMap,
  writeSettings,
} from './persistence';
import {
  assertFileSize,
  isTrustedRendererUrl,
  MAX_GP_FILE_BYTES,
  MAX_SNG_FILE_BYTES,
  resolveSafeSngOutputPath,
} from './security';

type Handler = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown;

function registerTrustedHandler(channel: string, expectedRenderer: URL, handler: Handler): void {
  ipcMain.handle(channel, (event, ...args) => {
    if (
      event.senderFrame === null ||
      event.senderFrame !== event.sender.mainFrame ||
      !isTrustedRendererUrl(event.senderFrame.url, expectedRenderer)
    ) {
      throw new Error('Rejected IPC call from an untrusted renderer.');
    }
    return handler(event, ...args);
  });
}

// Registers every window.gp2sng channel. Call exactly once, after app ready.
export function registerIpcHandlers(expectedRenderer: URL): void {
  const dataDir = resolveDataDir(app.isPackaged, process.platform, app.getPath('userData'));
  const handle = (channel: string, handler: Handler) =>
    registerTrustedHandler(channel, expectedRenderer, handler);

  handle('loadGpFile', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Load Guitar Pro file',
      properties: ['openFile'],
      filters: [{ name: 'Guitar Pro', extensions: ['gp'] }],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const path = result.filePaths[0];
    await assertFileSize(path, MAX_GP_FILE_BYTES, 'Guitar Pro file');
    return { path, bytes: new Uint8Array(await readFile(path)) };
  });

  handle('loadSngFile', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Load prior GP2SNG conversion',
      properties: ['openFile'],
      filters: [{ name: 'GP2SNG chart', extensions: ['sng'] }],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const path = result.filePaths[0];
    await assertFileSize(path, MAX_SNG_FILE_BYTES, 'SNG file');
    return { path, bytes: new Uint8Array(await readFile(path)) };
  });

  handle('chooseOutputDir', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Choose output directory',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  handle('pathExists', async (_event, dir, filename) => {
    const target = resolveSafeSngOutputPath(dir, filename);
    try {
      await access(target);
      return true;
    } catch {
      return false;
    }
  });

  handle('writeSng', async (_event, dir, filename, bytes) => {
    if (!(bytes instanceof Uint8Array)) throw new Error('SNG data must be binary.');
    await writeFile(resolveSafeSngOutputPath(dir, filename), bytes);
  });

  handle('readSettings', () => readSettings(dataDir));
  handle('writeSettings', (_event, patch) =>
    writeSettings(dataDir, patch as Partial<PersistedSettings>),
  );
  handle('readGlobalMap', () => readGlobalMap(dataDir));
  handle('writeGlobalMap', (_event, map) => writeGlobalMap(dataDir, map as MidiMap));
}
