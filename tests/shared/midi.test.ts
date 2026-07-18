import { describe, expect, it } from 'vitest';
import {
  applyRemap,
  CHINA_NOTES,
  CRASH_HIGH_NOTES,
  getCymbalColor,
  isRideBellAndHiHatAccented,
  lookup,
  midiLabel,
  SPLASH_NOTES,
  STANDARD_DRUM_MIDI_NAMES,
  STANDARD_DRUM_MIDI_NUMBERS,
  setCymbalColor,
  setRideBellAndHiHatAccented,
  splitYargNoteId,
  validateMidiMap,
} from '../../src/shared/midi/index';
import { DEFAULT_MIDI_MAP, type MidiMap } from '../../src/shared/types/index';

describe('STANDARD_DRUM_MIDI constants', () => {
  it('names well-known drum numbers (GP2SNG short labels)', () => {
    expect(STANDARD_DRUM_MIDI_NAMES[35]).toBe('Kick 1');
    expect(STANDARD_DRUM_MIDI_NAMES[36]).toBe('Kick 2');
    expect(STANDARD_DRUM_MIDI_NAMES[38]).toBe('Snare');
    expect(STANDARD_DRUM_MIDI_NAMES[42]).toBe('Hi-hat (closed)');
    expect(STANDARD_DRUM_MIDI_NAMES[46]).toBe('Hi-hat (open)');
    expect(STANDARD_DRUM_MIDI_NAMES[49]).toBe('Crash high');
    expect(STANDARD_DRUM_MIDI_NAMES[52]).toBe('China');
    expect(STANDARD_DRUM_MIDI_NAMES[53]).toBe('Ride (bell)');
    expect(STANDARD_DRUM_MIDI_NAMES[57]).toBe('Crash medium');
  });

  it('names the extended (non-GM) numbers used by the default map', () => {
    expect(STANDARD_DRUM_MIDI_NAMES[29]).toBe('Ride (choke)');
    expect(STANDARD_DRUM_MIDI_NAMES[30]).toBe('Reverse Cymbal (hit)');
    expect(STANDARD_DRUM_MIDI_NAMES[31]).toBe('Snare (side stick)');
    expect(STANDARD_DRUM_MIDI_NAMES[33]).toBe('Metronome (hit)');
    expect(STANDARD_DRUM_MIDI_NAMES[34]).toBe('Metronome (bell)');
    expect(STANDARD_DRUM_MIDI_NAMES[91]).toBe('Snare (rim shot)');
    expect(STANDARD_DRUM_MIDI_NAMES[92]).toBe('Hi-hat (half)');
    expect(STANDARD_DRUM_MIDI_NAMES[126]).toBe('Ride (middle)');
    expect(STANDARD_DRUM_MIDI_NAMES[127]).toBe('Ride (bell)');
  });

  it('names the new choke / edge numbers', () => {
    expect(STANDARD_DRUM_MIDI_NAMES[93]).toBe('Ride (edge)');
    expect(STANDARD_DRUM_MIDI_NAMES[94]).toBe('Ride (choke)');
    expect(STANDARD_DRUM_MIDI_NAMES[95]).toBe('Splash (choke)');
    expect(STANDARD_DRUM_MIDI_NAMES[96]).toBe('China (choke)');
    expect(STANDARD_DRUM_MIDI_NAMES[97]).toBe('Crash high (choke)');
    expect(STANDARD_DRUM_MIDI_NAMES[98]).toBe('Crash medium (choke)');
  });

  it('numbers are sorted, deduped, and a superset of the default map', () => {
    const sorted = [...STANDARD_DRUM_MIDI_NUMBERS].every((n, i, a) => i === 0 || a[i - 1] < n);
    expect(sorted).toBe(true);
    for (const list of Object.values(DEFAULT_MIDI_MAP)) {
      for (const n of list) {
        expect(STANDARD_DRUM_MIDI_NUMBERS).toContain(n);
      }
    }
  });
});

describe('midiLabel', () => {
  it('shows the number and drum name when known', () => {
    expect(midiLabel(38)).toBe('38 — Snare');
  });
  it('falls back to the bare number when unknown', () => {
    expect(midiLabel(200)).toBe('200');
  });
});

