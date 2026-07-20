import { describe, expect, it } from 'vitest';
import { decodeSessionBlob, encodeSessionBlob } from '../../../src/shared/sng/index';
import {
  DEFAULT_CONVERSION_SETTINGS,
  DEFAULT_MIDI_MAP,
  SESSION_BLOB_VERSION,
  type SessionBlob,
  SessionRestoreError,
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

const metadata: SongMetadata = {
  name: 'Song',
  artist: 'Artist',
  album: '',
  genre: '',
  year: '',
  charter: 'X via GP2SNG',
  drumsDifficulty: 4,
};

function sampleBlob(): SessionBlob {
  return {
    version: SESSION_BLOB_VERSION,
    gpFilePath: 'C:/songs/song.gp',
    // Deliberately includes 0x00 and high bytes: base64 must survive both.
    gpBytes: new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0xff, 0x7f]),
    selectedTrackId: 2,
    sessionMap: DEFAULT_MIDI_MAP,
    sessionSettings: DEFAULT_CONVERSION_SETTINGS,
    chart,
    warnings: [],
    overrides: [{ tick: 480, midi: 47, note: 'greenTom', accented: false, seq: 1 }],
    deletions: [{ tick: 960, midi: 42, seq: 2 }],
    previewRemaps: [{ midi: 51, from: 'blueCymbal', to: 'greenCymbal', seq: 3 }],
    metadata,
    audioOffsetMs: -120,
  };
}

describe('session blob codec', () => {
  it('round-trips every member, GP bytes included', () => {
    const blob = sampleBlob();
    const decoded = decodeSessionBlob(encodeSessionBlob(blob));
    expect(decoded).toEqual(blob);
    expect(Array.from(decoded.gpBytes)).toEqual(Array.from(blob.gpBytes));
  });

  it('refuses a blob written by a different version', () => {
    const bytes = encodeSessionBlob({ ...sampleBlob(), version: SESSION_BLOB_VERSION + 1 });
    expect(() => decodeSessionBlob(bytes)).toThrow(SessionRestoreError);
  });

  it('refuses malformed JSON', () => {
    const bytes = new TextEncoder().encode('{ not json');
    expect(() => decodeSessionBlob(bytes)).toThrow(SessionRestoreError);
  });

  it('refuses a blob missing a required member', () => {
    const parsed = JSON.parse(new TextDecoder().decode(encodeSessionBlob(sampleBlob())));
    delete parsed.chart;
    const bytes = new TextEncoder().encode(JSON.stringify(parsed));
    expect(() => decodeSessionBlob(bytes)).toThrow(SessionRestoreError);
  });
});
