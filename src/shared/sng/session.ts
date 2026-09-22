import { validateMidiMap } from '../midi/index';
import {
  type AlbumArt,
  BASE_YARG_NOTES,
  CYMBAL_COLORS,
  GRACE_NOTE_SPACINGS,
  SESSION_BLOB_FILENAME,
  SESSION_BLOB_VERSION,
  type SessionBlob,
  SessionRestoreError,
  YARG_NOTE_IDS,
} from '../types/index';
import { readSng } from './container';

// Members the decoder insists on before handing back a blob. A half-populated
// session would render a working-looking Preview built on a chart the user never
// exported, so a missing member is a refusal, not a default.
const REQUIRED_MEMBERS: readonly string[] = [
  'gpFilePath',
  'gpFileBase64',
  'sessionMap',
  'sessionSettings',
  'chart',
  'warnings',
  'overrides',
  'deletions',
  'previewRemaps',
  'metadata',
  'audioOffsetMs',
  'audioPaddingMs',
];

const CORRUPT =
  "This .sng's GP2SNG session data is corrupt. Re-convert it from the original Guitar Pro file.";

const MAX_EMBEDDED_GP_BYTES = 50 * 1024 * 1024;
const MAX_EMBEDDED_GP_BASE64_CHARS = Math.ceil(MAX_EMBEDDED_GP_BYTES / 3) * 4;
const DYNAMICS = ['neutral', 'ghost', 'accent'] as const;
const WARNING_KINDS = [
  'threeHandNotes',
  'unmappedNotesDropped',
  'yargNoteCollision',
  'directionSignsUnsupported',
] as const;

function corrupt(detail: string): never {
  throw new SessionRestoreError(CORRUPT, { invalid: detail });
}

function record(value: unknown, detail: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) corrupt(detail);
  return value as Record<string, unknown>;
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function integer(value: unknown, minimum = Number.MIN_SAFE_INTEGER): value is number {
  return Number.isSafeInteger(value) && (value as number) >= minimum;
}

function midi(value: unknown): value is number {
  return integer(value, 0) && value <= 127;
}

function fraction(value: unknown): boolean {
  return Array.isArray(value) && value.length === 2 && integer(value[0]) && integer(value[1], 1);
}

function stringFields(value: unknown, fields: readonly string[], detail: string): void {
  const candidate = record(value, detail);
  for (const field of fields)
    if (typeof candidate[field] !== 'string') corrupt(`${detail}.${field}`);
}

function validateSettings(value: unknown): void {
  const settings = record(value, 'sessionSettings');
  if (!GRACE_NOTE_SPACINGS.includes(settings.graceNoteSpacing as never)) {
    corrupt('sessionSettings.graceNoteSpacing');
  }
  for (const field of [
    'snareGhostNotes',
    'tomGhostNotes',
    'cymbalGhostNotes',
    'snareAccentedNotes',
    'tomAccentedNotes',
    'cymbalAccentedNotes',
    'dynamicCymbalSelection',
  ]) {
    if (typeof settings[field] !== 'boolean') corrupt(`sessionSettings.${field}`);
  }
  const priorities = record(settings.cymbalPriorities, 'sessionSettings.cymbalPriorities');
  for (const field of ['crashHigh', 'splash', 'china']) {
    const colors = priorities[field];
    if (
      !Array.isArray(colors) ||
      colors.length !== 3 ||
      new Set(colors).size !== 3 ||
      !colors.every((color) => CYMBAL_COLORS.includes(color as never))
    ) {
      corrupt(`sessionSettings.cymbalPriorities.${field}`);
    }
  }
}

function nondecreasing(items: unknown[], field: string): boolean {
  let previous = -1;
  for (const item of items) {
    const value = record(item, field)[field];
    if (!integer(value, 0) || value < previous) return false;
    previous = value;
  }
  return true;
}

