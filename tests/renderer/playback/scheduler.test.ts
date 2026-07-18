import { describe, expect, it } from 'vitest';
import {
  beatCtxTime,
  chartTimeAt,
  computeAudioStart,
} from '../../../src/renderer/src/playback/scheduler';

// computeAudioStart resolves the two AudioBufferSourceNode.start(when, offset)
// arguments (docs/DESIGN.md → Chart preview → Playback, clock & audio sync). Audio
// position for chart time t is t + offsetSeconds.
describe('computeAudioStart', () => {
  it('starts at the top of both timelines with no offset', () => {
    expect(computeAudioStart(0, 0)).toEqual({ whenDelaySeconds: 0, sourceOffsetSeconds: 0 });
  });

  it('starts mid-song immediately at the matching source offset', () => {
    expect(computeAudioStart(5, 0)).toEqual({ whenDelaySeconds: 0, sourceOffsetSeconds: 5 });
  });

  it('starts immediately deeper into the source for a positive (earlier) offset', () => {
    // offset +2s = audio 2s ahead of the chart.
    expect(computeAudioStart(0, 2)).toEqual({ whenDelaySeconds: 0, sourceOffsetSeconds: 2 });
  });

  it('defers the source start for a negative (later) offset past chart 0', () => {
    expect(computeAudioStart(0, -1.5)).toEqual({ whenDelaySeconds: 1.5, sourceOffsetSeconds: 0 });
  });

  it('combines t0 and a negative offset', () => {
    // audio position = 1 + (-3) = -2 -> defer 2s.
    expect(computeAudioStart(1, -3)).toEqual({ whenDelaySeconds: 2, sourceOffsetSeconds: 0 });
  });
});

describe('chartTimeAt', () => {
  it('advances chart time in real time at rate 1', () => {
    expect(chartTimeAt(5, 10, 12, 1)).toBe(7); // 5 + (12-10)*1
  });

  it('advances at double chart-rate when rate is 2', () => {
    expect(chartTimeAt(0, 0, 3, 2)).toBe(6);
  });

  it('advances at half chart-rate when rate is 0.5', () => {
    expect(chartTimeAt(0, 0, 4, 0.5)).toBe(2);
  });
});

describe('beatCtxTime', () => {
  it('is the inverse of chartTimeAt at rate 1', () => {
    // a beat at chart-second 7 with anchors (5,10) occurs at ctx 12.
    expect(beatCtxTime(7, 5, 10, 1)).toBe(12);
  });

  it('stretches beat spacing in ctx time when the rate is below 1', () => {
    // at half speed a chart-second-1 beat is 2 real seconds after the anchor.
    expect(beatCtxTime(1, 0, 0, 0.5)).toBe(2);
  });

  it('compresses beat spacing when the rate is above 1', () => {
    expect(beatCtxTime(2, 0, 0, 2)).toBe(1);
  });
});
