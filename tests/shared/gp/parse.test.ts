import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { parseGp } from '../../../src/shared/gp/index';
import type { GpNote } from '../../../src/shared/types/index';

const exampleBytes = new Uint8Array(
  readFileSync(fileURLToPath(new URL('../../fixtures/example.gp', import.meta.url))),
);
const score = parseGp(exampleBytes);

function allNotes(): GpNote[] {
  const out: GpNote[] = [];
  for (const bar of score.tracks[0].bars) {
    for (const voice of bar.voices) {
      for (const beat of voice.beats) out.push(...beat.notes);
    }
  }
  return out;
}

describe('parseGp — metadata', () => {
  it('reads the (empty) Score fields without crashing', () => {
    expect(score.metadata).toEqual({
      title: '',
      subtitle: '',
      artist: '',
      album: '',
      copyright: '',
      tabber: '',
    });
  });
});

describe('parseGp — tempo automations', () => {
  it('normalizes both tempo automations to quarter-note BPM', () => {
    expect(score.tempoAutomations).toEqual([
      { bar: 0, position: 0, bpm: 140, linear: false },
      { bar: 4, position: 0, bpm: 180, linear: false },
    ]);
  });
});

describe('parseGp — master bars', () => {
  it('reads 25 master bars', () => {
    expect(score.masterBars).toHaveLength(25);
  });

  it('reads time signatures including the 3/4 and 7/8 bars', () => {
    expect(score.masterBars[0].timeSignature).toEqual({ numerator: 4, denominator: 4 });
    expect(score.masterBars[8].timeSignature).toEqual({ numerator: 3, denominator: 4 });
    expect(score.masterBars[10].timeSignature).toEqual({ numerator: 7, denominator: 8 });
  });

  it('reads 12 sections, preferring Text over Letter', () => {
    const named = score.masterBars.filter((mb) => mb.section !== null);
    expect(named).toHaveLength(12);
    expect(score.masterBars[0].section).toBe('Standard');
    expect(score.masterBars[4].section).toBe('Tempo Change');
    expect(score.masterBars[23].section).toBe('Section with a Letter A');
    expect(score.masterBars[1].section).toBeNull();
  });

  it('reads repeats and alternate endings', () => {
    expect(score.masterBars[12].repeatStart).toBe(true);
    expect(score.masterBars[12].repeatCount).toBe(2);
    expect(score.masterBars[13].repeatEnd).toBe(true);
    expect(score.masterBars[15].alternateEndings).toEqual([1, 2, 3]);
    expect(score.masterBars[16].alternateEndings).toEqual([4]);
    expect(score.masterBars[0].alternateEndings).toEqual([]);
  });

  it('flags no direction signs (fixture has none)', () => {
    expect(score.masterBars.every((mb) => mb.hasDirections === false)).toBe(true);
  });
});

describe('parseGp — tracks & notes', () => {
  it('finds exactly one drum-kit track named Drumkit', () => {
    expect(score.tracks).toHaveLength(1);
    expect(score.tracks[0]).toMatchObject({ id: 0, name: 'Drumkit', isDrumKit: true });
  });

  it('aligns one bar per master bar', () => {
    expect(score.tracks[0].bars).toHaveLength(25);
  });

  it('emits 195 note events (tie destination skipped) and reports the count', () => {
    const notes = allNotes();
    expect(notes).toHaveLength(195);
    expect(score.tracks[0].noteCount).toBe(195);
  });

  it('marks 21 ghost notes (AntiAccent or grace) and 8 accents', () => {
    const notes = allNotes();
    expect(notes.filter((n) => n.ghost)).toHaveLength(21);
    expect(notes.filter((n) => n.accent)).toHaveLength(8);
  });

  it('preserves the distinct input MIDI numbers', () => {
    const distinct = [...new Set(allNotes().map((n) => n.midi))].sort((a, b) => a - b);
    expect(distinct).toEqual([36, 38, 42, 43, 45, 46, 47, 49, 51, 52, 57]);
  });

  it('records 6 rest beats (beats with no notes)', () => {
    let rests = 0;
    for (const bar of score.tracks[0].bars)
      for (const voice of bar.voices)
        for (const beat of voice.beats) if (beat.notes.length === 0) rests++;
    expect(rests).toBe(6);
  });

  it('computes tuplet and dotted durations as reduced fractions', () => {
    const durations = new Set<string>();
    for (const bar of score.tracks[0].bars)
      for (const voice of bar.voices)
        for (const beat of voice.beats) durations.add(`${beat.durationNum}/${beat.durationDen}`);
    expect(durations).toContain('1/12'); // eighth triplet
    expect(durations).toContain('3/16'); // dotted eighth
    expect(durations).toContain('3/8'); // dotted quarter
  });
});

describe('parseGp — GP8 acceptance', () => {
  // GP8 shares GP7's container and schema (AlphaTab's single Gp7To8Importer);
  // we accept it unverified against a real file. A minimal GPIF is enough to
  // prove the version/encoding gates let GP8 through.
  const emptyScore = {
    metadata: { title: '', subtitle: '', artist: '', album: '', copyright: '', tabber: '' },
    tempoAutomations: [],
    masterBars: [],
    tracks: [],
  };

  it('accepts an 8.x VERSION', () => {
    const gpif = '<GPIF><Encoding><EncodingDescription>GP8</EncodingDescription></Encoding></GPIF>';
    const archive = zipSync({ VERSION: strToU8('8.0'), 'Content/score.gpif': strToU8(gpif) });
    expect(parseGp(archive)).toEqual(emptyScore);
  });

  it('accepts a GP8 encoding', () => {
    const gpif = '<GPIF><Encoding><EncodingDescription>GP8</EncodingDescription></Encoding></GPIF>';
    const archive = zipSync({ VERSION: strToU8('7.0'), 'Content/score.gpif': strToU8(gpif) });
    expect(parseGp(archive)).toEqual(emptyScore);
  });
});

describe('parseGp — errors', () => {
  it('rejects an unsupported version', () => {
    const archive = zipSync({ VERSION: strToU8('5.0'), 'Content/score.gpif': strToU8('<GPIF/>') });
    expect(() => parseGp(archive)).toThrow(/Unsupported GP version/);
  });

  it('rejects an unsupported encoding', () => {
    const gpif = '<GPIF><Encoding><EncodingDescription>GP6</EncodingDescription></Encoding></GPIF>';
    const archive = zipSync({ VERSION: strToU8('7.0'), 'Content/score.gpif': strToU8(gpif) });
    expect(() => parseGp(archive)).toThrow(/Unsupported encoding/);
  });

  it('rejects bytes that are not a ZIP archive', () => {
    expect(() => parseGp(new Uint8Array([0, 1, 2]))).toThrow(/valid GP archive/);
  });
});
