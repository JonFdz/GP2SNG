import { describe, expect, it } from 'vitest';
import {
  previewAudioOffsetSeconds,
  repadPcm,
  resolveExportAudio,
} from '../../../src/renderer/src/audio/index';

const SAMPLE_RATE = 48000;
const channels = () => [Float32Array.from({ length: SAMPLE_RATE }, (_, i) => i / SAMPLE_RATE)];

describe('resolveExportAudio', () => {
  it('passes the bytes through untouched when the padding already matches', async () => {
    const bytes = Uint8Array.from([1, 2, 3, 4]);
    const result = await resolveExportAudio({
      bytes,
      channels: channels(),
      sampleRate: SAMPLE_RATE,
      currentPaddingMs: 2909,
      targetPaddingMs: 2909,
    });

    expect(result.bytes).toBe(bytes); // identity, not just equality
    expect(result.paddingMs).toBe(2909);
    expect(result.extension).toBe('ogg');
  });

  it('encodes padded audio when there is none yet', async () => {
    const result = await resolveExportAudio({
      bytes: Uint8Array.from([1, 2, 3, 4]),
      channels: channels(),
      sampleRate: SAMPLE_RATE,
      currentPaddingMs: 0,
      targetPaddingMs: 1000,
    });

    expect(result.paddingMs).toBe(1000);
    expect([...result.bytes.subarray(0, 4)]).toEqual([0x4f, 0x67, 0x67, 0x53]);
  }, 30000);

  it('reports the target padding after re-encoding', async () => {
    const result = await resolveExportAudio({
      bytes: Uint8Array.from([1]),
      channels: channels(),
      sampleRate: SAMPLE_RATE,
      currentPaddingMs: 500,
      targetPaddingMs: 1500,
    });

    expect(result.paddingMs).toBe(1500);
  }, 30000);
});

describe('repadPcm', () => {
  it('replaces the existing padding rather than stacking on top of it', () => {
    // 1 s of source - 0.5 s trimmed + 1.5 s padded = 2 s
    const out = repadPcm(channels(), SAMPLE_RATE, 500, 1500);
    expect(out[0].length).toBe(SAMPLE_RATE * 2);
  });

  it('pads from nothing when there is no existing padding', () => {
    const out = repadPcm(channels(), SAMPLE_RATE, 0, 1000);
    expect(out[0].length).toBe(SAMPLE_RATE * 2);
    expect(out[0][0]).toBe(0);
    expect(out[0][SAMPLE_RATE]).toBe(0); // first source sample is 0 too
    expect(out[0][SAMPLE_RATE + 1]).toBeCloseTo(1 / SAMPLE_RATE, 9);
  });

  it('shortens the stream when the target is smaller than the current padding', () => {
    const out = repadPcm(channels(), SAMPLE_RATE, 1000, 0);
    expect(out[0].length).toBe(0);
  });
});

describe('previewAudioOffsetSeconds', () => {
  const chart = {
    leadInTicks: 3840,
    resolution: 480,
    tempoMap: [{ tick: 0, usPerQuarter: 500000 }],
  };

  it('holds unpadded audio back through the lead-in', () => {
    // 3840 ticks at 480 PPQ, 120 BPM = 4 s
    expect(previewAudioOffsetSeconds(chart, 0, 0)).toBeCloseTo(-4, 6);
  });

  it('starts already-padded audio at chart time zero', () => {
    expect(previewAudioOffsetSeconds(chart, 0, 4000)).toBeCloseTo(0, 6);
  });

  it('adds the user offset on top', () => {
    expect(previewAudioOffsetSeconds(chart, 120, 4000)).toBeCloseTo(0.12, 6);
  });
});
