import { describe, expect, it } from 'vitest';
import { displayedNotes } from '../../../src/renderer/src/playback/overrides';
import { buildSessionBlob } from '../../../src/renderer/src/state/sessionBlob';
import { readSngSession, writeSng } from '../../../src/shared/sng/index';
import {
  DEFAULT_CONVERSION_SETTINGS,
  DEFAULT_MIDI_MAP,
  SESSION_BLOB_VERSION,
  type SeqDeletion,
  type SeqOverride,
  type SongMetadata,
  type YargChart,
} from '../../../src/shared/types/index';

const rawChart: YargChart = {
  resolution: 480,
  tempoMap: [{ tick: 0, usPerQuarter: 500000 }],
  timeSignatures: [{ tick: 0, numerator: 4, denominator: 4 }],
  notes: [
    { tick: 0, note: 'red', dynamic: 'neutral', midi: 38 },
    { tick: 480, note: 'yellowCymbal', dynamic: 'neutral', midi: 42 },
    { tick: 960, note: 'blueTom', dynamic: 'neutral', midi: 47 },
  ],
  sections: [],
  endTick: 1920,
  leadInTicks: 0,
};

const overrides: SeqOverride[] = [{ tick: 0, midi: 38, note: 'orange', accented: false, seq: 1 }];
const deletions: SeqDeletion[] = [{ tick: 960, midi: 47, seq: 2 }];

const metadata: SongMetadata = {
  name: 'Song',
  artist: 'Artist',
  album: '',
  genre: '',
  year: '',
  charter: 'X via GP2SNG',
  drumsDifficulty: 4,
};

describe('buildSessionBlob', () => {
  it('stamps the current version and passes every other field through unchanged', () => {
    const blob = buildSessionBlob({
      gpFilePath: 'C:/songs/song.gp',
      gpBytes: new Uint8Array([1, 2, 3]),
      selectedTrackId: 2,
      sessionMap: DEFAULT_MIDI_MAP,
      sessionSettings: DEFAULT_CONVERSION_SETTINGS,
      chart: rawChart,
      warnings: [],
      overrides,
      deletions,
      previewRemaps: [],
      metadata,
      audioOffsetMs: -120,
    });
    expect(blob.version).toBe(SESSION_BLOB_VERSION);
    expect(blob.chart).toBe(rawChart);
    expect(blob.overrides).toBe(overrides);
    expect(blob.deletions).toBe(deletions);
    expect(blob.metadata).toBe(metadata);
    expect(blob.audioOffsetMs).toBe(-120);
  });

  // Regression for the branch's highest-risk line: FinalizeView.doWrite must pass
  // the DISPLAYED chart (conversion output + overrides - deletions, what YARG
  // plays) to writeSng, while the blob carries the RAW chart (unedited conversion
  // output, so the edit layers stay individually revertable on reopen). An
  // accidental swap in doWrite would pass the rest of the suite and only surface as
  // doubled edits the next time the .sng is reopened. This test builds both charts
  // exactly the way doWrite does, writes with displayed-as-argument and
  // raw-in-blob (the correct wiring), and reads back — proving the blob holds the
  // raw notes, not the displayed ones. If the two were ever swapped in doWrite, the
  // .sng handed to writeSng and readSngSession here would carry the displayed
  // chart as `notes.mid` and the raw chart in the blob would instead be the
  // displayed one, and BOTH assertions below would fail.
  it('keeps the raw chart in the blob distinct from the displayed chart written to notes.mid', () => {
    const displayed = displayedNotes(rawChart.notes, overrides, deletions);
    // Sanity: the edits actually changed something, or the rest of this test would
    // pass vacuously even with the charts swapped.
    expect(displayed).not.toEqual(rawChart.notes);

    const displayedChart: YargChart = { ...rawChart, notes: displayed };
    const session = buildSessionBlob({
      gpFilePath: 'C:/songs/song.gp',
      gpBytes: new Uint8Array([1, 2, 3]),
      selectedTrackId: 0,
      sessionMap: DEFAULT_MIDI_MAP,
      sessionSettings: DEFAULT_CONVERSION_SETTINGS,
      chart: rawChart,
      warnings: [],
      overrides,
      deletions,
      previewRemaps: [],
      metadata,
      audioOffsetMs: 0,
    });

    const audio = { bytes: new Uint8Array([1, 2, 3, 4]), extension: 'ogg' };
    const sngBytes = writeSng(displayedChart, metadata, audio, 0, session);
    const restored = readSngSession(sngBytes);

    expect(restored.blob.chart.notes).toEqual(rawChart.notes);
    expect(restored.blob.chart.notes).not.toEqual(displayed);
  });
});
