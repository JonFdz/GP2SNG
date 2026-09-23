import { describe, expect, it } from 'vitest';

// @ts-expect-error Project-owned Node scripts intentionally have no declaration file.
import { payloadMatchKinds } from '../../scripts/check-wasm-bundle.mjs';

describe('WASM payload matching', () => {
  const payload = Buffer.from([0x00, 0x61, 0x73, 0x6d, 0xde, 0xad, 0xbe, 0xef]);

  it('finds exact binary payloads', () => {
    expect(payloadMatchKinds(Buffer.concat([Buffer.from('prefix'), payload]), payload)).toEqual([
      'exact bytes',
    ]);
  });

  it('finds inline base64 payloads', () => {
    const source = Buffer.from(`data:application/wasm;base64,${payload.toString('base64')}`);
    expect(payloadMatchKinds(source, payload)).toEqual(['base64']);
  });

  it('does not match unrelated content', () => {
    expect(
      payloadMatchKinds(Buffer.from('mentions ogg and mp3 but has no payload'), payload),
    ).toEqual([]);
  });
});
