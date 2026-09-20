import { barStartTicks, tickToSeconds } from '../../../shared/convert/timing';
import type { YargChart } from '../../../shared/types/index';
import { scaleChartTempo } from '../state/tempoCorrection';

export type TempoAnalysisKind =
  | 'aligned'
  | 'uniformTempoAdjustment'
  | 'tempoMapMismatch'
  | 'inconclusive';

export interface TempoAnalysisResult {
  kind: TempoAnalysisKind;
  confidence?: 'High' | 'Medium';
  scale?: number; // absolute relative to GP
  offsetMs?: number; // existing SNG delay convention
  driftSecondsPerMinute?: number;
  differencePercent?: number;
  mismatch?: { bar: number; fromBpm: number; toBpm: number };
}

export interface PcmAudio {
  sampleRate: number;
  length: number;
  numberOfChannels: number;
  getChannelData(channel: number): Float32Array;
}

// Initial calibration values, deliberately centralized. The score thresholds
// assume the envelope below is locally normalized to [0, 1]. They are guards
// against sparse/ambiguous evidence, not musically authoritative boundaries.
export const TEMPO_ANALYSIS_THRESHOLDS = {
  bucketSeconds: 0.01,
  windowSeconds: 18,
  minEventsPerWindow: 12,
  minAnalyzableWindows: 3,
  minCoverage: 0.5,
  minWindowScore: 0.17,
  minAlignmentImprovement: 0.035,
  maxUniformResidual: 0.18,
  highResidual: 0.09,
  alignedDriftTolerance: 0.0015,
  maxOffsetSeconds: 5,
  minSignalEnergy: 0.003,
  minDiagnosticTempoChangePercent: 0.5,
  minDiagnosticOffsetShift: 0.18,
} as const;

interface Event {
  time: number;
  weight: number;
}
interface WindowFit {
  center: number;
  offset: number;
  score: number;
}
const T = TEMPO_ANALYSIS_THRESHOLDS;

function bucketDuration(sampleRate: number): number {
  return Math.max(1, Math.round(sampleRate * T.bucketSeconds)) / sampleRate;
}

// Short-time amplitude rises preserve drum attacks without an FFT. A slow EMA
// rejects sustained loudness; a local peak normalizer prevents mastering level
// changes from letting one loud section dominate the entire fit.
export function onsetEnvelope(audio: PcmAudio): Float32Array {
  const samplesPerBucket = Math.max(1, Math.round(audio.sampleRate * T.bucketSeconds));
  const count = Math.ceil(audio.length / samplesPerBucket);
  const energy = new Float32Array(count);
  const channels = Array.from({ length: audio.numberOfChannels }, (_, i) =>
    audio.getChannelData(i),
  );
  for (let b = 0; b < count; b++) {
    const start = b * samplesPerBucket;
    const end = Math.min(start + samplesPerBucket, audio.length);
    let sum = 0;
    for (const channel of channels) {
      for (let i = start; i < end; i++) sum += Math.abs(channel[i]);
    }
    energy[b] = sum / Math.max(1, (end - start) * channels.length);
  }
  const attacks = new Float32Array(count);
  let slow = 0;
  for (let i = 0; i < count; i++) {
    attacks[i] = energy[i] >= T.minSignalEnergy ? Math.max(0, energy[i] - slow * 1.2) : 0;
    slow += 0.06 * (energy[i] - slow);
  }
  // Two-second local peak normalization; the envelope remains compact even for
  // a long recording. The ±2-bin scoring tolerance absorbs PCM bucket edges.
  const radius = Math.round(1 / bucketDuration(audio.sampleRate));
  const normalized = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    let peak = 0;
    for (let j = Math.max(0, i - radius); j <= Math.min(count - 1, i + radius); j++) {
      if (attacks[j] > peak) peak = attacks[j];
    }
    normalized[i] = peak > 0 ? attacks[i] / peak : 0;
  }
  return normalized;
}

function chartEvents(chart: YargChart): Event[] {
  const lead = tickToSeconds(chart.leadInTicks, chart.tempoMap, chart.resolution);
  const byTick = new Map<number, number>();
  for (const note of chart.notes) {
    if (note.tick < chart.leadInTicks) continue;
    // Kick/snare are usually distinctive anchors. Toms get partial weight;
    // cymbal-only subdivisions remain useful but cannot outvote strong drums.
    const weight =
      note.note === 'orange' || note.note === 'red' ? 1 : note.note.endsWith('Tom') ? 0.7 : 0.3;
    byTick.set(note.tick, Math.max(byTick.get(note.tick) ?? 0, weight));
  }
  return [...byTick]
    .map(([tick, weight]) => ({
      time: tickToSeconds(tick, chart.tempoMap, chart.resolution) - lead,
      weight,
    }))
    .sort((a, b) => a.time - b.time);
}

