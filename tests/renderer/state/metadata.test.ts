import { describe, expect, it } from 'vitest';
import { defaultMetadata, metadataErrors } from '../../../src/renderer/src/state/metadata';
import type { GpMetadata, SongMetadata } from '../../../src/shared/types/index';

const gp: GpMetadata = {
  title: 'My Song',
  subtitle: '',
  artist: 'The Band',
  album: 'The Album',
  copyright: '',
  tabber: 'Maximus',
};

describe('defaultMetadata', () => {
  it('pre-populates name/artist/album from GP and defaults the charter', () => {
    const m = defaultMetadata(gp);
    expect(m.name).toBe('My Song');
    expect(m.artist).toBe('The Band');
    expect(m.album).toBe('The Album');
    expect(m.charter).toBe('Maximus via GP2SNG');
    expect(m.genre).toBe('');
    expect(m.year).toBe('');
  });

  it('defaults the charter to just "GP2SNG" when GP has no tabber', () => {
    expect(defaultMetadata({ ...gp, tabber: '' }).charter).toBe('GP2SNG');
  });

  it('leaves drums difficulty unset (no default)', () => {
    expect(Number.isNaN(defaultMetadata(gp).drumsDifficulty)).toBe(true);
  });
});

const valid: SongMetadata = {
  name: 'Song',
  artist: 'Artist',
  album: '',
  genre: '',
  year: '',
  charter: 'X via GP2SNG',
  drumsDifficulty: 4,
};

describe('metadataErrors', () => {
  it('reports no errors for valid metadata', () => {
    expect(metadataErrors(valid)).toEqual({});
  });

  it('requires a non-blank song name and artist', () => {
    expect(metadataErrors({ ...valid, name: '' }).name).toBeTruthy();
    expect(metadataErrors({ ...valid, name: '   ' }).name).toBeTruthy();
    expect(metadataErrors({ ...valid, artist: '' }).artist).toBeTruthy();
  });

  it('requires drums difficulty to be an integer 0–6', () => {
    expect(metadataErrors({ ...valid, drumsDifficulty: Number.NaN }).drumsDifficulty).toBeTruthy();
    expect(metadataErrors({ ...valid, drumsDifficulty: -1 }).drumsDifficulty).toBeTruthy();
    expect(metadataErrors({ ...valid, drumsDifficulty: 7 }).drumsDifficulty).toBeTruthy();
    expect(metadataErrors({ ...valid, drumsDifficulty: 3.5 }).drumsDifficulty).toBeTruthy();
    expect(metadataErrors({ ...valid, drumsDifficulty: 0 }).drumsDifficulty).toBeUndefined();
    expect(metadataErrors({ ...valid, drumsDifficulty: 6 }).drumsDifficulty).toBeUndefined();
  });
});
