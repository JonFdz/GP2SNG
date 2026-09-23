import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { outputFilename } from '../../../src/renderer/src/state/outputFilename';
import { canAdvance, useWizardStore } from '../../../src/renderer/src/state/wizardStore';
import { applyRemap } from '../../../src/shared/midi/index';
import {
  type ConversionSettings,
  type ConversionWarning,
  DEFAULT_CONVERSION_SETTINGS,
  DEFAULT_MIDI_MAP,
  type ParsedGpScore,
  type ParsedGpTrack,
  SESSION_BLOB_VERSION,
  type SessionBlob,
  SessionRestoreError,
  type YargChart,
} from '../../../src/shared/types/index';

function track(id: number, isDrumKit: boolean, noteCount: number): ParsedGpTrack {
  return { id, name: `T${id}`, isDrumKit, noteCount, bars: [] };
}

function score(tracks: ParsedGpTrack[]): ParsedGpScore {
  return {
    metadata: { title: '', subtitle: '', artist: '', album: '', copyright: '', tabber: '' },
    tempoAutomations: [],
    masterBars: [],
    tracks,
  };
}

const GP_BYTES = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);

const restoredChart: YargChart = {
  resolution: 480,
  tempoMap: [{ tick: 0, usPerQuarter: 500000 }],
  timeSignatures: [{ tick: 0, numerator: 4, denominator: 4 }],
  notes: [{ tick: 0, note: 'red', dynamic: 'neutral', midi: 38 }],
  sections: [],
  endTick: 1920,
  leadInTicks: 0,
};

function blob(): SessionBlob {
  return {
    version: SESSION_BLOB_VERSION,
    gpFilePath: 'C:/songs/song.gp',
    gpBytes: GP_BYTES,
    selectedTrackIds: [3],
    sessionMap: applyRemap(DEFAULT_MIDI_MAP, 38, 'blueTom'),
    // A non-default value so restoreSession is actually verified to carry the
    // blob's settings through, not just whatever the store's own DEFAULT_ is.
    sessionSettings: { ...DEFAULT_CONVERSION_SETTINGS, cymbalGhostNotes: true },
    chart: restoredChart,
    warnings: [],
    overrides: [{ tick: 480, midi: 47, note: 'greenTom', dynamic: 'neutral', seq: 1 }],
    deletions: [{ tick: 960, midi: 42, seq: 2 }],
    previewRemaps: [{ midi: 51, from: 'blueCymbal', to: 'greenCymbal', seq: 3 }],
    metadata: {
      name: 'Song',
      artist: 'Artist',
      album: '',
      genre: '',
      year: '',
      charter: 'X via GP2SNG',
      drumsDifficulty: 4,
    },
    audioOffsetMs: -120,
    audioPaddingMs: 250,
  };
}

function restore(sngFilePath = 'C:/songs/Song - Artist.sng'): void {
  useWizardStore.getState().restoreSession({
    sngFilePath,
    gpFilePath: 'C:/songs/song.gp',
    gpFileBytes: GP_BYTES,
    score: score([track(3, true, 40)]),
    blob: blob(),
    audioBytes: new Uint8Array([9, 9, 9]),
  });
}

beforeEach(() => {
  useWizardStore.getState().reset();
});

