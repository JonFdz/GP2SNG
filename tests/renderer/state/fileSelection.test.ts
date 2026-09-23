import { describe, expect, it, vi } from 'vitest';
import {
  isFileWithinSizeLimit,
  MAX_ALBUM_ART_FILE_BYTES,
  MAX_AUDIO_FILE_BYTES,
} from '../../../src/renderer/src/state/fileSelection';

describe('selected file size limits', () => {
  it.each([
    ['audio', MAX_AUDIO_FILE_BYTES],
    ['artwork', MAX_ALBUM_ART_FILE_BYTES],
  ])('accepts a %s file exactly at its limit', (_label, limit) => {
    expect(isFileWithinSizeLimit({ size: limit }, limit)).toBe(true);
  });

  it.each([
    ['audio', MAX_AUDIO_FILE_BYTES],
    ['artwork', MAX_ALBUM_ART_FILE_BYTES],
  ])('rejects a %s file one byte over its limit', (_label, limit) => {
    expect(isFileWithinSizeLimit({ size: limit + 1 }, limit)).toBe(false);
  });

  it('keeps the audio and artwork limits independent', () => {
    expect(MAX_AUDIO_FILE_BYTES).toBe(256 * 1024 * 1024);
    expect(MAX_ALBUM_ART_FILE_BYTES).toBe(20 * 1024 * 1024);
    expect(
      isFileWithinSizeLimit({ size: MAX_ALBUM_ART_FILE_BYTES + 1 }, MAX_AUDIO_FILE_BYTES),
    ).toBe(true);
  });

  it('checks metadata only and never reads or allocates the file contents', () => {
    const file = { size: MAX_AUDIO_FILE_BYTES + 1, arrayBuffer: vi.fn() };

    expect(isFileWithinSizeLimit(file, MAX_AUDIO_FILE_BYTES)).toBe(false);
    expect(file.arrayBuffer).not.toHaveBeenCalled();
  });
});
