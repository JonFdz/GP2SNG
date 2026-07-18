import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { readGpArchive } from '../../../src/shared/gp/unzip';

const exampleBytes = new Uint8Array(
  readFileSync(fileURLToPath(new URL('../../fixtures/example.gp', import.meta.url))),
);

describe('readGpArchive', () => {
  it('extracts VERSION and score.gpif from a real GP7 file', () => {
    const { version, gpif } = readGpArchive(exampleBytes);
    expect(version).toBe('7.0');
    expect(gpif).toContain('<GPIF>');
    expect(gpif).toContain('<EncodingDescription>GP7</EncodingDescription>');
  });

  it('throws GpParseError on non-ZIP bytes', () => {
    expect(() => readGpArchive(new Uint8Array([1, 2, 3, 4]))).toThrow(/valid GP archive/);
  });

  it('throws GpParseError when score.gpif is missing', () => {
    const archive = zipSync({ VERSION: strToU8('7.0') });
    expect(() => readGpArchive(archive)).toThrow(/score\.gpif/);
  });
});
