import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { readGpArchive } from '../../../src/shared/gp/unzip';

const exampleBytes = new Uint8Array(
  readFileSync(fileURLToPath(new URL('../../fixtures/example.gp', import.meta.url))),
);

function withDeclaredSize(archive: Uint8Array, name: string, size: number): Uint8Array {
  const out = archive.slice();
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
  const encodedName = new TextEncoder().encode(name);
  for (let i = 0; i <= out.length - 46 - encodedName.length; i++) {
    if (view.getUint32(i, true) !== 0x02014b50) continue;
    const nameLength = view.getUint16(i + 28, true);
    if (nameLength !== encodedName.length) continue;
    if (encodedName.every((byte, j) => out[i + 46 + j] === byte)) {
      view.setUint32(i + 24, size, true);
      return out;
    }
  }
  throw new Error(`Central-directory entry not found: ${name}`);
}

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

  it('throws GpParseError when VERSION is missing', () => {
    const archive = zipSync({ 'Content/score.gpif': strToU8('<GPIF/>') });
    expect(() => readGpArchive(archive)).toThrow(/VERSION/);
  });

  it.each([
    ['VERSION', 64 * 1024 + 1],
    ['Content/score.gpif', 64 * 1024 * 1024 + 1],
  ])('rejects an oversized declared %s entry without inflating it', (name, size) => {
    const archive = zipSync({ VERSION: strToU8('7.0'), 'Content/score.gpif': strToU8('<GPIF/>') });
    expect(() => readGpArchive(withDeclaredSize(archive, name, size))).toThrow(/too large/);
  });

  it('skips an irrelevant archive member even when its declared size is enormous', () => {
    const archive = zipSync({
      VERSION: strToU8('7.0'),
      'Content/score.gpif': strToU8('<GPIF/>'),
      'Content/irrelevant.bin': new Uint8Array([1]),
    });
    const crafted = withDeclaredSize(archive, 'Content/irrelevant.bin', 0xfffffff0);
    expect(readGpArchive(crafted)).toEqual({ version: '7.0', gpif: '<GPIF/>' });
  });
});
