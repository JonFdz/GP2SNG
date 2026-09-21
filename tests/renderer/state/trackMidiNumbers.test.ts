import { describe, expect, test } from 'vitest';
import { trackMidiNumbers } from '../../../src/renderer/src/state/trackMidiNumbers';
import type { GpBeat, ParsedGpTrack } from '../../../src/shared/types/index';

function beat(...midis: number[]): GpBeat {
  return {
    durationNum: 1,
    durationDen: 4,
    notes: midis.map((midi) => ({ midi, ghost: false, accent: false })),
    isGrace: false,
  };
}

function track(...bars: GpBeat[][]): ParsedGpTrack {
  return {
    id: 0,
    name: 'Drums',
    isDrumKit: true,
    noteCount: 0,
    bars: bars.map((beats) => ({ voices: [{ beats }] })),
  };
}

describe('trackMidiNumbers', () => {
  test('collects distinct MIDI numbers across bars, sorted ascending', () => {
    const t = track([beat(38, 42), beat(36)], [beat(42, 46)]);
    expect(trackMidiNumbers([t])).toEqual([36, 38, 42, 46]);
  });

  test('returns an empty array for a track with no notes', () => {
    expect(trackMidiNumbers([track([beat()])])).toEqual([]);
    expect(trackMidiNumbers([track()])).toEqual([]);
  });

  test('gathers numbers from every voice in a bar', () => {
    const t: ParsedGpTrack = {
      id: 1,
      name: 'Drums',
      isDrumKit: true,
      noteCount: 0,
      bars: [{ voices: [{ beats: [beat(38)] }, { beats: [beat(36, 42)] }] }],
    };
    expect(trackMidiNumbers([t])).toEqual([36, 38, 42]);
  });

  test('unions MIDI numbers across tracks without duplicates', () => {
    expect(trackMidiNumbers([track([beat(36, 38, 42)]), track([beat(38, 51, 55)])])).toEqual([
      36, 38, 42, 51, 55,
    ]);
  });
});
