import { MIN_LEAD_IN_SECONDS, openingBpm } from '../../../shared/convert/leadIn';
import { expandTimeline } from '../../../shared/convert/timeline';
import { tickToSeconds } from '../../../shared/convert/timing';
import type { ParsedGpScore, YargChart } from '../../../shared/types/index';

export const MIN_TEMPO_SCALE = 0.5;
export const MAX_TEMPO_SCALE = 2;

export function originalOpeningBpm(score: ParsedGpScore): number {
  return openingBpm(score.tempoAutomations, expandTimeline(score.masterBars));
}

export function openingChartBpm(chart: YargChart): number {
  const us = chart.tempoMap[0]?.usPerQuarter ?? 500000;
  return 60000000 / us;
}

// Editing state is reconstructed from the two sources already present in every
// session. A missing GP automation uses the converter's 120 BPM fallback.
export function deriveTempoScale(score: ParsedGpScore, chart: YargChart): number {
  const scale = openingChartBpm(chart) / originalOpeningBpm(score);
  return Number.isFinite(scale) && scale >= MIN_TEMPO_SCALE && scale <= MAX_TEMPO_SCALE ? scale : 1;
}

export function scaleChartTempo(
  chart: YargChart,
  fromScale: number,
  targetScale: number,
): YargChart {
  if (
    !Number.isFinite(fromScale) ||
    fromScale <= 0 ||
    !Number.isFinite(targetScale) ||
    targetScale < MIN_TEMPO_SCALE ||
    targetScale > MAX_TEMPO_SCALE
  ) {
    throw new Error('Tempo adjustment must be between 50% and 200% of the GP tempo.');
  }
  if (fromScale === targetScale) return chart;
  const tempoMap = chart.tempoMap.map((event) => ({
    tick: event.tick,
    // BPM is inverse to microseconds per quarter. Convert through the original
    // GP rate so repeated edits target an absolute scale, not a chain of deltas.
    usPerQuarter: Math.round((event.usPerQuarter * fromScale) / targetScale),
  }));
  if (
    tempoMap.some((event) => !Number.isSafeInteger(event.usPerQuarter) || event.usPerQuarter <= 0)
  ) {
    throw new Error('The adjusted tempo is invalid.');
  }
  if (
    chart.leadInTicks > 0 &&
    tickToSeconds(chart.leadInTicks, tempoMap, chart.resolution) + 1e-6 < MIN_LEAD_IN_SECONDS
  ) {
    throw new Error('This tempo would shorten the lead-in below the required 2 seconds.');
  }
  return { ...chart, tempoMap };
}
