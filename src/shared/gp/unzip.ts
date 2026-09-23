import { strFromU8, unzipSync } from 'fflate';
import { GpParseError } from '../types/index';

export interface GpArchive {
  version: string;
  gpif: string;
}

export const MAX_VERSION_BYTES = 64 * 1024;
export const MAX_GPIF_BYTES = 64 * 1024 * 1024;

const REQUIRED_LIMITS: Readonly<Record<string, number>> = {
  VERSION: MAX_VERSION_BYTES,
  'Content/score.gpif': MAX_GPIF_BYTES,
};

export function readGpArchive(bytes: Uint8Array): GpArchive {
  let files: Record<string, Uint8Array>;
  let oversized: { name: string; size: number; limit: number } | undefined;
  let duplicate: string | undefined;
  const seenRequired = new Set<string>();
  try {
    files = unzipSync(bytes, {
      filter: (entry) => {
        const limit = REQUIRED_LIMITS[entry.name];
        if (limit === undefined) return false;
        if (seenRequired.has(entry.name)) {
          duplicate ??= entry.name;
          return false;
        }
        seenRequired.add(entry.name);
        if (entry.originalSize > limit) {
          oversized = { name: entry.name, size: entry.originalSize, limit };
          return false;
        }
        return true;
      },
    });
  } catch (e) {
    throw new GpParseError('Not a valid GP archive (ZIP unpack failed)', { cause: String(e) });
  }
  if (duplicate !== undefined) {
    throw new GpParseError(`GP archive contains duplicate ${duplicate} entry`);
  }
  if (oversized !== undefined) {
    throw new GpParseError(`GP archive entry ${oversized.name} is too large`, oversized);
  }
  const versionEntry = files.VERSION;
  const gpifEntry = files['Content/score.gpif'];
  if (!versionEntry) throw new GpParseError('GP archive missing VERSION entry');
  if (!gpifEntry) throw new GpParseError('GP archive missing Content/score.gpif entry');
  return { version: strFromU8(versionEntry).trim(), gpif: strFromU8(gpifEntry) };
}