describe('wizardStore', () => {
  test('starts on the load step with no score', () => {
    const s = useWizardStore.getState();
    expect(s.step).toBe('load');
    expect(s.score).toBeNull();
    expect(s.selectedTrackIds).toEqual([]);
  });

  test('loadScore stores the file and auto-selects all drum-kit tracks in score order', () => {
    const sc = score([track(0, false, 500), track(1, true, 10), track(2, true, 40)]);
    useWizardStore.getState().loadScore('C:/song.gp', GP_BYTES, sc);
    const s = useWizardStore.getState();
    expect(s.gpFilePath).toBe('C:/song.gp');
    expect(s.score).toBe(sc);
    expect(s.selectedTrackIds).toEqual([1, 2]);
  });

  test('toggleTrack removes an auto-selected track', () => {
    const sc = score([track(0, true, 40), track(1, true, 10)]);
    useWizardStore.getState().loadScore('C:/song.gp', GP_BYTES, sc);
    useWizardStore.getState().toggleTrack(1);
    expect(useWizardStore.getState().selectedTrackIds).toEqual([0]);
  });

  test('a score without drum-kit tracks loads with no selection and supports manual selection', () => {
    const sc = score([track(0, false, 5), track(1, false, 2)]);
    useWizardStore.getState().loadScore('C:/song.gp', GP_BYTES, sc);
    expect(useWizardStore.getState().score).toBe(sc);
    expect(useWizardStore.getState().selectedTrackIds).toEqual([]);
    useWizardStore.getState().toggleTrack(1);
    expect(useWizardStore.getState().selectedTrackIds).toEqual([1]);
  });

  test('manual selection stays unique and in score order', () => {
    useWizardStore
      .getState()
      .loadScore(
        'a.gp',
        GP_BYTES,
        score([track(3, false, 1), track(1, false, 1), track(2, false, 1)]),
      );
    useWizardStore.getState().toggleTrack(2);
    useWizardStore.getState().toggleTrack(3);
    useWizardStore.getState().toggleTrack(1);
    expect(useWizardStore.getState().selectedTrackIds).toEqual([3, 1, 2]);
    useWizardStore.getState().toggleTrack(2);
    useWizardStore.getState().toggleTrack(2);
    expect(useWizardStore.getState().selectedTrackIds).toEqual([3, 1, 2]);
  });

  test('loading a different file resets forward wizard state', () => {
    useWizardStore.getState().loadScore('a.gp', GP_BYTES, score([track(0, true, 40)]));
    useWizardStore.getState().goNext(); // -> mapping
    expect(useWizardStore.getState().step).toBe('mapping');

    useWizardStore.getState().loadScore('b.gp', GP_BYTES, score([track(5, true, 12)]));
    const s = useWizardStore.getState();
    expect(s.step).toBe('load');
    expect(s.selectedTrackIds).toEqual([5]);
  });

  test('goNext and goBack walk the wizard steps and clamp at the ends', () => {
    expect(useWizardStore.getState().step).toBe('load');
    useWizardStore.getState().goBack();
    expect(useWizardStore.getState().step).toBe('load'); // clamped low
    useWizardStore.getState().goNext();
    expect(useWizardStore.getState().step).toBe('mapping');
    useWizardStore.getState().goNext();
    expect(useWizardStore.getState().step).toBe('preview');
    useWizardStore.getState().goNext();
    expect(useWizardStore.getState().step).toBe('finalize');
    useWizardStore.getState().goNext();
    expect(useWizardStore.getState().step).toBe('finalize'); // clamped high
    useWizardStore.getState().goBack();
    expect(useWizardStore.getState().step).toBe('preview');
  });

  test('goToStep jumps directly to the given step', () => {
    useWizardStore.getState().goToStep('preview');
    expect(useWizardStore.getState().step).toBe('preview');
    useWizardStore.getState().goToStep('load');
    expect(useWizardStore.getState().step).toBe('load');
  });

  test('reset returns the store to its initial state', () => {
    useWizardStore.getState().loadScore('a.gp', GP_BYTES, score([track(0, true, 40)]));
    useWizardStore.getState().goNext();
    useWizardStore.getState().reset();
    const s = useWizardStore.getState();
    expect(s.step).toBe('load');
    expect(s.gpFilePath).toBeNull();
    expect(s.score).toBeNull();
    expect(s.selectedTrackIds).toEqual([]);
  });

  test('waveform visibility defaults on, survives Preview navigation, and resets', () => {
    expect(useWizardStore.getState().showWaveform).toBe(true);
    useWizardStore.getState().setShowWaveform(false);
    expect(useWizardStore.getState().showWaveform).toBe(false);
    useWizardStore.getState().goToStep('preview');
    useWizardStore.getState().goNext();
    useWizardStore.getState().goBack();
    expect(useWizardStore.getState().showWaveform).toBe(false);
    useWizardStore.getState().setShowWaveform(true);
    expect(useWizardStore.getState().showWaveform).toBe(true);
    useWizardStore.getState().setShowWaveform(false);
    useWizardStore.getState().reset();
    expect(useWizardStore.getState().showWaveform).toBe(true);
  });

  test('setSessionMap invalidates the prior conversion (clears chart + warnings)', () => {
    const chart = {
      resolution: 480,
      tempoMap: [],
      timeSignatures: [],
      notes: [],
      sections: [],
      endTick: 0,
      leadInTicks: 0,
    } as YargChart;
    const warnings: ConversionWarning[] = [{ kind: 'threeHandNotes', message: 'x' }];
    useWizardStore.getState().setConversion(chart, warnings);
    expect(useWizardStore.getState().chart).not.toBeNull();

    useWizardStore.getState().setSessionMap(DEFAULT_MIDI_MAP);
    expect(useWizardStore.getState().chart).toBeNull();
    expect(useWizardStore.getState().warnings).toEqual([]);
  });
});

