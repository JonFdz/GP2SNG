import type { GpMetadata, SongMetadata } from '../../../shared/types/index';

// Pre-populate the preview metadata form from the parsed GP score
// (docs/DESIGN.md → Chart preview → Metadata form). Drums difficulty has no GP
// source and no default, so it starts unset (NaN) and blocks Save until set.
export function defaultMetadata(gp: GpMetadata): SongMetadata {
  return {
    name: gp.title,
    artist: gp.artist,
    album: gp.album,
    genre: '',
    year: '',
    charter: gp.tabber === '' ? 'GP2SNG' : `${gp.tabber} via GP2SNG`,
    drumsDifficulty: Number.NaN,
  };
}

export interface MetadataErrors {
  name?: string;
  artist?: string;
  drumsDifficulty?: string;
}

// Inline field validation that gates the Save button (docs/DESIGN.md → Error
// handling → Metadata). Empty = no errors reported for that field.
export function metadataErrors(m: SongMetadata): MetadataErrors {
  const errors: MetadataErrors = {};
  if (m.name.trim() === '') errors.name = 'Song name is required';
  if (m.artist.trim() === '') errors.artist = 'Artist is required';
  const d = m.drumsDifficulty;
  if (!Number.isInteger(d) || d < 0 || d > 6) {
    errors.drumsDifficulty = 'Drums difficulty must be an integer 0–6';
  }
  return errors;
}

export function isMetadataValid(m: SongMetadata): boolean {
  return Object.keys(metadataErrors(m)).length === 0;
}
