import { strFromU8, unzipSync } from 'fflate';
import { GpParseError } from '../types/index';

export interface GpArchive {
  version: string;
  gpif: string;
}

export function readGpArchive(bytes: Uint8Array): GpArchive {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch (e) {
    throw new GpParseError('Not a valid GP archive (ZIP unpack failed)', { cause: String(e) });
  }
  const versionEntry = files.VERSION;
  const gpifEntry = files['Content/score.gpif'];
  if (!versionEntry) throw new GpParseError('GP archive missing VERSION entry');
  if (!gpifEntry) throw new GpParseError('GP archive missing Content/score.gpif entry');
  return { version: strFromU8(versionEntry).trim(), gpif: strFromU8(gpifEntry) };
}
