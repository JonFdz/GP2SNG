import { expandTimeline } from '../../../shared/convert/timeline';
import { barTicks, tickToSeconds } from '../../../shared/convert/timing';
import type { ParsedGpScore, YargChart } from '../../../shared/types/index';
import { scaleChartTempo } from '../state/tempoCorrection';
// TEMPORARY QA DIAGNOSTICS. Remove after real-audio tempo analysis calibration.
import {
  authoredCandidateMeasurements,
  compactDiagnosticWindows,
  createTempoAnalysisDiagnostics,
  retainCoarseCandidate,
  type ScaleCandidateDiagnostic,
  type TempoAnalysisDecisionReason,
  type TempoAnalysisDiagnostics,
  type WindowDiagnostic,
} from './tempoAnalysisDiagnostics';

export type TempoAnalysisKind =
  | 'aligned'
  | 'uniformTempoAdjustment'
  | 'tempoMapMismatch'
  | 'inconclusive';

export interface TempoAnalysisResult {
  kind: TempoAnalysisKind;
  confidence?: 'High' | 'Medium';
  scale?: number; // absolute relative to GP
  offsetMs?: number; // Preview/SNG Audio Offset: positive reads audio later in the buffer
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
  // At most 10% ambiguous windows; structural evidence still takes precedence.
  minUniformInlierRatio: 0.9,
  windowStartEpsilonSeconds: 0.01,
  scaleBoundaryMargin: 0.001,
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
  minAuthoredSideWindows: 2,
  minAttributionStrengthRatio: 1.5,
} as const;

// Global suggestions retain the existing coarse domain and fine refinement.
// The wider range is diagnostic-only and never supplies a global suggestion.
const GLOBAL_SCALE_RANGE = { min: 0.95, max: 1.05 };
const LOCAL_DIAGNOSTIC_SCALE_RANGE = { min: 0.85, max: 1.15 };

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
  const byTick = new Map<number, number>();
  for (const note of chart.notes) {
    if (note.tick < chart.leadInTicks) continue;
    // Keep every event in the fit so a small tempo change cannot switch the
    // entire event set. Dense cymbal subdivisions carry less total influence
    // than kick/snare anchors, but still support cymbal-only passages.
    const weight =
      note.note === 'orange' || note.note === 'red' ? 1 : note.note.endsWith('Tom') ? 0.7 : 0.1;
    byTick.set(note.tick, Math.max(byTick.get(note.tick) ?? 0, weight));
  }
  const events = [...byTick]
    .map(([tick, weight]) => ({
      time: tickToSeconds(tick, chart.tempoMap, chart.resolution) - lead,
      weight,
    }))
    .sort((a, b) => a.time - b.time);
  return events;
}

// Half-overlapping full-length windows keep events near an 18-second boundary
// represented on either side. Anchor the final window to the song end rather
// than counting a short tail as a failed region when duration shifts slightly.
export function globalWindowStarts(duration: number): number[] {
  const last = Math.max(0, duration - T.windowSeconds);
  const starts: number[] = [];
  for (let start = 0; start < last; start += T.windowSeconds / 2) starts.push(start);
  if (starts.length > 0 && last - starts[starts.length - 1] <= T.windowStartEpsilonSeconds)
    starts[starts.length - 1] = last;
  else starts.push(last);
  return starts;
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
    // event.time excludes the chart lead-in. Preview reads at chartTime plus
    // Audio Offset, with any physical SNG silence already present in the PCM.
    sum +=
      event.weight * at(envelope, event.time / scale + offset + paddingSeconds, secondsPerBucket);
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
  focused?: { starts: number[]; pivot: number },
): WindowFit[] {
  const windows: WindowFit[] = [];
  const starts =
    focused?.starts ?? Array.from({ length: totalWindows }, (_, i) => i * T.windowSeconds);
  const range = focused ? LOCAL_DIAGNOSTIC_SCALE_RANGE : GLOBAL_SCALE_RANGE;
  for (const start of starts) {
    const region = events.filter(
      (event) => event.time >= start && event.time < start + T.windowSeconds,
    );
    if (region.length < T.minEventsPerWindow) continue;
    // Pivot at the authored change: a large post-change scale has a large
    // absolute intercept, even when audio is continuous at the event itself.
    const pivot = focused?.pivot ?? 0;
    const relativeRegion = focused
      ? region.map((event) => ({ ...event, time: event.time - pivot }))
      : region;
    let best = { scale: 1, offset: 0, score: -1 };
    for (let scale = range.min; scale <= range.max + 0.000001; scale += 0.002) {
      const fit = searchOffset(
        relativeRegion,
        envelope,
        scale,
        padding + pivot,
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
        relativeRegion,
        envelope,
        scale,
        padding + pivot,
        coarse.offset - 0.12,
        coarse.offset + 0.12,
        0.01,
        secondsPerBucket,
      );
      if (fit.score > best.score) best = { scale, ...fit };
    }
    if (best.score >= T.minWindowScore) {
      windows.push({
        center: start + T.windowSeconds / 2,
        ...best,
        offset: best.offset + pivot * (1 - 1 / best.scale),
      });
    }
  }
  return windows;
}

