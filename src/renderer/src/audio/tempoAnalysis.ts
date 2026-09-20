import { expandTimeline } from '../../../shared/convert/timeline';
import { barTicks, tickToSeconds } from '../../../shared/convert/timing';
import type { ParsedGpScore, YargChart } from '../../../shared/types/index';
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
  mismatch?: { bar: number; fromBpm: number; toBpm: number; ramp: boolean };
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
  minStructuralWindows: 8,
  minStructuralWindowScore: 0.3,
  maxStructuralResidual: 0.12,
  minStructuralImprovement: 0.1,
  maxStructuralResidualRatio: 0.6,
  minStructuralSlopeChange: 0.004,
  minStructuralOffsetJump: 0.25,
  minRegionalScaleChange: 0.006,
  maxRegionalScaleSpread: 0.003,
  maxRegionalOffsetSpread: 0.25,
} as const;

interface Event {
  time: number;
  weight: number;
}
interface WindowFit {
  center: number;
  offset: number;
  score: number;
  scale: number;
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
  const duration = tickToSeconds(chart.endTick, chart.tempoMap, chart.resolution) - lead;
  const byTick = new Map<number, number>();
  for (const note of chart.notes) {
    if (note.tick < chart.leadInTicks) continue;
    // Kick/snare are usually distinctive anchors. Toms get partial weight;
    // cymbal-only subdivisions are a fallback when strong drums are too sparse.
    const weight =
      note.note === 'orange' || note.note === 'red' ? 1 : note.note.endsWith('Tom') ? 0.7 : 0.3;
    byTick.set(note.tick, Math.max(byTick.get(note.tick) ?? 0, weight));
  }
  const events = [...byTick]
    .map(([tick, weight]) => ({
      time: tickToSeconds(tick, chart.tempoMap, chart.resolution) - lead,
      weight,
    }))
    .sort((a, b) => a.time - b.time);
  const strong = events.filter((event) => event.weight >= 0.7);
  const strongWindows = new Set(strong.map((event) => Math.floor(event.time / T.windowSeconds)));
  // A dense cymbal pattern can otherwise outweigh even correctly aligned
  // kicks/snares by sheer count. Retain cymbals for songs with sparse anchors.
  return strong.length >= T.minEventsPerWindow * T.minAnalyzableWindows &&
    strongWindows.size / Math.ceil(duration / T.windowSeconds) >= T.minCoverage
    ? strong
    : events;
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

function lineFit(windows: WindowFit[]): { intercept: number; slope: number; sumSquared: number } {
  const meanTime = windows.reduce((sum, w) => sum + w.center, 0) / windows.length;
  const meanOffset = windows.reduce((sum, w) => sum + w.offset, 0) / windows.length;
  let covariance = 0;
  let variance = 0;
  for (const w of windows) {
    covariance += (w.center - meanTime) * (w.offset - meanOffset);
    variance += (w.center - meanTime) ** 2;
  }
  const slope = variance > 0 ? covariance / variance : 0;
  const intercept = meanOffset - slope * meanTime;
  const sumSquared = windows.reduce(
    (sum, w) => sum + (w.offset - intercept - slope * w.center) ** 2,
    0,
  );
  return { intercept, slope, sumSquared };
}

// Regional disagreement alone is ambiguous. Require a sustained two-segment
// offset trajectory that fits much better than one line, with a slope change or
// persistent jump. Short/noisy runs cannot earn a structural diagnosis.
function structuralBoundary(windows: WindowFit[]): number | null {
  if (
    windows.length < T.minStructuralWindows ||
    median(windows.map((w) => w.score)) < T.minStructuralWindowScore
  )
    return null;
  const whole = Math.sqrt(lineFit(windows).sumSquared / windows.length);
  let best: { boundary: number; residual: number } | null = null;
  for (let split = 4; split <= windows.length - 4; split++) {
    const before = lineFit(windows.slice(0, split));
    const after = lineFit(windows.slice(split));
    const boundary = (windows[split - 1].center + windows[split].center) / 2;
    const residual = Math.sqrt((before.sumSquared + after.sumSquared) / windows.length);
    const jump = Math.abs(
      before.intercept + before.slope * boundary - after.intercept - after.slope * boundary,
    );
    if (
      residual <= T.maxStructuralResidual &&
      whole - residual >= T.minStructuralImprovement &&
      residual <= whole * T.maxStructuralResidualRatio &&
      (Math.abs(before.slope - after.slope) >= T.minStructuralSlopeChange ||
        jump >= T.minStructuralOffsetJump) &&
      (best === null || residual < best.residual)
    )
      best = { boundary, residual };
  }
  return best?.boundary ?? null;
}

// A wrong chart tempo step produces two sustained local scale clusters (for
// example ~1.000 before and ~1.025 after 164→160). Random regional delays may
// vary in offset, but do not form two tight, different tempo-scale clusters.
function regionalScaleBoundary(windows: WindowFit[]): number | null {
  if (
    windows.length < T.minStructuralWindows ||
    median(windows.map((w) => w.score)) < T.minStructuralWindowScore
  )
    return null;
  let best: { boundary: number; difference: number } | null = null;
  for (let split = 4; split <= windows.length - 4; split++) {
    const beforeWindows = windows.slice(0, split);
    const afterWindows = windows.slice(split);
    const before = beforeWindows.map((w) => w.scale);
    const after = afterWindows.map((w) => w.scale);
    const first = median(before);
    const second = median(after);
    const difference = Math.abs(first - second);
    const firstSpread = median(before.map((scale) => Math.abs(scale - first)));
    const secondSpread = median(after.map((scale) => Math.abs(scale - second)));
    const firstOffset = median(beforeWindows.map((w) => w.offset));
    const secondOffset = median(afterWindows.map((w) => w.offset));
    const firstOffsetSpread = median(beforeWindows.map((w) => Math.abs(w.offset - firstOffset)));
    const secondOffsetSpread = median(afterWindows.map((w) => Math.abs(w.offset - secondOffset)));
    if (
      difference >= T.minRegionalScaleChange &&
      firstSpread <= T.maxRegionalScaleSpread &&
      secondSpread <= T.maxRegionalScaleSpread &&
      firstOffsetSpread <= T.maxRegionalOffsetSpread &&
      secondOffsetSpread <= T.maxRegionalOffsetSpread &&
      (best === null || difference > best.difference)
    )
      best = {
        boundary: (windows[split - 1].center + windows[split].center) / 2,
        difference,
      };
  }
  return best?.boundary ?? null;
}

function localWindowFits(
  events: Event[],
  envelope: Float32Array,
  padding: number,
  secondsPerBucket: number,
  totalWindows: number,
): WindowFit[] {
  const windows: WindowFit[] = [];
  for (let i = 0; i < totalWindows; i++) {
    const start = i * T.windowSeconds;
    const region = events.filter(
      (event) => event.time >= start && event.time < start + T.windowSeconds,
    );
    if (region.length < T.minEventsPerWindow) continue;
    let best = { scale: 1, offset: 0, score: -1 };
    for (let scale = 0.95; scale <= 1.050001; scale += 0.002) {
      const fit = searchOffset(
        region,
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
    for (let scale = coarse.scale - 0.003; scale <= coarse.scale + 0.003001; scale += 0.0005) {
      const fit = searchOffset(
        region,
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
    if (best.score >= T.minWindowScore) {
      windows.push({ center: start + T.windowSeconds / 2, ...best });
    }
  }
  return windows;
}

// Reconstruct only authored automation positions in played order. Chart tempoMap
// also contains interpolated ramp steps, which must never be labeled as GP edits.
export function authoredTempoDiagnostic(
  chart: YargChart,
  score: ParsedGpScore | undefined,
  boundary: number,
): TempoAnalysisResult['mismatch'] {
  if (score === undefined) return undefined;
  const lead = tickToSeconds(chart.leadInTicks, chart.tempoMap, chart.resolution);
  const points: { time: number; bpm: number; linear: boolean; bar: number }[] = [];
  let barStart = chart.leadInTicks;
  for (const masterIndex of expandTimeline(score.masterBars)) {
    const master = score.masterBars[masterIndex];
    const span = barTicks(master.timeSignature, chart.resolution);
    const automations = score.tempoAutomations
      .filter((auto) => auto.bar === masterIndex)
      .sort((a, b) => a.position - b.position);
    for (const auto of automations) {
      const tick = barStart + Math.round(auto.position * span);
      points.push({
        time: tickToSeconds(tick, chart.tempoMap, chart.resolution) - lead,
        bpm: auto.bpm,
        linear: auto.linear,
        bar: masterIndex + 1,
      });
    }
    barStart += span;
  }
  let closest: TempoAnalysisResult['mismatch'];
  let distance: number = T.windowSeconds;
  for (let i = 1; i < points.length; i++) {
    const previous = points[i - 1];
    const point = points[i];
    if (previous.bpm === point.bpm) continue;
    const delta = Math.abs(point.time - boundary);
    if (delta < distance) {
      distance = delta;
      closest = {
        bar: point.bar,
        fromBpm: previous.bpm,
        toBpm: point.bpm,
        ramp: previous.linear,
      };
    }
  }
  return closest;
}

export function analyzeTempo(
  chart: YargChart,
  currentScale: number,
  audio: PcmAudio,
  audioPaddingMs = 0,
  score?: ParsedGpScore,
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
      windows.push({ center: start + T.windowSeconds / 2, scale: best.scale, ...fit });
  }
  const enoughGlobal =
    windows.length >= T.minAnalyzableWindows && windows.length / totalWindows >= T.minCoverage;
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
  if (!enoughGlobal || !stable) {
    const local = localWindowFits(events, envelope, padding, secondsPerBucket, totalWindows);
    if (local.length / totalWindows < T.minCoverage) return inconclusive;
    const boundary = regionalScaleBoundary(local) ?? structuralBoundary(windows);
    return boundary === null
      ? inconclusive
      : { kind: 'tempoMapMismatch', mismatch: authoredTempoDiagnostic(original, score, boundary) };
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