describe('output filename override', () => {
  function currentFilename(): string | null {
    const { metadata, outputFilenameOverride } = useWizardStore.getState();
    return outputFilename(metadata?.name ?? '', metadata?.artist ?? '', outputFilenameOverride);
  }

  test('defaults to automatic mode and follows metadata until customized', () => {
    expect(useWizardStore.getState().outputFilenameOverride).toBeNull();
    useWizardStore.getState().setMetadata({ name: 'Granite', artist: 'Sleep Token' });
    expect(currentFilename()).toBe('Granite - Sleep Token.sng');
    useWizardStore.getState().setMetadata({ artist: 'Sleep Token UK' });
    expect(currentFilename()).toBe('Granite - Sleep Token UK.sng');
  });

  test('a custom override survives navigation and metadata edits until reset', () => {
    useWizardStore.getState().setMetadata({ name: 'Granite', artist: 'Sleep Token' });
    useWizardStore.getState().goToStep('finalize');
    useWizardStore.getState().setOutputFilenameOverride('Sleep Token - Granite - Custom Chart');
    useWizardStore.getState().goBack();
    useWizardStore.getState().setMetadata({ artist: 'Sleep Token UK' });
    useWizardStore.getState().goNext();
    expect(useWizardStore.getState().step).toBe('finalize');
    expect(useWizardStore.getState().outputFilenameOverride).toBe(
      'Sleep Token - Granite - Custom Chart',
    );
    expect(currentFilename()).toBe('Sleep Token - Granite - Custom Chart.sng');
    useWizardStore.getState().setOutputFilenameOverride(null);
    expect(currentFilename()).toBe('Granite - Sleep Token UK.sng');
  });

  test('loading another score clears the override', () => {
    useWizardStore.getState().setOutputFilenameOverride('Custom');
    useWizardStore.getState().loadScore('new.gp', GP_BYTES, score([track(0, true, 5)]));
    expect(useWizardStore.getState().outputFilenameOverride).toBeNull();
  });

  test('full reset clears the override', () => {
    useWizardStore.getState().setOutputFilenameOverride('Custom');
    useWizardStore.getState().reset();
    expect(useWizardStore.getState().outputFilenameOverride).toBeNull();
  });

  test('restored sessions start in automatic mode without a blob field', () => {
    useWizardStore.getState().setOutputFilenameOverride('Previous custom name');
    restore();
    expect(useWizardStore.getState().outputFilenameOverride).toBeNull();
    useWizardStore.getState().setMetadata({ artist: 'New Artist' });
    expect(currentFilename()).toBe('Song - New Artist.sng');
    expect(blob()).not.toHaveProperty('outputFilenameOverride');
  });

  test('restoring a renamed .sng uses its filename as the override', () => {
    restore('C:/songs/My Favourite Chart.sng');
    expect(useWizardStore.getState().outputFilenameOverride).toBe('My Favourite Chart');
    useWizardStore.getState().setMetadata({ artist: 'New Artist' });
    expect(currentFilename()).toBe('My Favourite Chart.sng');
  });
});

describe('wizardStore session map + conversion', () => {
  const emptyChart: YargChart = {
    resolution: 480,
    tempoMap: [],
    timeSignatures: [],
    notes: [],
    sections: [],
    endTick: 0,
    leadInTicks: 0,
  };

  test('startSession clones the global map into a fresh, non-dirty session', () => {
    useWizardStore.getState().startSession(DEFAULT_MIDI_MAP, DEFAULT_CONVERSION_SETTINGS);
    const s = useWizardStore.getState();
    expect(s.sessionMap).toEqual(DEFAULT_MIDI_MAP);
    expect(s.sessionMap).not.toBe(DEFAULT_MIDI_MAP); // a copy, not the live global map
    expect(s.mapDirty).toBe(false);
  });

  test('startSession is a no-op once a session map already exists (preserves edits)', () => {
    useWizardStore.getState().startSession(DEFAULT_MIDI_MAP, DEFAULT_CONVERSION_SETTINGS);
    const edited = applyRemap(DEFAULT_MIDI_MAP, 51, 'yellowCymbal');
    useWizardStore.getState().setSessionMap(edited);

    useWizardStore.getState().startSession(DEFAULT_MIDI_MAP, DEFAULT_CONVERSION_SETTINGS); // re-entering the step
    const s = useWizardStore.getState();
    expect(s.sessionMap).toEqual(edited);
    expect(s.mapDirty).toBe(true);
  });

  test('setSessionMap replaces the session map and marks it dirty', () => {
    useWizardStore.getState().startSession(DEFAULT_MIDI_MAP, DEFAULT_CONVERSION_SETTINGS);
    const edited = applyRemap(DEFAULT_MIDI_MAP, 47, null);
    useWizardStore.getState().setSessionMap(edited);
    const s = useWizardStore.getState();
    expect(s.sessionMap).toBe(edited);
    expect(s.mapDirty).toBe(true);
  });

  test('setConversion stores the converted chart and its warnings', () => {
    const warnings: ConversionWarning[] = [{ kind: 'unmappedNotesDropped', message: 'dropped 1' }];
    useWizardStore.getState().setConversion(emptyChart, warnings);
    const s = useWizardStore.getState();
    expect(s.chart).toBe(emptyChart);
    expect(s.warnings).toBe(warnings);
  });

  test('reselecting a different track invalidates session map, dirtiness, and conversion', () => {
    const sc = score([track(0, true, 40), track(1, true, 10)]);
    useWizardStore.getState().loadScore('a.gp', GP_BYTES, sc);
    useWizardStore.getState().startSession(DEFAULT_MIDI_MAP, DEFAULT_CONVERSION_SETTINGS);
    useWizardStore.getState().setSessionMap(applyRemap(DEFAULT_MIDI_MAP, 51, 'yellowCymbal'));
    useWizardStore.getState().setConversion(emptyChart, []);
    useWizardStore
      .getState()
      .setSessionSettings({ ...DEFAULT_CONVERSION_SETTINGS, graceNoteSpacing: '32nd' });
    useWizardStore.getState().addOverride({ tick: 0, midi: 38, note: 'red', dynamic: 'neutral' });
    useWizardStore.getState().deleteNote({ tick: 0, midi: 42 });
    useWizardStore
      .getState()
      .recordPreviewRemap({ midi: 38, from: 'red', to: 'blueTom', nextMap: DEFAULT_MIDI_MAP });
    useWizardStore.getState().setViewTime(4);

    useWizardStore.getState().toggleTrack(1); // changed track
    const s = useWizardStore.getState();
    expect(s.sessionMap).toBeNull();
    expect(s.mapDirty).toBe(false);
    expect(s.settingsDirty).toBe(false);
    expect(s.chart).toBeNull();
    expect(s.warnings).toEqual([]);
    expect(s.overrides).toEqual([]);
    expect(s.deletions).toEqual([]);
    expect(s.previewRemaps).toEqual([]);
    expect(s.viewTime).toBe(0);
    expect(s.score).toBe(sc);
    expect(s.gpFileBytes).toBe(GP_BYTES);
  });

  test('toggling an unknown track preserves the session and conversion', () => {
    const sc = score([track(0, true, 40)]);
    useWizardStore.getState().loadScore('a.gp', GP_BYTES, sc); // auto-selects track 0
    useWizardStore.getState().startSession(DEFAULT_MIDI_MAP, DEFAULT_CONVERSION_SETTINGS);
    const edited = applyRemap(DEFAULT_MIDI_MAP, 51, 'yellowCymbal');
    useWizardStore.getState().setSessionMap(edited);

    useWizardStore.getState().toggleTrack(99);
    const s = useWizardStore.getState();
    expect(s.sessionMap).toEqual(edited);
    expect(s.mapDirty).toBe(true);
  });

  test('loadScore and reset clear session + conversion state', () => {
    useWizardStore.getState().startSession(DEFAULT_MIDI_MAP, DEFAULT_CONVERSION_SETTINGS);
    useWizardStore.getState().setSessionMap(applyRemap(DEFAULT_MIDI_MAP, 51, 'yellowCymbal'));
    useWizardStore.getState().setConversion(emptyChart, []);

    useWizardStore.getState().loadScore('b.gp', GP_BYTES, score([track(0, true, 5)]));
    let s = useWizardStore.getState();
    expect(s.sessionMap).toBeNull();
    expect(s.chart).toBeNull();

    useWizardStore.getState().setConversion(emptyChart, []);
    useWizardStore.getState().reset();
    s = useWizardStore.getState();
    expect(s.sessionMap).toBeNull();
    expect(s.mapDirty).toBe(false);
    expect(s.chart).toBeNull();
    expect(s.warnings).toEqual([]);
  });
});

