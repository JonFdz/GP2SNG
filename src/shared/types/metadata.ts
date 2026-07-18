// User-editable song metadata gathered on the preview screen
// (docs/DESIGN.md → Chart preview + playback component → Metadata form).
export interface SongMetadata {
  name: string; // required
  artist: string; // required
  album: string;
  genre: string;
  year: string;
  charter: string; // defaulted "<Tabber> via GP2SNG"
  drumsDifficulty: number; // required integer 0-6
}
