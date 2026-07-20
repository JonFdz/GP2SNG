import { describe, expect, it } from 'vitest';
import { readMidi, readSng, writeSng } from '../../../src/shared/sng/index';
import {
  DEFAULT_CONVERSION_SETTINGS,
  DEFAULT_MIDI_MAP,
  SESSION_BLOB_VERSION,
  type SessionBlob,
  type SongMetadata,
  type YargChart,
} from '../../../src/shared/types/index';

const chart: YargChart = {
  resolution: 480,
  tempoMap: [{ tick: 0, usPerQuarter: 500000 }],
  timeSignatures: [{ tick: 0, numerator: 4, denominator: 4 }],
  notes: [{ tick: 0, note: 'red', dynamic: 'neutral', midi: 38 }],
  sections: [{ tick: 0, name: 'Intro' }],
  endTick: 1920,
  leadInTicks: 0,
};
const meta: SongMetadata = {
  name: 'Song',
  artist: 'Artist',
  album: '',
  genre: '',
  year: '',
  charter: 'X via GP2SNG',
  drumsDifficulty: 4,
};

// The blob is opaque to these tests — they assert container and MIDI structure —
// but writeSng requires one, so this is the minimum well-formed value.
function session(): SessionBlob {
  return {
    version: SESSION_BLOB_VERSION,
    gpFilePath: 'C:/songs/song.gp',
    gpBytes: new Uint8Array([1, 2, 3]),
    selectedTrackId: 0,
    sessionMap: DEFAULT_MIDI_MAP,
    sessionSettings: DEFAULT_CONVERSION_SETTINGS,
    chart,
    warnings: [],
    overrides: [],
    deletions: [],
    previewRemaps: [],
    metadata: meta,
    audioOffsetMs: 0,
    audioPaddingMs: 0,
  };
}

describe('writeSng', () => {
  it('bundles notes.mid, writes required metadata, and computes song_length', () => {
    const sng = readSng(writeSng(chart, meta, undefined, 0, session()));
    expect('notes.mid' in sng.files).toBe(true);
    expect(sng.metadata).toMatchObject({
      name: 'Song',
      artist: 'Artist',
      charter: 'X via GP2SNG',
      pro_drums: 'True',
      diff_drums: '4',
      diff_drums_real: '4',
      delay: '0',
      song_length: '2000', // one 4/4 bar at 120 BPM = 2000 ms
    });
    expect('album' in sng.metadata).toBe(false); // empty dropped
    const midi = readMidi(sng.files['notes.mid']);
    expect(midi.tracks.find((t) => t.name === 'PART DRUMS')?.notes).toHaveLength(1);
  });

  it('throws when name or artist is missing', () => {
    expect(() => writeSng(chart, { ...meta, name: '' }, undefined, 0, session())).toThrow(
      /required/,
    );
  });

  it('writes delay as the audio offset alone, never the lead-in', () => {
    // The bug this replaced: delay was `offsetMs - leadInMs`, which cancels out of
    // YARG's runway entirely (gameplay starts 2 s before audio position zero, so
    // shifting chart and audio together buys nothing). Lead-in silence now lives in
    // the audio, so delay carries only the user's A/V calibration.
    const withLeadIn: YargChart = { ...chart, leadInTicks: 3840 };
    const sng = readSng(writeSng(withLeadIn, meta, undefined, -120, session()));

    expect(sng.metadata.delay).toBe('-120');
  });

  it('writes delay 0 when the user set no offset', () => {
    const withLeadIn: YargChart = { ...chart, leadInTicks: 3840 };
    const sng = readSng(writeSng(withLeadIn, meta, undefined, 0, session()));

    expect(sng.metadata.delay).toBe('0');
  });
});