describe('dirty flags track divergence from the session baseline (reverting clears them)', () => {
  test('setSessionMap back to the seeded map clears mapDirty', () => {
    useWizardStore.getState().startSession(DEFAULT_MIDI_MAP, DEFAULT_CONVERSION_SETTINGS);
    const edited = applyRemap(DEFAULT_MIDI_MAP, 47, null);
    useWizardStore.getState().setSessionMap(edited);
    expect(useWizardStore.getState().mapDirty).toBe(true);

    const reverted = applyRemap(edited, 47, 'blueTom'); // value-equal to the seed
    useWizardStore.getState().setSessionMap(reverted);
    expect(useWizardStore.getState().mapDirty).toBe(false);
  });

  test('a Preview remap that nets back to the seeded map leaves mapDirty false', () => {
    useWizardStore.getState().startSession(DEFAULT_MIDI_MAP, DEFAULT_CONVERSION_SETTINGS);
    const map1 = applyRemap(DEFAULT_MIDI_MAP, 38, 'blueTom');
    useWizardStore
      .getState()
      .recordPreviewRemap({ midi: 38, from: 'red', to: 'blueTom', nextMap: map1 });
    expect(useWizardStore.getState().mapDirty).toBe(true);

    const revert = applyRemap(map1, 38, 'red'); // value-equal to the seed
    useWizardStore.getState().removePreviewRemap(38, revert);
    expect(useWizardStore.getState().mapDirty).toBe(false);
  });
});

