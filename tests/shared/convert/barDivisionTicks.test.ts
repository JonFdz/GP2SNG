import { describe, expect, it } from 'vitest';
import { barDivisionTicks } from '../../../src/shared/convert/index';
import type { TimeSignatureEvent } from '../../../src/shared/types/index';

const sig = (numerator: number, denominator: number): TimeSignatureEvent[] => [
  { tick: 0, numerator, denominator },
];

describe('barDivisionTicks', () => {
  it('subdivides 4/4 into quarter notes (3 interior lines)', () => {
    // span 1920; 4 quarters; interior at 480, 960, 1440.
    expect(barDivisionTicks(sig(4, 4), 1920, 480)).toEqual([480, 960, 1440]);
  });

  it('subdivides 7/8 into eighth notes when quarters do not divide evenly', () => {
    // span 1680; 7 eighths of 240; 6 interior lines, none on the bar start/end.
    expect(barDivisionTicks(sig(7, 8), 1680, 480)).toEqual([240, 480, 720, 960, 1200, 1440]);
  });

  it('subdivides 15/16 into sixteenth notes (14 interior lines)', () => {
    const expected = Array.from({ length: 14 }, (_, i) => (i + 1) * 120);
    expect(barDivisionTicks(sig(15, 16), 1800, 480)).toEqual(expected);
  });

  it('prefers quarters over eighths for 6/8 (divides evenly into 3 quarters)', () => {
    // span 1440; 3 quarters of 480; interior at 480, 960 — not 6 eighths.
    expect(barDivisionTicks(sig(6, 8), 1440, 480)).toEqual([480, 960]);
  });

  it('restarts the subdivision step at a mid-chart signature change', () => {
    // two 4/4 bars (step 480), then one 7/8 bar (step 240) starting at tick 3840.
    const sigs: TimeSignatureEvent[] = [
      { tick: 0, numerator: 4, denominator: 4 },
      { tick: 3840, numerator: 7, denominator: 8 },
    ];
    expect(barDivisionTicks(sigs, 5520, 480)).toEqual([
      480, 960, 1440, 2400, 2880, 3360, 4080, 4320, 4560, 4800, 5040, 5280,
    ]);
    // 3840 (the 7/8 bar start) carries no subdivision line.
    expect(barDivisionTicks(sigs, 5520, 480)).not.toContain(3840);
  });

  it('emits only ticks strictly below endTick for a partial trailing bar', () => {
    // 1.5 bars of 4/4: full bar 1 plus half of bar 2 (ends at 2880).
    expect(barDivisionTicks(sig(4, 4), 2880, 480)).toEqual([480, 960, 1440, 2400]);
  });

  it('defaults to 4/4 when no signatures are given', () => {
    expect(barDivisionTicks([], 1920, 480)).toEqual([480, 960, 1440]);
  });

  it('returns no lines for an empty chart', () => {
    expect(barDivisionTicks(sig(4, 4), 0, 480)).toEqual([]);
  });
});
