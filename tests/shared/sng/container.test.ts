import { describe, expect, it } from 'vitest';
import { buildSngContainer, readSng } from '../../../src/shared/sng/index';

const mask = Uint8Array.from({ length: 16 }, (_, i) => i * 7 + 3);
const files = [
  { name: 'notes.mid', bytes: Uint8Array.from([1, 2, 3, 4, 5, 255, 0, 128]) },
  { name: 'song.ogg', bytes: Uint8Array.from({ length: 300 }, (_, i) => i % 256) },
];
const metadata: [string, string][] = [
  ['name', 'My Song'],
  ['artist', 'Me'],
  ['delay', '0'],
  ['empty', ''], // must be dropped
];

describe('buildSngContainer / readSng round-trip', () => {
  const decoded = readSng(buildSngContainer(files, metadata, mask));

  it('recovers file bytes exactly through XOR masking', () => {
    expect([...decoded.files['notes.mid']]).toEqual([1, 2, 3, 4, 5, 255, 0, 128]);
    expect(decoded.files['song.ogg']).toHaveLength(300);
    expect([...decoded.files['song.ogg']].slice(0, 4)).toEqual([0, 1, 2, 3]);
  });

  it('recovers non-empty metadata pairs and drops empty ones', () => {
    expect(decoded.metadata).toEqual({ name: 'My Song', artist: 'Me', delay: '0' });
    expect('empty' in decoded.metadata).toBe(false);
  });

  it('starts with the SNGPKG magic and version 1', () => {
    const raw = buildSngContainer(files, metadata, mask);
    expect([...raw.slice(0, 6)]).toEqual([...new TextEncoder().encode('SNGPKG')]);
    expect(raw[6]).toBe(1); // version uint32 LE, low byte
  });
});

function simpleContainer(): Uint8Array {
  return buildSngContainer([{ name: 'a.bin', bytes: new Uint8Array([1, 2, 3]) }], [], mask);
}

function mutateU64(bytes: Uint8Array, offset: number, value: bigint): Uint8Array {
  const out = bytes.slice();
  new DataView(out.buffer).setBigUint64(offset, value, true);
  return out;
}

describe('readSng malformed-input validation', () => {
  it.each([0, 5, 25])('rejects a truncated container of %i bytes', (length) => {
    expect(() => readSng(simpleContainer().subarray(0, length))).toThrow(/truncated/i);
  });

  it('rejects an oversized or inconsistent metadata section', () => {
    expect(() => readSng(mutateU64(simpleContainer(), 26, BigInt(1024 * 1024 + 1)))).toThrow(
      /metadata/i,
    );
  });

  it('rejects a huge metadata count before iterating', () => {
    expect(() => readSng(mutateU64(simpleContainer(), 34, 257n))).toThrow(/metadata pairs/i);
  });

  it('rejects an unsafe uint64 before converting it to a number', () => {
    expect(() =>
      readSng(mutateU64(simpleContainer(), 26, BigInt(Number.MAX_SAFE_INTEGER) + 1n)),
    ).toThrow(/unsafe 64-bit/i);
  });

  it('rejects a huge file count before iterating', () => {
    // Empty metadata ends at 42; file-index length is at 42 and count at 50.
    expect(() => readSng(mutateU64(simpleContainer(), 50, 129n))).toThrow(/file entries/i);
  });

  it('rejects out-of-range file offsets and lengths before allocating', () => {
    const raw = simpleContainer();
    // One entry: name starts at 59, length at 64, absolute offset at 72.
    expect(() => readSng(mutateU64(raw, 72, BigInt(raw.length + 1)))).toThrow(/outside/i);
    expect(() => readSng(mutateU64(raw, 64, BigInt(raw.length)))).toThrow(/outside/i);
  });

  it('rejects duplicate file names', () => {
    const raw = buildSngContainer(
      [
        { name: 'a', bytes: new Uint8Array([1]) },
        { name: 'b', bytes: new Uint8Array([2]) },
      ],
      [],
      mask,
    );
    // Empty metadata: second entry name follows count + first (1+1+8+8).
    const secondNameOffset = 50 + 8 + (1 + 1 + 8 + 8) + 1;
    const crafted = raw.slice();
    crafted[secondNameOffset] = 'a'.charCodeAt(0);
    expect(() => readSng(crafted)).toThrow(/duplicate/i);
  });

  it('rejects an oversized file-index section', () => {
    expect(() => readSng(mutateU64(simpleContainer(), 42, 40_000n))).toThrow(/file-index/i);
  });
});