describe('lookup', () => {
  it('resolves a base-row number to its note, unaccented', () => {
    expect(lookup(DEFAULT_MIDI_MAP, 38)).toEqual({ note: 'red', accented: false });
    expect(lookup(DEFAULT_MIDI_MAP, 42)).toEqual({ note: 'yellowCymbal', accented: false });
  });

  it('resolves an accented-row number to its base note, accented', () => {
    const map: MidiMap = {
      ...DEFAULT_MIDI_MAP,
      blueCymbal: [49, 51, 55, 59],
      blueCymbalAccented: [53],
    };
    expect(lookup(map, 53)).toEqual({ note: 'blueCymbal', accented: true });
  });

  it('returns null for an unmapped number', () => {
    expect(lookup(DEFAULT_MIDI_MAP, 58)).toBeNull();
  });
});

describe('splitYargNoteId', () => {
  it('splits a base row id into its note, unaccented', () => {
    expect(splitYargNoteId('yellowCymbal')).toEqual({ note: 'yellowCymbal', accented: false });
  });

  it('splits an accented row id into its base note, accented', () => {
    expect(splitYargNoteId('yellowCymbalAccented')).toEqual({
      note: 'yellowCymbal',
      accented: true,
    });
  });
});

describe('applyRemap', () => {
  it('moves a number from one base row to another, keeping lists sorted', () => {
    const next = applyRemap(DEFAULT_MIDI_MAP, 51, 'yellowCymbal');
    expect(next.blueCymbal).toEqual([29, 34, 49, 55, 59, 93, 94, 95, 97, 126]);
    expect(next.yellowCymbal).toEqual([42, 44, 51, 54, 69, 70, 80, 81, 82, 83, 85]);
  });

  it('does not mutate the input map', () => {
    const before = JSON.parse(JSON.stringify(DEFAULT_MIDI_MAP));
    applyRemap(DEFAULT_MIDI_MAP, 51, 'yellowCymbal');
    expect(DEFAULT_MIDI_MAP).toEqual(before);
  });

  it('removes the number entirely when target is null (drop to bucket)', () => {
    const next = applyRemap(DEFAULT_MIDI_MAP, 47, null);
    expect(next.blueTom).toEqual([61, 64, 66, 77]);
    expect(lookup(next, 47)).toBeNull();
  });

  it('adds a previously-unmapped number to a target row', () => {
    const next = applyRemap(DEFAULT_MIDI_MAP, 58, 'greenTom');
    expect(next.greenTom).toEqual([41, 43, 45, 58]);
  });

  it('is a no-op-in-place when moving a number to the row it already occupies', () => {
    const next = applyRemap(DEFAULT_MIDI_MAP, 38, 'red');
    expect(next.red).toEqual([31, 33, 37, 38, 39, 40, 56]);
  });

  it('enforces single membership: moving to an accented row leaves the base row', () => {
    const next = applyRemap(DEFAULT_MIDI_MAP, 51, 'blueCymbalAccented');
    expect(next.blueCymbal).toEqual([29, 34, 49, 55, 59, 93, 94, 95, 97, 126]);
    expect(next.blueCymbalAccented).toEqual([51, 53, 127]);
    expect(validateMidiMap(next)).toBeNull();
  });
});

describe('setRideBellAndHiHatAccented', () => {
  it('off: moves 46/92 to yellowCymbal and 53/127 to blueCymbal (regular colors)', () => {
    const next = setRideBellAndHiHatAccented(DEFAULT_MIDI_MAP, false);
    expect(next.yellowCymbalAccented).toEqual([]);
    expect(next.yellowCymbal).toEqual([42, 44, 46, 54, 69, 70, 80, 81, 82, 83, 85, 92]);
    expect(next.blueCymbalAccented).toEqual([]);
    expect(next.blueCymbal).toEqual([29, 34, 49, 51, 53, 55, 59, 93, 94, 95, 97, 126, 127]);
    expect(validateMidiMap(next)).toBeNull();
  });

  it('on: moves 46/92 to yellowCymbalAccented and 53/127 to blueCymbalAccented', () => {
    const off = setRideBellAndHiHatAccented(DEFAULT_MIDI_MAP, false);
    const next = setRideBellAndHiHatAccented(off, true);
    expect(next.yellowCymbalAccented).toEqual([46, 92]);
    expect(next.blueCymbalAccented).toEqual([53, 127]);
    expect(validateMidiMap(next)).toBeNull();
  });

  it('round-trips off→on back to the default placements', () => {
    const off = setRideBellAndHiHatAccented(DEFAULT_MIDI_MAP, false);
    expect(setRideBellAndHiHatAccented(off, true)).toEqual(DEFAULT_MIDI_MAP);
  });

  it('is idempotent when the trio already sits in the requested rows', () => {
    expect(setRideBellAndHiHatAccented(DEFAULT_MIDI_MAP, true)).toEqual(DEFAULT_MIDI_MAP);
  });

  it('does not mutate the input map', () => {
    const before = JSON.parse(JSON.stringify(DEFAULT_MIDI_MAP));
    setRideBellAndHiHatAccented(DEFAULT_MIDI_MAP, false);
    expect(DEFAULT_MIDI_MAP).toEqual(before);
  });
});

