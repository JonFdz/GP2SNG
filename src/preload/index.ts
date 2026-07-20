import { contextBridge, ipcRenderer } from 'electron';
import type { Gp2SngApi } from '../shared/types/index';

const api: Gp2SngApi = {
  loadGpFile: () => ipcRenderer.invoke('loadGpFile'),
  loadSngFile: () => ipcRenderer.invoke('loadSngFile'),
  chooseOutputDir: () => ipcRenderer.invoke('chooseOutputDir'),
  pathExists: (dir, filename) => ipcRenderer.invoke('pathExists', dir, filename),
  writeSng: (dir, filename, bytes) => ipcRenderer.invoke('writeSng', dir, filename, bytes),
  readSettings: () => ipcRenderer.invoke('readSettings'),
  writeSettings: (patch) => ipcRenderer.invoke('writeSettings', patch),
  readGlobalMap: () => ipcRenderer.invoke('readGlobalMap'),
  writeGlobalMap: (map) => ipcRenderer.invoke('writeGlobalMap', map),
};

contextBridge.exposeInMainWorld('gp2sng', api);
