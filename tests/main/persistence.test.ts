import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  readGlobalMap,
  readSettings,
  writeGlobalMap,
  writeSettings,
} from '../../src/main/persistence';
import {
  DEFAULT_CYMBAL_PRIORITIES,
  DEFAULT_MIDI_MAP,
  DEFAULT_SETTINGS,
  type MidiMap,
  PersistenceError,
} from '../../src/shared/types/index';

function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'gp2sng-persist-'));
}

describe('readSettings / readGlobalMap — absent files', () => {
  it('returns defaults with no failure when files are absent', async () => {
    const dir = await tempDir();
    expect(await readSettings(dir)).toEqual({ value: DEFAULT_SETTINGS, failedToLoad: false });
    expect(await readGlobalMap(dir)).toEqual({ value: DEFAULT_MIDI_MAP, failedToLoad: false });
  });
});

describe('read — malformed / invalid files', () => {
  it('returns default and records failure on malformed JSON, leaving the file untouched', async () => {
    const dir = await tempDir();
    const file = join(dir, 'midi-map.json');
    await writeFile(file, '{ not valid json', 'utf8');
    const res = await readGlobalMap(dir);
    expect(res).toEqual({ value: DEFAULT_MIDI_MAP, failedToLoad: true });
    expect(await readFile(file, 'utf8')).toBe('{ not valid json');
  });

  it('records failure (not a silent default) when an existing path is unreadable', async () => {
    const dir = await tempDir();
    // Occupy the file path with a directory so readFile throws EISDIR (a
    // non-ENOENT read error) — distinct from a normal absent-file first launch.
    await mkdir(join(dir, 'midi-map.json'));
    expect(await readGlobalMap(dir)).toEqual({ value: DEFAULT_MIDI_MAP, failedToLoad: true });
  });

  const invalidMaps: Record<string, unknown> = {
    'missing a row': (() => {
      const m: Record<string, unknown> = { ...DEFAULT_MIDI_MAP };
      delete m.red;
      return m;
    })(),
    'duplicate across lists': { ...DEFAULT_MIDI_MAP, redAccented: [36] }, // 36 already in orange
    'out-of-range number': { ...DEFAULT_MIDI_MAP, greenTom: [41, 43, 200] },
    'unsorted list': { ...DEFAULT_MIDI_MAP, red: [38, 31] },
    'non-integer value': { ...DEFAULT_MIDI_MAP, blueTom: [47.5] },
  };

  for (const [label, value] of Object.entries(invalidMaps)) {
    it(`returns default and records failure for an invalid map (${label})`, async () => {
      const dir = await tempDir();
      const file = join(dir, 'midi-map.json');
      const raw = JSON.stringify(value);
      await writeFile(file, raw, 'utf8');
      const res = await readGlobalMap(dir);
      expect(res.failedToLoad).toBe(true);
      expect(res.value).toEqual(DEFAULT_MIDI_MAP);
      expect(await readFile(file, 'utf8')).toBe(raw); // untouched
    });
  }
});

