// End-to-end integration test (docs/INTRO.md Task 22, docs/DESIGN.md → Test
// strategy → Integration tests): parse the real tests/fixtures/example.gp, map,
// convert, write .sng bytes, then read them back through GP2SNG's own SNG/MIDI
// readers and assert on the decoded STRUCTURE — notes/flags, sections,
// metadata, bundled-audio presence — rather than raw bytes. This is the one
// test that crosses shared/gp → shared/midi → shared/convert → shared/sng with
// no process boundary.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { convertToYargChart, tickToSeconds } from '../src/shared/convert/index';
import { parseGp } from '../src/shared/gp/index';
import { applyRemap } from '../src/shared/midi/index';
import { readMidi, readSng, readSngSession, writeSng } from '../src/shared/sng/index';
import {
  DEFAULT_CONVERSION_SETTINGS,
  DEFAULT_MIDI_MAP,
  SESSION_BLOB_VERSION,
  type SessionBlob,
  type SongMetadata,
} from '../src/shared/types/index';

const exampleBytes = new Uint8Array(
  readFileSync(fileURLToPath(new URL('./fixtures/example.gp', import.meta.url))),
);

// Stands in for the values the user fills on the preview screen.
const metadata: SongMetadata = {
  name: 'Example Song',
  artist: 'The Testers',
  album: 'Fixtures',
  genre: 'Metal',
  year: '2026',
  charter: 'Maximus via GP2SNG',
  drumsDifficulty: 5,
};

// Stands in for a user-supplied audio file bundled via "Add Audio".
const audio = { bytes: Uint8Array.from([0xff, 0x00, 0x13, 0x37]), extension: 'OGG' };

// parse → map → convert → write → read back.
const score = parseGp(exampleBytes);
const { chart, warnings } = convertToYargChart(score, score.tracks[0].id, DEFAULT_MIDI_MAP);

// The blob is opaque to most of these tests — they assert container and MIDI
// structure — but writeSng requires one, so this is the minimum well-formed value.
// gpBytes is the real fixture so the round-trip test below means something.
function session(): SessionBlob {
  return {
    version: SESSION_BLOB_VERSION,
    gpFilePath: 'C:/songs/song.gp',
    gpBytes: exampleBytes,
    selectedTrackId: 0,
    sessionMap: DEFAULT_MIDI_MAP,
    sessionSettings: DEFAULT_CONVERSION_SETTINGS,
    chart,
    warnings: [],
    overrides: [],
    deletions: [],
    previewRemaps: [],
    metadata,
    audioOffsetMs: 0,
    audioPaddingMs: 0,
  };
}

const sng = readSng(writeSng(chart, metadata, audio, -120, session()));
const midi = readMidi(sng.files['notes.mid']);
const drums = midi.tracks.find((t) => t.name === 'PART DRUMS');
const events = midi.tracks.find((t) => t.name === 'EVENTS');

if (!drums || !events) throw new Error('expected PART DRUMS and EVENTS tracks');