export interface AuthoredTempoPoint {
  time: number;
  bpm: number;
  linear: boolean;
  bar: number;
}

// Reconstruct only authored automation positions in played order. Chart tempoMap
// also contains interpolated ramp steps, which must never be labeled as GP edits.
export function authoredTempoPoints(chart: YargChart, score: ParsedGpScore): AuthoredTempoPoint[] {
  const lead = tickToSeconds(chart.leadInTicks, chart.tempoMap, chart.resolution);
  const points: AuthoredTempoPoint[] = [];
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
  return points;
}

function tempoChange(points: AuthoredTempoPoint[], index: number): TempoAnalysisResult['mismatch'] {
  return {
    bar: points[index].bar,
    fromBpm: points[index - 1].bpm,
    toBpm: points[index].bpm,
    ramp: points[index - 1].linear,
  };
}

// Local fits can reveal the new tempo relationship soon after an authored
// change, even when cumulative drift becomes obvious much later. Compare up to
// four reliable windows on each side, excluding windows that cross this or a
// neighboring authored event. A unique, sustained scale shift earns a bar.
function attributedTempoChange(
  chart: YargChart,
  score: ParsedGpScore | undefined,
  windows: WindowFit[],
  diagnostics?: TempoAnalysisDiagnostics,
  offsetWindows?: WindowFit[],
  extendedFits?: Map<number, WindowFit[]>,
): TempoAnalysisResult['mismatch'] {
  const attribution = diagnostics?.authoredAttribution;
  if (score === undefined) {
    if (attribution) attribution.finalReason = 'noScoreAvailable';
    return undefined;
  }
  const points = authoredTempoPoints(chart, score);
  const candidates: { index: number; strength: number }[] = [];
  for (let i = 1; i < points.length; i++) {
    const point = points[i];
    if (point.bpm === points[i - 1].bpm) continue;
    const candidateWindows = extendedFits?.get(i) ?? windows;
    const before = candidateWindows
      .filter(
        (w) =>
          w.center + T.windowSeconds / 2 <= point.time &&
          w.center - T.windowSeconds / 2 >= points[i - 1].time,
      )
      .slice(-4);
    const after = candidateWindows
      .filter(
        (w) =>
          w.center - T.windowSeconds / 2 >= point.time &&
          (i + 1 === points.length || w.center + T.windowSeconds / 2 <= points[i + 1].time),
      )
      .slice(0, 4);
    // TEMPORARY measurements only. None of these values drives attribution.
    const measurement = attribution
      ? authoredCandidateMeasurements(
          {
            bar: point.bar,
            timeSeconds: point.time,
            fromBpm: points[i - 1].bpm,
            toBpm: point.bpm,
            ramp: points[i - 1].linear,
          },
          before,
          after,
          median,
          lineFit,
          {
            windows: offsetWindows ?? [],
            previousEventTime: points[i - 1].time,
            nextEventTime: points[i + 1]?.time ?? Number.POSITIVE_INFINITY,
            halfWindowSeconds: T.windowSeconds / 2,
          },
        )
      : undefined;
    if (measurement) attribution?.candidates.push(measurement);
    if (before.length < T.minAuthoredSideWindows || after.length < T.minAuthoredSideWindows) {
      if (before.length < T.minAuthoredSideWindows)
        measurement?.rejectionReasons.push('notEnoughBeforeWindows');
      if (after.length < T.minAuthoredSideWindows)
        measurement?.rejectionReasons.push('notEnoughAfterWindows');
      continue;
    }
    if (
      median(before.map((w) => w.score)) < T.minStructuralWindowScore ||
      median(after.map((w) => w.score)) < T.minStructuralWindowScore
    ) {
      if (measurement) {
        if (median(before.map((w) => w.score)) < T.minStructuralWindowScore)
          measurement.rejectionReasons.push('beforeScoreTooLow');
        if (median(after.map((w) => w.score)) < T.minStructuralWindowScore)
          measurement.rejectionReasons.push('afterScoreTooLow');
      }
      continue;
    }
    const first = median(before.map((w) => w.scale));
    const second = median(after.map((w) => w.scale));
    const firstSpread = median(before.map((w) => Math.abs(w.scale - first)));
    const secondSpread = median(after.map((w) => Math.abs(w.scale - second)));
    const change = Math.abs(second - first);
    // Wide searches must recover sustained evidence, not a median hiding weak
    // or mutually incompatible fits. Keep normal attribution unchanged.
    if (
      extendedFits &&
      ([...before, ...after].some((w) => w.score < T.minStructuralWindowScore) ||
        before.some((w) => Math.abs(w.scale - first) > T.maxRegionalScaleSpread) ||
        after.some((w) => Math.abs(w.scale - second) > T.maxRegionalScaleSpread))
    ) {
      measurement?.rejectionReasons.push('inconsistentExtendedEvidence');
      continue;
    }
    if (
      change >= T.minRegionalScaleChange &&
      firstSpread <= T.maxRegionalScaleSpread &&
      secondSpread <= T.maxRegionalScaleSpread
    ) {
      candidates.push({ index: i, strength: change - firstSpread - secondSpread });
      if (measurement) {
        measurement.acceptedAsCandidate = true;
        measurement.candidateStrength = change - firstSpread - secondSpread;
      }
    } else if (measurement) {
      if (change < T.minRegionalScaleChange)
        measurement.rejectionReasons.push('scaleChangeTooSmall');
      if (firstSpread > T.maxRegionalScaleSpread)
        measurement.rejectionReasons.push('beforeScaleSpreadTooLarge');
      if (secondSpread > T.maxRegionalScaleSpread)
        measurement.rejectionReasons.push('afterScaleSpreadTooLarge');
    }
  }
  candidates.sort((a, b) => b.strength - a.strength);
  if (attribution) {
    attribution.candidateCount = candidates.length;
    attribution.strongestCandidateStrength = candidates[0]?.strength;
    attribution.secondCandidateStrength = candidates[1]?.strength;
  }
  if (
    candidates.length === 0 ||
    (candidates.length > 1 &&
      candidates[0].strength < candidates[1].strength * T.minAttributionStrengthRatio)
  ) {
    if (attribution)
      attribution.finalReason = candidates.length === 0 ? 'noCandidates' : 'ambiguousCandidates';
    return undefined;
  }
  if (attribution) {
    attribution.finalReason = 'selectedUniqueCandidate';
    const selected = candidates[0].index;
    attribution.selectedBar = points[selected].bar;
    attribution.selectedFromBpm = points[selected - 1].bpm;
    attribution.selectedToBpm = points[selected].bpm;
  }
  return tempoChange(points, candidates[0].index);
}