describe('wizardStore preview state', () => {
  test('setMetadata initializes then patch-merges individual fields', () => {
    useWizardStore.getState().setMetadata({
      name: 'S',
      artist: 'A',
      album: '',
      genre: '',
      year: '',
      charter: 'C',
      drumsDifficulty: Number.NaN,
    });
    useWizardStore.getState().setMetadata({ drumsDifficulty: 5 });
    const m = useWizardStore.getState().metadata;
    expect(m?.name).toBe('S');
    expect(m?.drumsDifficulty).toBe(5);
  });

  test('addOverride replaces an existing override for the same (tick, midi)', () => {
    useWizardStore.getState().addOverride({ tick: 0, midi: 38, note: 'red', dynamic: 'accent' });
    useWizardStore
      .getState()
      .addOverride({ tick: 0, midi: 38, note: 'greenTom', dynamic: 'neutral' });
    useWizardStore
      .getState()
      .addOverride({ tick: 480, midi: 47, note: 'blueTom', dynamic: 'neutral' });
    const ovs = useWizardStore.getState().overrides;
    expect(ovs).toHaveLength(2);
    expect(ovs.find((o) => o.tick === 0 && o.midi === 38)).toMatchObject({
      note: 'greenTom',
      dynamic: 'neutral',
    });
  });

  test('addOverride keeps one effective lane and dynamic edit for a note', () => {
    useWizardStore
      .getState()
      .addOverride({ tick: 0, midi: 38, note: 'greenTom', dynamic: 'ghost' });
    useWizardStore
      .getState()
      .addOverride({ tick: 0, midi: 38, note: 'blueCymbal', dynamic: 'ghost' });
    useWizardStore
      .getState()
      .addOverride({ tick: 0, midi: 38, note: 'blueCymbal', dynamic: 'accent' });

    expect(useWizardStore.getState().overrides).toHaveLength(1);
    expect(useWizardStore.getState().overrides[0]).toMatchObject({
      note: 'blueCymbal',
      dynamic: 'accent',
    });
  });

  test('addOverride normalizes orange to neutral', () => {
    useWizardStore.getState().addOverride({ tick: 0, midi: 38, note: 'orange', dynamic: 'accent' });
    expect(useWizardStore.getState().overrides[0]).toMatchObject({
      note: 'orange',
      dynamic: 'neutral',
    });
  });

  test('deleteNote dedupes repeat deletes by (tick, midi)', () => {
    useWizardStore.getState().deleteNote({ tick: 0, midi: 38 });
    useWizardStore.getState().deleteNote({ tick: 0, midi: 38 });
    const dels = useWizardStore.getState().deletions;
    expect(dels).toHaveLength(1);

    useWizardStore.getState().deleteNote({ tick: 480, midi: 47 });
    expect(useWizardStore.getState().deletions).toHaveLength(2);
  });

  test('reset clears preview-scoped state', () => {
    useWizardStore.getState().setMetadata({
      name: 'S',
      artist: 'A',
      album: '',
      genre: '',
      year: '',
      charter: 'C',
      drumsDifficulty: 3,
    });
    useWizardStore
      .getState()
      .addOverride({ tick: 0, midi: 38, note: 'greenTom', dynamic: 'neutral' });
    useWizardStore.getState().deleteNote({ tick: 4, midi: 40 });
    useWizardStore.getState().setAudioOffsetMs(120);
    useWizardStore.getState().setViewTime(9);

    useWizardStore.getState().reset();
    const s = useWizardStore.getState();
    expect(s.metadata).toBeNull();
    expect(s.overrides).toEqual([]);
    expect(s.deletions).toEqual([]);
    expect(s.audioOffsetMs).toBe(0);
    expect(s.viewTime).toBe(0);
  });

  test('setAudio stores the padding it is given; clearAudio resets it to zero', () => {
    useWizardStore.getState().setAudio({
      buffer: {} as AudioBuffer,
      bytes: new Uint8Array([1]),
      paddingMs: 500,
    });
    expect(useWizardStore.getState().audioPaddingMs).toBe(500);

    useWizardStore.getState().clearAudio();
    expect(useWizardStore.getState().audioPaddingMs).toBe(0);
  });

  test('album artwork can be set, replaced, removed, restored, and reset', () => {
    const png = { bytes: new Uint8Array([1, 2, 3]), extension: 'png' as const };
    const jpg = { bytes: new Uint8Array([4, 5, 6]), extension: 'jpg' as const };
    useWizardStore.getState().setAlbumArt(png);
    expect(useWizardStore.getState().albumArt).toBe(png);

    useWizardStore.getState().setAlbumArt(jpg);
    expect(useWizardStore.getState().albumArt).toBe(jpg);
    useWizardStore.getState().clearAlbumArt();
    expect(useWizardStore.getState().albumArt).toBeNull();

    useWizardStore.getState().restoreSession({
      sngFilePath: 'C:/songs/Song - Artist.sng',
      gpFilePath: 'C:/songs/song.gp',
      gpFileBytes: GP_BYTES,
      score: score([track(3, true, 40)]),
      blob: blob(),
      audioBytes: new Uint8Array([9, 9, 9]),
      albumArt: png,
    });
    expect(useWizardStore.getState().albumArt).toBe(png);

    useWizardStore.getState().reset();
    expect(useWizardStore.getState().albumArt).toBeNull();
  });

  test('selecting a different track clears chart-derived preview state', () => {
    const sc = score([track(0, true, 40), track(1, true, 10)]);
    useWizardStore.getState().loadScore('a.gp', GP_BYTES, sc);
    useWizardStore
      .getState()
      .addOverride({ tick: 0, midi: 38, note: 'greenTom', dynamic: 'neutral' });
    useWizardStore.getState().deleteNote({ tick: 4, midi: 40 });
    useWizardStore.getState().setViewTime(5);

    useWizardStore.getState().toggleTrack(1);
    const s = useWizardStore.getState();
    expect(s.overrides).toEqual([]);
    expect(s.deletions).toEqual([]);
    expect(s.viewTime).toBe(0);
  });

  test('preview playback prefs default correctly', () => {
    const s = useWizardStore.getState();
    expect(s.previewVolume).toBe(1);
    expect(s.playbackRate).toBe(1);
    expect(s.metronomeOn).toBe(false);
    expect(s.metronomeVolume).toBe(1);
    expect(s.pixelsPerSecond).toBe(700);
  });

  test('preview playback pref setters update the store', () => {
    useWizardStore.getState().setPreviewVolume(1.5);
    useWizardStore.getState().setPlaybackRate(0.5);
    useWizardStore.getState().setMetronomeOn(true);
    useWizardStore.getState().setMetronomeVolume(0.5);
    const s = useWizardStore.getState();
    expect(s.previewVolume).toBe(1.5);
    expect(s.playbackRate).toBe(0.5);
    expect(s.metronomeOn).toBe(true);
    expect(s.metronomeVolume).toBe(0.5);
  });

  test('reset restores preview playback prefs to defaults', () => {
    useWizardStore.getState().setPreviewVolume(2);
    useWizardStore.getState().setPlaybackRate(0.2);
    useWizardStore.getState().setMetronomeOn(true);
    useWizardStore.getState().setMetronomeVolume(2);
    useWizardStore.getState().reset();
    const s = useWizardStore.getState();
    expect(s.previewVolume).toBe(1);
    expect(s.playbackRate).toBe(1);
    expect(s.metronomeOn).toBe(false);
    expect(s.metronomeVolume).toBe(1);
  });
});

