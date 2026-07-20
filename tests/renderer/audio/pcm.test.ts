import { describe, expect, it } from 'vitest';
import { padPcm, trimPcm } from '../../../src/renderer/src/audio/index';

describe('padPcm', () => {
  it('prepends silence to every channel and preserves the samples', () => {
    const channels = [Float32Array.from([1, 2, 3]), Float32Array.from([4, 5, 6])];
    const padded = padPcm(channels, 10, 0.5); // 5 samples of silence

    expect(padded).toHaveLength(2);
    expect(padded[0]).toHaveLength(8);
    expect([...padded[0]]).toEqual([0, 0, 0, 0, 0, 1, 2, 3]);
    expect([...padded[1]]).toEqual([0, 0, 0, 0, 0, 4, 5, 6]);
  });

  it('is a no-op for zero seconds', () => {
    const channels = [Float32Array.from([1, 2, 3])];
    expect([...padPcm(channels, 10, 0)[0]]).toEqual([1, 2, 3]);
  });

  it('does not mutate its input', () => {
    const channels = [Float32Array.from([1, 2, 3])];
    padPcm(channels, 10, 1);
    expect([...channels[0]]).toEqual([1, 2, 3]);
  });
});

describe('trimPcm', () => {
  it('drops leading samples from every channel', () => {
    const channels = [Float32Array.from([0, 0, 1, 2]), Float32Array.from([0, 0, 3, 4])];
    const trimmed = trimPcm(channels, 10, 0.2); // 2 samples

    expect([...trimmed[0]]).toEqual([1, 2]);
    expect([...trimmed[1]]).toEqual([3, 4]);
  });

  it('round-trips with padPcm', () => {
    const channels = [Float32Array.from([1, 2, 3])];
    const back = trimPcm(padPcm(channels, 10, 0.5), 10, 0.5);
    expect([...back[0]]).toEqual([1, 2, 3]);
  });

  it('clamps rather than underflowing when asked to trim past the end', () => {
    const channels = [Float32Array.from([1, 2])];
    expect([...trimPcm(channels, 10, 99)[0]]).toEqual([]);
  });
});
