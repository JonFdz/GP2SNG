import type { MidiMap, PersistedSettings } from './midi';

// Reads return the loaded value plus a flag. `failedToLoad` is true only when a
// file existed but was malformed/invalid; a missing file is normal on first
// launch and is NOT a failure. This lets the app shell raise the one-time notice
// from docs/DESIGN.md → Error handling → Persistence (background).
export type LoadResult<T> = { value: T; failedToLoad: boolean };

export type Gp2SngApi = {
  loadGpFile: () => Promise<{ path: string; bytes: Uint8Array } | null>;
  chooseOutputDir: () => Promise<string | null>;
  // Whether dir/filename already exists (drives the Save overwrite-confirm modal,
  // docs/DESIGN.md → UI top-level structure → Save).
  pathExists: (dir: string, filename: string) => Promise<boolean>;
  writeSng: (dir: string, filename: string, bytes: Uint8Array) => Promise<void>;
  readSettings: () => Promise<LoadResult<PersistedSettings>>;
  writeSettings: (patch: Partial<PersistedSettings>) => Promise<void>;
  readGlobalMap: () => Promise<LoadResult<MidiMap>>;
  writeGlobalMap: (map: MidiMap) => Promise<void>;
};

declare global {
  interface Window {
    gp2sng: Gp2SngApi;
  }
}
