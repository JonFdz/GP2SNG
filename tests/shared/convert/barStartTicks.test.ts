import { describe, expect, it } from 'vitest';
import { barStartTicks } from '../../../src/shared/convert/index';
import type { TimeSignatureEvent } from '../../../src/shared/types/index';

const fourFour: TimeSignatureEvent[] = [{ tick: 0, numerator: 4, denominator: 4 }];

describe('barStartTicks', () => {
  it('returns one start per bar for a constant 4/4 chart', () => {
    // two 4/4 bars at 480 PPQ = 1920 ticks each; endTick is the end of bar 2.
    expect(barStartTicks(fourFour, 3840, 480)).toEqual([0, 1920]);
  });

  it('switches bar length at a mid-chart time-signature change', () => {
    const sigs: TimeSignatureEvent[] = [
      { tick: 0, numerator: 4, denominator: 4 }, // one 1920-tick bar
      { tick: 1920, numerator: 3, denominator: 4 }, // two 1440-tick bars
    ];
    expect(barStartTicks(sigs, 4800, 480)).toEqual([0, 1920, 3360]);
  });

  it('defaults to 4/4 when no signatures are given', () => {
    expect(barStartTicks([], 3840, 480)).toEqual([0, 1920]);
  });

  it('returns no starts for an empty chart', () => {
    expect(barStartTicks(fourFour, 0, 480)).toEqual([]);
  });
});
