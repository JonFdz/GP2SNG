import {
  type BaseYargNote,
  CYMBAL_COLORS,
  type CymbalColor,
  type MidiMap,
  YARG_NOTE_IDS,
  type YargNoteId,
} from '../types/index';

function insertSorted(list: number[], midi: number): number[] {
  if (list.includes(midi)) return list;
  return [...list, midi].sort((a, b) => a - b);
}

// Returns a NEW map with `midi` removed from every row and then inserted into
// `target` (or into no row when `target` is null). Preserves all MidiMap
// invariants: 16 keys, ascending, deduped, single-membership.
export function applyRemap(map: MidiMap, midi: number, target: YargNoteId | null): MidiMap {
  const next = {} as MidiMap;
  for (const id of YARG_NOTE_IDS) {
    next[id] = map[id].filter((n) => n !== midi);
  }
  if (target !== null) {
    next[target] = insertSorted(next[target], midi);
  }
  return next;
}

// The notes the "Accent ride bell & open hi-hat" checkbox controls, each paired
// with its base cymbal note: open (46) and half (92) hi-hat → Yellow, ride bell
// (53, 127) → Blue. Checked puts each in its accented row; unchecked, its regular row.
const RIDE_BELL_AND_HIHAT: readonly { midi: number; note: BaseYargNote }[] = [
  { midi: 46, note: 'yellowCymbal' },
  { midi: 53, note: 'blueCymbal' },
  { midi: 92, note: 'yellowCymbal' },
  { midi: 127, note: 'blueCymbal' },
];

// The "Accent ride bell & open hi-hat" checkbox transform (docs/DESIGN.md → MIDI
// map → Presentation): moves the trio into their accented cymbal rows when `on`,
// or back to the regular cymbal rows when off, via the same remap path as a drag.
// Idempotent when the trio already sits in the requested rows.
export function setRideBellAndHiHatAccented(map: MidiMap, on: boolean): MidiMap {
  return RIDE_BELL_AND_HIHAT.reduce(
    (acc, { midi, note }) => applyRemap(acc, midi, on ? `${note}Accented` : note),
    map,
  );
}

// Whether every note the checkbox controls currently sits in its accented row —
// i.e. the checkbox reads as checked. Derived from the map, so there is no
// separate persisted state to keep in sync.
export function isRideBellAndHiHatAccented(map: MidiMap): boolean {
  return RIDE_BELL_AND_HIHAT.every(({ midi, note }) => map[`${note}Accented`].includes(midi));
}

// Re-exported from the types leaf so PersistedSettings can reference the color type
// without a types→midi import cycle.
export { CYMBAL_COLORS, type CymbalColor };

// Each selector's note family: the base cymbal note plus its choke articulation,
// moved together. China defaults green; the others default blue (see the default map).
export const CRASH_HIGH_NOTES: readonly number[] = [49, 97];
export const SPLASH_NOTES: readonly number[] = [55, 95];
export const CHINA_NOTES: readonly number[] = [52, 96];

// The color a family currently sits in, read from its primary (first) note's base
// cymbal row; 'blue' when that note is not in any cymbal row.
export function getCymbalColor(map: MidiMap, notes: readonly number[]): CymbalColor {
  const r = lookup(map, notes[0]);
  if (r?.note === 'yellowCymbal') return 'yellow';
  if (r?.note === 'greenCymbal') return 'green';
  return 'blue';
}

// Moves every note in the family into `${color}Cymbal` via applyRemap (invariant-
// safe, immutable). Idempotent when the family already sits there.
export function setCymbalColor(
  map: MidiMap,
  notes: readonly number[],
  color: CymbalColor,
): MidiMap {
  return notes.reduce<MidiMap>(
    (acc, midi) => applyRemap(acc, midi, `${color}Cymbal` as YargNoteId),
    map,
  );
}

// Splits a MIDI-map row id into its base YARG note plus the accent flag. The
// inverse of the `${base}Accented` template that builds YargNoteId.
export function splitYargNoteId(id: YargNoteId): { note: BaseYargNote; accented: boolean } {
  if (id.endsWith('Accented')) {
    return { note: id.slice(0, -'Accented'.length) as BaseYargNote, accented: true };
  }
  return { note: id as BaseYargNote, accented: false };
}

// Resolves a MIDI number to its base YARG note plus accent flag, or null.
export function lookup(
  map: MidiMap,
  midi: number,
): { note: BaseYargNote; accented: boolean } | null {
  for (const id of YARG_NOTE_IDS) {
    if (map[id].includes(midi)) return splitYargNoteId(id);
  }
  return null;
}

// Returns null if `value` is a valid MidiMap, else the first violation reason.
export function validateMidiMap(value: unknown): string | null {
  if (typeof value !== 'object' || value === null) {
    return 'map is not an object';
  }
  const map = value as Record<string, unknown>;
  const seen = new Map<number, YargNoteId>();
  for (const id of YARG_NOTE_IDS) {
    const list = map[id];
    if (!Array.isArray(list)) {
      return `missing or non-array row "${id}"`;
    }
    let prev = -1;
    for (const n of list) {
      if (typeof n !== 'number' || !Number.isInteger(n)) {
        return `row "${id}" contains a non-integer value`;
      }
      if (n < 0 || n > 127) {
        return `row "${id}" contains ${n}, outside [0,127]`;
      }
      if (n <= prev) {
        return `row "${id}" is not strictly ascending (saw ${n} after ${prev})`;
      }
      if (seen.has(n)) {
        return `MIDI number ${n} appears in both "${seen.get(n)}" and "${id}"`;
      }
      seen.set(n, id);
      prev = n;
    }
  }
  const extraKeys = Object.keys(map).filter(
    (k) => !(YARG_NOTE_IDS as readonly string[]).includes(k),
  );
  if (extraKeys.length > 0) {
    return `unexpected key(s): ${extraKeys.join(', ')}`;
  }
  return null;
}
