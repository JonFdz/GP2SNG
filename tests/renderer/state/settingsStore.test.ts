import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { resolveHydration, useSettingsStore } from '../../../src/renderer/src/state/settingsStore';
import {
  type ConversionSettings,
  DEFAULT_CONVERSION_SETTINGS,
  DEFAULT_CYMBAL_PRIORITIES,
  DEFAULT_MIDI_MAP,
  type MidiMap,
} from '../../../src/shared/types/index';

describe('resolveHydration', () => {
  test('maps successful reads into store state', () => {
    const map: MidiMap = { ...DEFAULT_MIDI_MAP };
    const state = resolveHydration(
      {
        value: {
          outputDir: 'C:/songs',
          graceNoteSpacing: '32nd',
          snareGhostNotes: false,
          tomGhostNotes: true,
          cymbalGhostNotes: true,
          snareAccentedNotes: true,
          tomAccentedNotes: false,
          cymbalAccentedNotes: false,
          dynamicCymbalSelection: true,
          cymbalPriorities: {
            crashHigh: ['blue', 'green', 'yellow'],
            splash: ['blue', 'green', 'yellow'],
            china: ['green', 'yellow', 'blue'],
          },
        },
        failedToLoad: false,
      },
      { value: map, failedToLoad: false },
    );
    expect(state).toEqual({
      outputDir: 'C:/songs',
      conversionSettings: {
        graceNoteSpacing: '32nd',
        snareGhostNotes: false,
        tomGhostNotes: true,
        cymbalGhostNotes: true,
        snareAccentedNotes: true,
        tomAccentedNotes: false,
        cymbalAccentedNotes: false,
        dynamicCymbalSelection: true,
        cymbalPriorities: DEFAULT_CYMBAL_PRIORITIES,
      },
      globalMap: map,
      loadFailed: false,
    });
  });

  test('flags loadFailed when the settings read failed', () => {
    const state = resolveHydration(
      {
        value: {
          outputDir: null,
          graceNoteSpacing: '64th',
          snareGhostNotes: true,
          tomGhostNotes: false,
          cymbalGhostNotes: false,
          snareAccentedNotes: true,
          tomAccentedNotes: false,
          cymbalAccentedNotes: false,
          dynamicCymbalSelection: true,
          cymbalPriorities: {
            crashHigh: ['blue', 'green', 'yellow'],
            splash: ['blue', 'green', 'yellow'],
            china: ['green', 'yellow', 'blue'],
          },
        },
        failedToLoad: true,
      },
      { value: DEFAULT_MIDI_MAP, failedToLoad: false },
    );
    expect(state.loadFailed).toBe(true);
  });

  test('flags loadFailed when the global-map read failed', () => {
    const state = resolveHydration(
      {
        value: {
          outputDir: null,
          graceNoteSpacing: '64th',
          snareGhostNotes: true,
          tomGhostNotes: false,
          cymbalGhostNotes: false,
          snareAccentedNotes: true,
          tomAccentedNotes: false,
          cymbalAccentedNotes: false,
          dynamicCymbalSelection: true,
          cymbalPriorities: {
            crashHigh: ['blue', 'green', 'yellow'],
            splash: ['blue', 'green', 'yellow'],
            china: ['green', 'yellow', 'blue'],
          },
        },
        failedToLoad: false,
      },
      { value: DEFAULT_MIDI_MAP, failedToLoad: true },
    );
    expect(state.loadFailed).toBe(true);
  });

  test('maps cymbal selection fields into store state', () => {
    const priorities = {
      crashHigh: ['green', 'blue', 'yellow'],
      splash: ['blue', 'green', 'yellow'],
      china: ['green', 'yellow', 'blue'],
    } as const;
    const state = resolveHydration(
      {
        value: {
          outputDir: null,
          graceNoteSpacing: '64th',
          snareGhostNotes: true,
          tomGhostNotes: false,
          cymbalGhostNotes: false,
          snareAccentedNotes: true,
          tomAccentedNotes: false,
          cymbalAccentedNotes: false,
          dynamicCymbalSelection: false,
          cymbalPriorities: priorities,
        },
        failedToLoad: false,
      },
      { value: DEFAULT_MIDI_MAP, failedToLoad: false },
    );
    expect(state.conversionSettings.dynamicCymbalSelection).toBe(false);
    expect(state.conversionSettings.cymbalPriorities).toEqual(priorities);
  });
});

