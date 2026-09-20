import { describe, expect, test } from 'vitest';
import {
  automaticOutputFilenameBase,
  outputFilename,
  withoutSngExtension,
} from '../../../src/renderer/src/state/outputFilename';

describe('outputFilename', () => {
  test('builds the automatic name from song and artist', () => {
    expect(automaticOutputFilenameBase('Song', 'Artist')).toBe('Song - Artist');
    expect(outputFilename('Song', 'Artist', null)).toBe('Song - Artist.sng');
  });

  test('trims song and artist', () => {
    expect(outputFilename('  Song  ', '  Artist ', null)).toBe('Song - Artist.sng');
  });

  test('replaces invalid characters in the resulting filename', () => {
    expect(outputFilename('Song', 'Artist', 'AC/DC: Live? - Band')).toBe('AC_DC_ Live_ - Band.sng');
    expect(outputFilename('<Song>', 'Artist|Band', null)).toBe('_Song_ - Artist_Band.sng');
  });

  test('uses a custom base in place of metadata', () => {
    expect(outputFilename('Song', 'Artist', 'Custom Chart')).toBe('Custom Chart.sng');
  });

  test('does not duplicate a typed extension', () => {
    expect(withoutSngExtension('Custom Chart.sng')).toBe('Custom Chart');
    expect(withoutSngExtension('.sng')).toBe('');
    expect(outputFilename('Song', 'Artist', ' Custom Chart.sng ')).toBe('Custom Chart.sng');
    expect(outputFilename('Song', 'Artist', 'Custom Chart.SNG.sng')).toBe('Custom Chart.sng');
  });

  test('rejects blank custom input and extension alone', () => {
    expect(outputFilename('Song', 'Artist', '')).toBeNull();
    expect(outputFilename('Song', 'Artist', '   ')).toBeNull();
    expect(outputFilename('Song', 'Artist', ' .sng ')).toBeNull();
  });

  test('requires song and artist in automatic mode', () => {
    expect(outputFilename(' ', 'Artist', null)).toBeNull();
    expect(outputFilename('Song', ' ', null)).toBeNull();
  });
});
