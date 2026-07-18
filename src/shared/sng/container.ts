import { SngWriteError } from '../types/index';

const MAGIC = 'SNGPKG';

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
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const dec = new TextDecoder();
  let o = 0;
  const u32 = () => {
    const v = view.getUint32(o, true);
    o += 4;
    return v;
  };
  const i32 = () => {
    const v = view.getInt32(o, true);
    o += 4;
    return v;
  };
  const u64 = () => {
    const v = Number(view.getBigUint64(o, true));
    o += 8;
    return v;
  };

  if (dec.decode(bytes.subarray(0, 6)) !== MAGIC) throw new SngWriteError('Bad SNG magic');
  o = 6;
  if (u32() !== 1) throw new SngWriteError('Unsupported SNG version');
  const xorMask = bytes.subarray(o, o + 16);
  o += 16;

  const metadataLen = u64();
  const metaEnd = o + metadataLen;
  const count = u64();
  const metadata: Record<string, string> = {};
  for (let i = 0; i < count; i++) {
    const kl = i32();
    const key = dec.decode(bytes.subarray(o, o + kl));
    o += kl;
    const vl = i32();
    const val = dec.decode(bytes.subarray(o, o + vl));
    o += vl;
    metadata[key] = val;
  }
  o = metaEnd;

  const fileMetaLen = u64();
  const idxEnd = o + fileMetaLen;
  const fileCount = u64();
  const index: { name: string; len: number; offset: number }[] = [];
  for (let i = 0; i < fileCount; i++) {
    const nl = bytes[o++];
    const name = dec.decode(bytes.subarray(o, o + nl));
    o += nl;
    const len = u64();
    const offset = u64();
    index.push({ name, len, offset });
  }
  o = idxEnd;
  u64(); // fileDataLen (not needed; offsets are absolute)

  const files: Record<string, Uint8Array> = {};
  for (const f of index) {
    const masked = bytes.subarray(f.offset, f.offset + f.len);
    const plain = new Uint8Array(f.len);
    for (let i = 0; i < f.len; i++) plain[i] = masked[i] ^ (xorMask[i % 16] ^ (i & 0xff));
    files[f.name] = plain;
  }
  return { metadata, files };
}