// At most four complete, independent windows per side of each real change.
// Share this evidence with the existing conservative authored attribution gates.
function extendedAuthoredFits(
  points: AuthoredTempoPoint[],
  events: Event[],
  envelope: Float32Array,
  padding: number,
  secondsPerBucket: number,
  duration: number,
): Map<number, WindowFit[]> {
  const fits = new Map<number, WindowFit[]>();
  const starts = Array.from(
    { length: Math.floor(duration / T.windowSeconds) },
    (_, i) => i * T.windowSeconds,
  );
  for (let i = 1; i < points.length; i++) {
    if (points[i].bpm === points[i - 1].bpm) continue;
    const before = starts
      .filter((start) => start >= points[i - 1].time && start + T.windowSeconds <= points[i].time)
      .slice(-4);
    const after = starts
      .filter(
        (start) =>
          start >= points[i].time && start + T.windowSeconds <= (points[i + 1]?.time ?? duration),
      )
      .slice(0, 4);
    if (before.length < T.minAuthoredSideWindows || after.length < T.minAuthoredSideWindows)
      continue;
    fits.set(
      i,
      localWindowFits(events, envelope, padding, secondsPerBucket, 0, {
        starts: [...before, ...after],
        pivot: points[i].time,
      }),
    );
  }
  return fits;
}

