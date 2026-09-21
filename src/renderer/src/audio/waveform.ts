export interface WaveformOverview {
  durationSeconds: number;
  bucketDurationSeconds: number;
  min: Float32Array;
  max: Float32Array;
}

interface WaveformSource {
  length: number;
  sampleRate: number;
  numberOfChannels: number;
  getChannelData(index: number): Float32Array;
}

const BUCKET_SECONDS = 0.01;

function sampleValue(value: number): number {
  return Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : 0;
}

// Build a compact, mixed-channel envelope once when the decoded buffer changes.
export function buildWaveformOverview(source: WaveformSource): WaveformOverview {
  const { length, sampleRate, numberOfChannels } = source;
  if (
    !Number.isSafeInteger(length) ||
    length <= 0 ||
    !Number.isFinite(sampleRate) ||
    sampleRate <= 0 ||
    !Number.isSafeInteger(numberOfChannels) ||
    numberOfChannels <= 0
  ) {
    return {
      durationSeconds: 0,
      bucketDurationSeconds: 0,
      min: new Float32Array(),
      max: new Float32Array(),
    };
  }

  const samplesPerBucket = Math.max(1, Math.round(sampleRate * BUCKET_SECONDS));
  const count = Math.ceil(length / samplesPerBucket);
  const channels = Array.from({ length: numberOfChannels }, (_, i) => source.getChannelData(i));
  const min = new Float32Array(count);
  const max = new Float32Array(count);

  for (let bucket = 0; bucket < count; bucket++) {
    let low = 1;
    let high = -1;
    const end = Math.min(length, (bucket + 1) * samplesPerBucket);
    for (let sample = bucket * samplesPerBucket; sample < end; sample++) {
      let mixed = 0;
      for (const channel of channels) mixed += sampleValue(channel[sample] ?? 0);
      mixed = sampleValue(mixed / numberOfChannels);
      low = Math.min(low, mixed);
      high = Math.max(high, mixed);
    }
    min[bucket] = low;
    max[bucket] = high;
  }

  return {
    durationSeconds: length / sampleRate,
    bucketDurationSeconds: samplesPerBucket / sampleRate,
    min,
    max,
  };
}