describe('write — round-trip', () => {
  it('round-trips settings through write then read', async () => {
    const dir = await tempDir();
    await writeSettings(dir, { outputDir: 'C:\\songs' });
    expect(await readSettings(dir)).toEqual({
      value: { ...DEFAULT_SETTINGS, outputDir: 'C:\\songs' },
      failedToLoad: false,
    });
  });

  it('round-trips the grace-note spacing and preserves the output dir', async () => {
    const dir = await tempDir();
    await writeSettings(dir, { outputDir: 'C:\\a' });
    await writeSettings(dir, { graceNoteSpacing: '32nd' });
    expect((await readSettings(dir)).value).toEqual({
      ...DEFAULT_SETTINGS,
      outputDir: 'C:\\a',
      graceNoteSpacing: '32nd',
    });
  });

  it('fills the default grace spacing for a file that predates the field', async () => {
    const dir = await tempDir();
    // A settings.json written before graceNoteSpacing existed must keep its
    // outputDir and gain the default spacing rather than being discarded.
    await writeFile(join(dir, 'settings.json'), JSON.stringify({ outputDir: 'C:\\old' }), 'utf8');
    expect(await readSettings(dir)).toEqual({
      value: { ...DEFAULT_SETTINGS, outputDir: 'C:\\old' },
      failedToLoad: false,
    });
  });

  it('round-trips the ghost-note toggles', async () => {
    const dir = await tempDir();
    await writeSettings(dir, {
      snareGhostNotes: false,
      tomGhostNotes: true,
      cymbalGhostNotes: true,
    });
    expect((await readSettings(dir)).value).toEqual({
      ...DEFAULT_SETTINGS,
      snareGhostNotes: false,
      tomGhostNotes: true,
      cymbalGhostNotes: true,
    });
  });

  it('fills the default ghost toggles for a file that predates them', async () => {
    const dir = await tempDir();
    await writeFile(join(dir, 'settings.json'), JSON.stringify({ outputDir: 'C:\\old' }), 'utf8');
    expect((await readSettings(dir)).value).toEqual({ ...DEFAULT_SETTINGS, outputDir: 'C:\\old' });
  });

  it('round-trips the accented-note toggles', async () => {
    const dir = await tempDir();
    await writeSettings(dir, {
      snareAccentedNotes: false,
      tomAccentedNotes: true,
      cymbalAccentedNotes: true,
    });
    expect((await readSettings(dir)).value).toEqual({
      ...DEFAULT_SETTINGS,
      snareAccentedNotes: false,
      tomAccentedNotes: true,
      cymbalAccentedNotes: true,
    });
  });

  it('rejects a non-boolean accented-note toggle', async () => {
    const dir = await tempDir();
    await expect(
      writeSettings(dir, { tomAccentedNotes: 'yes' as unknown as boolean }),
    ).rejects.toThrow();
  });

  it('ignores a settings file carrying the old padGhostNotes key and takes the new defaults', async () => {
    // No migration is written for this rename (single-user, no-legacy-support
    // project): readSettings treats every field as optional and fills defaults,
    // so the retired key has no effect on the new fields — snareGhostNotes and
    // tomGhostNotes ship at their shipped defaults rather than inheriting it.
    const dir = await tempDir();
    await writeFile(
      join(dir, 'settings.json'),
      JSON.stringify({ outputDir: 'C:\\old', padGhostNotes: false }),
      'utf8',
    );
    const res = await readSettings(dir);
    expect(res.failedToLoad).toBe(false);
    expect(res.value.outputDir).toBe('C:\\old');
    expect(res.value.snareGhostNotes).toBe(true);
    expect(res.value.tomGhostNotes).toBe(false);
  });

  it('rejects an invalid grace spacing, falling back to defaults with a recorded failure', async () => {
    const dir = await tempDir();
    const raw = JSON.stringify({ outputDir: 'C:\\x', graceNoteSpacing: '128th' });
    await writeFile(join(dir, 'settings.json'), raw, 'utf8');
    expect(await readSettings(dir)).toEqual({ value: DEFAULT_SETTINGS, failedToLoad: true });
  });

  it('rejects an unknown lead-in bar count, falling back to defaults with a recorded failure', async () => {
    const dir = await tempDir();
    const raw = JSON.stringify({ outputDir: 'C:\\x', leadInBars: 3 });
    await writeFile(join(dir, 'settings.json'), raw, 'utf8');
    expect(await readSettings(dir)).toEqual({ value: DEFAULT_SETTINGS, failedToLoad: true });
  });

  it('accepts a valid lead-in bar count', async () => {
    const dir = await tempDir();
    const raw = JSON.stringify({ outputDir: 'C:\\x', leadInBars: 4 });
    await writeFile(join(dir, 'settings.json'), raw, 'utf8');
    expect(await readSettings(dir)).toEqual({
      value: { ...DEFAULT_SETTINGS, outputDir: 'C:\\x', leadInBars: 4 },
      failedToLoad: false,
    });
  });

  it('round-trips a modified map through write then read', async () => {
    const dir = await tempDir();
    const map: MidiMap = { ...DEFAULT_MIDI_MAP, greenTom: [41, 43, 45, 58] };
    await writeGlobalMap(dir, map);
    expect(await readGlobalMap(dir)).toEqual({ value: map, failedToLoad: false });
  });

  it('merges a settings patch onto the existing file (read-modify-write)', async () => {
    const dir = await tempDir();
    await writeSettings(dir, { outputDir: 'C:\\a' });
    await writeSettings(dir, {}); // empty patch must not wipe the existing value
    expect((await readSettings(dir)).value).toEqual({ ...DEFAULT_SETTINGS, outputDir: 'C:\\a' });
  });
});

