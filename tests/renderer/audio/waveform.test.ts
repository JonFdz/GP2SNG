import { describe, expect, it } from 'vitest';
import { buildWaveformOverview } from '../../../src/renderer/src/audio/waveform';

function source(channels: Float32Array[], sampleRate: number, length = channels[0]?.length ?? 0) {
  return {
    length,
    sampleRate,
    numberOfChannels: channels.length,
    getChannelData: (index: number) => channels[index],
  };
}

describe('buildWaveformOverview', () => {
  it('returns an empty overview for empty or invalid source data', () => {
    for (const input of [
      source([], 44100),
      source([new Float32Array(0)], 44100),
      source([new Float32Array(2)], 0),
    ]) {
      const overview = buildWaveformOverview(input);
      expect(overview.durationSeconds).toBe(0);
      expect(overview.min.length).toBe(0);
      expect(overview.max.length).toBe(0);
    }
  });

  it('groups mono samples into deterministic 10 ms buckets with min and max', () => {
    const overview = buildWaveformOverview(
      source([new Float32Array([-0.5, 0.25, 0.75, -0.25, -0.8, 0.1])], 400),
    );
    expect(overview.durationSeconds).toBe(0.015);
    expect(overview.bucketDurationSeconds).toBe(0.01);
    expect(overview.min[0]).toBeCloseTo(-0.5);
    expect(overview.max[0]).toBeCloseTo(0.75);
    expect(overview.min[1]).toBeCloseTo(-0.8);
    expect(overview.max[1]).toBeCloseTo(0.1);
    expect(overview.min.length).toBe(2);
  });

  it('averages all channels per sample and bounds invalid amplitudes', () => {
    const overview = buildWaveformOverview(
      source(
        [
          new Float32Array([1, -1, Number.NaN, 5, -5]),
          new Float32Array([-1, 0.5, Number.POSITIVE_INFINITY, 0, 0]),
          new Float32Array([0.5, 0.5, 0.25, 0, 0]),
        ],
        100,
      ),
    );
    for (const [index, expected] of [0.5 / 3, 0, 0.25 / 3, 1 / 3, -1 / 3].entries()) {
      expect(overview.min[index]).toBeCloseTo(expected);
      expect(overview.max[index]).toBeCloseTo(expected);
    }
    expect(
      [...overview.min, ...overview.max].every((v) => Number.isFinite(v) && v >= -1 && v <= 1),
    ).toBe(true);
  });

  it('keeps a four-minute overview compact at 10 ms resolution', () => {
    const overview = buildWaveformOverview(source([new Float32Array(240 * 100)], 100));
    expect(overview.durationSeconds).toBe(240);
    expect(overview.min.length).toBe(24000);
    expect(overview.min.byteLength + overview.max.byteLength).toBe(192000);
  });
});
