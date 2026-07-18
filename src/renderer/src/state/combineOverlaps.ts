import type { ConversionWarning } from '../../../shared/types/index';

export interface CombinedOverlap {
  midi: number[]; // ascending (duplicates on a beat are kept)
  bars: number[]; // ascending, de-duplicated
}

// Combine identical three-hand-note overlaps for the Mapping step: two warnings
// with the same set of MIDI notes (any order) collapse into one entry whose bars
// are merged. Notes are sorted ascending; bars are sorted and de-duplicated;
// groups keep first-appearance order (batch 4 §4).
export function combineOverlaps(warnings: ConversionWarning[]): CombinedOverlap[] {
  const groups = new Map<string, CombinedOverlap>();
  for (const w of warnings) {
    if (w.kind !== 'threeHandNotes') continue;
    const { bar, midi } = w.context as { bar: number; midi: number[] };
    const sorted = [...midi].sort((a, b) => a - b);
    const key = sorted.join(',');
    const existing = groups.get(key);
    if (existing === undefined) {
      groups.set(key, { midi: sorted, bars: [bar] });
    } else if (!existing.bars.includes(bar)) {
      existing.bars.push(bar);
    }
  }
  for (const g of groups.values()) g.bars.sort((a, b) => a - b);
  return [...groups.values()];
}
