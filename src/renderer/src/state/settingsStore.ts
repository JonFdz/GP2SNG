import { create } from 'zustand';
import {
  type ConversionSettings,
  DEFAULT_CONVERSION_SETTINGS,
  DEFAULT_MIDI_MAP,
  DEFAULT_SETTINGS,
  type LoadResult,
  type MidiMap,
  type PersistedSettings,
} from '../../../shared/types/index';

// Long-lived, cross-session config (docs/DESIGN.md → Architecture → State model):
// the output directory, grace-note spacing, and the global MIDI map, hydrated
// once at startup via IPC.
interface SettingsState {
  outputDir: string | null;
  conversionSettings: ConversionSettings;
  globalMap: MidiMap;
  // A prior read fell back to defaults because a file was malformed/invalid.
  // Drives the one-time app-shell notice (docs/DESIGN.md → Error handling).
  loadFailed: boolean;
  hydrated: boolean;
  hydrate: () => Promise<void>;
  // The setters update the in-memory value FIRST, then persist over IPC. The
  // write rejects with PersistenceError on failure; callers catch it to raise the
  // inline retry banner while the in-memory change is retained (docs/DESIGN.md →
  // Error handling → Persistence (background)).
  setOutputDir: (dir: string | null) => Promise<void>;
  setConversionSettings: (next: ConversionSettings) => Promise<void>;
  setGlobalMap: (map: MidiMap) => Promise<void>;
  // Restore all tuning settings + the global MIDI map to their shipped defaults,
  // deliberately leaving outputDir untouched (a user-chosen environment path).
  resetToDefaults: () => Promise<void>;
}

// Pure mapping from the two IPC read results into store state. Extracted so the
// hydration semantics are unit-testable without IPC.
export function resolveHydration(
  settings: LoadResult<PersistedSettings>,
  map: LoadResult<MidiMap>,
): {
  outputDir: string | null;
  conversionSettings: ConversionSettings;
  globalMap: MidiMap;
  loadFailed: boolean;
} {
  const { outputDir, ...conversionSettings } = settings.value;
  return {
    outputDir,
    conversionSettings,
    globalMap: map.value,
    loadFailed: settings.failedToLoad || map.failedToLoad,
  };
}

export const useSettingsStore = create<SettingsState>((set) => ({
  outputDir: DEFAULT_SETTINGS.outputDir,
  conversionSettings: DEFAULT_CONVERSION_SETTINGS,
  globalMap: DEFAULT_MIDI_MAP,
  loadFailed: false,
  hydrated: false,
  hydrate: async () => {
    try {
      const [settings, map] = await Promise.all([
        window.gp2sng.readSettings(),
        window.gp2sng.readGlobalMap(),
      ]);
      set({ ...resolveHydration(settings, map), hydrated: true });
    } catch {
      // An unexpected IPC failure (reads normally return LoadResult, never throw)
      // still surfaces as the non-blocking startup notice.
      set({ loadFailed: true, hydrated: true });
    }
  },
  setOutputDir: async (dir) => {
    set({ outputDir: dir });
    await window.gp2sng.writeSettings({ outputDir: dir });
  },
  setConversionSettings: async (next) => {
    set({ conversionSettings: next });
    await window.gp2sng.writeSettings(next);
  },
  setGlobalMap: async (map) => {
    set({ globalMap: map });
    await window.gp2sng.writeGlobalMap(map);
  },
  resetToDefaults: async () => {
    // The outputDir-less patch means the persistence-layer merge keeps the saved
    // output directory while every other field resets.
    set({ conversionSettings: DEFAULT_CONVERSION_SETTINGS, globalMap: DEFAULT_MIDI_MAP });
    await Promise.all([
      window.gp2sng.writeSettings(DEFAULT_CONVERSION_SETTINGS),
      window.gp2sng.writeGlobalMap(DEFAULT_MIDI_MAP),
    ]);
  },
}));