describe('canAdvance', () => {
  test('load requires a loaded score and a selected track with notes', () => {
    const sc = score([track(0, true, 10), track(1, true, 0)]);
    expect(canAdvance('load', null, [])).toBe(false);
    expect(canAdvance('load', sc, [])).toBe(false); // no track selected yet
    expect(canAdvance('load', sc, [1])).toBe(false); // zero-note track blocks Next
    expect(canAdvance('load', sc, [0])).toBe(true);
    expect(canAdvance('load', sc, [1, 0])).toBe(true);
    expect(canAdvance('load', sc, [99])).toBe(false);
  });

  test('preview can always advance to finalize', () => {
    expect(canAdvance('preview', null, [])).toBe(true);
  });
});

describe('wizardStore action-log edits', () => {
  test('edits carry increasing recency stamps', () => {
    useWizardStore.getState().addOverride({ tick: 0, midi: 38, note: 'red', dynamic: 'neutral' });
    useWizardStore.getState().deleteNote({ tick: 480, midi: 47 });
    const { overrides, deletions } = useWizardStore.getState();
    expect(deletions[0].seq).toBeGreaterThan(overrides[0].seq);
  });

  test('removeOverride removes exactly the keyed override', () => {
    useWizardStore.getState().addOverride({ tick: 0, midi: 38, note: 'red', dynamic: 'neutral' });
    useWizardStore
      .getState()
      .addOverride({ tick: 480, midi: 47, note: 'blueTom', dynamic: 'neutral' });
    useWizardStore.getState().removeOverride(0, 38);
    const ovs = useWizardStore.getState().overrides;
    expect(ovs).toHaveLength(1);
    expect(ovs[0]).toMatchObject({ tick: 480, midi: 47 });
  });

  test('removeDeletion removes exactly the keyed deletion', () => {
    useWizardStore.getState().deleteNote({ tick: 0, midi: 38 });
    useWizardStore.getState().deleteNote({ tick: 480, midi: 47 });
    useWizardStore.getState().removeDeletion(0, 38);
    const dels = useWizardStore.getState().deletions;
    expect(dels).toHaveLength(1);
    expect(dels[0]).toMatchObject({ tick: 480, midi: 47 });
  });

  test('recordPreviewRemap captures the original row once and updates the target', () => {
    const map1 = applyRemap(DEFAULT_MIDI_MAP, 38, 'blueTom');
    useWizardStore
      .getState()
      .recordPreviewRemap({ midi: 38, from: 'red', to: 'blueTom', nextMap: map1 });
    let pr = useWizardStore.getState().previewRemaps;
    expect(pr).toHaveLength(1);
    expect(pr[0]).toMatchObject({ midi: 38, from: 'red', to: 'blueTom' });
    expect(useWizardStore.getState().sessionMap).toBe(map1);

    const map2 = applyRemap(map1, 38, 'greenTom');
    // The view passes the current placement ('blueTom') as `from`; the store keeps the original 'red'.
    useWizardStore
      .getState()
      .recordPreviewRemap({ midi: 38, from: 'blueTom', to: 'greenTom', nextMap: map2 });
    pr = useWizardStore.getState().previewRemaps;
    expect(pr).toHaveLength(1);
    expect(pr[0]).toMatchObject({ midi: 38, from: 'red', to: 'greenTom' });
  });

  test('recordPreviewRemap drops the row when the target returns to the original (net no-op)', () => {
    const map1 = applyRemap(DEFAULT_MIDI_MAP, 38, 'blueTom');
    useWizardStore
      .getState()
      .recordPreviewRemap({ midi: 38, from: 'red', to: 'blueTom', nextMap: map1 });
    const map2 = applyRemap(map1, 38, 'red');
    useWizardStore
      .getState()
      .recordPreviewRemap({ midi: 38, from: 'blueTom', to: 'red', nextMap: map2 });
    expect(useWizardStore.getState().previewRemaps).toEqual([]);
  });

  test('removePreviewRemap reverts the session map and drops the entry', () => {
    const map1 = applyRemap(DEFAULT_MIDI_MAP, 38, 'blueTom');
    useWizardStore
      .getState()
      .recordPreviewRemap({ midi: 38, from: 'red', to: 'blueTom', nextMap: map1 });
    const revert = applyRemap(map1, 38, 'red');
    useWizardStore.getState().removePreviewRemap(38, revert);
    expect(useWizardStore.getState().previewRemaps).toEqual([]);
    expect(useWizardStore.getState().sessionMap).toBe(revert);
  });

  test('previewRemaps clear on setSessionMap, toggleTrack, and reset', () => {
    const map1 = applyRemap(DEFAULT_MIDI_MAP, 38, 'blueTom');
    const record = () =>
      useWizardStore
        .getState()
        .recordPreviewRemap({ midi: 38, from: 'red', to: 'blueTom', nextMap: map1 });

    record();
    useWizardStore.getState().setSessionMap(DEFAULT_MIDI_MAP);
    expect(useWizardStore.getState().previewRemaps).toEqual([]);

    record();
    useWizardStore.getState().loadScore('a.gp', GP_BYTES, score([track(0, true, 1)]));
    record();
    useWizardStore.getState().toggleTrack(0);
    expect(useWizardStore.getState().previewRemaps).toEqual([]);

    record();
    useWizardStore.getState().reset();
    expect(useWizardStore.getState().previewRemaps).toEqual([]);
  });
});

