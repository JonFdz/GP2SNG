import type { GpMasterBar } from '../types/index';
import { barTicks } from './timing';

// Expand the GP timeline into played order (a list of master-bar indices),
// handling repeats and alternate endings. Direction signs are NOT simulated
// (the caller warns); a naive linear pass with repeats/alt-endings is used.
export function expandTimeline(masterBars: GpMasterBar[]): number[] {
  const played: number[] = [];
  let i = 0;
  let openIndex = 0;
  let pass = 1;
  let justJumped = false;

  while (i < masterBars.length) {
    const bar = masterBars[i];
    if (bar.repeatStart && !justJumped) {
      openIndex = i;
      pass = 1;
    }
    justJumped = false;

    // Alternate endings: only play a bracketed bar on its listed passes.
    if (bar.alternateEndings.length > 0 && !bar.alternateEndings.includes(pass)) {
      i++;
      continue;
    }

    played.push(i);

    if (bar.repeatEnd && pass < bar.repeatCount) {
      pass++;
      i = openIndex;
      justJumped = true;
      continue;
    }
    i++;
  }
  return played;
}

// Each played bar paired with its start tick and 1-based Guitar Pro document bar
// number (masterIndex + 1). Walks the same expanded timeline and per-bar tick
// spans the converter uses, so the tick sequence matches the chart's bar
// boundaries (and barStartTicks). Drives the preview's "BAR N (GP BAR M)" label.
//
// `leadInBars` prepends that many empty lead-in bars, mirroring the converter,
// which offsets the chart by leadInBars * barTicks(firstPlayedBar.timeSignature)
// and emits that opening signature at tick 0 (docs/DESIGN.md → Timing model →
// Lead-in). The lead-in entries span the first played bar's length and carry a
// null gpBar sentinel (they belong to no GP bar); the played bars follow, their
// ticks shifted by the same offset — so the returned tick sequence still equals
// barStartTicks exactly, keeping the preview's bar labels index-aligned with its
// measure lines.
export function playedBars(
  masterBars: GpMasterBar[],
  ppq: number,
  leadInBars = 0,
): { tick: number; gpBar: number | null }[] {
  const bars: { tick: number; gpBar: number | null }[] = [];
  const played = expandTimeline(masterBars);
  let tick = 0;
  if (leadInBars > 0 && played.length > 0) {
    const leadBarTicks = barTicks(masterBars[played[0]].timeSignature, ppq);
    for (let i = 0; i < leadInBars; i++) {
      bars.push({ tick, gpBar: null });
      tick += leadBarTicks;
    }
  }
  for (const masterIndex of played) {
    bars.push({ tick, gpBar: masterIndex + 1 });
    tick += barTicks(masterBars[masterIndex].timeSignature, ppq);
  }
  return bars;
}
