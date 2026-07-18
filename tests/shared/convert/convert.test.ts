import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { convertToYargChart, detectOverlaps } from '../../../src/shared/convert/index';
import { parseGp } from '../../../src/shared/gp/index';
import { setRideBellAndHiHatAccented } from '../../../src/shared/midi/index';
import {
  BASE_YARG_NOTES,
  type ConversionSettings,
  DEFAULT_CONVERSION_SETTINGS,
  DEFAULT_MIDI_MAP,
  type GpBar,
  type MidiMap,
  type ParsedGpScore,
} from '../../../src/shared/types/index';

const bytes = new Uint8Array(
  readFileSync(fileURLToPath(new URL('../../fixtures/example.gp', import.meta.url))),
);
const score = parseGp(bytes);
const { chart, warnings } = convertToYargChart(score, 0, DEFAULT_MIDI_MAP);

describe('convertToYargChart — structure', () => {
  it('produces a 480-PPQ chart with notes', () => {
    expect(chart.resolution).toBe(480);
    expect(chart.notes.length).toBeGreaterThan(0);
    expect(chart.endTick).toBeGreaterThan(0);
  });

  it('emits every note into a valid base YARG lane, sorted by tick', () => {
    for (const n of chart.notes) expect(BASE_YARG_NOTES).toContain(n.note);
    for (let i = 1; i < chart.notes.length; i++) {
      expect(chart.notes[i].tick).toBeGreaterThanOrEqual(chart.notes[i - 1].tick);
    }
  });

  it('carries the 12 sections with the right names at increasing ticks', () => {
    expect(chart.sections).toHaveLength(12);
    expect(chart.sections[0].name).toBe('Standard');
    expect(chart.sections.map((s) => s.name)).toContain('Section with a Letter A');
    for (let i = 1; i < chart.sections.length; i++) {
      expect(chart.sections[i].tick).toBeGreaterThan(chart.sections[i - 1].tick);
    }
  });

  it('builds the tempo map from both automations (140 then 180 BPM)', () => {
    expect(chart.tempoMap[0]).toEqual({ tick: 0, usPerQuarter: Math.round(60000000 / 140) });
    expect(chart.tempoMap.some((t) => t.usPerQuarter === Math.round(60000000 / 180))).toBe(true);
  });

  it('records the 4/4, 3/4 and 7/8 signatures', () => {
    const sigs = chart.timeSignatures.map((s) => `${s.numerator}/${s.denominator}`);
    expect(sigs).toContain('4/4');
    expect(sigs).toContain('3/4');
    expect(sigs).toContain('7/8');
  });

  it('produces tom notes (default map maps 47->blueTom, 43/45->greenTom)', () => {
    expect(chart.notes.some((n) => n.note === 'blueTom')).toBe(true);
    expect(chart.notes.some((n) => n.note === 'greenTom')).toBe(true);
  });

  it('produces ghost and accent dynamics', () => {
    expect(chart.notes.some((n) => n.dynamic === 'ghost')).toBe(true);
    expect(chart.notes.some((n) => n.dynamic === 'accent')).toBe(true);
  });

  it('marks every kick note neutral', () => {
    for (const n of chart.notes) if (n.note === 'orange') expect(n.dynamic).toBe('neutral');
  });

  it('carries each note back to its source MIDI number', () => {
    // Every emitted note records the GP MIDI number it came from (the preview
    // needs it for the info panel and reassign — docs/DESIGN.md → Chart preview).
    for (const n of chart.notes) expect(Number.isInteger(n.midi)).toBe(true);
    // Kick notes come from the default map's orange row (35 or 36).
    for (const n of chart.notes) if (n.note === 'orange') expect([35, 36]).toContain(n.midi);
  });
});

