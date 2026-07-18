import { BASE_YARG_NOTES, type BaseYargNote, type YargNote } from '../types/index';

export type ChartErrorKind = 'threeHandNotes' | 'cymbalPadCollision';

export interface ChartError {
  tick: number;
  kind: ChartErrorKind;
  notes: BaseYargNote[];
}

// Coloured cymbal/tom pairs share one physical pad; both on a tick is unplayable.
const CYMBAL_TOM_PAIRS: readonly [BaseYargNote, BaseYargNote][] = [
  ['yellowCymbal', 'yellowTom'],
  ['blueCymbal', 'blueTom'],
  ['greenCymbal', 'greenTom'],
];

// Blocking, unplayable-chart conditions derived purely from the displayed notes
// (docs spec -> Preview errors vs. warnings). Recomputed live so a reassign clears
// the corresponding red dot. One entry per (tick, kind).
export function detectChartErrors(notes: YargNote[]): ChartError[] {
  const lanesByTick = new Map<number, Set<BaseYargNote>>();
  for (const n of notes) {
    let lanes = lanesByTick.get(n.tick);
    if (lanes === undefined) {
      lanes = new Set();
      lanesByTick.set(n.tick, lanes);
    }
    lanes.add(n.note);
  }

  const errors: ChartError[] = [];
  for (const [tick, lanes] of lanesByTick) {
    const hands = BASE_YARG_NOTES.filter((l) => l !== 'orange' && lanes.has(l));
    if (hands.length >= 3) errors.push({ tick, kind: 'threeHandNotes', notes: hands });
    for (const [cymbal, tom] of CYMBAL_TOM_PAIRS) {
      if (lanes.has(cymbal) && lanes.has(tom)) {
        errors.push({ tick, kind: 'cymbalPadCollision', notes: [cymbal, tom] });
      }
    }
  }
  return errors.sort((a, b) => a.tick - b.tick || a.kind.localeCompare(b.kind));
}
