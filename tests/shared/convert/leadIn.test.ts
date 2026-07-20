import { describe, expect, it } from 'vitest';
import { leadInBarsFor, openingBpm } from '../../../src/shared/convert/index';

const PPQ = 480;
const FOUR_FOUR = { numerator: 4, denominator: 4 };
const THREE_FOUR = { numerator: 3, denominator: 4 };
const SEVEN_EIGHT = { numerator: 7, denominator: 8 };

describe('leadInBarsFor', () => {
  it('gives 2 bars at or above 120 BPM', () => {
    expect(leadInBarsFor(FOUR_FOUR, 120, PPQ)).toBe(2); // 4.000 s
    expect(leadInBarsFor(FOUR_FOUR, 200, PPQ)).toBe(2); // 2.400 s
  });

  it('gives 1 bar below 120 BPM when that already clears 2 seconds', () => {
    expect(leadInBarsFor(FOUR_FOUR, 90, PPQ)).toBe(1); // 2.667 s
  });

  it('raises the recommended count until the 2-second floor holds', () => {
    // 3/4 at 119 BPM is one bar of 1.513 s — YARN's own recommendation breaks
    // YARN's own requirement, so the count goes up.
    expect(leadInBarsFor(THREE_FOUR, 119, PPQ)).toBe(2); // 3.025 s
  });

  it('leaves an odd meter alone when 2 bars already clear the floor', () => {
    expect(leadInBarsFor(SEVEN_EIGHT, 145, PPQ)).toBe(2); // 2.897 s
  });
});

describe('openingBpm', () => {
  it('takes the first automation in played order, not document order', () => {
    const automations = [
      { bar: 5, position: 0, bpm: 90, linear: false },
      { bar: 2, position: 0, bpm: 165, linear: false },
    ];
    expect(openingBpm(automations, [2, 5])).toBe(165);
  });

  it('takes the earliest position within that bar', () => {
    const automations = [
      { bar: 0, position: 0.5, bpm: 90, linear: false },
      { bar: 0, position: 0, bpm: 140, linear: false },
    ];
    expect(openingBpm(automations, [0])).toBe(140);
  });

  it('skips played bars with no automation', () => {
    const automations = [{ bar: 3, position: 0, bpm: 100, linear: false }];
    expect(openingBpm(automations, [0, 1, 3])).toBe(100);
  });

  it('falls back to 120 when the score has no automations', () => {
    expect(openingBpm([], [0, 1])).toBe(120);
  });
});
