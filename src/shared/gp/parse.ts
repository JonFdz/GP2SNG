import { GpParseError, type ParsedGpScore } from '../types/index';
import { parseMasterBars, parseMetadata, parseTempoAutomations } from './score';
import { parseTracks } from './tracks';
import { readGpArchive } from './unzip';
import { child, parseXml, text, type XmlNode } from './xml';

export function parseGp(bytes: Uint8Array): ParsedGpScore {
  const { version, gpif } = readGpArchive(bytes);
  // GP7 and GP8 share one container and one score.gpif schema — AlphaTab reads
  // both through a single Gp7To8Importer with no version branching, so we accept
  // either. (GP8 is unverified against a real file; see docs/GP_FORMAT.md.)
  if (!version.startsWith('7') && !version.startsWith('8')) {
    throw new GpParseError(`Unsupported GP version "${version}" (expected 7.x or 8.x)`, {
      version,
    });
  }
  const doc = parseXml(gpif);
  const root = child(doc, 'GPIF') as XmlNode | undefined;
  if (!root) throw new GpParseError('score.gpif has no <GPIF> root');

  const encoding = text(child(child(root, 'Encoding'), 'EncodingDescription'));
  if (encoding !== '' && encoding !== 'GP7' && encoding !== 'GP8') {
    throw new GpParseError(`Unsupported encoding "${encoding}" (expected GP7 or GP8)`, {
      encoding,
    });
  }

  return {
    metadata: parseMetadata(root),
    tempoAutomations: parseTempoAutomations(root),
    masterBars: parseMasterBars(root),
    tracks: parseTracks(root),
  };
}