describe('convertToYargChart — lead-in', () => {
  const LEAD = 2 * 1920; // 2 bars of 4/4 at 480 PPQ

  it('reports the lead-in and starts the first bar after it', () => {
    expect(chart.leadInTicks).toBe(LEAD);
    expect(chart.notes[0].tick).toBeGreaterThanOrEqual(LEAD);
    expect(chart.sections[0].tick).toBe(LEAD);
  });

  it('derives the lead-in from the first bar signature, not an assumed 4/4', () => {
    const s = oneBarScore([{ notes: [{ midi: 38 }] }]);
    s.masterBars[0].timeSignature = { numerator: 7, denominator: 8 };
    const { chart: c } = convertToYargChart(s, 0, DEFAULT_MIDI_MAP);
    expect(c.leadInTicks).toBe(2 * ((7 * 4 * 480) / 8)); // 2 bars of 7/8 = 2 * 1680 = 3360
  });

  it('scales linearly with the setting', () => {
    const s = oneBarScore([{ notes: [{ midi: 38 }] }]);
    for (const bars of [1, 2, 4] as const) {
      const { chart: c } = convertToYargChart(s, 0, DEFAULT_MIDI_MAP, {
        ...DEFAULT_CONVERSION_SETTINGS,
        leadInBars: bars,
      });
      expect(c.leadInTicks).toBe(bars * 1920);
      expect(c.notes[0].tick).toBe(bars * 1920);
    }
  });

  it('governs the lead-in with the song opening tempo, not the 120 BPM fallback', () => {
    // example.gp opens at 140 BPM; the lead-in bars must not silently run at 120.
    expect(chart.tempoMap[0]).toEqual({ tick: 0, usPerQuarter: Math.round(60000000 / 140) });
    expect(chart.tempoMap.filter((e) => e.tick === LEAD)).toHaveLength(0); // no redundant event
  });

  it('governs the lead-in with the first bar time signature and emits no duplicate', () => {
    expect(chart.timeSignatures[0]).toEqual({ tick: 0, numerator: 4, denominator: 4 });
    expect(chart.timeSignatures.filter((s) => s.tick === LEAD)).toHaveLength(0);
  });

  it('grows endTick by the lead-in', () => {
    const s = oneBarScore([{ notes: [{ midi: 38 }] }]);
    const { chart: c } = convertToYargChart(s, 0, DEFAULT_MIDI_MAP);
    expect(c.endTick).toBe(1920 + c.leadInTicks);
  });

  it('lets a grace on the very first beat flam back into the lead-in bars', () => {
    // Without a lead-in this clamped to tick 0 and the flam was lost.
    const s = oneBarScore([{ notes: [{ midi: 42 }], grace: true }, { notes: [{ midi: 38 }] }]);
    const { chart: c } = convertToYargChart(s, 0, DEFAULT_MIDI_MAP);
    expect(c.notes.find((n) => n.note === 'yellowCymbal')?.tick).toBe(c.leadInTicks - 30);
  });
});

describe('convertToYargChart — warnings & errors', () => {
  it('does not warn about direction signs (fixture has none)', () => {
    expect(warnings.some((w) => w.kind === 'directionSignsUnsupported')).toBe(false);
  });

  it('throws when nothing maps', () => {
    const empty: MidiMap = { ...DEFAULT_MIDI_MAP };
    for (const k of Object.keys(empty) as (keyof MidiMap)[]) empty[k] = [];
    expect(() => convertToYargChart(score, 0, empty)).toThrow(/map to any YARG note/);
  });

  it('warns about unmapped dropped notes', () => {
    // Drop 42 (hi-hat) from the map -> it becomes an unmapped, dropped value.
    // (46 lives in yellowCymbalAccented by default, so it is not re-listed here.)
    const noHat: MidiMap = { ...DEFAULT_MIDI_MAP, yellowCymbal: [44, 54] };
    const res = convertToYargChart(score, 0, noHat);
    const w = res.warnings.find((x) => x.kind === 'unmappedNotesDropped');
    expect(w).toBeTruthy();
    expect((w?.context as { midi: number[] }).midi).toContain(42);
  });
});

