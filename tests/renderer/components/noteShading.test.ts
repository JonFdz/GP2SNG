import { describe, expect, test } from 'vitest';
import { darken, darkenChannels } from '../../../src/renderer/src/components/noteShading';

describe('darken', () => {
  test('scales each channel 25% toward black by default', () => {
    expect(darken('#ffffff')).toBe('#bfbfbf'); // 255 * 0.75 = 191.25 -> 191 = 0xbf
    expect(darken('#db8324')).toBe('#a4621b'); // a real note color (orange/kick)
  });

  test('black stays black', () => {
    expect(darken('#000000')).toBe('#000000');
  });

  test('zero-pads channels to a full 6-digit hex string', () => {
    expect(darken('#0000ff')).toBe('#0000bf'); // 255*0.75=191=0xbf -> "0000bf"
  });

  test('respects a custom amount', () => {
    expect(darken('#ffffff', 0.5)).toBe('#808080'); // 255 * 0.5 = 127.5 -> 128 = 0x80
  });
});

describe('darkenChannels', () => {
  test('returns the darkened channels as an "r,g,b" string', () => {
    expect(darkenChannels('#ffffff', 0.5)).toBe('128,128,128'); // 255 * 0.5 = 127.5 -> 128
    expect(darkenChannels('#0000ff')).toBe('0,0,191'); // default 0.25: 255 * 0.75 = 191
  });

  test('black stays 0,0,0', () => {
    expect(darkenChannels('#000000')).toBe('0,0,0');
  });
});
