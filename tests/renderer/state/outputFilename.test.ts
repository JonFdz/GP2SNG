import { describe, expect, test } from 'vitest';
import {
  automaticOutputFilenameBase,
  outputFilename,
  reopenedOutputFilenameOverride,
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

describe('reopenedOutputFilenameOverride', () => {
  test('keeps automatic mode when the opened name matches the current default', () => {
    expect(
      reopenedOutputFilenameOverride('C:\\Charts\\Song - Artist.sng', 'Song', 'Artist'),
    ).toBeNull();
    expect(
      reopenedOutputFilenameOverride('/charts/Song - Artist.SNG', 'Song', 'Artist'),
    ).toBeNull();
  });

  test('restores a custom export name without the extension', () => {
    expect(
      reopenedOutputFilenameOverride('C:\\Charts\\Artist - Song - Custom.sng', 'Song', 'Artist'),
    ).toBe('Artist - Song - Custom');
  });

  test('uses an externally renamed filename as the custom name', () => {
    expect(reopenedOutputFilenameOverride('/charts/My Custom Name.SNG', 'Song', 'Artist')).toBe(
      'My Custom Name',
    );
  });

  test('compares against the same sanitized filename used for export', () => {
    expect(
      reopenedOutputFilenameOverride('/charts/AC_DC_ - Band_Name.sng', 'AC/DC:', 'Band?Name'),
    ).toBeNull();
  });
});