// A minimal 2-bar score whose two bars form a repeat (played N times), each
// bar carrying its own tempo automation. Lets us assert that tempo changes
// inside a repeated range re-emit on every pass (docs/DESIGN.md → Timing model).
function repeatWithTempos(repeatCount: number): ParsedGpScore {
  const ts = { numerator: 4, denominator: 4 };
  const quarter = (midi: number) => ({
    durationNum: 1,
    durationDen: 4,
    notes: [{ midi, ghost: false, accent: false }],
    isGrace: false,
  });
  const bar = (midi: number): GpBar => ({
    voices: [{ beats: [quarter(midi), quarter(midi), quarter(midi), quarter(midi)] }],
  });
  return {
    metadata: { title: '', subtitle: '', artist: '', album: '', copyright: '', tabber: '' },
    tempoAutomations: [
      { bar: 0, position: 0, bpm: 120, linear: false },
      { bar: 1, position: 0, bpm: 240, linear: false },
    ],
    masterBars: [
      {
        timeSignature: ts,
        section: null,
        repeatStart: true,
        repeatEnd: false,
        repeatCount: 0,
        alternateEndings: [],
        hasDirections: false,
      },
      {
        timeSignature: ts,
        section: null,
        repeatStart: false,
        repeatEnd: true,
        repeatCount,
        alternateEndings: [],
        hasDirections: false,
      },
    ],
    tracks: [{ id: 0, name: 'Drums', isDrumKit: true, noteCount: 8, bars: [bar(36), bar(38)] }],
  };
}

describe('convertToYargChart — tempo across repeats', () => {
  it('re-emits tempo changes on every pass through a repeated range', () => {
    // 2 bars (4/4 → 1920 ticks each) repeated twice, after a 2-bar lead-in: the
    // bars start at ticks 3840, 5760, 7680, 9600. The lead-in's opening-tempo
    // point at tick 0 makes the (equal) 120 BPM event at 3840 redundant, so it
    // collapses.
    const res = convertToYargChart(repeatWithTempos(2), 0, DEFAULT_MIDI_MAP);
    const us120 = Math.round(60_000_000 / 120);
    const us240 = Math.round(60_000_000 / 240);
    expect(res.chart.tempoMap).toEqual([
      { tick: 0, usPerQuarter: us120 },
      { tick: 5760, usPerQuarter: us240 },
      { tick: 7680, usPerQuarter: us120 }, // 2nd pass: tempo must reset to 120
      { tick: 9600, usPerQuarter: us240 },
    ]);
  });
});

describe('detectOverlaps', () => {
  it('returns an array (0+ three-hand-note warnings) for the fixture', () => {
    const w = detectOverlaps(score.tracks[0], DEFAULT_MIDI_MAP);
    expect(Array.isArray(w)).toBe(true);
    for (const x of w) expect(x.kind).toBe('threeHandNotes');
  });
});

// A single 4/4 bar whose one voice carries the given beats, with optional tempo
// automations and a directions flag. Each beat defaults to a quarter note; set
// `grace: true` for a grace beat. Lets each conversion path be triggered in
// isolation (docs/DESIGN.md → Error handling, Timing model → grace notes), which
// the fixture only exercises incidentally.
type NoteSpec = { midi: number; ghost?: boolean; accent?: boolean };
type BeatSpec = { notes: NoteSpec[]; grace?: boolean; num?: number; den?: number };

function oneBarScore(
  beats: BeatSpec[],
  opts: { tempoAutomations?: ParsedGpScore['tempoAutomations']; hasDirections?: boolean } = {},
): ParsedGpScore {
  return {
    metadata: { title: '', subtitle: '', artist: '', album: '', copyright: '', tabber: '' },
    tempoAutomations: opts.tempoAutomations ?? [],
    masterBars: [
      {
        timeSignature: { numerator: 4, denominator: 4 },
        section: null,
        repeatStart: false,
        repeatEnd: false,
        repeatCount: 0,
        alternateEndings: [],
        hasDirections: opts.hasDirections ?? false,
      },
    ],
    tracks: [
      {
        id: 0,
        name: 'Drums',
        isDrumKit: true,
        noteCount: beats.reduce((n, b) => n + b.notes.length, 0),
        bars: [
          {
            voices: [
              {
                beats: beats.map((b) => ({
                  durationNum: b.num ?? 1,
                  durationDen: b.den ?? 4,
                  isGrace: b.grace ?? false,
                  notes: b.notes.map((n) => ({
                    midi: n.midi,
                    // The parser forces grace notes to ghost (tracks.ts); mirror it here.
                    ghost: (n.ghost ?? false) || (b.grace ?? false),
                    accent: n.accent ?? false,
                  })),
                })),
              },
            ],
          },
        ],
      },
    ],
  };
}

