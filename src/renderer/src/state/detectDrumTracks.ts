import type { ParsedGpTrack } from '../../../shared/types/index';

// Auto-select every drum-kit track in score order. Other tracks remain available
// for manual selection on the Load step.
export function detectDrumTracks(tracks: readonly ParsedGpTrack[]): number[] {
  return tracks.filter((track) => track.isDrumKit).map((track) => track.id);
}
