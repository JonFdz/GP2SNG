// The editable base follows metadata until the user supplies a conversion-local override.
export function automaticOutputFilenameBase(songName: string, artist: string): string {
  return `${songName.trim()} - ${artist.trim()}`;
}

// The suffix belongs to the application, even if it is pasted or typed into the field.
export function withoutSngExtension(value: string): string {
  return value.replace(/(?:\.sng)+\s*$/i, '');
}

// Use the same normalized filename for the footer, overwrite check, and write.
// Invalid Windows/POSIX filename characters retain the replacement used by Finalize.
export function outputFilename(
  songName: string,
  artist: string,
  override: string | null,
): string | null {
  if (override === null && (songName.trim() === '' || artist.trim() === '')) return null;

  const base =
    override === null
      ? automaticOutputFilenameBase(songName, artist)
      : withoutSngExtension(override.trim()).trim();
  if (base === '') return null;

  const sanitized = base.replace(/[<>:"/\\|?*]/g, '_');
  return `${sanitized}.sng`;
}

// A reopened .sng's actual filesystem name is its export name. Keep automatic
// mode only when that name matches what the current metadata would export.
export function reopenedOutputFilenameOverride(
  sngFilePath: string,
  songName: string,
  artist: string,
): string | null {
  const openedBase = withoutSngExtension(sngFilePath.split(/[\\/]/).pop() ?? '');
  const automatic = outputFilename(songName, artist, null);
  return automatic !== null && openedBase === withoutSngExtension(automatic) ? null : openedBase;
}
