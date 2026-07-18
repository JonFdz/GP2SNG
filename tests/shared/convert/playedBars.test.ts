import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { barStartTicks, convertToYargChart, playedBars } from '../../../src/shared/convert/index';
import { parseGp } from '../../../src/shared/gp/index';
import { DEFAULT_MIDI_MAP } from '../../../src/shared/types/index';

const bytes = new Uint8Array(
  readFileSync(fileURLToPath(new URL('../../fixtures/example.gp', import.meta.url))),
);
const score = parseGp(bytes);
const { chart } = convertToYargChart(score, 0, DEFAULT_MIDI_MAP);

describe('playedBars — alignment with barStartTicks', () => {
  // The chart converts with the default 2-bar lead-in, so playedBars must be
  // passed the same lead-in count to stay parallel with barStartTicks.
  const LEAD_IN_BARS = 2;

  it("matches barStartTicks' played-bar starts for the real fixture", () => {
    // The example fixture carries 4/4, 3/4, and 7/8 signatures. playedBars walks the
    // played timeline (prefixed with the lead-in bars); barStartTicks reconstructs
    // bar starts from the chart's time-signature events (which also span the lead-in).
    // They must agree tick-for-tick so barNumbers stays index-aligned with the
    // preview's barLines.
    expect(playedBars(score.masterBars, chart.resolution, LEAD_IN_BARS).map((b) => b.tick)).toEqual(
      barStartTicks(chart.timeSignatures, chart.endTick, chart.resolution),
    );
  });

  it('labels the lead-in bars null and starts the song at GP bar 1', () => {
    const bars = playedBars(score.masterBars, chart.resolution, LEAD_IN_BARS);
    for (let i = 0; i < LEAD_IN_BARS; i++) expect(bars[i].gpBar).toBeNull();
    expect(bars[LEAD_IN_BARS].gpBar).toBe(1);
  });
});