describe('convertToYargChart — same-YARG-note collision', () => {
  it('merges two MIDI notes landing on one YARG note/tick, keeping the stronger dynamic', () => {
    // 31 and 40 both map to red in the default map; stack them on one beat.
    const s = oneBarScore([{ notes: [{ midi: 31 }, { midi: 40, accent: true }] }]);
    const { chart, warnings } = convertToYargChart(s, 0, DEFAULT_MIDI_MAP);
    const red = chart.notes.filter((n) => n.note === 'red');
    expect(red).toHaveLength(1); // merged to one note, not two stacked at the same tick
    expect(red[0].dynamic).toBe('accent'); // accent (rank 2) wins over neutral (rank 1)
    const w = warnings.find((x) => x.kind === 'yargNoteCollision');
    expect(w).toBeTruthy();
    expect((w?.context as { note: string }).note).toBe('red');
  });

  it('keeps neutral over ghost when merging a collision', () => {
    // 38 and 40 both map to red; 38 is a pad ghost (kept as ghost), 40 neutral.
    const s = oneBarScore([{ notes: [{ midi: 38, ghost: true }, { midi: 40 }] }]);
    const { chart } = convertToYargChart(s, 0, DEFAULT_MIDI_MAP);
    const red = chart.notes.filter((n) => n.note === 'red');
    expect(red).toHaveLength(1);
    expect(red[0].dynamic).toBe('neutral'); // neutral (rank 1) wins over ghost (rank 0)
  });
});

describe('convertToYargChart — warning paths', () => {
  it('keeps the accent when a ghost note is also mapped to an accented row', () => {
    // 38 lives in the accented red row (an accented-cymbal identity such as a
    // ride bell) and is authored as a GP ghost. Accent wins over ghost so the
    // accented-row identity survives; the conflict is silent (no warning).
    const map: MidiMap = {
      ...DEFAULT_MIDI_MAP,
      red: [31, 33, 37, 39, 40, 56, 91],
      redAccented: [38],
    };
    const s = oneBarScore([{ notes: [{ midi: 38, ghost: true }] }]);
    const { chart, warnings } = convertToYargChart(s, 0, map);
    expect(chart.notes.find((n) => n.note === 'red')?.dynamic).toBe('accent');
    expect(warnings).toHaveLength(0);
  });

  it('interpolates a linear tempo ramp into stepped events (no flatten warning)', () => {
    const ts = { numerator: 4, denominator: 4 };
    const kickBar = (): GpBar => ({
      voices: [
        {
          beats: [
            {
              durationNum: 1,
              durationDen: 4,
              isGrace: false,
              notes: [{ midi: 36, ghost: false, accent: false }],
            },
          ],
        },
      ],
    });
    const s: ParsedGpScore = {
      metadata: { title: '', subtitle: '', artist: '', album: '', copyright: '', tabber: '' },
      tempoAutomations: [
        { bar: 0, position: 0, bpm: 120, linear: true },
        { bar: 1, position: 0, bpm: 240, linear: false },
      ],
      masterBars: [
        {
          timeSignature: ts,
          section: null,
          repeatStart: false,
          repeatEnd: false,
          repeatCount: 0,
          alternateEndings: [],
          hasDirections: false,
        },
        {
          timeSignature: ts,
          section: null,
          repeatStart: false,
          repeatEnd: false,
          repeatCount: 0,
          alternateEndings: [],
          hasDirections: false,
        },
      ],
      tracks: [
        { id: 0, name: 'Drums', isDrumKit: true, noteCount: 2, bars: [kickBar(), kickBar()] },
      ],
    };
    const { chart, warnings } = convertToYargChart(s, 0, DEFAULT_MIDI_MAP);
    // The ramp from the first bar (120 BPM, tick 3840 after the 2-bar lead-in) to
    // the second (240 BPM, tick 5760) becomes many steps.
    expect(chart.tempoMap.filter((e) => e.tick >= 3840 && e.tick < 5760).length).toBeGreaterThan(1);
    for (let i = 1; i < chart.tempoMap.length; i++) {
      expect(chart.tempoMap[i].usPerQuarter).toBeLessThanOrEqual(
        chart.tempoMap[i - 1].usPerQuarter,
      );
    }
    // Clean, fully-mapped score → no warnings (the flatten warning is gone).
    expect(warnings).toHaveLength(0);
  });

  it('warns (directionSignsUnsupported) when the score uses direction signs', () => {
    const s = oneBarScore([{ notes: [{ midi: 36 }] }], { hasDirections: true });
    const { warnings } = convertToYargChart(s, 0, DEFAULT_MIDI_MAP);
    expect(warnings.some((w) => w.kind === 'directionSignsUnsupported')).toBe(true);
  });
});

