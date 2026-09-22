import { SngWriteError } from '../types/index';

const MAGIC = 'SNGPKG';

export const MAX_SNG_INPUT_BYTES = 512 * 1024 * 1024;
export const MAX_METADATA_BYTES = 1024 * 1024;
export const MAX_METADATA_PAIRS = 256;
export const MAX_METADATA_KEY_BYTES = 1024;
export const MAX_METADATA_VALUE_BYTES = 64 * 1024;
export const MAX_FILE_ENTRIES = 128;
export const MAX_FILE_NAME_BYTES = 255;
export const MAX_FILE_INDEX_BYTES = 8 + MAX_FILE_ENTRIES * (1 + MAX_FILE_NAME_BYTES + 8 + 8);
const HEADER_BYTES = 6 + 4 + 16;

function maskFile(bytes: Uint8Array, xorMask: Uint8Array): Uint8Array {
  const out = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    out[i] = bytes[i] ^ (xorMask[i % 16] ^ (i & 0xff));
  }
  return out;
}

export function buildSngContainer(
  files: { name: string; bytes: Uint8Array }[],
  metadata: [string, string][],
  xorMask: Uint8Array,
): Uint8Array {
  const enc = new TextEncoder();
  const pairs = metadata
    .filter(([k, v]) => k !== '' && v !== '')
    .map(([k, v]) => ({ key: enc.encode(k), val: enc.encode(v) }));
  const entries = files.map((f) => ({ name: enc.encode(f.name.toLowerCase()), bytes: f.bytes }));

  let metadataPairsBytes = 0;
  for (const p of pairs) metadataPairsBytes += 4 + p.key.length + 4 + p.val.length;
  const metadataLen = 8 + metadataPairsBytes;

  let fileEntryBytes = 0;
  for (const e of entries) fileEntryBytes += 1 + e.name.length + 8 + 8;
  const fileMetaLen = 8 + fileEntryBytes;

  const fileDataLen = entries.reduce((s, e) => s + e.bytes.length, 0);
  const fileDataStart = 26 + (8 + metadataLen) + (8 + fileMetaLen) + 8;
  const total = fileDataStart + fileDataLen;

  const buf = new Uint8Array(total);
  const view = new DataView(buf.buffer);
  let o = 0;
  const u8 = (n: number) => {
    buf[o++] = n;
  };
  const u32 = (n: number) => {
    view.setUint32(o, n, true);
    o += 4;
  };
  const i32 = (n: number) => {
    view.setInt32(o, n, true);
    o += 4;
  };
  const u64 = (n: number) => {
    view.setBigUint64(o, BigInt(n), true);
    o += 8;
  };
  const raw = (b: Uint8Array) => {
    buf.set(b, o);
    o += b.length;
  };

  // Header
  raw(enc.encode(MAGIC));
  u32(1); // version
  raw(xorMask);

  // Metadata
  u64(metadataLen);
  u64(pairs.length);
  for (const p of pairs) {
    i32(p.key.length);
    raw(p.key);
    i32(p.val.length);
    raw(p.val);
  }

  // File index
  u64(fileMetaLen);
  u64(entries.length);
  let cursor = fileDataStart;
  for (const e of entries) {
    u8(e.name.length);
    raw(e.name);
    u64(e.bytes.length);
    u64(cursor);
    cursor += e.bytes.length;
  }

  // File data
  u64(fileDataLen);
  for (const e of entries) raw(maskFile(e.bytes, xorMask));

  return buf;
}

