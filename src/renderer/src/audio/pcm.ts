// Lead-in silence lives in the audio, not in the `delay` key: YARG starts gameplay
// exactly 2 s before audio position zero, so `delay` cancels out of the player's
// runway entirely (docs/DESIGN.md → Timing model → Lead-in). These two are the
// whole mechanism, kept pure and free of AudioBuffer so they test under Node.

export function padPcm(
  channels: Float32Array[],
  sampleRate: number,
  seconds: number,
): Float32Array[] {
  const silence = Math.round(seconds * sampleRate);
  if (silence <= 0) return channels.map((c) => c.slice());
  return channels.map((channel) => {
    const out = new Float32Array(silence + channel.length);
    out.set(channel, silence);
    return out;
  });
}

export function trimPcm(
  channels: Float32Array[],
  sampleRate: number,
  seconds: number,
): Float32Array[] {
  const drop = Math.round(seconds * sampleRate);
  if (drop <= 0) return channels.map((c) => c.slice());
  return channels.map((channel) => channel.slice(Math.min(drop, channel.length)));
}
