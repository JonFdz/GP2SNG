import type { ParsedGpTrack } from '../../../shared/types/index';

// Auto-detect the drum track to convert (FUNCTIONALITY step 4): the drum-kit
// track with the most notes. Returns its track id, or null when the score has
// no drum-kit track at all — the Load step rejects such files (GP2SNG converts
// drums only; docs/DESIGN.md → Error handling → Load).
export function detectDrumTrack(tracks: ParsedGpTrack[]): number | null {
  let best: ParsedGpTrack | null = null;
  for (const t of tracks) {
    if (!t.isDrumKit) continue;
    if (best === null || t.noteCount > best.noteCount) best = t;
  }
  return best === null ? null : best.id;
}
