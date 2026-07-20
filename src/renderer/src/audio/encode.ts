import { createOggEncoder } from 'wasm-media-encoders';

// GuitarGame's format documentation recommends Quality 8 for OGG. Every export is
// re-encoded (the lead-in silence has to go somewhere), so this is one lossy
// generation on top of whatever the user imported — the same trade Onyx and
// Editor on Fire both make. Repeated save cycles stay at one generation because
// the writer passes already-padded bytes through untouched.
const VBR_QUALITY = 8;

// Encoding a whole song in one `encode()` call would copy every sample into the
// WASM heap at once; a chunked feed keeps that bounded.
const CHUNK_SAMPLES = 48000;

export async function encodeOggVorbis(
  channels: Float32Array[],
  sampleRate: number,
): Promise<Uint8Array> {
  const encoder = await createOggEncoder();
  encoder.configure({
    channels: channels.length as 1 | 2,
    sampleRate,
    vbrQuality: VBR_QUALITY,
  });

  const parts: Uint8Array[] = [];
  const total = channels[0]?.length ?? 0;
  for (let offset = 0; offset < total; offset += CHUNK_SAMPLES) {
    const end = Math.min(offset + CHUNK_SAMPLES, total);
    // encode() returns a view into WASM memory that the next call invalidates, so
    // every result is copied before the loop continues.
    parts.push(new Uint8Array(encoder.encode(channels.map((c) => c.subarray(offset, end)))));
  }
  parts.push(new Uint8Array(encoder.finalize()));

  const size = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(size);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}
