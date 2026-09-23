import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export function payloadMatchKinds(fileBytes, payload) {
  const kinds = [];
  if (fileBytes.indexOf(payload) !== -1) kinds.push('exact bytes');
  const encoded = Buffer.from(payload.toString('base64'), 'ascii');
  if (fileBytes.indexOf(encoded) !== -1) kinds.push('base64');
  return kinds;
}

async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((left, right) =>
    left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
  )) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await listFiles(fullPath)));
    else if (entry.isFile()) files.push(fullPath);
  }
  return files;
}

export async function findPayloadMatches(files, payload) {
  const matches = [];
  for (const file of files) {
    const kinds = payloadMatchKinds(await readFile(file), payload);
    if (kinds.length > 0) matches.push({ file, kinds });
  }
  return matches;
}

export async function checkWasmBundle({ rootDir }) {
  const rendererDirectory = path.join(rootDir, 'out', 'renderer');
  const wasmDirectory = path.join(rootDir, 'node_modules', 'wasm-media-encoders', 'wasm');
  const [ogg, mp3, outputFiles] = await Promise.all([
    readFile(path.join(wasmDirectory, 'ogg.wasm')),
    readFile(path.join(wasmDirectory, 'mp3.wasm')),
    listFiles(rendererDirectory),
  ]);
  const [oggMatches, mp3Matches] = await Promise.all([
    findPayloadMatches(outputFiles, ogg),
    findPayloadMatches(outputFiles, mp3),
  ]);

  if (oggMatches.length === 0) {
    throw new Error(
      `Ogg WASM payload was not found in out/renderer (SHA-256 ${sha256(ogg)}); detection is not validated`,
    );
  }
  if (mp3Matches.length > 0) {
    const locations = mp3Matches
      .map((match) => path.relative(rootDir, match.file))
      .join(', ');
    throw new Error(
      `MP3/LAME WASM payload was found in out/renderer at ${locations} (SHA-256 ${sha256(mp3)})`,
    );
  }

  return {
    oggHash: sha256(ogg),
    mp3Hash: sha256(mp3),
    oggMatches: oggMatches.map((match) => ({
      file: path.relative(rootDir, match.file),
      kinds: match.kinds,
    })),
  };
}

async function main() {
  const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const result = await checkWasmBundle({ rootDir });
  console.log(`Ogg WASM present (${result.oggHash})`);
  for (const match of result.oggMatches) {
    console.log(`  ${match.file}: ${match.kinds.join(', ')}`);
  }
  console.log(`MP3/LAME WASM absent (${result.mp3Hash})`);
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
