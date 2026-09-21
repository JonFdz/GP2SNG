import { describe, expect, it } from 'vitest';
import {
  buildMidi,
  buildSngContainer,
  decodeSessionBlob,
  encodeSessionBlob,
  readMidi,
  readSng,
  readSngSession,
  writeSng,
} from '../../../src/shared/sng/index';
import {
  DEFAULT_CONVERSION_SETTINGS,
  DEFAULT_MIDI_MAP,
  SESSION_BLOB_VERSION,
  type SessionBlob,
  SessionRestoreError,
  type SongMetadata,
  type YargChart,
} from '../../../src/shared/types/index';

function reparse(blob: SessionBlob): Record<string, unknown> {
  return JSON.parse(new TextDecoder().decode(encodeSessionBlob(blob)));
}

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
    audioPaddingMs: 0,
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

  it('refuses a blob with no version field at all as corrupt, not "different version"', () => {
    const parsed = reparse(sampleBlob());
    delete parsed.version;
    const bytes = new TextEncoder().encode(JSON.stringify(parsed));
    let thrown: unknown;
    try {
      decodeSessionBlob(bytes);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(SessionRestoreError);
    expect((thrown as SessionRestoreError).message).not.toMatch(/different version/);
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

  it('refuses a blob whose gpFileBase64 is not valid base64', () => {
    const parsed = JSON.parse(new TextDecoder().decode(encodeSessionBlob(sampleBlob())));
    parsed.gpFileBase64 = 'not-valid-base64!!!';
    const bytes = new TextEncoder().encode(JSON.stringify(parsed));
    expect(() => decodeSessionBlob(bytes)).toThrow(SessionRestoreError);
  });

  it('refuses a blob whose chart has no array notes, instead of crashing rendering later', () => {
    const parsed = reparse(sampleBlob());
    parsed.chart = 'not a chart';
    const bytes = new TextEncoder().encode(JSON.stringify(parsed));
    expect(() => decodeSessionBlob(bytes)).toThrow(SessionRestoreError);
  });

  it('refuses a blob whose sessionMap is missing a YARG_NOTE_IDS row', () => {
    const parsed = reparse(sampleBlob());
    const map = parsed.sessionMap as Record<string, unknown>;
    delete map.greenTomAccented;
    const bytes = new TextEncoder().encode(JSON.stringify(parsed));
    expect(() => decodeSessionBlob(bytes)).toThrow(SessionRestoreError);
  });

  it('round-trips audioPaddingMs', () => {
    const blob: SessionBlob = { ...sampleBlob(), audioPaddingMs: 2909 };
    const decoded = decodeSessionBlob(encodeSessionBlob(blob));

    expect(decoded.audioPaddingMs).toBe(2909);
  });

  it('refuses a blob with no audioPaddingMs', () => {
    const raw = reparse(sampleBlob());
    delete raw.audioPaddingMs;
    const bytes = new TextEncoder().encode(JSON.stringify(raw));

    expect(() => decodeSessionBlob(bytes)).toThrow(SessionRestoreError);
  });
});

describe('readSngSession', () => {
  const audio = { bytes: new Uint8Array([1, 2, 3, 4]), extension: 'ogg' };

  it('extracts the session blob and the bundled audio', () => {
    const restored = readSngSession(writeSng(chart, metadata, audio, -120, sampleBlob()));
    expect(restored.blob).toEqual(sampleBlob());
    expect(Array.from(restored.audioBytes)).toEqual([1, 2, 3, 4]);
  });

  it('restores PNG artwork unchanged', () => {
    const art = {
      bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0xaa]),
      extension: 'png' as const,
    };
    const restored = readSngSession(writeSng(chart, metadata, audio, -120, sampleBlob(), art));

    expect(restored.albumArt?.extension).toBe('png');
    expect(Array.from(restored.albumArt?.bytes ?? [])).toEqual(Array.from(art.bytes));
  });

  it('restores JPG artwork unchanged and preserves it through re-export', () => {
    const art = {
      bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 0xbb]),
      extension: 'jpg' as const,
    };
    const restored = readSngSession(writeSng(chart, metadata, audio, -120, sampleBlob(), art));
    const reexported = readSng(
      writeSng(chart, metadata, audio, -120, restored.blob, restored.albumArt),
    );

    expect(restored.albumArt?.extension).toBe('jpg');
    expect(Array.from(reexported.files['album.jpg'])).toEqual(Array.from(art.bytes));
  });

  it('restores album.jpeg as JPEG artwork unchanged', () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0xcc]);
    const sng = buildSngContainer(
      [
        { name: 'notes.mid', bytes: buildMidi(chart) },
        { name: 'song.ogg', bytes: audio.bytes },
        { name: 'album.jpeg', bytes: jpeg },
        { name: 'gp2sng.json', bytes: encodeSessionBlob(sampleBlob()) },
      ],
      [],
      new Uint8Array(16),
    );

    const restored = readSngSession(sng);
    expect(restored.albumArt?.extension).toBe('jpg');
    expect(Array.from(restored.albumArt?.bytes ?? [])).toEqual(Array.from(jpeg));
  });

  it('prefers album.png, then album.jpg, then album.jpeg when multiple names exist', () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const jpg = new Uint8Array([0xff, 0xd8, 0xff]);
    const jpeg = new Uint8Array([0xff, 0xd8, 0xee]);
    const both = buildSngContainer(
      [
        { name: 'notes.mid', bytes: buildMidi(chart) },
        { name: 'song.ogg', bytes: audio.bytes },
        { name: 'album.png', bytes: png },
        { name: 'album.jpg', bytes: jpg },
        { name: 'album.jpeg', bytes: jpeg },
        { name: 'gp2sng.json', bytes: encodeSessionBlob(sampleBlob()) },
      ],
      [],
      new Uint8Array(16),
    );

    const restored = readSngSession(both);
    expect(restored.albumArt?.extension).toBe('png');
    expect(Array.from(restored.albumArt?.bytes ?? [])).toEqual(Array.from(png));
  });

  it('prefers album.jpg over album.jpeg', () => {
    const jpg = new Uint8Array([0xff, 0xd8, 0xff]);
    const jpeg = new Uint8Array([0xff, 0xd8, 0xee]);
    const sng = buildSngContainer(
      [
        { name: 'notes.mid', bytes: buildMidi(chart) },
        { name: 'song.ogg', bytes: audio.bytes },
        { name: 'album.jpg', bytes: jpg },
        { name: 'album.jpeg', bytes: jpeg },
        { name: 'gp2sng.json', bytes: encodeSessionBlob(sampleBlob()) },
      ],
      [],
      new Uint8Array(16),
    );

    const restored = readSngSession(sng);
    expect(restored.albumArt?.extension).toBe('jpg');
    expect(Array.from(restored.albumArt?.bytes ?? [])).toEqual(Array.from(jpg));
  });

  it('restores a session with no artwork as before', () => {
    const restored = readSngSession(writeSng(chart, metadata, audio, -120, sampleBlob()));

    expect(restored.albumArt).toBeUndefined();
  });

  it('leaves notes.mid and the audio file untouched', () => {
    const sng = readSng(writeSng(chart, metadata, audio, 0, sampleBlob()));
    const drums = readMidi(sng.files['notes.mid']).tracks.find((t) => t.name === 'PART DRUMS');
    expect(drums?.notes).toHaveLength(1);
    expect(Array.from(sng.files['song.ogg'])).toEqual([1, 2, 3, 4]);
  });

  it('refuses a .sng that carries no session blob', () => {
    const foreign = buildSngContainer(
      [
        { name: 'notes.mid', bytes: buildMidi(chart) },
        { name: 'song.ogg', bytes: audio.bytes },
      ],
      [['name', 'Song']],
      new Uint8Array(16),
    );
    expect(() => readSngSession(foreign)).toThrow(SessionRestoreError);
  });

  it('refuses a .sng with no bundled audio', () => {
    const noAudio = writeSng(chart, metadata, undefined, 0, sampleBlob());
    expect(() => readSngSession(noAudio)).toThrow(SessionRestoreError);
  });

  // Regression: the reader used to whitelist mp3/ogg/opus/wav, but the Preview
  // picker's `audio/*` accept clause lets the browser decode (and the writer emit)
  // other extensions too — e.g. flac. A GP2SNG-produced .sng must still reopen.
  it('reopens a .sng whose bundled audio extension is outside the original four', () => {
    const flac = { bytes: new Uint8Array([9, 8, 7, 6]), extension: 'flac' };
    const restored = readSngSession(writeSng(chart, metadata, flac, -120, sampleBlob()));
    expect(Array.from(restored.audioBytes)).toEqual([9, 8, 7, 6]);
  });

  it('refuses bytes that are not a .sng at all', () => {
    expect(() => readSngSession(new Uint8Array([0, 1, 2, 3]))).toThrow(SessionRestoreError);
  });
});