function at(envelope: Float32Array, time: number, secondsPerBucket: number): number {
  const index = Math.round(time / secondsPerBucket);
  if (index < 2 || index >= envelope.length - 2) return 0;
  let best = 0;
  for (let i = index - 2; i <= index + 2; i++) best = Math.max(best, envelope[i]);
  return best;
}

function alignmentScore(
  events: Event[],
  envelope: Float32Array,
  scale: number,
  offset: number,
  paddingSeconds: number,
  secondsPerBucket: number,
): number {
  let sum = 0;
  let weight = 0;
  for (const event of events) {
    sum +=
      event.weight * at(envelope, event.time / scale - offset + paddingSeconds, secondsPerBucket);
    weight += event.weight;
  }
  return weight > 0 ? sum / weight : 0;
}

function searchOffset(
  events: Event[],
  envelope: Float32Array,
  scale: number,
  padding: number,
  min: number,
  max: number,
  step: number,
  secondsPerBucket: number,
): { offset: number; score: number } {
  let best = { offset: 0, score: -1 };
  let ties = 0;
  for (let offset = min; offset <= max + step / 2; offset += step) {
    const score = alignmentScore(events, envelope, scale, offset, padding, secondsPerBucket);
    if (score > best.score + 1e-6) {
      best = { offset, score };
      ties = 1;
    } else if (Math.abs(score - best.score) <= 1e-6) {
      best.offset = (best.offset * ties + offset) / (ties + 1);
      ties++;
    }
  }
  return best;
}

