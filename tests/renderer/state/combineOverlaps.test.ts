import { describe, expect, it } from 'vitest';
import { combineOverlaps } from '../../../src/renderer/src/state/combineOverlaps';
import type { ConversionWarning } from '../../../src/shared/types/index';

function overlap(bar: number, midi: number[]): ConversionWarning {
  return {
    kind: 'threeHandNotes',
    message: `MIDI notes ${midi.join(', ')} overlap on bar ${bar}`,
    context: { bar, midi },
  };
}

describe('combineOverlaps', () => {
  it('combines same-note overlaps regardless of order, sorting notes ascending', () => {
    const combined = combineOverlaps([overlap(100, [42, 57, 38]), overlap(200, [57, 42, 38])]);
    expect(combined).toEqual([{ midi: [38, 42, 57], bars: [100, 200] }]);
  });

  it('sorts and de-duplicates bars', () => {
    const combined = combineOverlaps([
      overlap(200, [38, 42, 57]),
      overlap(100, [38, 42, 57]),
      overlap(100, [57, 42, 38]),
    ]);
    expect(combined).toEqual([{ midi: [38, 42, 57], bars: [100, 200] }]);
  });

  it('keeps distinct note sets separate in first-appearance order', () => {
    const combined = combineOverlaps([overlap(5, [40, 50, 60]), overlap(6, [38, 42, 57])]);
    expect(combined).toEqual([
      { midi: [40, 50, 60], bars: [5] },
      { midi: [38, 42, 57], bars: [6] },
    ]);
  });

  it('ignores non-three-hand-note warnings', () => {
    const other: ConversionWarning = { kind: 'directionSignsUnsupported', message: 'x' };
    expect(combineOverlaps([other, overlap(1, [38, 42, 57])])).toEqual([
      { midi: [38, 42, 57], bars: [1] },
    ]);
  });
});
