// Session paths may have been written on either Windows or POSIX, regardless of
// the host currently reopening them. Split on both separators so new exports keep
// only the display filename without relying on host-specific path APIs.
export function sourceFileName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}