describe('sessionSettings', () => {
  afterEach(() => useWizardStore.getState().reset());

  test('startSession seeds session and baseline from the passed settings', () => {
    const settings: ConversionSettings = { ...DEFAULT_CONVERSION_SETTINGS, cymbalGhostNotes: true };
    useWizardStore.getState().startSession(DEFAULT_MIDI_MAP, settings);
    const s = useWizardStore.getState();
    expect(s.sessionSettings).toEqual(settings);
    expect(s.baselineSettings).toEqual(settings);
    expect(s.settingsDirty).toBe(false);
  });

  test('an edit sets settingsDirty and invalidates the chart', () => {
    useWizardStore.getState().startSession(DEFAULT_MIDI_MAP, DEFAULT_CONVERSION_SETTINGS);
    useWizardStore.setState({ chart: { resolution: 480 } as never, warnings: [] });
    useWizardStore
      .getState()
      .setSessionSettings({ ...DEFAULT_CONVERSION_SETTINGS, graceNoteSpacing: '32nd' });
    const s = useWizardStore.getState();
    expect(s.settingsDirty).toBe(true);
    expect(s.chart).toBeNull();
  });

  test('an accent-toggle edit sets settingsDirty', () => {
    useWizardStore.getState().startSession(DEFAULT_MIDI_MAP, DEFAULT_CONVERSION_SETTINGS);
    useWizardStore
      .getState()
      .setSessionSettings({ ...DEFAULT_CONVERSION_SETTINGS, tomAccentedNotes: true });
    expect(useWizardStore.getState().settingsDirty).toBe(true);
  });

  test('reverting an edit clears settingsDirty', () => {
    useWizardStore.getState().startSession(DEFAULT_MIDI_MAP, DEFAULT_CONVERSION_SETTINGS);
    useWizardStore
      .getState()
      .setSessionSettings({ ...DEFAULT_CONVERSION_SETTINGS, snareGhostNotes: false });
    expect(useWizardStore.getState().settingsDirty).toBe(true);
    useWizardStore.getState().setSessionSettings({ ...DEFAULT_CONVERSION_SETTINGS });
    expect(useWizardStore.getState().settingsDirty).toBe(false);
  });

  test('a nested cymbalPriorities change is detected', () => {
    useWizardStore.getState().startSession(DEFAULT_MIDI_MAP, DEFAULT_CONVERSION_SETTINGS);
    useWizardStore.getState().setSessionSettings({
      ...DEFAULT_CONVERSION_SETTINGS,
      cymbalPriorities: {
        ...DEFAULT_CONVERSION_SETTINGS.cymbalPriorities,
        china: ['yellow', 'blue', 'green'],
      },
    });
    expect(useWizardStore.getState().settingsDirty).toBe(true);
  });

  test('toggleTrack with a different id clears settingsDirty', () => {
    const sc = score([track(0, true, 40), track(1, true, 10)]);
    useWizardStore.getState().loadScore('a.gp', GP_BYTES, sc);
    useWizardStore.getState().startSession(DEFAULT_MIDI_MAP, DEFAULT_CONVERSION_SETTINGS);
    useWizardStore
      .getState()
      .setSessionSettings({ ...DEFAULT_CONVERSION_SETTINGS, graceNoteSpacing: '32nd' });
    expect(useWizardStore.getState().settingsDirty).toBe(true);

    useWizardStore.getState().toggleTrack(1);
    expect(useWizardStore.getState().settingsDirty).toBe(false);
  });
});