describe('convertToYargChart — ghost-note toggles', () => {
  const ghostOn = (note: 'red' | 'yellowTom' | 'yellowCymbal', settings: ConversionSettings) => {
    const midi = { red: 38, yellowTom: 48, yellowCymbal: 42 }[note];
    const s = oneBarScore([{ notes: [{ midi, ghost: true }] }]);
    const { chart } = convertToYargChart(s, 0, DEFAULT_MIDI_MAP, settings);
    return chart.notes.find((n) => n.note === note)?.dynamic;
  };

  it('keeps a snare ghost by default and drops it when snare ghosts are off', () => {
    expect(ghostOn('red', DEFAULT_CONVERSION_SETTINGS)).toBe('ghost');
    expect(ghostOn('red', { ...DEFAULT_CONVERSION_SETTINGS, snareGhostNotes: false })).toBe(
      'neutral',
    );
  });

  it('drops a tom ghost by default and keeps it when tom ghosts are on', () => {
    expect(ghostOn('yellowTom', DEFAULT_CONVERSION_SETTINGS)).toBe('neutral');
    expect(ghostOn('yellowTom', { ...DEFAULT_CONVERSION_SETTINGS, tomGhostNotes: true })).toBe(
      'ghost',
    );
  });

  it('drops a cymbal ghost by default and keeps it when cymbal ghosts are on', () => {
    expect(ghostOn('yellowCymbal', DEFAULT_CONVERSION_SETTINGS)).toBe('neutral');
    expect(
      ghostOn('yellowCymbal', { ...DEFAULT_CONVERSION_SETTINGS, cymbalGhostNotes: true }),
    ).toBe('ghost');
  });

  it('gates the three kinds independently — snare on, toms off, cymbals off', () => {
    const s = { ...DEFAULT_CONVERSION_SETTINGS, snareGhostNotes: true };
    expect(ghostOn('red', s)).toBe('ghost');
    expect(ghostOn('yellowTom', s)).toBe('neutral');
    expect(ghostOn('yellowCymbal', s)).toBe('neutral');
  });

  it('leaves a ghosted kick neutral regardless of the toggles', () => {
    const s = oneBarScore([{ notes: [{ midi: 36, ghost: true }] }]);
    const { chart } = convertToYargChart(s, 0, DEFAULT_MIDI_MAP, {
      ...DEFAULT_CONVERSION_SETTINGS,
      snareGhostNotes: true,
      tomGhostNotes: true,
      cymbalGhostNotes: true,
    });
    expect(chart.notes.find((n) => n.note === 'orange')?.dynamic).toBe('neutral');
  });
});

