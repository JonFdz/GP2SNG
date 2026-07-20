import { describe, expect, it } from 'vitest';
import { encodeOggVorbis } from '../../../src/renderer/src/audio/index';

// A second of quiet-but-not-silent stereo. Pure silence compresses to almost
// nothing and would make a length assertion meaningless.
function tone(sampleRate: number, seconds: number): Float32Array[] {
  const n = sampleRate * seconds;
  const left = new Float32Array(n);
  const right = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    left[i] = Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 0.25;
    right[i] = left[i];
  }
  return [left, right];
}

describe('encodeOggVorbis', () => {
  it('produces a well-formed Ogg stream', async () => {
    const bytes = await encodeOggVorbis(tone(48000, 1), 48000);

    expect(bytes.length).toBeGreaterThan(1000);
    // "OggS" capture pattern on the first page.
    expect([...bytes.subarray(0, 4)]).toEqual([0x4f, 0x67, 0x67, 0x53]);
    // The Vorbis identification header follows in the first page's payload.
    expect(new TextDecoder().decode(bytes.subarray(0, 64))).toContain('vorbis');
  }, 30000);

  it('encodes mono', async () => {
    const [left] = tone(48000, 1);
    const bytes = await encodeOggVorbis([left], 48000);
    expect([...bytes.subarray(0, 4)]).toEqual([0x4f, 0x67, 0x67, 0x53]);
  }, 30000);
});
