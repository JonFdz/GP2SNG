import { describe, expect, test } from 'vitest';
import { detectDrumTrack } from '../../../src/renderer/src/state/detectDrumTrack';
import type { ParsedGpTrack } from '../../../src/shared/types/index';

function track(id: number, isDrumKit: boolean, noteCount: number): ParsedGpTrack {
  return { id, name: `T${id}`, isDrumKit, noteCount, bars: [] };
}

describe('detectDrumTrack', () => {
  test('returns the drum-kit track with the most notes', () => {
    const tracks = [track(0, true, 10), track(1, true, 42), track(2, true, 5)];
    expect(detectDrumTrack(tracks)).toBe(1);
  });

  test('ignores non-drum-kit tracks even when they have more notes', () => {
    const tracks = [track(0, false, 999), track(1, true, 12)];
    expect(detectDrumTrack(tracks)).toBe(1);
  });

  test('breaks ties by track order (first wins)', () => {
    const tracks = [track(0, true, 20), track(1, true, 20)];
    expect(detectDrumTrack(tracks)).toBe(0);
  });

  test('returns null when there is no drum-kit track', () => {
    const tracks = [track(0, false, 100), track(1, false, 50)];
    expect(detectDrumTrack(tracks)).toBeNull();
  });

  test('returns null for an empty track list', () => {
    expect(detectDrumTrack([])).toBeNull();
  });
});