describe('convertToYargChart — accent-note toggles', () => {
  const accentOn = (note: 'red' | 'yellowTom' | 'greenCymbal', settings: ConversionSettings) => {
    const midi = { red: 38, yellowTom: 48, greenCymbal: 52 }[note];
    const s = oneBarScore([{ notes: [{ midi, accent: true }] }]);
    const { chart } = convertToYargChart(s, 0, DEFAULT_MIDI_MAP, settings);
    return chart.notes.find((n) => n.note === note)?.dynamic;
  };

  it('keeps a snare accent by default and drops it when snare accents are off', () => {
    expect(accentOn('red', DEFAULT_CONVERSION_SETTINGS)).toBe('accent');
    expect(accentOn('red', { ...DEFAULT_CONVERSION_SETTINGS, snareAccentedNotes: false })).toBe(
      'neutral',
    );
  });

  it('drops a tom accent by default and keeps it when tom accents are on', () => {
    expect(accentOn('yellowTom', DEFAULT_CONVERSION_SETTINGS)).toBe('neutral');
    expect(accentOn('yellowTom', { ...DEFAULT_CONVERSION_SETTINGS, tomAccentedNotes: true })).toBe(
      'accent',
    );
  });

  it('drops a green cymbal accent by default and keeps it when cymbal accents are on', () => {
    // With "Accent ride bell & open hi-hat" on (the default map), green is the only
    // cymbal a GP accent can promote — yellow/blue are suppressed regardless.
    expect(accentOn('greenCymbal', DEFAULT_CONVERSION_SETTINGS)).toBe('neutral');
    expect(
      accentOn('greenCymbal', { ...DEFAULT_CONVERSION_SETTINGS, cymbalAccentedNotes: true }),
    ).toBe('accent');
  });

  it('never gates an accented-row note — the toggle only suppresses GP accents', () => {
    // 91 lives in redAccented (row identity, no GP accent). snareAccentedNotes off
    // must NOT de-accent it.
    const s = oneBarScore([{ notes: [{ midi: 91 }] }]);
    const { chart } = convertToYargChart(s, 0, DEFAULT_MIDI_MAP, {
      ...DEFAULT_CONVERSION_SETTINGS,
      snareAccentedNotes: false,
    });
    expect(chart.notes.find((n) => n.note === 'red')?.dynamic).toBe('accent');
  });
});

describe('detectOverlaps — three hand notes', () => {
  it('warns when three non-kick notes share a beat', () => {
    // snare(38) + hi-hat(42) + ride(49): three hand notes on one beat.
    const s = oneBarScore([{ notes: [{ midi: 38 }, { midi: 42 }, { midi: 49 }] }]);
    const w = detectOverlaps(s.tracks[0], DEFAULT_MIDI_MAP);
    expect(w).toHaveLength(1);
    expect(w[0].kind).toBe('threeHandNotes');
    expect((w[0].context as { bar: number }).bar).toBe(1);
  });

  it('does not warn when a kick shares the beat with only two hand notes', () => {
    // kick(36) + snare(38) + hi-hat(42): the kick is not a hand note.
    const s = oneBarScore([{ notes: [{ midi: 36 }, { midi: 38 }, { midi: 42 }] }]);
    expect(detectOverlaps(s.tracks[0], DEFAULT_MIDI_MAP)).toHaveLength(0);
  });
});