describe('GP → SNG pipeline (integration)', () => {
  it('bundles notes.mid and the supplied audio at the song.<ext> slot', () => {
    expect('notes.mid' in sng.files).toBe(true);
    expect([...sng.files['song.ogg']]).toEqual([0xff, 0x00, 0x13, 0x37]);
  });

  it('writes the full metadata set with computed song_length and delay', () => {
    expect(sng.metadata).toMatchObject({
      name: 'Example Song',
      artist: 'The Testers',
      album: 'Fixtures',
      genre: 'Metal',
      year: '2026',
      charter: 'Maximus via GP2SNG',
      pro_drums: 'True',
      diff_drums: '5',
      diff_drums_real: '5',
      // delay carries only the user's A/V offset; the lead-in lives in the bundled
      // audio, not in this metadata key (docs/DESIGN.md → Timing model → Lead-in).
      delay: '-120',
    });
    const songLength = Number(sng.metadata.song_length);
    expect(Number.isInteger(songLength)).toBe(true);
    // song_length spans the lead-in as well as the music.
    expect(songLength).toBeGreaterThan(
      tickToSeconds(chart.endTick - chart.leadInTicks, chart.tempoMap, chart.resolution) * 1000,
    );
  });

  it('carries a 480-PPQ MIDI with the tempo and time-signature map', () => {
    expect(midi.division).toBe(480);
    expect(midi.tempos.some((t) => t.usPerQuarter === Math.round(60_000_000 / 140))).toBe(true);
    expect(midi.tempos.some((t) => t.usPerQuarter === Math.round(60_000_000 / 180))).toBe(true);
    const sigs = midi.timeSignatures.map((s) => `${s.numerator}/${s.denominator}`);
    expect(sigs).toEqual(expect.arrayContaining(['4/4', '3/4', '7/8']));
  });

  it('enables chart dynamics on PART DRUMS', () => {
    expect(drums.texts.some((t) => t.text === '[ENABLE_CHART_DYNAMICS]')).toBe(true);
  });

  it('emits gems and Pro-Drums tom markers matching the default map', () => {
    // Default map routes the fixture's MIDI into every lane but yellow tom.
    const gems = new Set(drums.notes.filter((n) => n.note < 110).map((n) => n.note));
    expect(gems).toEqual(new Set([96, 97, 98, 99, 100]));
    // Tom markers: blueTom (47) and greenTom (43/45); no yellow tom in the fixture.
    const markers = new Set(drums.notes.filter((n) => n.note >= 110).map((n) => n.note));
    expect(markers).toEqual(new Set([111, 112]));
    // Note-ons are ordered by tick.
    const ticks = drums.notes.map((n) => n.tick);
    for (let i = 1; i < ticks.length; i++) expect(ticks[i]).toBeGreaterThanOrEqual(ticks[i - 1]);
  });

  it('encodes ghost and accent as velocities 1 and 127, kick always neutral', () => {
    const gems = drums.notes.filter((n) => n.note < 110);
    expect(gems.some((n) => n.velocity === 1)).toBe(true); // ghost
    expect(gems.some((n) => n.velocity === 127)).toBe(true); // accent
    for (const n of drums.notes.filter((n) => n.note === 96)) expect(n.velocity).toBe(100); // kick
  });

  it('writes the 12 GP sections as [section …] events in order', () => {
    const sections = events.texts.filter((t) => t.text.startsWith('[section '));
    expect(sections).toHaveLength(12);
    expect(sections[0].text).toBe('[section Standard]');
    expect(sections.map((s) => s.text)).toContain('[section Section with a Letter A]');
    for (let i = 1; i < sections.length; i++) {
      expect(sections[i].tick).toBeGreaterThan(sections[i - 1].tick);
    }
  });

  it('reports no unmapped or direction-sign warnings for the clean fixture', () => {
    // All 11 distinct MIDI numbers are in the default map; the fixture has no
    // direction signs. (Its tempo automations are step changes, not ramps.)
    expect(warnings.some((w) => w.kind === 'unmappedNotesDropped')).toBe(false);
    expect(warnings.some((w) => w.kind === 'directionSignsUnsupported')).toBe(false);
  });

  it('routes a session remap through the whole pipeline (MIDI 42 → yellow tom)', () => {
    // Under the default map MIDI 42 is a yellow cymbal, so the yellow-tom marker
    // (110) never appears.
    expect(drums.notes.every((n) => n.note !== 110)).toBe(true);
    // Remapping 42 to yellow tom must surface that marker in the final .sng.
    const remapped = applyRemap(DEFAULT_MIDI_MAP, 42, 'yellowTom');
    const res = convertToYargChart(score, score.tracks[0].id, remapped);
    const rmidi = readMidi(
      readSng(writeSng(res.chart, metadata, undefined, 0, session())).files['notes.mid'],
    );
    const rdrums = rmidi.tracks.find((t) => t.name === 'PART DRUMS');
    expect(rdrums?.notes.some((n) => n.note === 110)).toBe(true);
  });
});

describe('session blob round trip', () => {
  it('carries the GP file through a .sng and re-parses to an identical score', () => {
    const restored = readSngSession(writeSng(chart, metadata, audio, -120, session()));
    expect(Array.from(restored.blob.gpBytes)).toEqual(Array.from(exampleBytes));
    expect(parseGp(restored.blob.gpBytes)).toEqual(score);
  });
});
