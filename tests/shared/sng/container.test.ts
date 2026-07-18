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