function validateChart(value: unknown): void {
  const chart = record(value, 'chart');
  if (chart.resolution !== 480 || !integer(chart.endTick, 0) || !integer(chart.leadInTicks, 0)) {
    corrupt('chart scalar');
  }
  for (const field of ['tempoMap', 'timeSignatures', 'notes', 'sections']) {
    if (!Array.isArray(chart[field])) corrupt(`chart.${field}`);
    if (!nondecreasing(chart[field] as unknown[], 'tick')) corrupt(`chart.${field} order`);
  }
  const tempoMap = chart.tempoMap as unknown[];
  const timeSignatures = chart.timeSignatures as unknown[];
  if (tempoMap.length === 0 || record(tempoMap[0], 'tempoMap[0]').tick !== 0) corrupt('tempoMap');
  if (timeSignatures.length === 0 || record(timeSignatures[0], 'timeSignatures[0]').tick !== 0) {
    corrupt('timeSignatures');
  }
  for (const [i, raw] of tempoMap.entries()) {
    const event = record(raw, `tempoMap[${i}]`);
    if (!integer(event.tick, 0) || !integer(event.usPerQuarter, 1)) corrupt(`tempoMap[${i}]`);
  }
  for (const [i, raw] of timeSignatures.entries()) {
    const event = record(raw, `timeSignatures[${i}]`);
    if (!integer(event.tick, 0) || !integer(event.numerator, 1) || !integer(event.denominator, 1)) {
      corrupt(`timeSignatures[${i}]`);
    }
  }
  for (const [i, raw] of (chart.notes as unknown[]).entries()) {
    const note = record(raw, `notes[${i}]`);
    if (
      !integer(note.tick, 0) ||
      !BASE_YARG_NOTES.includes(note.note as never) ||
      !DYNAMICS.includes(note.dynamic as never) ||
      !midi(note.midi)
    ) {
      corrupt(`notes[${i}]`);
    }
  }
  for (const [i, raw] of (chart.sections as unknown[]).entries()) {
    const section = record(raw, `sections[${i}]`);
    if (!integer(section.tick, 0) || typeof section.name !== 'string') corrupt(`sections[${i}]`);
  }
}

function validateWarnings(value: unknown): void {
  if (!Array.isArray(value)) corrupt('warnings');
  for (const [i, raw] of value.entries()) {
    const warning = record(raw, `warnings[${i}]`);
    if (
      !WARNING_KINDS.includes(warning.kind as never) ||
      typeof warning.message !== 'string' ||
      (warning.context !== undefined &&
        (warning.context === null ||
          typeof warning.context !== 'object' ||
          Array.isArray(warning.context)))
    ) {
      corrupt(`warnings[${i}]`);
    }
    const context = warning.context as Record<string, unknown> | undefined;
    if (warning.kind === 'threeHandNotes') {
      if (
        context === undefined ||
        !integer(context.bar, 1) ||
        !Array.isArray(context.midi) ||
        !context.midi.every(midi) ||
        !fraction(context.positionFrac)
      ) {
        corrupt(`warnings[${i}].context`);
      }
    } else if (warning.kind === 'unmappedNotesDropped') {
      if (context === undefined || !Array.isArray(context.midi) || !context.midi.every(midi)) {
        corrupt(`warnings[${i}].context`);
      }
    } else if (warning.kind === 'yargNoteCollision') {
      if (
        context === undefined ||
        !integer(context.tick, 0) ||
        !BASE_YARG_NOTES.includes(context.note as never)
      ) {
        corrupt(`warnings[${i}].context`);
      }
    }
  }
}

