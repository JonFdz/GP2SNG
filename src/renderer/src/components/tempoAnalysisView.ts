import type { TempoAnalysisResult } from '../audio/tempoAnalysis';

// The onset envelope uses 10 ms buckets and the regional offset search uses
// 20 ms steps. Smaller suggestions are below useful action precision.
export const MIN_ACTIONABLE_OFFSET_MS = 30;
const TEMPO_APPLIED_TOLERANCE = 0.00015; // about one 0.01% manual input step
const OFFSET_APPLIED_TOLERANCE_MS = 20;

export function suggestedTempoApplied(result: TempoAnalysisResult, currentScale: number): boolean {
  return (
    result.kind === 'uniformTempoAdjustment' &&
    result.scale !== undefined &&
    Math.abs(result.scale - currentScale) <= TEMPO_APPLIED_TOLERANCE
  );
}

export function suggestedOffsetAvailable(result: TempoAnalysisResult): boolean {
  return (
    (result.kind === 'aligned' || result.kind === 'uniformTempoAdjustment') &&
    result.offsetMs !== undefined &&
    Math.abs(result.offsetMs) >= MIN_ACTIONABLE_OFFSET_MS
  );
}

export function suggestedOffsetApplied(
  result: TempoAnalysisResult,
  currentOffsetMs: number,
): boolean {
  return (
    suggestedOffsetAvailable(result) &&
    Math.abs((result.offsetMs ?? 0) - currentOffsetMs) <= OFFSET_APPLIED_TOLERANCE_MS
  );
}

export function preserveAnalysisOnSourceChange(
  result: TempoAnalysisResult | null,
  chartChanged: boolean,
  audioChanged: boolean,
  pendingSuggestedScale: number | null,
  currentScale: number,
): boolean {
  return (
    result !== null &&
    chartChanged &&
    !audioChanged &&
    pendingSuggestedScale !== null &&
    Math.abs(pendingSuggestedScale - currentScale) <= TEMPO_APPLIED_TOLERANCE &&
    suggestedTempoApplied(result, currentScale)
  );
}

export function formatSuggestedOffset(ms: number): string {
  return `${ms > 0 ? '+' : ''}${ms} ms`;
}