describe('convertToYargChart — grace notes (flam placement)', () => {
  const LEAD = 2 * 1920; // the default 2-bar lead-in shifts every absolute tick

  it('places a same-lane grace as a distinct ghost one 64th before the beat (default)', () => {
    // A ghost grace-snare leading into a snare hit on beat 2 (tick 480). Without
    // flam placement the two collide on one tick and the grace vanishes.
    const s = oneBarScore([
      { notes: [{ midi: 36 }] }, // kick on beat 1 (advances the cursor to tick 480)
      { notes: [{ midi: 38 }], grace: true }, // grace snare
      { notes: [{ midi: 38 }] }, // primary snare on beat 2
    ]);
    const { chart } = convertToYargChart(s, 0, DEFAULT_MIDI_MAP);
    const reds = chart.notes.filter((n) => n.note === 'red').sort((a, b) => a.tick - b.tick);
    expect(reds).toHaveLength(2); // grace survives as its own note
    expect(reds[0]).toMatchObject({ tick: LEAD + 450, dynamic: 'ghost' }); // 480 − 30 (a 64th)
    expect(reds[1]).toMatchObject({ tick: LEAD + 480, dynamic: 'neutral' });
  });

  it('staggers a drag (two grace notes) into ordered, distinct ticks', () => {
    const s = oneBarScore([
      { notes: [{ midi: 36 }] }, // kick on beat 1
      { notes: [{ midi: 38 }], grace: true }, // grace 1 (played first, furthest back)
      { notes: [{ midi: 38 }], grace: true }, // grace 2 (nearer the beat)
      { notes: [{ midi: 38 }] }, // primary snare on beat 2 (tick 480)
    ]);
    const { chart } = convertToYargChart(s, 0, DEFAULT_MIDI_MAP);
    const reds = chart.notes.filter((n) => n.note === 'red').sort((a, b) => a.tick - b.tick);
    expect(reds.map((n) => n.tick)).toEqual([LEAD + 420, LEAD + 450, LEAD + 480]); // 480−60, 480−30, 480
    expect(reds[0].dynamic).toBe('ghost');
    expect(reds[2].dynamic).toBe('neutral');
  });

  it('honors the 32nd-note spacing setting (60 ticks before the beat)', () => {
    const s = oneBarScore([
      { notes: [{ midi: 36 }] },
      { notes: [{ midi: 38 }], grace: true },
      { notes: [{ midi: 38 }] },
    ]);
    const { chart } = convertToYargChart(s, 0, DEFAULT_MIDI_MAP, {
      ...DEFAULT_CONVERSION_SETTINGS,
      graceNoteSpacing: '32nd',
    });
    const reds = chart.notes.filter((n) => n.note === 'red').sort((a, b) => a.tick - b.tick);
    expect(reds[0].tick).toBe(LEAD + 420); // 480 − 60 (a 32nd)
  });
});

describe('convertToYargChart — strict accented yellow/blue cymbals (checkbox on)', () => {
  // The default map is the checkbox-on state (46/92 in yellowCymbalAccented,
  // 53/127 in blueCymbalAccented), so accented yellow = open hi-hat and accented
  // blue = ride bell. A GP accent on any OTHER yellow/blue cymbal must not promote.

  it('does not accent a GP-accented closed hi-hat (42 stays a neutral yellow cymbal)', () => {
    const s = oneBarScore([{ notes: [{ midi: 42, accent: true }] }]);
    const { chart } = convertToYargChart(s, 0, DEFAULT_MIDI_MAP);
    expect(chart.notes.find((n) => n.note === 'yellowCymbal')?.dynamic).toBe('neutral');
  });

  it('accents open hi-hat (46) and half hi-hat (92) via their row, without a GP accent', () => {
    const s = oneBarScore([{ notes: [{ midi: 46 }] }, { notes: [{ midi: 92 }] }]);
    const { chart } = convertToYargChart(s, 0, DEFAULT_MIDI_MAP);
    const yellow = chart.notes.filter((n) => n.note === 'yellowCymbal');
    expect(yellow).toHaveLength(2);
    for (const n of yellow) expect(n.dynamic).toBe('accent');
  });

  it('does not accent a GP-accented ride middle (51 stays a neutral blue cymbal)', () => {
    const s = oneBarScore([{ notes: [{ midi: 51, accent: true }] }]);
    const { chart } = convertToYargChart(s, 0, DEFAULT_MIDI_MAP);
    expect(chart.notes.find((n) => n.note === 'blueCymbal')?.dynamic).toBe('neutral');
  });

  it('accents ride bell (53, 127) via their row, without a GP accent', () => {
    const s = oneBarScore([{ notes: [{ midi: 53 }] }, { notes: [{ midi: 127 }] }]);
    const { chart } = convertToYargChart(s, 0, DEFAULT_MIDI_MAP);
    const blue = chart.notes.filter((n) => n.note === 'blueCymbal');
    expect(blue).toHaveLength(2);
    for (const n of blue) expect(n.dynamic).toBe('accent');
  });

  it('still accents a GP-accented green cymbal (china 52) — green is not suppressed, and promotes once cymbal accents are enabled', () => {
    const s = oneBarScore([{ notes: [{ midi: 52, accent: true }] }]);
    const { chart } = convertToYargChart(s, 0, DEFAULT_MIDI_MAP, {
      ...DEFAULT_CONVERSION_SETTINGS,
      cymbalAccentedNotes: true,
    });
    expect(chart.notes.find((n) => n.note === 'greenCymbal')?.dynamic).toBe('accent');
  });

  it('still accents a GP-accented snare (38) — pads are not suppressed', () => {
    const s = oneBarScore([{ notes: [{ midi: 38, accent: true }] }]);
    const { chart } = convertToYargChart(s, 0, DEFAULT_MIDI_MAP);
    expect(chart.notes.find((n) => n.note === 'red')?.dynamic).toBe('accent');
  });

  it('lets a suppressed cymbal accent fall through to ghost when it is also a ghost', () => {
    // 42 (closed hi-hat) authored as both accent and ghost. The accent is suppressed,
    // and because the note is a ghost and cymbal ghosts are enabled it resolves to
    // ghost (not neutral) — the ghost path is unaffected by suppression.
    const s = oneBarScore([{ notes: [{ midi: 42, accent: true, ghost: true }] }]);
    const { chart } = convertToYargChart(s, 0, DEFAULT_MIDI_MAP, {
      ...DEFAULT_CONVERSION_SETTINGS,
      snareGhostNotes: true,
      cymbalGhostNotes: true,
    });
    expect(chart.notes.find((n) => n.note === 'yellowCymbal')?.dynamic).toBe('ghost');
  });
});