function validateEdits(parsed: Record<string, unknown>): void {
  for (const field of ['overrides', 'deletions', 'previewRemaps']) {
    if (!Array.isArray(parsed[field])) corrupt(field);
  }
  const seenOverrides = new Set<string>();
  for (const [i, raw] of (parsed.overrides as unknown[]).entries()) {
    const edit = record(raw, `overrides[${i}]`);
    const key = `${edit.tick}:${edit.midi}`;
    if (
      !integer(edit.tick, 0) ||
      !midi(edit.midi) ||
      !BASE_YARG_NOTES.includes(edit.note as never) ||
      typeof edit.accented !== 'boolean' ||
      !integer(edit.seq, 0) ||
      seenOverrides.has(key)
    ) {
      corrupt(`overrides[${i}]`);
    }
    seenOverrides.add(key);
  }
  const seenDeletions = new Set<string>();
  for (const [i, raw] of (parsed.deletions as unknown[]).entries()) {
    const edit = record(raw, `deletions[${i}]`);
    const key = `${edit.tick}:${edit.midi}`;
    if (
      !integer(edit.tick, 0) ||
      !midi(edit.midi) ||
      !integer(edit.seq, 0) ||
      seenDeletions.has(key)
    ) {
      corrupt(`deletions[${i}]`);
    }
    seenDeletions.add(key);
  }
  const seenRemaps = new Set<number>();
  for (const [i, raw] of (parsed.previewRemaps as unknown[]).entries()) {
    const edit = record(raw, `previewRemaps[${i}]`);
    if (
      !midi(edit.midi) ||
      (edit.from !== null && !YARG_NOTE_IDS.includes(edit.from as never)) ||
      (edit.to !== null && !YARG_NOTE_IDS.includes(edit.to as never)) ||
      !integer(edit.seq, 0) ||
      seenRemaps.has(edit.midi)
    ) {
      corrupt(`previewRemaps[${i}]`);
    }
    seenRemaps.add(edit.midi);
  }
}

function validateSession(parsed: Record<string, unknown>): void {
  if (typeof parsed.gpFilePath !== 'string') corrupt('gpFilePath');
  if (validateMidiMap(parsed.sessionMap) !== null) corrupt('sessionMap');
  validateSettings(parsed.sessionSettings);
  validateChart(parsed.chart);
  validateWarnings(parsed.warnings);
  validateEdits(parsed);
  stringFields(
    parsed.metadata,
    ['name', 'artist', 'album', 'genre', 'year', 'charter'],
    'metadata',
  );
  const metadata = parsed.metadata as Record<string, unknown>;
  if (!integer(metadata.drumsDifficulty, 0) || metadata.drumsDifficulty > 6) {
    corrupt('metadata.drumsDifficulty');
  }
  if (
    !finite(parsed.audioOffsetMs) ||
    !finite(parsed.audioPaddingMs) ||
    parsed.audioPaddingMs < 0
  ) {
    corrupt('audio timing');
  }
}

// The blob is JSON, so the GP file's bytes ride as base64. The ~33% overhead is
// nothing against the bundled audio (tens of KB of GP against megabytes of song),
// and keeping it one JSON member keeps the container to a single extra file.
function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const CHUNK = 0x8000; // spreading a whole GP file into fromCharCode blows the stack
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

export function assertEmbeddedGpBase64Length(encodedLength: number): void {
  if (
    !Number.isSafeInteger(encodedLength) ||
    encodedLength < 0 ||
    encodedLength > MAX_EMBEDDED_GP_BASE64_CHARS
  ) {
    corrupt('gpFileBase64 exceeds 50 MiB');
  }
}

