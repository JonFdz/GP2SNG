// TEMPORARY QA DIAGNOSTICS.
// Remove this file, its analyzer hooks, and the development-only UI callback
// after real-audio tempo analysis calibration. No PCM or envelope data is logged.
import type { PcmAudio, TempoAnalysisResult } from './tempoAnalysis';

export type TempoAnalysisDecisionReason =
  | 'aligned'
  | 'uniformAdjustment'
  | 'tempoMapMismatch'
  | 'invalidAudio'
  | 'invalidCurrentScale'
  | 'baselineReconstructionFailed'
  | 'insufficientEvents'
  | 'songTooShort'
  | 'noOnsetEvidence'
  | 'insufficientLocalCoverage'
  | 'noStructuralBoundary'
  | 'insufficientAlignmentImprovement'
  | 'withinAlignedToleranceButImprovementUnexpected'
  | 'unexpectedError';

export interface ScaleCandidateDiagnostic {
  scale: number;
  offsetSeconds: number;
  score: number;
}

export interface WindowDiagnostic {
  start: number;
  center: number;
  eventCount: number;
  accepted: boolean;
  rejectionReason?: 'tooFewEvents' | 'lowScore';
  score?: number;
  offsetSeconds?: number;
}

export interface AuthoredCandidateDiagnostic {
  bar: number;
  timeSeconds: number;
  fromBpm: number;
  toBpm: number;
  ramp: boolean;
  beforeWindowCount: number;
  afterWindowCount: number;
  beforeMedianScore: number | null;
  afterMedianScore: number | null;
  beforeScaleMedian: number | null;
  afterScaleMedian: number | null;
  scaleChange: number | null;
  beforeScaleSpread: number | null;
  afterScaleSpread: number | null;
  beforeOffsetWindowCount: number;
  afterOffsetWindowCount: number;
  beforeOffsetMedian: number | null;
  afterOffsetMedian: number | null;
  beforeOffsetSpread: number | null;
  afterOffsetSpread: number | null;
  beforeOffsetSlope: number | null;
  afterOffsetSlope: number | null;
  slopeChange: number | null;
  estimatedOffsetJumpAtEvent: number | null;
  acceptedAsCandidate: boolean;
  candidateStrength?: number;
  rejectionReasons: (
    | 'notEnoughBeforeWindows'
    | 'notEnoughAfterWindows'
    | 'beforeScoreTooLow'
    | 'afterScoreTooLow'
    | 'scaleChangeTooSmall'
    | 'beforeScaleSpreadTooLarge'
    | 'afterScaleSpreadTooLarge'
  )[];
}