function sparse(events: Event[], max: number): Event[] {
  if (events.length <= max) return events;
  const out: Event[] = [];
  for (let i = 0; i < max; i++) out.push(events[Math.floor((i * events.length) / max)]);
  return out;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

function mismatchEvent(chart: YargChart, windows: WindowFit[]): TempoAnalysisResult['mismatch'] {
  const events = chart.tempoMap.filter((event) => event.tick > chart.leadInTicks);
  if (events.length === 0) return undefined;
  const lead = tickToSeconds(chart.leadInTicks, chart.tempoMap, chart.resolution);
  let nearest: (typeof events)[number] | undefined;
  let strongestShift: number = T.minDiagnosticOffsetShift;
  for (const event of events) {
    const index = chart.tempoMap.indexOf(event);
    const previous = chart.tempoMap[index - 1];
    if (
      !previous ||
      Math.abs(previous.usPerQuarter / event.usPerQuarter - 1) * 100 <
        T.minDiagnosticTempoChangePercent
    )
      continue;
    const at = tickToSeconds(event.tick, chart.tempoMap, chart.resolution) - lead;
    const before = windows.filter((w) => w.center < at).map((w) => w.offset);
    const after = windows.filter((w) => w.center >= at).map((w) => w.offset);
    if (before.length < 2 || after.length < 2) continue;
    const shift = Math.abs(median(before) - median(after));
    if (shift > strongestShift) {
      strongestShift = shift;
      nearest = event;
    }
  }
  if (nearest === undefined) return undefined;
  // A slow divergence after a wrong tempo step is useful evidence even when
  // adjacent windows do not show a sharp jump at the event itself.
  const index = chart.tempoMap.indexOf(nearest);
  const previous = chart.tempoMap[index - 1];
  if (!previous) return undefined;
  const bars = barStartTicks(chart.timeSignatures, chart.endTick, chart.resolution);
  const bar = bars.filter((tick) => tick >= chart.leadInTicks && tick <= nearest.tick).length;
  return { bar, fromBpm: 60000000 / previous.usPerQuarter, toBpm: 60000000 / nearest.usPerQuarter };
}

export function analyzeTempo(
  chart: YargChart,
  currentScale: number,
  audio: PcmAudio,
  audioPaddingMs = 0,
): TempoAnalysisResult {
  const inconclusive: TempoAnalysisResult = { kind: 'inconclusive' };
  if (audio.sampleRate <= 0 || audio.numberOfChannels < 1 || !Number.isFinite(audioPaddingMs))
    return inconclusive;
  let original: YargChart;
  try {
    original = scaleChartTempo(chart, currentScale, 1);
  } catch {
    return inconclusive;
  }
  const events = chartEvents(original);
  const duration =
    tickToSeconds(original.endTick, original.tempoMap, original.resolution) -
    tickToSeconds(original.leadInTicks, original.tempoMap, original.resolution);
  if (
    events.length < T.minEventsPerWindow * T.minAnalyzableWindows ||
    duration < T.windowSeconds * 2
  )
    return inconclusive;
  const envelope = onsetEnvelope(audio);
  if (envelope.every((v) => v === 0)) return inconclusive;
  const secondsPerBucket = bucketDuration(audio.sampleRate);
  const padding = audioPaddingMs / 1000;
  const sample = sparse(events, 400);
  let best = { scale: 1, offset: 0, score: -1 };
  // Narrow GP-prior search. Coarse 0.05% then fine 0.005%; offset is searched
  // jointly so a fixed audio delay cannot masquerade as a tempo change.
  for (let scale = 0.95; scale <= 1.050001; scale += 0.0005) {
    const fit = searchOffset(
      sample,
      envelope,
      scale,
      padding,
      -T.maxOffsetSeconds,
      T.maxOffsetSeconds,
      0.04,
      secondsPerBucket,
    );
    if (fit.score > best.score) best = { scale, ...fit };
  }
  const coarse = best;
  for (let scale = coarse.scale - 0.001; scale <= coarse.scale + 0.001001; scale += 0.00005) {
    const fit = searchOffset(
      sample,
      envelope,
      scale,
      padding,
      coarse.offset - 0.12,
      coarse.offset + 0.12,
      0.01,
      secondsPerBucket,
    );
    if (fit.score > best.score) best = { scale, ...fit };
  }
  const base = searchOffset(
    sample,
    envelope,
    1,
    padding,
    -T.maxOffsetSeconds,
    T.maxOffsetSeconds,
    0.01,
    secondsPerBucket,
  );

  const windows: WindowFit[] = [];
  const totalWindows = Math.ceil(duration / T.windowSeconds);
  for (let i = 0; i < totalWindows; i++) {
    const start = i * T.windowSeconds;
    const region = events.filter(
      (event) => event.time >= start && event.time < start + T.windowSeconds,
    );
    if (region.length < T.minEventsPerWindow) continue;
    const fit = searchOffset(
      region,
      envelope,
      best.scale,
      padding,
      Math.max(-T.maxOffsetSeconds, best.offset - 2),
      Math.min(T.maxOffsetSeconds, best.offset + 2),
      0.02,
      secondsPerBucket,
    );
    if (fit.score >= T.minWindowScore)
      windows.push({ center: start + T.windowSeconds / 2, ...fit });
  }
  if (windows.length < T.minAnalyzableWindows || windows.length / totalWindows < T.minCoverage)
    return inconclusive;

  const offsets = windows.map((w) => w.offset);
  const center = median(offsets);
  const residuals = windows.map((w) => Math.abs(w.offset - center));
  const residual = median(residuals);
  const maxResidual = Math.max(...residuals);
  const improvement = best.score - base.score;
  const stable = residual <= T.maxUniformResidual && maxResidual <= T.maxUniformResidual * 2;
  const differencePercent = (best.scale - 1) * 100;
  const common = {
    scale: best.scale,
    offsetMs: Math.round(center * 1000),
    differencePercent,
    driftSecondsPerMinute: 60 * Math.abs(1 - 1 / best.scale),
  };
  if (!stable) {
    return { kind: 'tempoMapMismatch', mismatch: mismatchEvent(original, windows) };
  }
  if (
    Math.abs(best.scale - 1) <= T.alignedDriftTolerance &&
    improvement < T.minAlignmentImprovement
  ) {
    return { kind: 'aligned', ...common };
  }
  if (
    improvement < T.minAlignmentImprovement ||
    Math.abs(best.scale - 1) <= T.alignedDriftTolerance
  )
    return inconclusive;
  return {
    kind: 'uniformTempoAdjustment',
    ...common,
    confidence:
      residual <= T.highResidual &&
      windows.length / totalWindows >= 0.75 &&
      improvement >= T.minAlignmentImprovement * 2
        ? 'High'
        : 'Medium',
  };
}