export function readSng(bytes: Uint8Array): {
  metadata: Record<string, string>;
  files: Record<string, Uint8Array>;
} {
  if (bytes.byteLength > MAX_SNG_INPUT_BYTES) throw new SngWriteError('SNG input exceeds 512 MiB');
  if (bytes.byteLength < HEADER_BYTES) throw new SngWriteError('SNG container is truncated');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const dec = new TextDecoder('utf-8', { fatal: true });
  let o = 0;
  const requireBytes = (length: number, boundary = bytes.byteLength) => {
    if (!Number.isSafeInteger(length) || length < 0 || o > boundary - length) {
      throw new SngWriteError('SNG container is truncated or has an invalid section boundary');
    }
  };
  const u8 = (boundary?: number) => {
    requireBytes(1, boundary);
    return bytes[o++];
  };
  const u32 = (boundary?: number) => {
    requireBytes(4, boundary);
    const v = view.getUint32(o, true);
    o += 4;
    return v;
  };
  const i32 = (boundary?: number) => {
    requireBytes(4, boundary);
    const v = view.getInt32(o, true);
    o += 4;
    return v;
  };
  const u64 = (boundary?: number) => {
    requireBytes(8, boundary);
    const raw = view.getBigUint64(o, true);
    o += 8;
    if (raw > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new SngWriteError('SNG container contains an unsafe 64-bit integer');
    }
    return Number(raw);
  };
  const text = (length: number, maximum: number, boundary: number) => {
    if (length < 0 || length > maximum) throw new SngWriteError('SNG string length is invalid');
    requireBytes(length, boundary);
    try {
      const value = dec.decode(bytes.subarray(o, o + length));
      o += length;
      return value;
    } catch {
      throw new SngWriteError('SNG container contains invalid UTF-8');
    }
  };

  if (dec.decode(bytes.subarray(0, 6)) !== MAGIC) throw new SngWriteError('Bad SNG magic');
  o = 6;
  if (u32() !== 1) throw new SngWriteError('Unsupported SNG version');
  const xorMask = bytes.subarray(o, o + 16);
  o += 16;

  const metadataLen = u64();
  if (metadataLen < 8 || metadataLen > MAX_METADATA_BYTES) {
    throw new SngWriteError('Invalid SNG metadata section length');
  }
  if (o > bytes.byteLength - metadataLen) throw new SngWriteError('Truncated SNG metadata section');
  const metaEnd = o + metadataLen;
  const count = u64(metaEnd);
  if (count > MAX_METADATA_PAIRS) throw new SngWriteError('Too many SNG metadata pairs');
  const metadata: Record<string, string> = Object.create(null) as Record<string, string>;
  for (let i = 0; i < count; i++) {
    const kl = i32(metaEnd);
    const key = text(kl, MAX_METADATA_KEY_BYTES, metaEnd);
    const vl = i32(metaEnd);
    const val = text(vl, MAX_METADATA_VALUE_BYTES, metaEnd);
    metadata[key] = val;
  }
  if (o !== metaEnd) throw new SngWriteError('Inconsistent SNG metadata section length');

  const fileMetaLen = u64();
  if (fileMetaLen < 8 || fileMetaLen > MAX_FILE_INDEX_BYTES) {
    throw new SngWriteError('Invalid SNG file-index section length');
  }
  if (o > bytes.byteLength - fileMetaLen) throw new SngWriteError('Truncated SNG file index');
  const idxEnd = o + fileMetaLen;
  const fileCount = u64(idxEnd);
  if (fileCount > MAX_FILE_ENTRIES) throw new SngWriteError('Too many SNG file entries');
  const index: { name: string; len: number; offset: number }[] = [];
  const names = new Set<string>();
  for (let i = 0; i < fileCount; i++) {
    const nl = u8(idxEnd);
    if (nl === 0 || nl > MAX_FILE_NAME_BYTES)
      throw new SngWriteError('Invalid SNG file name length');
    const name = text(nl, MAX_FILE_NAME_BYTES, idxEnd);
    if (names.has(name)) throw new SngWriteError(`Duplicate SNG file name: ${name}`);
    names.add(name);
    const len = u64(idxEnd);
    const offset = u64(idxEnd);
    index.push({ name, len, offset });
  }
  if (o !== idxEnd) throw new SngWriteError('Inconsistent SNG file-index section length');
  const fileDataLen = u64();
  const fileDataStart = o;
  if (fileDataLen > bytes.byteLength - fileDataStart) {
    throw new SngWriteError('Truncated SNG file-data section');
  }
  const fileDataEnd = fileDataStart + fileDataLen;
  if (fileDataEnd !== bytes.byteLength)
    throw new SngWriteError('Inconsistent SNG file-data length');

  for (const file of index) {
    if (
      file.offset < fileDataStart ||
      file.offset > fileDataEnd ||
      file.len > fileDataEnd - file.offset
    ) {
      throw new SngWriteError(`SNG file entry is outside the file-data section: ${file.name}`);
    }
  }

  const files: Record<string, Uint8Array> = Object.create(null) as Record<string, Uint8Array>;
  for (const f of index) {
    const masked = bytes.subarray(f.offset, f.offset + f.len);
    const plain = new Uint8Array(f.len);
    for (let i = 0; i < f.len; i++) plain[i] = masked[i] ^ (xorMask[i % 16] ^ (i & 0xff));
    files[f.name] = plain;
  }
  return { metadata, files };
}