export interface TempoAnalysisDiagnostics {
  temporaryQaDiagnostics: true;
  finalReason?: TempoAnalysisDecisionReason;
  result?: TempoAnalysisResult;
  errorName?: string;
  currentScale: number;
  originalOpeningBpm?: number;
  audioPaddingMs: number;
  thresholds: Readonly<Record<string, number>>;
  audio: {
    sampleRate: number;
    channels: number;
    durationSeconds: number | null;
    envelopeBuckets?: number;
    nonZeroEnvelopeBuckets?: number;
    nonZeroRatio?: number;
  };
  durationSeconds?: number;
  eventSummary?: {
    uniqueTicks: number;
    strongEvents: number;
    tomEvents: number;
    cymbalOnlyEvents: number;
    totalWeight: number;
  };
  search?: {
    minScale: number;
    maxScale: number;
    fineMinScale: number;
    fineMaxScale: number;
    sampledEvents: number;
    bestScale: number;
    bestOffsetSeconds: number;
    bestScore: number;
    baseScale: 1;
    baseOffsetSeconds: number;
    baseScore: number;
    alignmentImprovement: number;
    differencePercent: number;
    nearScaleBoundary: boolean;
    boundaryProximityScale: number;
    topScaleCandidates: ScaleCandidateDiagnostic[];
  };
  globalValidation?: {
    durationSeconds: number;
    totalWindows: number;
    acceptedWindows: number;
    coverage: number;
    enoughGlobal: boolean;
    medianOffsetSeconds: number | null;
    medianResidualSeconds: number | null;
    maxResidualSeconds: number | null;
    stable: boolean;
    minAcceptedWindowScore: number | null;
    medianAcceptedWindowScore: number | null;
    maxAcceptedWindowScore: number | null;
    rejectedForTooFewEvents: number;
    rejectedForLowScore: number;
    windows: WindowDiagnostic[];
    omittedWindows: number;
  };
  fallback: {
    entered: boolean;
    entryReasons: ('insufficientGlobalCoverage' | 'unstableGlobalOffsets')[];
    localWindowCount?: number;
    acceptedLocalWindows?: number;
    localCoverage?: number;
    boundariesEvaluated: boolean;
    regionalScaleBoundary: number | null;
    structuralBoundary: number | null;
    selectedBoundary: number | null;
    selectedBoundarySource: 'regionalScale' | 'offsetStructure' | 'none';
  };
  authoredAttribution: {
    candidateCount: number;
    selectedBar?: number;
    selectedFromBpm?: number;
    selectedToBpm?: number;
    strongestCandidateStrength?: number;
    secondCandidateStrength?: number;
    requiredStrengthRatio: number;
    finalReason:
      | 'notEvaluated'
      | 'selectedUniqueCandidate'
      | 'noCandidates'
      | 'ambiguousCandidates'
      | 'noScoreAvailable';
    // Use the existing nonoverlapping global-validation fits at bestScale for
    // drift measurements; local scale-fit intercepts have different time bases.
    offsetTrajectoryBasis: 'globalValidationAtBestScale';
    candidates: AuthoredCandidateDiagnostic[];
  };
}

export function createTempoAnalysisDiagnostics(
  audio: PcmAudio,
  currentScale: number,
  audioPaddingMs: number,
  thresholds: Readonly<Record<string, number>>,
): TempoAnalysisDiagnostics {
  return {
    temporaryQaDiagnostics: true,
    currentScale,
    audioPaddingMs,
    thresholds: { ...thresholds },
    audio: {
      sampleRate: audio.sampleRate,
      channels: audio.numberOfChannels,
      durationSeconds: audio.sampleRate > 0 ? audio.length / audio.sampleRate : null,
    },
    fallback: {
      entered: false,
      entryReasons: [],
      boundariesEvaluated: false,
      regionalScaleBoundary: null,
      structuralBoundary: null,
      selectedBoundary: null,
      selectedBoundarySource: 'none',
    },
    authoredAttribution: {
      candidateCount: 0,
      requiredStrengthRatio: thresholds.minAttributionStrengthRatio,
      finalReason: 'notEvaluated',
      offsetTrajectoryBasis: 'globalValidationAtBestScale',
      candidates: [],
    },
  };
}

export function retainCoarseCandidate(
  top: ScaleCandidateDiagnostic[],
  candidate: ScaleCandidateDiagnostic,
): void {
  // Each coarse iteration has a distinct scale. Keep only five fits, never
  // scale × offset samples, and never sort or mutate the actual search inputs.
  top.push(candidate);
  top.sort((a, b) => b.score - a.score);
  if (top.length > 5) top.pop();
}

interface LocalFit {
  center: number;
  score: number;
  scale: number;
  offset: number;
}

