import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  assertFileSize,
  contentSecurityPolicy,
  isTrustedRendererUrl,
  resolveSafeSngOutputPath,
  validateDevelopmentRendererUrl,
} from '../../src/main/security';

describe('main-process file boundaries', () => {
  it('checks the on-disk size before callers read a selected file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'gp2sng-size-'));
    const file = join(dir, 'small.gp');
    await writeFile(file, new Uint8Array(9));
    await expect(assertFileSize(file, 9, 'GP file')).resolves.toBeUndefined();
    await expect(assertFileSize(file, 8, 'GP file')).rejects.toThrow(/too large/);
  });

  it.each(['song.sng', 'Song.SNG', 'a b.sng'])('accepts safe output filename %s', (filename) => {
    expect(resolveSafeSngOutputPath('/charts', filename, 'darwin')).toBe(`/charts/${filename}`);
  });

  it.each([
    '../song.sng',
    'folder/song.sng',
    'folder\\song.sng',
    '/tmp/song.sng',
    '.',
    '..',
    'song.zip',
  ])('rejects unsafe output filename %s', (filename) => {
    expect(() => resolveSafeSngOutputPath('/charts', filename, 'darwin')).toThrow(/Unsafe/);
  });

  it('rejects Windows absolute and traversal paths with Windows semantics', () => {
    expect(() => resolveSafeSngOutputPath('C:\\Charts', 'C:\\evil.sng', 'win32')).toThrow();
    expect(() => resolveSafeSngOutputPath('C:\\Charts', '..\\evil.sng', 'win32')).toThrow();
  });
});

describe('renderer trust boundary', () => {
  it('accepts only the configured development origin', () => {
    const expected = validateDevelopmentRendererUrl('http://localhost:5173/');
    expect(isTrustedRendererUrl('http://localhost:5173/', expected)).toBe(true);
    expect(isTrustedRendererUrl('http://localhost:5173/nested', expected)).toBe(true);
    expect(isTrustedRendererUrl('http://127.0.0.1:5173/', expected)).toBe(false);
    expect(isTrustedRendererUrl('https://example.com/', expected)).toBe(false);
  });

  it('rejects a non-loopback development renderer', () => {
    expect(() => validateDevelopmentRendererUrl('https://example.com/')).toThrow(/loopback/);
  });

  it('requires an exact packaged file URL', () => {
    const expected = new URL('file:///app/out/renderer/index.html');
    expect(isTrustedRendererUrl('file:///app/out/renderer/index.html', expected)).toBe(true);
    expect(isTrustedRendererUrl('file:///tmp/index.html', expected)).toBe(false);
  });

  it('keeps production network access closed except for the embedded WASM data URI', () => {
    const production = contentSecurityPolicy(true);
    expect(production).toContain('connect-src data:');
    expect(production).not.toMatch(/connect-src[^;]*https?:/);
    const dev = contentSecurityPolicy(false, new URL('http://localhost:5173/'));
    expect(dev).toContain('connect-src');
    expect(dev).toContain('ws://localhost:5173');
  });
});