describe('restoreSession', () => {
  test('lands on Preview with the blob’s chart, edits, metadata and offset', () => {
    restore();
    const s = useWizardStore.getState();
    expect(s.step).toBe('preview');
    expect(s.gpFilePath).toBe('C:/songs/song.gp');
    expect(Array.from(s.gpFileBytes ?? [])).toEqual(Array.from(GP_BYTES));
    expect(s.selectedTrackIds).toEqual([3]);
    expect(s.chart).toEqual(restoredChart);
    expect(s.overrides).toEqual(blob().overrides);
    expect(s.deletions).toEqual(blob().deletions);
    expect(s.previewRemaps).toEqual(blob().previewRemaps);
    expect(s.metadata).toEqual(blob().metadata);
    expect(s.audioOffsetMs).toBe(-120);
    expect(s.audioPaddingMs).toBe(250);
    expect(Array.from(s.audioBytes ?? [])).toEqual([9, 9, 9]);
  });

  test('baselines the restored map and settings so the session does not read dirty', () => {
    restore();
    const s = useWizardStore.getState();
    expect(s.mapDirty).toBe(false);
    expect(s.settingsDirty).toBe(false);
    expect(s.baselineMap).toEqual(blob().sessionMap);
    expect(s.sessionSettings).toEqual(blob().sessionSettings);
    expect(s.baselineSettings).toEqual(blob().sessionSettings);
  });

  test('leaves the decoded audio buffer unset for the Preview step to fill', () => {
    restore();
    expect(useWizardStore.getState().audioBuffer).toBeNull();
    expect(useWizardStore.getState().audioBytes).not.toBeNull();
  });

  test('discards any session already in progress', () => {
    useWizardStore
      .getState()
      .loadScore('other.gp', new Uint8Array([1]), score([track(0, true, 9)]));
    useWizardStore.getState().goToStep('mapping');
    restore();
    const s = useWizardStore.getState();
    expect(s.gpFilePath).toBe('C:/songs/song.gp');
    expect(s.selectedTrackIds).toEqual([3]);
    expect(s.step).toBe('preview');
  });

  test('derives a 71→71.5 correction from a saved chart and reapplies it on reconversion', () => {
    const gp = score([track(3, true, 40)]);
    gp.masterBars = [
      {
        timeSignature: { numerator: 4, denominator: 4 },
        section: null,
        repeatStart: false,
        repeatEnd: false,
        repeatCount: 0,
        alternateEndings: [],
        hasDirections: false,
      },
    ];
    gp.tempoAutomations = [{ bar: 0, position: 0, bpm: 71, linear: false }];
    const savedChart: YargChart = {
      ...restoredChart,
      tempoMap: [{ tick: 0, usPerQuarter: Math.round(60000000 / 71.5) }],
      leadInTicks: 1920,
    };
    const savedBlob = { ...blob(), chart: savedChart };
    expect('tempoScale' in savedBlob).toBe(false);
    useWizardStore.getState().restoreSession({
      sngFilePath: 'C:/songs/Song - Artist.sng',
      gpFilePath: 'C:/songs/song.gp',
      gpFileBytes: GP_BYTES,
      score: gp,
      blob: savedBlob,
      audioBytes: new Uint8Array(),
    });
    expect(useWizardStore.getState().tempoScale).toBeCloseTo(71.5 / 71, 5);
    expect(useWizardStore.getState().chart?.tempoMap).toEqual(savedChart.tempoMap);

    const unadjusted: YargChart = {
      ...savedChart,
      tempoMap: [{ tick: 0, usPerQuarter: Math.round(60000000 / 71) }],
    };
    useWizardStore.getState().setConversion(unadjusted, []);
    const converted = useWizardStore.getState().chart;
    expect(converted).not.toBeNull();
    expect(60000000 / (converted?.tempoMap[0].usPerQuarter ?? 1)).toBeCloseTo(71.5, 2);
    expect(useWizardStore.getState().tempoScale).toBeCloseTo(71.5 / 71, 5);

    useWizardStore.getState().loadScore('different.gp', GP_BYTES, score([track(0, true, 1)]));
    expect(useWizardStore.getState().tempoScale).toBe(1);
  });

  test('restores multiple tracks and preserves selection when returning to Load', () => {
    const sc = score([track(3, true, 40), track(4, false, 5)]);
    useWizardStore.getState().restoreSession({
      sngFilePath: 'C:/songs/Song - Artist.sng',
      gpFilePath: 'C:/songs/song.gp',
      gpFileBytes: GP_BYTES,
      score: sc,
      blob: { ...blob(), selectedTrackIds: [3, 4] },
      audioBytes: new Uint8Array([1]),
    });
    useWizardStore.getState().goToStep('load');
    expect(useWizardStore.getState().selectedTrackIds).toEqual([3, 4]);
    useWizardStore.getState().toggleTrack(4);
    expect(useWizardStore.getState().selectedTrackIds).toEqual([3]);
    expect(useWizardStore.getState().chart).toBeNull();
  });

  test('refuses a restored selection absent from the embedded score', () => {
    expect(() =>
      useWizardStore.getState().restoreSession({
        sngFilePath: 'C:/songs/Song - Artist.sng',
        gpFilePath: 'C:/songs/song.gp',
        gpFileBytes: GP_BYTES,
        score: score([track(3, true, 40)]),
        blob: { ...blob(), selectedTrackIds: [3, 9] },
        audioBytes: new Uint8Array([1]),
      }),
    ).toThrow(SessionRestoreError);
  });
});

test('loadScore retains the GP file bytes for the session blob', () => {
  useWizardStore.getState().loadScore('a.gp', GP_BYTES, score([track(0, true, 40)]));
  expect(Array.from(useWizardStore.getState().gpFileBytes ?? [])).toEqual(Array.from(GP_BYTES));
});