describe('write — validation and failures', () => {
  it('throws PersistenceError on an invalid map and writes nothing', async () => {
    const dir = await tempDir();
    const bad = { ...DEFAULT_MIDI_MAP, red: [1, 1] } as MidiMap; // not strictly ascending
    await expect(writeGlobalMap(dir, bad)).rejects.toBeInstanceOf(PersistenceError);
    await expect(readFile(join(dir, 'midi-map.json'), 'utf8')).rejects.toThrow(); // never created
  });

  it('throws PersistenceError on invalid settings', async () => {
    const dir = await tempDir();
    await expect(
      writeSettings(dir, { outputDir: 123 as unknown as string }),
    ).rejects.toBeInstanceOf(PersistenceError);
  });

  it('throws PersistenceError on an unknown grace spacing', async () => {
    const dir = await tempDir();
    await expect(writeSettings(dir, { graceNoteSpacing: '16th' as never })).rejects.toBeInstanceOf(
      PersistenceError,
    );
  });

  it('throws PersistenceError on a non-boolean ghost toggle', async () => {
    const dir = await tempDir();
    await expect(
      writeSettings(dir, { snareGhostNotes: 'yes' as unknown as boolean }),
    ).rejects.toBeInstanceOf(PersistenceError);
  });

  it('surfaces a write-time fs failure as PersistenceError', async () => {
    const dir = await tempDir();
    const filePath = join(dir, 'not-a-dir');
    await writeFile(filePath, 'x', 'utf8');
    // Using a regular file as the "dir" makes mkdir(recursive) throw — portable, no mocks.
    await expect(writeGlobalMap(filePath, DEFAULT_MIDI_MAP)).rejects.toBeInstanceOf(
      PersistenceError,
    );
  });

  it('serializes concurrent writes to a single valid final state', async () => {
    const dir = await tempDir();
    const maps: MidiMap[] = [0, 1, 2, 3, 4].map((k) => ({
      ...DEFAULT_MIDI_MAP,
      greenTom: [41, 43, 45, 71 + k],
    }));
    await Promise.all(maps.map((m) => writeGlobalMap(dir, m)));
    const res = await readGlobalMap(dir);
    expect(res.failedToLoad).toBe(false);
    expect(maps).toContainEqual(res.value);
  });
});

describe('settings — cymbal selection round-trip & validation', () => {
  it('round-trips dynamicCymbalSelection and cymbalPriorities', async () => {
    const dir = await tempDir();
    await writeSettings(dir, {
      dynamicCymbalSelection: false,
      cymbalPriorities: {
        crashHigh: ['green', 'blue', 'yellow'],
        splash: ['yellow', 'blue', 'green'],
        china: ['green', 'yellow', 'blue'],
      },
    });
    const res = await readSettings(dir);
    expect(res.failedToLoad).toBe(false);
    expect(res.value.dynamicCymbalSelection).toBe(false);
    expect(res.value.cymbalPriorities.crashHigh).toEqual(['green', 'blue', 'yellow']);
  });

  it('fills both keys with defaults when an older file omits them', async () => {
    const dir = await tempDir();
    await writeFile(join(dir, 'settings.json'), JSON.stringify({ outputDir: null }), 'utf8');
    const res = await readSettings(dir);
    expect(res.value.dynamicCymbalSelection).toBe(true);
    expect(res.value.cymbalPriorities).toEqual(DEFAULT_CYMBAL_PRIORITIES);
  });

  it('falls back to defaults on a malformed cymbalPriorities (non-permutation)', async () => {
    const dir = await tempDir();
    await writeFile(
      join(dir, 'settings.json'),
      JSON.stringify({
        outputDir: null,
        cymbalPriorities: {
          crashHigh: ['blue', 'blue', 'green'],
          splash: ['blue', 'green', 'yellow'],
          china: ['green', 'yellow', 'blue'],
        },
      }),
      'utf8',
    );
    const res = await readSettings(dir);
    expect(res.failedToLoad).toBe(true);
    expect(res.value.cymbalPriorities).toEqual(DEFAULT_CYMBAL_PRIORITIES);
  });

  it('falls back to defaults on a non-boolean dynamicCymbalSelection', async () => {
    const dir = await tempDir();
    await writeFile(
      join(dir, 'settings.json'),
      JSON.stringify({ outputDir: null, dynamicCymbalSelection: 'yes' }),
      'utf8',
    );
    const res = await readSettings(dir);
    expect(res.failedToLoad).toBe(true);
  });
});