// TEMPORARY QA DIAGNOSTICS: the optional callback leaves the returned result
// untouched. The UI supplies it only in development; ordinary calls collect nothing.
export function analyzeTempo(
  chart: YargChart,
  currentScale: number,
  audio: PcmAudio,
  audioPaddingMs = 0,
  score?: ParsedGpScore,
  onDiagnostics?: (diagnostics: TempoAnalysisDiagnostics) => void,
): TempoAnalysisResult {
  const diagnostics = onDiagnostics
    ? createTempoAnalysisDiagnostics(audio, currentScale, audioPaddingMs, T)
    : undefined;
  try {
    return analyzeTempoCore(chart, currentScale, audio, audioPaddingMs, score, diagnostics);
  } catch (error) {
    if (diagnostics) {
      diagnostics.finalReason = 'unexpectedError';
      diagnostics.errorName = error instanceof Error ? error.name : typeof error;
    }
    throw error;
  } finally {
    if (diagnostics && onDiagnostics) {
      // Diagnostics, including a failing console callback, must not affect results.
      try {
        compactDiagnosticWindows(diagnostics);
        onDiagnostics(diagnostics);
      } catch {
        // TEMPORARY reporting must not mask an analyzer return or exception.
      }
    }
  }
}

function analyzeTempoCore(
  chart: YargChart,
  currentScale: number,
  audio: PcmAudio,
  audioPaddingMs: number,
  score: ParsedGpScore | undefined,
  diagnostics?: TempoAnalysisDiagnostics,
): TempoAnalysisResult {
  const finish = (reason: TempoAnalysisDecisionReason, result: TempoAnalysisResult) => {
    if (diagnostics) {
      diagnostics.finalReason = reason;
      diagnostics.result = { ...result };
      if (result.mismatch) diagnostics.result.mismatch = { ...result.mismatch };
    }
    return result;
  };
  const inconclusive: TempoAnalysisResult = { kind: 'inconclusive' };
  if (audio.sampleRate <= 0 || audio.numberOfChannels < 1 || !Number.isFinite(audioPaddingMs))
    return finish('invalidAudio', inconclusive);
  let original: YargChart;
  try {
    original = scaleChartTempo(chart, currentScale, 1);
  } catch {
    return finish(
      !Number.isFinite(currentScale) || currentScale <= 0
        ? 'invalidCurrentScale'
        : 'baselineReconstructionFailed',
      inconclusive,
    );
  }
  const events = chartEvents(original);
  const duration =
    tickToSeconds(original.endTick, original.tempoMap, original.resolution) -
    tickToSeconds(original.leadInTicks, original.tempoMap, original.resolution);
  if (diagnostics) {
    diagnostics.durationSeconds = duration;
    diagnostics.originalOpeningBpm = 60000000 / (original.tempoMap[0]?.usPerQuarter ?? 500000);
    diagnostics.eventSummary = {
      uniqueTicks: events.length,
      strongEvents: events.filter((event) => event.weight === 1).length,
      tomEvents: events.filter((event) => event.weight === 0.7).length,
      cymbalOnlyEvents: events.filter((event) => event.weight === 0.1).length,
      totalWeight: events.reduce((sum, event) => sum + event.weight, 0),
    };
  }
  if (
    events.length < T.minEventsPerWindow * T.minAnalyzableWindows ||
    duration < T.windowSeconds * 2
  )
    return finish(
      events.length < T.minEventsPerWindow * T.minAnalyzableWindows
        ? 'insufficientEvents'
        : 'songTooShort',
      inconclusive,
    );
  const envelope = onsetEnvelope(audio);
  if (diagnostics) {
    const nonZero = envelope.reduce((count, value) => count + (value !== 0 ? 1 : 0), 0);
    diagnostics.audio.envelopeBuckets = envelope.length;
    diagnostics.audio.nonZeroEnvelopeBuckets = nonZero;
    diagnostics.audio.nonZeroRatio = envelope.length > 0 ? nonZero / envelope.length : 0;
  }
  if (envelope.every((v) => v === 0)) return finish('noOnsetEvidence', inconclusive);
  const secondsPerBucket = bucketDuration(audio.sampleRate);
  const padding = audioPaddingMs / 1000;
  const sample = sparse(events, 400);
  let best = { scale: 1, offset: 0, score: -1 };
  const topScaleCandidates: ScaleCandidateDiagnostic[] = [];
  // Narrow GP-prior search. Coarse 0.05% then fine 0.005%; offset is searched
  // jointly so a fixed audio delay cannot masquerade as a tempo change.
  for (
    let scale = GLOBAL_SCALE_RANGE.min;
    scale <= GLOBAL_SCALE_RANGE.max + 0.000001;
    scale += 0.0005
  ) {
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
    if (diagnostics)
      retainCoarseCandidate(topScaleCandidates, {
        scale,
        offsetSeconds: fit.offset,
        score: fit.score,
      });
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
  const nearScaleBoundary =
    best.scale <= GLOBAL_SCALE_RANGE.min + T.scaleBoundaryMargin ||
    best.scale >= GLOBAL_SCALE_RANGE.max - T.scaleBoundaryMargin;
  if (diagnostics) {
    diagnostics.search = {
      minScale: GLOBAL_SCALE_RANGE.min,
      maxScale: GLOBAL_SCALE_RANGE.max,
      fineMinScale: coarse.scale - 0.001,
      fineMaxScale: coarse.scale + 0.001,
      sampledEvents: sample.length,
      bestScale: best.scale,
      bestOffsetSeconds: best.offset,
      bestScore: best.score,
      baseScale: 1,
      baseOffsetSeconds: base.offset,
      baseScore: base.score,
      alignmentImprovement: best.score - base.score,
      differencePercent: (best.scale - 1) * 100,
      boundaryProximityScale: T.scaleBoundaryMargin,
      nearScaleBoundary,
      topScaleCandidates,
    };
  }

  const windows: WindowFit[] = [];
  const windowDiagnostics: WindowDiagnostic[] = [];
  const primaryWindows: WindowFit[] = [];
  const starts = globalWindowStarts(duration);
  const totalWindows = starts.length;
  for (const [index, start] of starts.entries()) {
    const region = events.filter(
      (event) => event.time >= start && event.time < start + T.windowSeconds,
    );
    if (region.length < T.minEventsPerWindow) {
      if (diagnostics)
        windowDiagnostics.push({
          start,
          center: start + T.windowSeconds / 2,
          eventCount: region.length,
          accepted: false,
          rejectionReason: 'tooFewEvents',
        });
      continue;
    }
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
    if (diagnostics)
      windowDiagnostics.push({
        start,
        center: start + T.windowSeconds / 2,
        eventCount: region.length,
        accepted: fit.score >= T.minWindowScore,
        rejectionReason: fit.score >= T.minWindowScore ? undefined : 'lowScore',
        score: fit.score,
        offsetSeconds: fit.offset,
      });
    if (fit.score >= T.minWindowScore) {
      const window = { center: start + T.windowSeconds / 2, scale: best.scale, ...fit };
      windows.push(window);
      if (index % 2 === 0) primaryWindows.push(window);
    }
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
  const inliers = windows.filter((w) => Math.abs(w.offset - center) <= T.maxUniformResidual);
  const outliers = windows.filter((w) => Math.abs(w.offset - center) > T.maxUniformResidual);
  const inlierRatio = windows.length > 0 ? inliers.length / windows.length : 0;
  let acceptedViaRobustConsensus = false;
  const differencePercent = (best.scale - 1) * 100;
  if (diagnostics) {
    const scores = windows.map((window) => window.score);
    diagnostics.globalValidation = {
      durationSeconds: duration,
      totalWindows,
      acceptedWindows: windows.length,
      coverage: windows.length / totalWindows,
      enoughGlobal,
      medianOffsetSeconds: windows.length > 0 ? center : null,
      medianResidualSeconds: windows.length > 0 ? residual : null,
      maxResidualSeconds: windows.length > 0 ? maxResidual : null,
      stable,
      inlierWindowCount: inliers.length,
      outlierWindowCount: outliers.length,
      inlierRatio,
      outlierWindows: outliers.map((w) => ({ center: w.center, offsetSeconds: w.offset })),
      acceptedViaRobustConsensus,
      minAcceptedWindowScore: scores.length > 0 ? Math.min(...scores) : null,
      medianAcceptedWindowScore: scores.length > 0 ? median(scores) : null,
      maxAcceptedWindowScore: scores.length > 0 ? Math.max(...scores) : null,
      rejectedForTooFewEvents: windowDiagnostics.filter((w) => w.rejectionReason === 'tooFewEvents')
        .length,
      rejectedForLowScore: windowDiagnostics.filter((w) => w.rejectionReason === 'lowScore').length,
      windows: windowDiagnostics,
      omittedWindows: 0,
    };
  }
  const common = {
    scale: best.scale,
    offsetMs: Math.round(center * 1000),
    differencePercent,
    driftSecondsPerMinute: 60 * Math.abs(1 - 1 / best.scale),
  };
  if (!enoughGlobal || !stable) {
    if (diagnostics) {
      diagnostics.fallback.entered = true;
      if (!enoughGlobal) diagnostics.fallback.entryReasons.push('insufficientGlobalCoverage');
      if (!stable) diagnostics.fallback.entryReasons.push('unstableGlobalOffsets');
    }
    const localWindowCount = Math.ceil(duration / T.windowSeconds);
    const local = localWindowFits(events, envelope, padding, secondsPerBucket, localWindowCount);
    if (diagnostics) {
      diagnostics.fallback.localWindowCount = localWindowCount;
      diagnostics.fallback.acceptedLocalWindows = local.length;
      diagnostics.fallback.localCoverage = local.length / localWindowCount;
    }
    const enoughLocal = local.length / localWindowCount >= T.minCoverage;
    const regionalBoundary = enoughLocal ? regionalScaleBoundary(local) : null;
    // TEMPORARY: also measure the offset boundary when the regional boundary
    // wins. This pure diagnostic call cannot alter the existing ?? precedence.
    const offsetBoundary =
      enoughLocal && (regionalBoundary === null || diagnostics !== undefined)
        ? structuralBoundary(primaryWindows)
        : null;
    const boundary = regionalBoundary ?? offsetBoundary;
    if (diagnostics) {
      diagnostics.fallback.boundariesEvaluated = enoughLocal;
      diagnostics.fallback.regionalScaleBoundary = regionalBoundary;
      diagnostics.fallback.structuralBoundary = offsetBoundary;
      diagnostics.fallback.selectedBoundary = boundary;
      diagnostics.fallback.selectedBoundarySource =
        regionalBoundary !== null
          ? 'regionalScale'
          : offsetBoundary !== null
            ? 'offsetStructure'
            : 'none';
    }
    if (boundary !== null)
      return finish('tempoMapMismatch', {
        kind: 'tempoMapMismatch',
        mismatch: attributedTempoChange(original, score, local, diagnostics, primaryWindows),
      });
    // Only authored changes can unlock wider diagnostic fits. They never feed
    // best/common or any automatic whole-song scale recommendation.
    if (score) {
      const points = authoredTempoPoints(original, score);
      if (points.some((point, i) => i > 0 && point.bpm !== points[i - 1].bpm)) {
        if (diagnostics) {
          diagnostics.fallback.extendedDiagnosticSearchUsed = true;
          diagnostics.fallback.extendedScaleRange = LOCAL_DIAGNOSTIC_SCALE_RANGE;
        }
        const extended = extendedAuthoredFits(
          points,
          events,
          envelope,
          padding,
          secondsPerBucket,
          duration,
        );
        const mismatch = attributedTempoChange(
          original,
          score,
          [],
          diagnostics,
          primaryWindows,
          extended,
        );
        if (mismatch) return finish('tempoMapMismatch', { kind: 'tempoMapMismatch', mismatch });
      }
    }
    // A strong majority can survive isolated rhythmic aliases, but only after
    // both structural paths have had priority. Never promote this to High.
    acceptedViaRobustConsensus =
      enoughGlobal &&
      enoughLocal &&
      inlierRatio >= T.minUniformInlierRatio &&
      best.score >= T.minStructuralWindowScore &&
      improvement >= T.minAlignmentImprovement * 2;
    if (diagnostics?.globalValidation)
      diagnostics.globalValidation.acceptedViaRobustConsensus = acceptedViaRobustConsensus;
    if (!acceptedViaRobustConsensus)
      return finish(
        enoughLocal ? 'noStructuralBoundary' : 'insufficientLocalCoverage',
        inconclusive,
      );
  }
  if (
    Math.abs(best.scale - 1) <= T.alignedDriftTolerance &&
    improvement < T.minAlignmentImprovement
  ) {
    return finish('aligned', { kind: 'aligned', ...common });
  }
  if (
    improvement < T.minAlignmentImprovement ||
    Math.abs(best.scale - 1) <= T.alignedDriftTolerance
  )
    return finish(
      improvement < T.minAlignmentImprovement
        ? 'insufficientAlignmentImprovement'
        : 'withinAlignedToleranceButImprovementUnexpected',
      inconclusive,
    );
  return finish('uniformAdjustment', {
    kind: 'uniformTempoAdjustment',
    ...common,
    confidence:
      !acceptedViaRobustConsensus &&
      !nearScaleBoundary &&
      residual <= T.highResidual &&
      windows.length / totalWindows >= 0.75 &&
      improvement >= T.minAlignmentImprovement * 2
        ? 'High'
        : 'Medium',
  });
}
