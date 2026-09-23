import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SEPARATOR = '='.repeat(80);
const LICENSE_FILENAMES = [
  'LICENSE',
  'LICENSE.txt',
  'LICENSE.md',
  'LICENCE',
  'LICENCE.txt',
  'LICENCE.md',
  'COPYING',
  'COPYING.txt',
  'COPYING.md',
];
const NOTICE_FILENAMES = ['NOTICE', 'NOTICE.txt', 'NOTICE.md'];

const DEFAULT_LICENSE_FALLBACKS = [
  {
    name: '@nodable/entities',
    version: '3.0.0',
    license: 'MIT',
    file: 'scripts/license-fallbacks/nodable-entities-3.0.0.LICENSE',
    provenance:
      'The published @nodable/entities@3.0.0 npm tarball declares MIT in package.json and README but omits the repository LICENSE from its published files.\n' +
      'The license text below is reproduced from the upstream repository LICENSE at commit d2070d76a8ba07e6c7fa142caeb51ffd756e47eb. This commit identifies the license-text source only; it is not asserted to be the source revision for @nodable/entities@3.0.0.\n' +
      'https://github.com/nodable/val-parsers/blob/d2070d76a8ba07e6c7fa142caeb51ffd756e47eb/LICENSE',
  },
];

function compareStrings(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

async function readJson(file, description) {
  let source;
  try {
    source = await readFile(file, 'utf8');
  } catch (error) {
    throw new Error(`Unable to read ${description} at ${file}: ${error.message}`);
  }

  try {
    return JSON.parse(source);
  } catch (error) {
    throw new Error(`Invalid JSON in ${description} at ${file}: ${error.message}`);
  }
}

function assertUsableSpdxLicense(value, packageId) {
  if (
    typeof value !== 'string' ||
    value.trim() === '' ||
    value === 'UNLICENSED' ||
    value.startsWith('SEE LICENSE IN ') ||
    !/^[A-Za-z0-9().:+\-\s]+$/.test(value)
  ) {
    throw new Error(`${packageId} has missing or unsupported license metadata`);
  }
  return value;
}

function resolveDependencyPath(packages, parentPath, dependencyName) {
  let current = parentPath;
  while (true) {
    const candidate = current
      ? `${current}/node_modules/${dependencyName}`
      : `node_modules/${dependencyName}`;
    if (packages[candidate]) return candidate;

    if (!current) break;
    const nestedIndex = current.lastIndexOf('/node_modules/');
    current = nestedIndex === -1 ? '' : current.slice(0, nestedIndex);
  }

  throw new Error(
    `Unable to resolve runtime dependency ${dependencyName} from ${parentPath || 'the root package'} in package-lock.json`,
  );
}

function runtimeDependencyNames(lockEntry) {
  const names = new Set([
    ...Object.keys(lockEntry.dependencies ?? {}),
    ...Object.keys(lockEntry.optionalDependencies ?? {}),
  ]);

  for (const name of Object.keys(lockEntry.peerDependencies ?? {})) {
    if (!lockEntry.peerDependenciesMeta?.[name]?.optional) names.add(name);
  }

  return [...names].sort(compareStrings);
}

function runtimePackagePaths(lock) {
  const packages = lock.packages;
  if (!packages || typeof packages !== 'object' || !packages['']) {
    throw new Error('package-lock.json must contain a packages map and root package entry');
  }

  const visited = new Set();
  const visit = (packagePath) => {
    if (visited.has(packagePath)) return;
    const entry = packages[packagePath];
    if (!entry) throw new Error(`Missing lockfile entry for ${packagePath}`);
    visited.add(packagePath);
    for (const dependencyName of runtimeDependencyNames(entry)) {
      visit(resolveDependencyPath(packages, packagePath, dependencyName));
    }
  };

  for (const dependencyName of Object.keys(packages[''].dependencies ?? {}).sort(compareStrings)) {
    visit(resolveDependencyPath(packages, '', dependencyName));
  }

  return [...visited];
}

async function findDistributedFile(packageDirectory, preferredNames) {
  const entries = await readdir(packageDirectory, { withFileTypes: true });
  const files = entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
  const byLowercaseName = new Map(files.map((file) => [file.toLowerCase(), file]));
  for (const preferredName of preferredNames) {
    const actualName = byLowercaseName.get(preferredName.toLowerCase());
    if (actualName) return actualName;
  }
  return null;
}

async function readLicenseText(file, packageId) {
  const text = await readFile(file, 'utf8');
  if (text.length === 0 || text.includes('\0')) {
    throw new Error(`${packageId} has an unusable license file at ${file}`);
  }
  return text.replace(/\r\n?/g, '\n');
}

export async function collectRuntimePackages({
  rootDir,
  licenseFallbacks = DEFAULT_LICENSE_FALLBACKS,
}) {
  const lock = await readJson(path.join(rootDir, 'package-lock.json'), 'package-lock.json');
  const results = [];

  for (const lockPath of runtimePackagePaths(lock)) {
    const lockEntry = lock.packages[lockPath];
    const packageDirectory = path.join(rootDir, ...lockPath.split('/'));
    const metadata = await readJson(
      path.join(packageDirectory, 'package.json'),
      `installed package metadata for ${lockPath}`,
    );
    const packageId = `${metadata.name ?? lockPath}@${metadata.version ?? 'unknown'}`;

    if (!metadata.name || !metadata.version) {
      throw new Error(`${lockPath} has incomplete installed package metadata`);
    }
    if (metadata.version !== lockEntry.version) {
      throw new Error(
        `${packageId} does not match package-lock.json version ${lockEntry.version ?? 'missing'}`,
      );
    }

    const license = assertUsableSpdxLicense(metadata.license, packageId);
    if (lockEntry.license && lockEntry.license !== license) {
      throw new Error(
        `${packageId} license ${license} does not match package-lock.json license ${lockEntry.license}`,
      );
    }

    const licenseFilename = await findDistributedFile(packageDirectory, LICENSE_FILENAMES);
    let licenseText;
    let licenseSource;
    let licenseProvenance = null;

    if (licenseFilename) {
      licenseText = await readLicenseText(path.join(packageDirectory, licenseFilename), packageId);
      licenseSource = `${licenseFilename} (published npm package)`;
    } else {
      const fallback = licenseFallbacks.find(
        (entry) =>
          entry.name === metadata.name &&
          entry.version === metadata.version &&
          entry.license === license,
      );
      if (!fallback) {
        throw new Error(`${packageId} does not distribute a supported license file`);
      }
      licenseText = await readLicenseText(path.join(rootDir, fallback.file), packageId);
      licenseSource = fallback.file;
      licenseProvenance = fallback.provenance;
    }

    const noticeFilename = await findDistributedFile(packageDirectory, NOTICE_FILENAMES);
    const noticeText = noticeFilename
      ? await readLicenseText(path.join(packageDirectory, noticeFilename), packageId)
      : null;

    results.push({
      name: metadata.name,
      version: metadata.version,
      license,
      licenseSource,
      licenseProvenance,
      licenseText,
      noticeFilename,
      noticeText,
    });
  }

  return results.sort((left, right) => compareStrings(left.name, right.name));
}

function appendExactText(output, text) {
  output += text;
  if (!text.endsWith('\n')) output += '\n';
  return output;
}

export function renderRuntimeNotices(packages) {
  const licenseCounts = new Map();
  for (const entry of packages) {
    licenseCounts.set(entry.license, (licenseCounts.get(entry.license) ?? 0) + 1);
  }

  let output =
    'GP2SNG runtime npm dependency license notices\n' +
    '\n' +
    'This file is generated deterministically from package-lock.json and the installed\n' +
    'runtime packages. Run `npm run licenses:generate` to update it.\n' +
    `\nRuntime packages: ${packages.length}\n` +
    'License breakdown:\n';

  for (const [license, count] of [...licenseCounts].sort(([left], [right]) =>
    compareStrings(left, right),
  )) {
    output += `  ${license}: ${count}\n`;
  }

  for (const entry of packages) {
    output +=
      `\n${SEPARATOR}\n\n` +
      `Package: ${entry.name}\n` +
      `Version: ${entry.version}\n` +
      `Declared license: ${entry.license}\n` +
      `License text source: ${entry.licenseSource}\n`;
    if (entry.licenseProvenance) {
      output += `License text provenance:\n${entry.licenseProvenance}\n`;
    }
    output += '\nLicense text:\n\n';
    output = appendExactText(output, entry.licenseText);

    if (entry.noticeText) {
      output += `\nNOTICE text (${entry.noticeFilename}):\n\n`;
      output = appendExactText(output, entry.noticeText);
    }
  }

  return output;
}

export async function expectedRuntimeNotices(options) {
  return renderRuntimeNotices(await collectRuntimePackages(options));
}

export async function writeRuntimeNotices({ rootDir, outputPath, licenseFallbacks }) {
  const contents = await expectedRuntimeNotices({ rootDir, licenseFallbacks });
  await writeFile(outputPath, contents, 'utf8');
  return contents;
}

export async function checkRuntimeNotices({ rootDir, outputPath, licenseFallbacks }) {
  const expected = await expectedRuntimeNotices({ rootDir, licenseFallbacks });
  let actual;
  try {
    actual = await readFile(outputPath, 'utf8');
  } catch (error) {
    throw new Error(`Unable to read committed runtime notices at ${outputPath}: ${error.message}`);
  }
  if (actual !== expected) {
    throw new Error(
      'THIRD_PARTY_LICENSES/NPM_RUNTIME_NOTICES.txt is stale. Run `npm run licenses:generate` and commit the result.',
    );
  }
  return expected;
}

async function main() {
  const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
  const rootDir = path.resolve(scriptDirectory, '..');
  const outputPath = path.join(rootDir, 'THIRD_PARTY_LICENSES', 'NPM_RUNTIME_NOTICES.txt');
  const mode = process.argv[2];

  if (mode === undefined || mode === '--generate') {
    const contents = await writeRuntimeNotices({ rootDir, outputPath });
    console.log(`Generated ${path.relative(rootDir, outputPath)} (${contents.length} characters)`);
    return;
  }
  if (mode === '--check') {
    await checkRuntimeNotices({ rootDir, outputPath });
    console.log('Runtime npm license notices are up to date.');
    return;
  }
  throw new Error(`Unknown mode: ${mode}`);
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
