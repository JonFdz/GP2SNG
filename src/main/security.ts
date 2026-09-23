import { stat } from 'node:fs/promises';
import type path from 'node:path';
import { posix, win32 } from 'node:path';
import { pathToFileURL } from 'node:url';

export const MAX_GP_FILE_BYTES = 50 * 1024 * 1024;
export const MAX_SNG_FILE_BYTES = 512 * 1024 * 1024;

export async function assertFileSize(
  filePath: string,
  maximum: number,
  label: string,
): Promise<void> {
  const info = await stat(filePath);
  if (!info.isFile()) throw new Error(`${label} is not a regular file.`);
  if (info.size > maximum) {
    throw new Error(`${label} is too large (maximum ${Math.floor(maximum / (1024 * 1024))} MiB).`);
  }
}

function pathApi(platform: NodeJS.Platform): typeof path {
  return platform === 'win32' ? win32 : posix;
}

export function resolveSafeSngOutputPath(
  directory: unknown,
  filename: unknown,
  platform: NodeJS.Platform = process.platform,
): string {
  if (typeof directory !== 'string' || directory.length === 0) {
    throw new Error('Output directory must be a non-empty string.');
  }
  if (typeof filename !== 'string' || filename.length === 0) {
    throw new Error('Output filename must be a non-empty string.');
  }

  const api = pathApi(platform);
  if (
    filename === '.' ||
    filename === '..' ||
    api.isAbsolute(filename) ||
    api.basename(filename) !== filename ||
    filename.includes('/') ||
    filename.includes('\\') ||
    !filename.toLowerCase().endsWith('.sng')
  ) {
    throw new Error('Unsafe output filename. Choose a plain .sng filename.');
  }

  const root = api.resolve(directory);
  const target = api.resolve(root, filename);
  const comparisonRoot = platform === 'win32' || platform === 'darwin' ? root.toLowerCase() : root;
  const comparisonTarget =
    platform === 'win32' || platform === 'darwin' ? target.toLowerCase() : target;
  const prefix = comparisonRoot.endsWith(api.sep) ? comparisonRoot : `${comparisonRoot}${api.sep}`;
  if (!comparisonTarget.startsWith(prefix)) throw new Error('Output path escapes its directory.');
  return target;
}

function isLoopback(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

export function validateDevelopmentRendererUrl(value: string): URL {
  const url = new URL(value);
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || !isLoopback(url.hostname)) {
    throw new Error('Development renderer URL must use a loopback HTTP(S) origin.');
  }
  return url;
}

export function isTrustedRendererUrl(actual: string, expected: URL): boolean {
  let candidate: URL;
  try {
    candidate = new URL(actual);
  } catch {
    return false;
  }
  if (expected.protocol === 'file:') {
    return (
      candidate.protocol === 'file:' &&
      candidate.host === expected.host &&
      decodeURIComponent(candidate.pathname) === decodeURIComponent(expected.pathname)
    );
  }
  return candidate.origin === expected.origin;
}

export function packagedRendererUrl(rendererHtmlPath: string): URL {
  return new URL(pathToFileURL(rendererHtmlPath).href);
}

export function contentSecurityPolicy(isPackaged: boolean, developmentUrl?: URL): string {
  const common = [
    "default-src 'none'",
    `script-src 'self' 'wasm-unsafe-eval'${isPackaged ? '' : " 'unsafe-inline'"}`,
    `style-src 'self'${isPackaged ? '' : " 'unsafe-inline'"}`,
    "font-src 'self'",
    "img-src 'self' data: blob:",
    "media-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ];
  // wasm-media-encoders fetches its bundled data:application/wasm URI before
  // WebAssembly instantiation. data: permits that local payload without granting
  // any HTTP(S) network access in production.
  if (isPackaged) common.push('connect-src data:');
  else {
    if (developmentUrl === undefined) throw new Error('Development CSP requires its renderer URL.');
    const websocket = `${developmentUrl.protocol === 'https:' ? 'wss:' : 'ws:'}//${developmentUrl.host}`;
    common.push(`connect-src 'self' data: ${developmentUrl.origin} ${websocket}`);
  }
  return common.join('; ');
}