function fromBase64(text: string): Uint8Array {
  if (typeof text !== 'string') corrupt('gpFileBase64');
  assertEmbeddedGpBase64Length(text.length);
  if (
    text.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(text)
  ) {
    corrupt('gpFileBase64');
  }
  const padding = text.endsWith('==') ? 2 : text.endsWith('=') ? 1 : 0;
  const decodedLength = (text.length / 4) * 3 - padding;
  if (decodedLength > MAX_EMBEDDED_GP_BYTES) corrupt('gpFileBase64 exceeds 50 MiB');
  const binary = atob(text);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

export function encodeSessionBlob(blob: SessionBlob): Uint8Array {
  const { gpBytes, ...rest } = blob;
  return new TextEncoder().encode(JSON.stringify({ ...rest, gpFileBase64: toBase64(gpBytes) }));
}

export function decodeSessionBlob(bytes: Uint8Array): SessionBlob {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new SessionRestoreError(CORRUPT);
  }
  if (parsed === null || typeof parsed !== 'object') throw new SessionRestoreError(CORRUPT);

  // An absent version is a corrupt/foreign blob, not "a different version" — that
  // message implies a recognizable-but-mismatched blob, which this isn't.
  if (!('version' in parsed)) throw new SessionRestoreError(CORRUPT, { missing: 'version' });
  if (parsed.version !== 2 && parsed.version !== SESSION_BLOB_VERSION) {
    throw new SessionRestoreError(
      'This .sng was made by a different version of GP2SNG. Re-convert it from the original Guitar Pro file.',
      { version: parsed.version },
    );
  }
  for (const member of REQUIRED_MEMBERS) {
    if (!(member in parsed)) throw new SessionRestoreError(CORRUPT, { missing: member });
  }
  if (parsed.version === 2) {
    if (!integer(parsed.selectedTrackId, 0)) {
      throw new SessionRestoreError(CORRUPT, { missing: 'selectedTrackId' });
    }
    parsed.selectedTrackIds = [parsed.selectedTrackId];
    delete parsed.selectedTrackId;
    parsed.version = SESSION_BLOB_VERSION;
  } else {
    const ids = parsed.selectedTrackIds;
    if (
      !Array.isArray(ids) ||
      ids.length === 0 ||
      !ids.every((id) => integer(id, 0)) ||
      new Set(ids).size !== ids.length
    ) {
      throw new SessionRestoreError(CORRUPT, { missing: 'selectedTrackIds' });
    }
  }
  validateSession(parsed);

  const { gpFileBase64, ...rest } = parsed as unknown as Omit<SessionBlob, 'gpBytes'> & {
    gpFileBase64: string;
  };
  let gpBytes: Uint8Array;
  try {
    gpBytes = fromBase64(gpFileBase64);
  } catch {
    throw new SessionRestoreError(CORRUPT);
  }
  return { ...rest, gpBytes };
}

// A .sng bundles exactly one full-mix stem as song.<ext>. Match the writer's shape
// rather than a fixed extension list: the Preview file picker's `audio/*` accept
// clause admits formats (flac, m4a, aac, oga) beyond the four GP2SNG names in its
// own filter, so writeSng can emit any extension the browser decoded. A second,
// narrower list here would silently make those GP2SNG-produced .sng files
// unreopenable.
const AUDIO_FILE = /^song\.[^.]+$/;

export interface RestoredSession {
  blob: SessionBlob;
  audioBytes: Uint8Array;
  albumArt?: AlbumArt;
}

// Everything a reopened .sng yields, short of parsing its GP bytes — that happens
// in the renderer, matching how a freshly loaded GP file is handled (docs/DESIGN.md
// → IPC contract). Every failure is total: callers get an error, never a partial
// session.
export function readSngSession(sngBytes: Uint8Array): RestoredSession {
  let files: Record<string, Uint8Array>;
  try {
    files = readSng(sngBytes).files;
  } catch {
    throw new SessionRestoreError('That file could not be read as a .sng.');
  }

  const raw = files[SESSION_BLOB_FILENAME];
  if (raw === undefined) {
    throw new SessionRestoreError(
      'This .sng was not created by GP2SNG, so it cannot be reopened for editing.',
    );
  }
  const blob = decodeSessionBlob(raw);

  const audioName = Object.keys(files).find((name) => AUDIO_FILE.test(name));
  if (audioName === undefined) {
    throw new SessionRestoreError(
      'This .sng has no bundled audio, so it cannot be reopened for editing.',
    );
  }

  // Compatibility readers prefer PNG, then the canonical JPEG name, then its
  // legacy spelling. New exports contain at most one artwork member.
  const albumArt =
    files['album.png'] !== undefined
      ? { bytes: files['album.png'], extension: 'png' as const }
      : files['album.jpg'] !== undefined
        ? { bytes: files['album.jpg'], extension: 'jpg' as const }
        : files['album.jpeg'] !== undefined
          ? { bytes: files['album.jpeg'], extension: 'jpg' as const }
          : undefined;

  return { blob, audioBytes: files[audioName], albumArt };
}
