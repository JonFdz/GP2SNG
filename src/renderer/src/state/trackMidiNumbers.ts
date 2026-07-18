import type { ParsedGpTrack } from '../../../shared/types/index';

// The distinct MIDI numbers present in a track's notes, sorted ascending. Drives
// the per-song Mapping step's `displayNumbers` (docs/DESIGN.md → MIDI map component
// → Per-song call site): the universe of cards the Mapping view renders.
export function trackMidiNumbers(track: ParsedGpTrack): number[] {
  const seen = new Set<number>();
  for (const bar of track.bars) {
    for (const voice of bar.voices) {
      for (const beat of voice.beats) {
        for (const note of beat.notes) seen.add(note.midi);
      }
    }
  }
  return [...seen].sort((a, b) => a - b);
}
