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

interface SngLayout {
  dataLengthOffset: number;
  dataLength: number;
  entries: { lengthOffset: number; offsetOffset: number; offset: number }[];
}

function inspectSngLayout(bytes: Uint8Array): SngLayout {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const metadataLength = Number(view.getBigUint64(26, true));
  const fileIndexLengthOffset = 34 + metadataLength;
  const fileIndexLength = Number(view.getBigUint64(fileIndexLengthOffset, true));
  const entryCount = Number(view.getBigUint64(fileIndexLengthOffset + 8, true));
  let cursor = fileIndexLengthOffset + 16;
  const entries: SngLayout['entries'] = [];
  for (let i = 0; i < entryCount; i++) {
    const nameLength = bytes[cursor];
    cursor += 1 + nameLength;
    const lengthOffset = cursor;
    cursor += 8;
    const offsetOffset = cursor;
    const offset = Number(view.getBigUint64(cursor, true));
    cursor += 8;
    entries.push({ lengthOffset, offsetOffset, offset });
  }
  const dataLengthOffset = fileIndexLengthOffset + 8 + fileIndexLength;
  return {
    dataLengthOffset,
    dataLength: Number(view.getBigUint64(dataLengthOffset, true)),
    entries,
  };
}

function twoFileContainer(firstLength: number, secondLength: number): Uint8Array {
  return buildSngContainer(
    [
      { name: 'a', bytes: Uint8Array.from({ length: firstLength }, (_, i) => i + 1) },
      { name: 'b', bytes: Uint8Array.from({ length: secondLength }, (_, i) => i + 11) },
    ],
    [],
    mask,
  );
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

  it('rejects aggregate declared file lengths greater than the file-data section', () => {
    const raw = twoFileContainer(4, 4);
    const layout = inspectSngLayout(raw);
    const crafted = mutateU64(raw, layout.entries[0].lengthOffset, 5n);
    expect(() => readSng(crafted)).toThrow(/aggregate/i);
  });

  it('rejects two entries with the same non-empty file-data range', () => {
    const raw = twoFileContainer(4, 4);
    const layout = inspectSngLayout(raw);
    const crafted = mutateU64(
      raw,
      layout.entries[1].offsetOffset,
      BigInt(layout.entries[0].offset),
    );
    expect(() => readSng(crafted)).toThrow(/overlap/i);
  });

  it('rejects partially overlapping file-data ranges', () => {
    const raw = twoFileContainer(4, 4);
    const layout = inspectSngLayout(raw);
    const crafted = mutateU64(
      raw,
      layout.entries[1].offsetOffset,
      BigInt(layout.entries[0].offset + 2),
    );
    expect(() => readSng(crafted)).toThrow(/overlap/i);
  });

  it('rejects a file-data range contained inside another range', () => {
    const raw = twoFileContainer(6, 2);
    const layout = inspectSngLayout(raw);
    const crafted = mutateU64(
      raw,
      layout.entries[1].offsetOffset,
      BigInt(layout.entries[0].offset + 2),
    );
    expect(() => readSng(crafted)).toThrow(/overlap/i);
  });

  it('accepts adjacent file-data ranges', () => {
    const decoded = readSng(twoFileContainer(2, 2));
    expect([...decoded.files.a]).toEqual([1, 2]);
    expect([...decoded.files.b]).toEqual([11, 12]);
  });

  it('accepts file-data ranges separated by a gap', () => {
    const raw = twoFileContainer(2, 2);
    const layout = inspectSngLayout(raw);
    const insertionOffset = layout.entries[1].offset;
    const crafted = new Uint8Array(raw.length + 1);
    crafted.set(raw.subarray(0, insertionOffset));
    crafted[insertionOffset] = 0xff;
    crafted.set(raw.subarray(insertionOffset), insertionOffset + 1);
    const view = new DataView(crafted.buffer);
    view.setBigUint64(layout.entries[1].offsetOffset, BigInt(layout.entries[1].offset + 1), true);
    view.setBigUint64(layout.dataLengthOffset, BigInt(layout.dataLength + 1), true);

    const decoded = readSng(crafted);
    expect([...decoded.files.a]).toEqual([1, 2]);
    expect([...decoded.files.b]).toEqual([11, 12]);
  });

  it('allows zero-length entries at the start of a non-empty range', () => {
    const raw = buildSngContainer(
      [
        { name: 'empty', bytes: new Uint8Array() },
        { name: 'data', bytes: new Uint8Array([7]) },
      ],
      [],
      mask,
    );
    const decoded = readSng(raw);
    expect(decoded.files.empty).toHaveLength(0);
    expect([...decoded.files.data]).toEqual([7]);
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