describe('isRideBellAndHiHatAccented', () => {
  it('is true when all of 46/53/127 sit in their accented rows (the default)', () => {
    expect(isRideBellAndHiHatAccented(DEFAULT_MIDI_MAP)).toBe(true);
  });

  it('is false once the trio has been moved to regular cymbal rows', () => {
    expect(isRideBellAndHiHatAccented(setRideBellAndHiHatAccented(DEFAULT_MIDI_MAP, false))).toBe(
      false,
    );
  });

  it('is false when only some of the trio are accented', () => {
    const partial = applyRemap(DEFAULT_MIDI_MAP, 127, 'blueCymbal'); // 46 & 53 stay accented
    expect(isRideBellAndHiHatAccented(partial)).toBe(false);
  });
});

describe('cymbal color', () => {
  it('derives the family color from the primary note (default: crash/splash blue, china green)', () => {
    expect(getCymbalColor(DEFAULT_MIDI_MAP, CRASH_HIGH_NOTES)).toBe('blue');
    expect(getCymbalColor(DEFAULT_MIDI_MAP, SPLASH_NOTES)).toBe('blue');
    expect(getCymbalColor(DEFAULT_MIDI_MAP, CHINA_NOTES)).toBe('green');
  });

  it('moves the whole family into the chosen color row, invariant-safe', () => {
    const next = setCymbalColor(DEFAULT_MIDI_MAP, CRASH_HIGH_NOTES, 'yellow');
    expect(next.yellowCymbal).toContain(49);
    expect(next.yellowCymbal).toContain(97);
    expect(next.blueCymbal).not.toContain(49);
    expect(getCymbalColor(next, CRASH_HIGH_NOTES)).toBe('yellow');
    expect(validateMidiMap(next)).toBeNull();
  });

  it('defaults to blue when the primary note is unmapped', () => {
    const stripped = applyRemap(applyRemap(DEFAULT_MIDI_MAP, 49, null), 97, null);
    expect(getCymbalColor(stripped, CRASH_HIGH_NOTES)).toBe('blue');
  });

  it('does not mutate the input map', () => {
    const before = JSON.parse(JSON.stringify(DEFAULT_MIDI_MAP));
    setCymbalColor(DEFAULT_MIDI_MAP, CHINA_NOTES, 'yellow');
    expect(DEFAULT_MIDI_MAP).toEqual(before);
  });
});

describe('validateMidiMap', () => {
  it('accepts the default map', () => {
    expect(validateMidiMap(DEFAULT_MIDI_MAP)).toBeNull();
  });

  it('rejects a non-object', () => {
    expect(validateMidiMap(null)).toMatch(/not an object/);
    expect(validateMidiMap(42)).toMatch(/not an object/);
  });

  it('rejects a missing key', () => {
    const { greenTom, ...rest } = DEFAULT_MIDI_MAP;
    expect(validateMidiMap(rest)).toMatch(/greenTom/);
  });

  it('rejects an out-of-range number', () => {
    expect(validateMidiMap({ ...DEFAULT_MIDI_MAP, red: [200] })).toMatch(/outside \[0,127\]/);
  });

  it('rejects a non-integer number', () => {
    expect(validateMidiMap({ ...DEFAULT_MIDI_MAP, red: [1.5] })).toMatch(/non-integer/);
  });

  it('rejects an unsorted list', () => {
    expect(validateMidiMap({ ...DEFAULT_MIDI_MAP, red: [40, 31] })).toMatch(/ascending/);
  });

  it('rejects a duplicate within a list', () => {
    expect(validateMidiMap({ ...DEFAULT_MIDI_MAP, red: [31, 31] })).toMatch(/ascending/);
  });

  it('rejects the same number appearing in two rows', () => {
    const bad = { ...DEFAULT_MIDI_MAP, redAccented: [38] }; // 38 already in red
    expect(validateMidiMap(bad)).toMatch(/appears in both/);
  });

  it('rejects unexpected extra keys', () => {
    expect(validateMidiMap({ ...DEFAULT_MIDI_MAP, bogus: [] })).toMatch(/unexpected key/);
  });
});