describe('hydrate', () => {
  const initial = useSettingsStore.getState();

  afterEach(() => {
    vi.unstubAllGlobals();
    useSettingsStore.setState(initial, true);
  });

  test('stays unhydrated until both persisted reads finish', async () => {
    let finishSettings: ((value: unknown) => void) | undefined;
    const settings = new Promise((resolve) => {
      finishSettings = resolve;
    });
    vi.stubGlobal('window', {
      gp2sng: {
        readSettings: vi.fn().mockReturnValue(settings),
        readGlobalMap: vi.fn().mockResolvedValue({
          value: DEFAULT_MIDI_MAP,
          failedToLoad: false,
        }),
      },
    });
    useSettingsStore.setState({ hydrated: false, loadFailed: false });

    const hydrating = useSettingsStore.getState().hydrate();
    expect(useSettingsStore.getState().hydrated).toBe(false);
    finishSettings?.({
      value: { ...DEFAULT_CONVERSION_SETTINGS, outputDir: '/charts' },
      failedToLoad: false,
    });
    await hydrating;

    expect(useSettingsStore.getState()).toMatchObject({
      hydrated: true,
      loadFailed: false,
      outputDir: '/charts',
      conversionSettings: DEFAULT_CONVERSION_SETTINGS,
      globalMap: DEFAULT_MIDI_MAP,
    });
  });

  test('falls back and unblocks the app when an unexpected read rejects', async () => {
    vi.stubGlobal('window', {
      gp2sng: {
        readSettings: vi.fn().mockRejectedValue(new Error('IPC unavailable')),
        readGlobalMap: vi.fn().mockResolvedValue({
          value: DEFAULT_MIDI_MAP,
          failedToLoad: false,
        }),
      },
    });
    useSettingsStore.setState({ hydrated: false, loadFailed: false });

    await useSettingsStore.getState().hydrate();

    expect(useSettingsStore.getState()).toMatchObject({ hydrated: true, loadFailed: true });
  });
});

describe('resetToDefaults', () => {
  const initial = useSettingsStore.getState();
  let writeSettings: ReturnType<typeof vi.fn>;
  let writeGlobalMap: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    writeSettings = vi.fn().mockResolvedValue(undefined);
    writeGlobalMap = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('window', { gp2sng: { writeSettings, writeGlobalMap } });
    const customMap: MidiMap = { ...DEFAULT_MIDI_MAP, red: [99] };
    useSettingsStore.setState({
      outputDir: 'C:/songs',
      conversionSettings: {
        graceNoteSpacing: '32nd',
        snareGhostNotes: false,
        tomGhostNotes: true,
        cymbalGhostNotes: true,
        snareAccentedNotes: true,
        tomAccentedNotes: false,
        cymbalAccentedNotes: false,
        dynamicCymbalSelection: false,
        cymbalPriorities: {
          crashHigh: ['green', 'blue', 'yellow'],
          splash: ['green', 'blue', 'yellow'],
          china: ['yellow', 'blue', 'green'],
        },
      },
      globalMap: customMap,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    useSettingsStore.setState(initial, true);
  });

  test('restores default tuning + map in memory, keeps outputDir', async () => {
    await useSettingsStore.getState().resetToDefaults();
    const s = useSettingsStore.getState();
    expect(s.outputDir).toBe('C:/songs');
    expect(s.conversionSettings).toEqual(DEFAULT_CONVERSION_SETTINGS);
    expect(s.globalMap).toEqual(DEFAULT_MIDI_MAP);
  });

  test('persists default tuning patch (no outputDir) and default map', async () => {
    await useSettingsStore.getState().resetToDefaults();
    expect(writeGlobalMap).toHaveBeenCalledTimes(1);
    expect(writeGlobalMap).toHaveBeenCalledWith(DEFAULT_MIDI_MAP);
    expect(writeSettings).toHaveBeenCalledTimes(1);
    const patch = writeSettings.mock.calls[0][0];
    expect('outputDir' in patch).toBe(false);
    expect(patch).toEqual(DEFAULT_CONVERSION_SETTINGS);
  });

  test('rejects when a write fails but still applies the in-memory reset', async () => {
    writeGlobalMap.mockRejectedValue(new Error('disk full'));
    await expect(useSettingsStore.getState().resetToDefaults()).rejects.toThrow();
    expect(useSettingsStore.getState().globalMap).toEqual(DEFAULT_MIDI_MAP);
  });
});

describe('setConversionSettings', () => {
  const initial = useSettingsStore.getState();
  let writeSettings: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    writeSettings = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('window', { gp2sng: { writeSettings } });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    useSettingsStore.setState(initial, true);
  });

  test('applies the object in memory and persists it flat', async () => {
    const next: ConversionSettings = { ...DEFAULT_CONVERSION_SETTINGS, graceNoteSpacing: '32nd' };
    await useSettingsStore.getState().setConversionSettings(next);
    expect(useSettingsStore.getState().conversionSettings).toEqual(next);
    expect(writeSettings).toHaveBeenCalledWith(next);
  });

  test('rejects when the write fails, retaining the in-memory value', async () => {
    writeSettings.mockRejectedValue(new Error('disk full'));
    const next: ConversionSettings = { ...DEFAULT_CONVERSION_SETTINGS, cymbalGhostNotes: true };
    await expect(useSettingsStore.getState().setConversionSettings(next)).rejects.toThrow();
    expect(useSettingsStore.getState().conversionSettings.cymbalGhostNotes).toBe(true);
  });
});
