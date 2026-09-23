import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  checkRuntimeNotices,
  collectRuntimePackages,
  expectedRuntimeNotices,
  // @ts-expect-error Project-owned Node scripts intentionally have no declaration file.
} from '../../scripts/runtime-license-notices.mjs';

const temporaryDirectories: string[] = [];

async function temporaryRoot() {
  const root = await mkdtemp(path.join(tmpdir(), 'gp2sng-license-test-'));
  temporaryDirectories.push(root);
  return root;
}

async function writePackage(
  root: string,
  lockPath: string,
  metadata: Record<string, unknown>,
  licenseText: string | null = 'fixture license text\n',
) {
  const directory = path.join(root, ...lockPath.split('/'));
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, 'package.json'), `${JSON.stringify(metadata)}\n`);
  if (licenseText !== null) await writeFile(path.join(directory, 'LICENSE'), licenseText);
}

async function writeLock(root: string, packages: Record<string, unknown>) {
  await writeFile(
    path.join(root, 'package-lock.json'),
    `${JSON.stringify({ name: 'fixture', lockfileVersion: 3, packages })}\n`,
  );
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  );
});

describe('runtime license notices', () => {
  it('walks production dependencies, handles scoped names, excludes dev-only packages, and sorts stably', async () => {
    const root = await temporaryRoot();
    await writeLock(root, {
      '': {
        dependencies: { 'z-runtime': '1.0.0', 'a-runtime': '1.0.0' },
        devDependencies: { 'dev-only': '1.0.0' },
      },
      'node_modules/a-runtime': {
        version: '1.0.0',
        license: 'MIT',
        dependencies: { '@scope/child': '2.0.0' },
      },
      'node_modules/@scope/child': { version: '2.0.0', license: 'MIT' },
      'node_modules/z-runtime': { version: '1.0.0', license: 'MIT' },
      'node_modules/dev-only': { version: '1.0.0', license: 'MIT', dev: true },
    });
    await writePackage(root, 'node_modules/a-runtime', {
      name: 'a-runtime',
      version: '1.0.0',
      license: 'MIT',
    });
    await writePackage(root, 'node_modules/@scope/child', {
      name: '@scope/child',
      version: '2.0.0',
      license: 'MIT',
    });
    await writePackage(root, 'node_modules/z-runtime', {
      name: 'z-runtime',
      version: '1.0.0',
      license: 'MIT',
    });
    await writePackage(root, 'node_modules/dev-only', {
      name: 'dev-only',
      version: '1.0.0',
      license: 'MIT',
    });

    const first = await collectRuntimePackages({ rootDir: root, licenseFallbacks: [] });
    const second = await collectRuntimePackages({ rootDir: root, licenseFallbacks: [] });
    expect(first.map(({ name }: { name: string }) => name)).toEqual([
      '@scope/child',
      'a-runtime',
      'z-runtime',
    ]);
    expect(second).toEqual(first);
  });

  it('resolves a dependency from the nearest nested node_modules path', async () => {
    const root = await temporaryRoot();
    await writeLock(root, {
      '': { dependencies: { parent: '1.0.0' } },
      'node_modules/parent': {
        version: '1.0.0',
        license: 'MIT',
        dependencies: { shared: '2.0.0' },
      },
      'node_modules/parent/node_modules/shared': { version: '2.0.0', license: 'MIT' },
      'node_modules/shared': { version: '1.0.0', license: 'MIT' },
    });
    await writePackage(root, 'node_modules/parent', {
      name: 'parent',
      version: '1.0.0',
      license: 'MIT',
    });
    await writePackage(root, 'node_modules/parent/node_modules/shared', {
      name: 'shared',
      version: '2.0.0',
      license: 'MIT',
    });
    await writePackage(root, 'node_modules/shared', {
      name: 'shared',
      version: '1.0.0',
      license: 'MIT',
    });

    const packages = await collectRuntimePackages({ rootDir: root, licenseFallbacks: [] });
    expect(packages.find(({ name }: { name: string }) => name === 'shared')?.version).toBe('2.0.0');
  });

  it('fails when installed runtime metadata is missing', async () => {
    const root = await temporaryRoot();
    await writeLock(root, {
      '': { dependencies: { missing: '1.0.0' } },
      'node_modules/missing': { version: '1.0.0', license: 'MIT' },
    });

    await expect(collectRuntimePackages({ rootDir: root, licenseFallbacks: [] })).rejects.toThrow(
      'Unable to read installed package metadata',
    );
  });

  it('fails for missing license files and unsupported license metadata', async () => {
    const missingLicenseRoot = await temporaryRoot();
    await writeLock(missingLicenseRoot, {
      '': { dependencies: { runtime: '1.0.0' } },
      'node_modules/runtime': { version: '1.0.0', license: 'MIT' },
    });
    await writePackage(
      missingLicenseRoot,
      'node_modules/runtime',
      { name: 'runtime', version: '1.0.0', license: 'MIT' },
      null,
    );
    await expect(
      collectRuntimePackages({ rootDir: missingLicenseRoot, licenseFallbacks: [] }),
    ).rejects.toThrow('does not distribute a supported license file');

    const unsupportedRoot = await temporaryRoot();
    await writeLock(unsupportedRoot, {
      '': { dependencies: { runtime: '1.0.0' } },
      'node_modules/runtime': { version: '1.0.0' },
    });
    await writePackage(unsupportedRoot, 'node_modules/runtime', {
      name: 'runtime',
      version: '1.0.0',
      license: { type: 'MIT' },
    });
    await expect(
      collectRuntimePackages({ rootDir: unsupportedRoot, licenseFallbacks: [] }),
    ).rejects.toThrow('missing or unsupported license metadata');
  });

  it('uses only an exact allowlisted fallback and prefers a package-provided license', async () => {
    const root = await temporaryRoot();
    await writeLock(root, {
      '': { dependencies: { runtime: '1.0.0' } },
      'node_modules/runtime': { version: '1.0.0', license: 'MIT' },
    });
    await writePackage(
      root,
      'node_modules/runtime',
      { name: 'runtime', version: '1.0.0', license: 'MIT' },
      null,
    );
    await mkdir(path.join(root, 'fallbacks'));
    await writeFile(path.join(root, 'fallbacks', 'runtime.LICENSE'), 'fallback text\n');
    const fallback = {
      name: 'runtime',
      version: '1.0.0',
      license: 'MIT',
      file: 'fallbacks/runtime.LICENSE',
      provenance: 'pinned fixture provenance',
    };

    const [fallbackResult] = await collectRuntimePackages({
      rootDir: root,
      licenseFallbacks: [fallback],
    });
    expect(fallbackResult.licenseText).toBe('fallback text\n');
    expect(fallbackResult.licenseProvenance).toBe('pinned fixture provenance');

    await writeFile(path.join(root, 'node_modules/runtime/LICENSE'), 'package text\n');
    const [packageResult] = await collectRuntimePackages({
      rootDir: root,
      licenseFallbacks: [fallback],
    });
    expect(packageResult.licenseText).toBe('package text\n');
    expect(packageResult.licenseProvenance).toBeNull();
  });

  it('generates deterministic output and detects stale committed content', async () => {
    const root = await temporaryRoot();
    await writeLock(root, {
      '': { dependencies: { runtime: '1.0.0' } },
      'node_modules/runtime': { version: '1.0.0', license: 'MIT' },
    });
    await writePackage(
      root,
      'node_modules/runtime',
      { name: 'runtime', version: '1.0.0', license: 'MIT' },
      'fixture license text\r\n',
    );
    const outputPath = path.join(root, 'notices.txt');
    const first = await expectedRuntimeNotices({ rootDir: root, licenseFallbacks: [] });
    const second = await expectedRuntimeNotices({ rootDir: root, licenseFallbacks: [] });
    expect(second).toBe(first);
    expect(first).not.toContain('\r');

    await writeFile(outputPath, 'stale\n');
    await expect(
      checkRuntimeNotices({ rootDir: root, outputPath, licenseFallbacks: [] }),
    ).rejects.toThrow('is stale');
    await writeFile(outputPath, first);
    await expect(
      checkRuntimeNotices({ rootDir: root, outputPath, licenseFallbacks: [] }),
    ).resolves.toBe(first);
  });
});
