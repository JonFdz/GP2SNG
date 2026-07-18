import { CHINA_NOTES, CRASH_HIGH_NOTES, SPLASH_NOTES } from '../midi/index';
import type { BaseYargNote, CymbalColor, CymbalPriorities, YargNote } from '../types/index';

// The three adaptive accent-cymbal families, in the toolbar precedence used to
// break ties when two want the same free lane (docs/DESIGN.md → Drum output mapping).
const FAMILIES: readonly { key: keyof CymbalPriorities; notes: readonly number[] }[] = [
  { key: 'crashHigh', notes: CRASH_HIGH_NOTES },
  { key: 'splash', notes: SPLASH_NOTES },
  { key: 'china', notes: CHINA_NOTES },
];

function colorOf(note: BaseYargNote): CymbalColor | null {
  if (note === 'yellowCymbal') return 'yellow';
  if (note === 'blueCymbal') return 'blue';
  if (note === 'greenCymbal') return 'green';
  return null; // not a cymbal
}

function familyOf(midi: number): keyof CymbalPriorities | null {
  for (const f of FAMILIES) if (f.notes.includes(midi)) return f.key;
  return null;
}

// Reassign each accent-cymbal (High crash / Splash / China) to the first color in
// its priority list not already taken by another cymbal at the same tick, so
// overlapping cymbals spread across the three lanes instead of merging in decollide.
// A family's effective priority is [current-map-color, ...stored-order] so the map
// row and the stored list can never meaningfully desync. Fixed anchors and non-cymbal
// notes pass through unchanged. Pure — returns fresh notes.
export function resolveDynamicCymbalColors(
  rawNotes: readonly YargNote[],
  priorities: CymbalPriorities,
): YargNote[] {
  const result = rawNotes.map((n) => ({ ...n }));

  const byTick = new Map<number, number[]>();
  result.forEach((n, i) => {
    const g = byTick.get(n.tick);
    if (g) g.push(i);
    else byTick.set(n.tick, [i]);
  });

  for (const indices of byTick.values()) {
    const reserved = new Set<CymbalColor>();
    // Reserve lanes held by fixed cymbals (anchors + their accented forms).
    for (const i of indices) {
      const c = colorOf(result[i].note);
      if (c !== null && familyOf(result[i].midi) === null) reserved.add(c);
    }
    // Assign each adaptive family present, in precedence order, its first free color.
    for (const { key } of FAMILIES) {
      const familyIdx = indices.filter((i) => familyOf(result[i].midi) === key);
      if (familyIdx.length === 0) continue;
      const front = colorOf(result[familyIdx[0]].note);
      if (front === null) continue; // family note isn't in a cymbal row; leave as-is
      const order: CymbalColor[] = [front, ...priorities[key].filter((c) => c !== front)];
      const chosen = order.find((c) => !reserved.has(c)) ?? front;
      reserved.add(chosen);
      for (const i of familyIdx) result[i].note = `${chosen}Cymbal` as BaseYargNote;
    }
  }
  return result;
}
