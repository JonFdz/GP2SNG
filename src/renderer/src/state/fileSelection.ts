export const MAX_AUDIO_FILE_BYTES = 256 * 1024 * 1024;
export const MAX_ALBUM_ART_FILE_BYTES = 20 * 1024 * 1024;

export function isFileWithinSizeLimit(file: { size: number }, maximum: number): boolean {
  return file.size <= maximum;
}