describe('convertToYargChart — accented cymbals when the checkbox is off', () => {
  it('promotes a GP-accented closed hi-hat to an accent yellow cymbal (union rule holds)', () => {
    const off = setRideBellAndHiHatAccented(DEFAULT_MIDI_MAP, false);
    const s = oneBarScore([{ notes: [{ midi: 42, accent: true }] }]);
    const { chart } = convertToYargChart(s, 0, off, {
      ...DEFAULT_CONVERSION_SETTINGS,
      cymbalAccentedNotes: true,
    });
    expect(chart.notes.find((n) => n.note === 'yellowCymbal')?.dynamic).toBe('accent');
  });
});

describe('convertToYargChart — settings object', () => {
  it('honors ghost toggles passed as a settings object', () => {
    const s = oneBarScore([{ notes: [{ midi: 38, ghost: true }] }]);
    const { chart } = convertToYargChart(s, 0, DEFAULT_MIDI_MAP, {
      ...DEFAULT_CONVERSION_SETTINGS,
      snareGhostNotes: false,
    });
    expect(chart.notes.find((n) => n.note === 'red')?.dynamic).toBe('neutral');
  });

  it('defaults to the shipped conversion settings when none are passed', () => {
    const s = oneBarScore([{ notes: [{ midi: 38, ghost: true }] }]);
    const { chart } = convertToYargChart(s, 0, DEFAULT_MIDI_MAP);
    expect(chart.notes.find((n) => n.note === 'red')?.dynamic).toBe('ghost');
  });
});

describe('convertToYargChart — dynamic cymbal selection', () => {
  it('spreads an overlapping accent cymbal onto a free lane by default', () => {
    // 51 ride middle (fixed blue) + 55 splash (pref blue) on one beat → splash green.
    const s = oneBarScore([{ notes: [{ midi: 51 }, { midi: 55 }] }]);
    const { chart, warnings } = convertToYargChart(s, 0, DEFAULT_MIDI_MAP);
    expect(chart.notes.find((n) => n.midi === 51)?.note).toBe('blueCymbal');
    expect(chart.notes.find((n) => n.midi === 55)?.note).toBe('greenCymbal');
    expect(warnings.some((w) => w.kind === 'yargNoteCollision')).toBe(false);
  });

  it('merges the same overlap when dynamic selection is off', () => {
    const s = oneBarScore([{ notes: [{ midi: 51 }, { midi: 55 }] }]);
    const { chart, warnings } = convertToYargChart(s, 0, DEFAULT_MIDI_MAP, {
      ...DEFAULT_CONVERSION_SETTINGS,
      dynamicCymbalSelection: false,
    });
    expect(chart.notes.filter((n) => n.note === 'blueCymbal')).toHaveLength(1);
    expect(warnings.some((w) => w.kind === 'yargNoteCollision')).toBe(true);
  });
});
