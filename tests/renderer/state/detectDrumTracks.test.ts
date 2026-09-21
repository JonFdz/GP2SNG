import { describe, expect, test } from 'vitest';
import { detectDrumTracks } from '../../../src/renderer/src/state/detectDrumTracks';
import type { ParsedGpTrack } from '../../../src/shared/types/index';

function track(id: number, isDrumKit: boolean, noteCount: number): ParsedGpTrack {
  return { id, name: `T${id}`, isDrumKit, noteCount, bars: [] };
}

describe('detectDrumTracks', () => {
  test('returns all drum-kit tracks in score order', () => {
    const tracks = [track(0, true, 10), track(1, true, 42), track(2, true, 5)];
    expect(detectDrumTracks(tracks)).toEqual([0, 1, 2]);
  });

  test('ignores non-drum-kit tracks even when they have more notes', () => {
    const tracks = [track(0, false, 999), track(1, true, 12)];
    expect(detectDrumTracks(tracks)).toEqual([1]);
  });

  test('does not use note counts to choose between drum tracks', () => {
    const tracks = [track(0, true, 20), track(1, true, 20)];
    expect(detectDrumTracks(tracks)).toEqual([0, 1]);
  });

  test('returns an empty selection when there is no drum-kit track', () => {
    const tracks = [track(0, false, 100), track(1, false, 50)];
    expect(detectDrumTracks(tracks)).toEqual([]);
  });

  test('returns an empty selection for an empty track list', () => {
    expect(detectDrumTracks([])).toEqual([]);
  });
});
