import { describe, expect, it } from 'vitest';
import {
  BASE_YARG_NOTES,
  CHART_RESOLUTION,
  ConversionError,
  DEFAULT_CONVERSION_SETTINGS,
  DEFAULT_CYMBAL_PRIORITIES,
  DEFAULT_MIDI_MAP,
  DEFAULT_SETTINGS,
  Gp2SngError,
  GpParseError,
  PersistenceError,
  YARG_NOTE_IDS,
} from '../../src/shared/types/index';

describe('YARG note domain', () => {
  it('has 8 base notes and 16 map ids', () => {
    expect(BASE_YARG_NOTES).toHaveLength(8);
    expect(YARG_NOTE_IDS).toHaveLength(16);
  });

  it('every base note also appears as an Accented id', () => {
    for (const base of BASE_YARG_NOTES) {
      expect(YARG_NOTE_IDS).toContain(base);
      expect(YARG_NOTE_IDS).toContain(`${base}Accented`);
    }
  });
});

describe('DEFAULT_MIDI_MAP', () => {
  it('has all 16 keys', () => {
    expect(Object.keys(DEFAULT_MIDI_MAP).sort()).toEqual([...YARG_NOTE_IDS].sort());
  });

  it('matches the default assignments', () => {
    expect(DEFAULT_MIDI_MAP.red).toEqual([31, 33, 37, 38, 39, 40, 56]);
    expect(DEFAULT_MIDI_MAP.orange).toEqual([35, 36]);
    expect(DEFAULT_MIDI_MAP.yellowCymbal).toEqual([42, 44, 54, 69, 70, 80, 81, 82, 83, 85]);
    expect(DEFAULT_MIDI_MAP.yellowTom).toEqual([48, 50, 60, 62, 63, 65, 76]);
    expect(DEFAULT_MIDI_MAP.blueCymbal).toEqual([29, 34, 49, 51, 55, 59, 93, 94, 95, 97, 126]);
    expect(DEFAULT_MIDI_MAP.blueTom).toEqual([47, 61, 64, 66, 77]);
    expect(DEFAULT_MIDI_MAP.greenCymbal).toEqual([30, 52, 57, 96, 98]);
    expect(DEFAULT_MIDI_MAP.greenTom).toEqual([41, 43, 45]);
  });

  // Accent-on-by-default (docs/DESIGN.md → MIDI map): 91 rim shot, 46 open hi-hat,
  // and 53/127 ride bell ship in their accented rows.
  it('ships the accented defaults; all other accented rows are empty', () => {
    expect(DEFAULT_MIDI_MAP.redAccented).toEqual([91]);
    expect(DEFAULT_MIDI_MAP.yellowCymbalAccented).toEqual([46, 92]);
    expect(DEFAULT_MIDI_MAP.blueCymbalAccented).toEqual([53, 127]);
    const nonEmpty = new Set(['redAccented', 'yellowCymbalAccented', 'blueCymbalAccented']);
    for (const base of BASE_YARG_NOTES) {
      const id = `${base}Accented` as const;
      if (!nonEmpty.has(id)) expect(DEFAULT_MIDI_MAP[id]).toEqual([]);
    }
  });
});

describe('constants', () => {
  it('fixes chart resolution at 480 PPQ', () => {
    expect(CHART_RESOLUTION).toBe(480);
  });

  it('defaults settings to no output dir and a 64th-note grace spacing', () => {
    expect(DEFAULT_SETTINGS).toEqual({
      outputDir: null,
      graceNoteSpacing: '64th',
      snareGhostNotes: true,
      tomGhostNotes: false,
      cymbalGhostNotes: false,
      snareAccentedNotes: true,
      tomAccentedNotes: false,
      cymbalAccentedNotes: false,
      dynamicCymbalSelection: true,
      cymbalPriorities: DEFAULT_CYMBAL_PRIORITIES,
    });
  });
});

describe('error hierarchy', () => {
  it('subclasses extend Gp2SngError and carry name + context', () => {
    const err = new GpParseError('bad archive', { path: 'x.gp' });
    expect(err).toBeInstanceOf(Gp2SngError);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('GpParseError');
    expect(err.message).toBe('bad archive');
    expect(err.context).toEqual({ path: 'x.gp' });
  });

  it('distinct subclasses are not cross-instances', () => {
    expect(new ConversionError('x')).not.toBeInstanceOf(PersistenceError);
  });
});

describe('cymbal priority defaults', () => {
  it('ships dynamic cymbal selection on with the default priority lists', () => {
    expect(DEFAULT_SETTINGS.dynamicCymbalSelection).toBe(true);
    expect(DEFAULT_SETTINGS.cymbalPriorities).toEqual(DEFAULT_CYMBAL_PRIORITIES);
    expect(DEFAULT_CYMBAL_PRIORITIES).toEqual({
      crashHigh: ['blue', 'green', 'yellow'],
      splash: ['blue', 'green', 'yellow'],
      china: ['green', 'yellow', 'blue'],
    });
  });

  it('each default priority[0] matches the family row in DEFAULT_MIDI_MAP', () => {
    expect(DEFAULT_MIDI_MAP.blueCymbal).toContain(49); // crash high
    expect(DEFAULT_MIDI_MAP.blueCymbal).toContain(55); // splash
    expect(DEFAULT_MIDI_MAP.greenCymbal).toContain(52); // china
    expect(DEFAULT_CYMBAL_PRIORITIES.crashHigh[0]).toBe('blue');
    expect(DEFAULT_CYMBAL_PRIORITIES.splash[0]).toBe('blue');
    expect(DEFAULT_CYMBAL_PRIORITIES.china[0]).toBe('green');
  });
});

describe('DEFAULT_CONVERSION_SETTINGS', () => {
  it('holds the shipped tuning defaults', () => {
    expect(DEFAULT_CONVERSION_SETTINGS).toEqual({
      graceNoteSpacing: '64th',
      snareGhostNotes: true,
      tomGhostNotes: false,
      cymbalGhostNotes: false,
      snareAccentedNotes: true,
      tomAccentedNotes: false,
      cymbalAccentedNotes: false,
      dynamicCymbalSelection: true,
      cymbalPriorities: DEFAULT_CYMBAL_PRIORITIES,
    });
  });

  it('composes DEFAULT_SETTINGS with a null output directory', () => {
    expect(DEFAULT_SETTINGS).toEqual({ outputDir: null, ...DEFAULT_CONVERSION_SETTINGS });
  });
});