export function authoredCandidateMeasurements(
  change: { bar: number; timeSeconds: number; fromBpm: number; toBpm: number; ramp: boolean },
  before: LocalFit[],
  after: LocalFit[],
  median: (values: number[]) => number,
  lineFit: (windows: LocalFit[]) => { intercept: number; slope: number },
  offsetEvidence: {
    windows: LocalFit[];
    previousEventTime: number;
    nextEventTime: number;
    halfWindowSeconds: number;
  },
): AuthoredCandidateDiagnostic {
  const side = (windows: LocalFit[]) => {
    if (windows.length === 0) return null;
    const scale = median(windows.map((w) => w.scale));
    const offset = median(windows.map((w) => w.offset));
    return {
      score: median(windows.map((w) => w.score)),
      scale,
      scaleSpread: median(windows.map((w) => Math.abs(w.scale - scale))),
      offset,
      offsetSpread: median(windows.map((w) => Math.abs(w.offset - offset))),
      line: windows.length >= 2 ? lineFit(windows) : null,
    };
  };
  const first = side(before);
  const second = side(after);
  // Measurement only, using the same neighboring-event exclusion and up to
  // four windows per side. These windows do not enter candidate selection.
  const offsetBefore = offsetEvidence.windows
    .filter(
      (w) =>
        w.center + offsetEvidence.halfWindowSeconds <= change.timeSeconds &&
        w.center - offsetEvidence.halfWindowSeconds >= offsetEvidence.previousEventTime,
    )
    .slice(-4);
  const offsetAfter = offsetEvidence.windows
    .filter(
      (w) =>
        w.center - offsetEvidence.halfWindowSeconds >= change.timeSeconds &&
        w.center + offsetEvidence.halfWindowSeconds <= offsetEvidence.nextEventTime,
    )
    .slice(0, 4);
  const firstOffset = side(offsetBefore);
  const secondOffset = side(offsetAfter);
  return {
    ...change,
    beforeWindowCount: before.length,
    afterWindowCount: after.length,
    beforeMedianScore: first?.score ?? null,
    afterMedianScore: second?.score ?? null,
    beforeScaleMedian: first?.scale ?? null,
    afterScaleMedian: second?.scale ?? null,
    scaleChange: first && second ? Math.abs(second.scale - first.scale) : null,
    beforeScaleSpread: first?.scaleSpread ?? null,
    afterScaleSpread: second?.scaleSpread ?? null,
    beforeOffsetWindowCount: offsetBefore.length,
    afterOffsetWindowCount: offsetAfter.length,
    beforeOffsetMedian: firstOffset?.offset ?? null,
    afterOffsetMedian: secondOffset?.offset ?? null,
    beforeOffsetSpread: firstOffset?.offsetSpread ?? null,
    afterOffsetSpread: secondOffset?.offsetSpread ?? null,
    beforeOffsetSlope: firstOffset?.line?.slope ?? null,
    afterOffsetSlope: secondOffset?.line?.slope ?? null,
    slopeChange:
      firstOffset?.line && secondOffset?.line
        ? secondOffset.line.slope - firstOffset.line.slope
        : null,
    estimatedOffsetJumpAtEvent:
      firstOffset?.line && secondOffset?.line
        ? secondOffset.line.intercept +
          secondOffset.line.slope * change.timeSeconds -
          (firstOffset.line.intercept + firstOffset.line.slope * change.timeSeconds)
        : null,
    acceptedAsCandidate: false,
    rejectionReasons: [],
  };
}

function evenlySpaced<T>(items: T[], count: number): T[] {
  if (items.length <= count) return items;
  if (count <= 0) return [];
  return Array.from(
    { length: count },
    (_, i) => items[Math.round((i * (items.length - 1)) / Math.max(1, count - 1))],
  );
}

export function compactDiagnosticWindows(diagnostics: TempoAnalysisDiagnostics): void {
  const validation = diagnostics.globalValidation;
  if (!validation || validation.windows.length <= 96) return;
  const problematic = (w: WindowDiagnostic) =>
    !w.accepted ||
    Math.abs((w.offsetSeconds ?? 0) - (validation.medianOffsetSeconds ?? 0)) >
      diagnostics.thresholds.maxUniformResidual;
  const problems = validation.windows.filter(problematic);
  const overview = validation.windows.filter((w) => !problematic(w));
  // Retain all problematic windows when possible; on unusually long recordings
  // spread 72 problem samples and at least 24 ordinary samples across the song.
  const keptProblems = evenlySpaced(problems, Math.max(72, 96 - overview.length));
  const kept = [...keptProblems, ...evenlySpaced(overview, 96 - keptProblems.length)];
  validation.omittedWindows = validation.windows.length - kept.length;
  validation.windows = kept.sort((a, b) => a.start - b.start);
}

export function logTempoAnalysisDiagnostics(diagnostics: TempoAnalysisDiagnostics): void {
  // One immutable, copyable block in Electron DevTools; no per-loop logging.
  if (import.meta.env.DEV)
    console.log('[GP2SNG tempo analysis debug]', JSON.stringify(diagnostics, null, 2));
}
