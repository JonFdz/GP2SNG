import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { validateMidiMap } from '../shared/midi/index';
import {
  CYMBAL_COLORS,
  type CymbalColor,
  DEFAULT_MIDI_MAP,
  DEFAULT_SETTINGS,
  GRACE_NOTE_SPACINGS,
  type GraceNoteSpacing,
  type LoadResult,
  type MidiMap,
  type PersistedSettings,
  PersistenceError,
} from '../shared/types/index';

const SETTINGS_FILE = 'settings.json';
const MIDI_MAP_FILE = 'midi-map.json';

// docs/DESIGN.md → Persistence schema → Location. `app.isPackaged` is passed in so
// this module never imports 'electron' and stays unit-testable in plain Node.
export function resolveDataDir(isPackaged: boolean): string {
  return isPackaged
    ? join(dirname(process.execPath), 'gp2sng-data')
    : join(process.cwd(), 'dev-data');
}

// Encoding rules (DESIGN → Files): 2-space indent, trailing newline. Node writes LF.
function serialize(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function isCymbalPriority(v: unknown): boolean {
  if (!Array.isArray(v) || v.length !== 3) return false;
  const set = new Set(v);
  return set.size === 3 && [...set].every((c) => CYMBAL_COLORS.includes(c as CymbalColor));
}

function validateCymbalPriorities(v: unknown): string | null {
  if (typeof v !== 'object' || v === null) return '"cymbalPriorities" is not an object';
  const p = v as Record<string, unknown>;
  for (const key of ['crashHigh', 'splash', 'china'] as const) {
    if (!isCymbalPriority(p[key])) return `"cymbalPriorities.${key}" is not a color permutation`;
  }
  return null;
}

function validateSettings(value: unknown): string | null {
  if (typeof value !== 'object' || value === null) return 'settings is not an object';
  const s = value as Record<string, unknown>;
  if (!('outputDir' in s)) return 'missing "outputDir"';
  if (s.outputDir !== null && typeof s.outputDir !== 'string') {
    return '"outputDir" is not a string or null';
  }
  // graceNoteSpacing is optional on read (files predating the field are filled
  // with the default by readSettings); when present it must be a known value.
  if (
    'graceNoteSpacing' in s &&
    !GRACE_NOTE_SPACINGS.includes(s.graceNoteSpacing as GraceNoteSpacing)
  ) {
    return '"graceNoteSpacing" is not a known value';
  }
  // The ghost/accent toggles are optional on read (older files are filled with
  // defaults by readSettings); when present each must be a boolean.
  for (const key of [
    'snareGhostNotes',
    'tomGhostNotes',
    'cymbalGhostNotes',
    'snareAccentedNotes',
    'tomAccentedNotes',
    'cymbalAccentedNotes',
  ] as const) {
    if (key in s && typeof s[key] !== 'boolean') return `"${key}" is not a boolean`;
  }
  // dynamicCymbalSelection / cymbalPriorities are optional on read (older files
  // are filled with defaults by readSettings); when present they must be valid.
  if ('dynamicCymbalSelection' in s && typeof s.dynamicCymbalSelection !== 'boolean') {
    return '"dynamicCymbalSelection" is not a boolean';
  }
  if ('cymbalPriorities' in s) {
    const reason = validateCymbalPriorities(s.cymbalPriorities);
    if (reason !== null) return reason;
  }
  return null;
}

// Per-target write serialization: guarantees no two writes race the same tmp
// file or rename (the concurrent-write requirement, robust on Windows too).
const writeLocks = new Map<string, Promise<unknown>>();

function withWriteLock<T>(key: string, op: () => Promise<T>): Promise<T> {
  const prev = writeLocks.get(key) ?? Promise.resolve();
  const run = prev.then(op, op); // run regardless of the previous write's outcome
  writeLocks.set(
    key,
    run.then(
      () => undefined,
      () => undefined,
    ),
  );
  return run;
}

function atomicWrite(dir: string, file: string, contents: string): Promise<void> {
  const target = join(dir, file);
  return withWriteLock(target, async () => {
    await mkdir(dir, { recursive: true });
    const tmp = `${target}.tmp`;
    await writeFile(tmp, contents, 'utf8');
    await rename(tmp, target);
  });
}

async function readValidated<T>(
  dir: string,
  file: string,
  fallback: T,
  validate: (v: unknown) => string | null,
): Promise<LoadResult<T>> {
  await mkdir(dir, { recursive: true });
  let raw: string;
  try {
    raw = await readFile(join(dir, file), 'utf8');
  } catch (err) {
    // A missing file is normal on first launch; any other read error (e.g.
    // EACCES/EISDIR on an existing file) is a genuine failure to surface.
    const absent = (err as NodeJS.ErrnoException).code === 'ENOENT';
    return { value: structuredClone(fallback), failedToLoad: !absent };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { value: structuredClone(fallback), failedToLoad: true };
  }
  if (validate(parsed) !== null) {
    return { value: structuredClone(fallback), failedToLoad: true };
  }
  return { value: parsed as T, failedToLoad: false };
}

export async function readSettings(dir: string): Promise<LoadResult<PersistedSettings>> {
  const res = await readValidated(dir, SETTINGS_FILE, DEFAULT_SETTINGS, validateSettings);
  // Fill any keys absent from an older settings.json with their defaults so the
  // returned value always satisfies PersistedSettings (and outputDir survives).
  return { ...res, value: { ...DEFAULT_SETTINGS, ...res.value } };
}

export function readGlobalMap(dir: string): Promise<LoadResult<MidiMap>> {
  return readValidated(dir, MIDI_MAP_FILE, DEFAULT_MIDI_MAP, validateMidiMap);
}

export async function writeSettings(dir: string, patch: Partial<PersistedSettings>): Promise<void> {
  const current = (await readSettings(dir)).value;
  const merged: PersistedSettings = { ...current, ...patch };
  const reason = validateSettings(merged);
  if (reason !== null) throw new PersistenceError(`Invalid settings: ${reason}`, { reason });
  try {
    await atomicWrite(dir, SETTINGS_FILE, serialize(merged));
  } catch (err) {
    throw new PersistenceError('Failed to write settings', { cause: String(err) });
  }
}

export async function writeGlobalMap(dir: string, map: MidiMap): Promise<void> {
  const reason = validateMidiMap(map);
  if (reason !== null) throw new PersistenceError(`Invalid MIDI map: ${reason}`, { reason });
  try {
    await atomicWrite(dir, MIDI_MAP_FILE, serialize(map));
  } catch (err) {
    throw new PersistenceError('Failed to write MIDI map', { cause: String(err) });
  }
}
