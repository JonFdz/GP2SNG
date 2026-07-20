import type { GpTempoAutomation } from '../types/index';
import { barTicks } from './timing';

// YARG's YARN submission guidelines list, among the rules that get a chart
// rejected: "The chart must have at least 2 seconds of leading silence" and "We
// recommend 2 measures for songs at or above 120 BPM, and 1 measure for songs
// below 120 BPM". The two clauses disagree in short meters — 3/4 at 119 BPM is one
// bar of 1.51 s — so the recommendation is a starting point and the requirement is
// the floor that actually has to hold.
export const MIN_LEAD_IN_SECONDS = 2;

export function leadInBarsFor(
  timeSignature: { numerator: number; denominator: number },
  bpm: number,
  ppq: number,
): number {
  const secondsPerBar = (barTicks(timeSignature, ppq) / ppq) * (60 / bpm);
  let bars = bpm >= 120 ? 2 : 1;
  while (bars * secondsPerBar < MIN_LEAD_IN_SECONDS) bars++;
  return bars;
}

// The tempo the lead-in bars actually run at. `convertToYargChart` unshifts a
// tick-0 tempo point carrying the first automation's BPM so the lead-in does not
// run at the 120 BPM fallback, which makes the lead-in's duration a function of
// whichever automation fires first in PLAYED order — not document order, since
// repeats can put a later document bar first. 120 matches the tempo-map fallback
// for a score with no automations at all.
export function openingBpm(automations: GpTempoAutomation[], played: number[]): number {
  for (const masterIndex of played) {
    const inBar = automations.filter((a) => a.bar === masterIndex);
    if (inBar.length > 0) {
      return inBar.reduce((earliest, a) => (a.position < earliest.position ? a : earliest)).bpm;
    }
  }
  return 120;
}
