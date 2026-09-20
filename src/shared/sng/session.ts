import {
  type AlbumArt,
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
  'selectedTrackId',
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

function fromBase64(text: string): Uint8Array {
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
  if (parsed.version !== SESSION_BLOB_VERSION) {
    throw new SessionRestoreError(
      'This .sng was made by a different version of GP2SNG. Re-convert it from the original Guitar Pro file.',
      { version: parsed.version },
    );
  }
  for (const member of REQUIRED_MEMBERS) {
    if (!(member in parsed)) throw new SessionRestoreError(CORRUPT, { missing: member });
  }
  // Presence-only validation would let a malformed `chart`/`sessionMap` crash the
  // renderer deep inside rendering instead of refusing here (there is no error
  // boundary), so these two members — the ones whose malformation crashes rendering
  // — get a shape check. Not a general schema validator: everything else is trusted
  // once present.
  const chartCandidate = parsed.chart as { notes?: unknown } | null;
  if (chartCandidate === null || !Array.isArray(chartCandidate.notes)) {
    throw new SessionRestoreError(CORRUPT, { missing: 'chart.notes' });
  }
  const mapCandidate = parsed.sessionMap as Record<string, unknown> | null;
  if (
    mapCandidate === null ||
    typeof mapCandidate !== 'object' ||
    !YARG_NOTE_IDS.every((id) => id in mapCandidate)
  ) {
    throw new SessionRestoreError(CORRUPT, { missing: 'sessionMap row' });
  }

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

  // Prefer PNG for the compatibility case where an existing container includes
  // both names. New exports contain at most one artwork member.
  const albumArt =
    files['album.png'] !== undefined
      ? { bytes: files['album.png'], extension: 'png' as const }
      : files['album.jpg'] !== undefined
        ? { bytes: files['album.jpg'], extension: 'jpg' as const }
        : undefined;

  return { blob, audioBytes: files[audioName], albumArt };
}
