import { describe, expect, it } from 'vitest';
import { readMidi, readSng, sngDelayMs, writeSng } from '../../../src/shared/sng/index';
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

  it('bundles audio at the song.<ext> slot with the delay offset', () => {
    const audio = { bytes: Uint8Array.from([9, 8, 7]), extension: 'OGG' };
    const sng = readSng(writeSng(chart, meta, audio, -250, session()));
    expect([...sng.files['song.ogg']]).toEqual([9, 8, 7]); // filename lowercased
    expect(sng.metadata.delay).toBe('-250');
  });

  it('throws when name or artist is missing', () => {
    expect(() => writeSng(chart, { ...meta, name: '' }, undefined, 0, session())).toThrow(
      /required/,
    );
  });
});

describe('sngDelayMs', () => {
  // One 4/4 bar of lead-in at 120 BPM = 2000 ms.
  const leadIn: YargChart = { ...chart, leadInTicks: 1920, endTick: 3840 };

  it('holds the audio back by the lead-in at a zero offset', () => {
    expect(sngDelayMs(leadIn, 0)).toBe(-2000);
  });

  it('composes additively with the user audio offset, both signs', () => {
    expect(sngDelayMs(leadIn, 150)).toBe(-1850);
    expect(sngDelayMs(leadIn, -150)).toBe(-2150);
  });

  it('is the plain offset when there is no lead-in', () => {
    expect(sngDelayMs(chart, -120)).toBe(-120);
  });

  it('writes that value as delay, with a song_length covering the lead-in', () => {
    const sng = readSng(writeSng(leadIn, meta, undefined, 0, session()));
    expect(sng.metadata.delay).toBe('-2000');
    expect(sng.metadata.song_length).toBe('4000');
  });
});
