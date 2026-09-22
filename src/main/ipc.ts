import { access, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { app, dialog, ipcMain } from 'electron';
import type { MidiMap, PersistedSettings } from '../shared/types/index';
import {
  readGlobalMap,
  readSettings,
  resolveDataDir,
  writeGlobalMap,
  writeSettings,
} from './persistence';

// Registers every window.gp2sng channel. Call exactly once, after app ready.
export function registerIpcHandlers(): void {
  const dataDir = resolveDataDir(app.isPackaged, process.platform, app.getPath('userData'));

  ipcMain.handle('loadGpFile', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Load Guitar Pro file',
      properties: ['openFile'],
      filters: [{ name: 'Guitar Pro', extensions: ['gp'] }],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const path = result.filePaths[0];
    return { path, bytes: new Uint8Array(await readFile(path)) };
  });

  ipcMain.handle('loadSngFile', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Load prior GP2SNG conversion',
      properties: ['openFile'],
      filters: [{ name: 'GP2SNG chart', extensions: ['sng'] }],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const path = result.filePaths[0];
    return { path, bytes: new Uint8Array(await readFile(path)) };
  });

  ipcMain.handle('chooseOutputDir', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Choose output directory',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  ipcMain.handle('pathExists', async (_event, dir: string, filename: string) => {
    try {
      await access(join(dir, filename));
      return true;
    } catch {
      return false;
    }
  });

  ipcMain.handle('writeSng', async (_event, dir: string, filename: string, bytes: Uint8Array) => {
    await writeFile(join(dir, filename), bytes);
  });

  ipcMain.handle('readSettings', () => readSettings(dataDir));
  ipcMain.handle('writeSettings', (_event, patch: Partial<PersistedSettings>) =>
    writeSettings(dataDir, patch),
  );
  ipcMain.handle('readGlobalMap', () => readGlobalMap(dataDir));
  ipcMain.handle('writeGlobalMap', (_event, map: MidiMap) => writeGlobalMap(dataDir, map));
}
