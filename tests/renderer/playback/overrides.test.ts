import { describe, expect, it } from 'vitest';
import {
  applyDeletions,
  applyOverrides,
  displayedNotes,
} from '../../../src/renderer/src/playback/overrides';
import { detectChartErrors } from '../../../src/shared/convert/index';
import type { NoteOverride, YargNote } from '../../../src/shared/types/index';

const base: YargNote[] = [
  { tick: 0, note: 'red', dynamic: 'neutral', midi: 38 },
  { tick: 0, note: 'yellowCymbal', dynamic: 'ghost', midi: 42 },
  { tick: 480, note: 'blueTom', dynamic: 'neutral', midi: 47 },
];

describe('applyOverrides', () => {
  it('reassigns only the note matching (tick, midi)', () => {
    const ov: NoteOverride = { tick: 480, midi: 47, note: 'greenTom', dynamic: 'neutral' };
    const out = applyOverrides(base, [ov]);
    expect(out[2]).toMatchObject({ tick: 480, note: 'greenTom', midi: 47 });
    expect(out[0].note).toBe('red'); // untouched
    expect(out[1].note).toBe('yellowCymbal'); // untouched
  });

  it.each([
    ['ghost', 'neutral'],
    ['accent', 'neutral'],
    ['neutral', 'ghost'],
    ['accent', 'ghost'],
    ['ghost', 'accent'],
    ['neutral', 'accent'],
  ] as const)('forces an explicit %s -> %s dynamic change', (source, target) => {
    const notes: YargNote[] = [{ tick: 0, note: 'red', dynamic: source, midi: 38 }];
    const ov: NoteOverride = { tick: 0, midi: 38, note: 'red', dynamic: target };
    expect(applyOverrides(notes, [ov])[0].dynamic).toBe(target);
  });

  it('applies lane and dynamic reassignment together', () => {
    const ov: NoteOverride = { tick: 0, midi: 42, note: 'greenTom', dynamic: 'accent' };
    expect(applyOverrides(base, [ov])[1]).toMatchObject({ note: 'greenTom', dynamic: 'accent' });
  });

  it.each(['ghost', 'accent'] as const)('forces %s -> orange to neutral', (source) => {
    const notes: YargNote[] = [{ tick: 0, note: 'red', dynamic: source, midi: 38 }];
    const ov: NoteOverride = { tick: 0, midi: 38, note: 'orange', dynamic: 'neutral' };
    expect(applyOverrides(notes, [ov])[0]).toMatchObject({ note: 'orange', dynamic: 'neutral' });
  });

  it('defensively keeps orange neutral for a legacy accented override', () => {
    const ov: NoteOverride = { tick: 0, midi: 38, note: 'orange', accented: true };
    expect(applyOverrides(base, [ov])[0]).toMatchObject({ note: 'orange', dynamic: 'neutral' });
  });

  it('preserves the old accented:false behavior for legacy sessions', () => {
    const ov: NoteOverride = { tick: 0, midi: 42, note: 'blueCymbal', accented: false };
    expect(applyOverrides(base, [ov])[1]).toMatchObject({ note: 'blueCymbal', dynamic: 'ghost' });
  });

  it('preserves the old accented:true behavior for legacy sessions', () => {
    const ov: NoteOverride = { tick: 0, midi: 38, note: 'red', accented: true };
    expect(applyOverrides(base, [ov])[0].dynamic).toBe('accent');
  });

  it('is a no-op when no override matches', () => {
    const ov: NoteOverride = { tick: 999, midi: 99, note: 'red', dynamic: 'neutral' };
    expect(applyOverrides(base, [ov])).toEqual(base);
  });

  it('does not mutate the input notes', () => {
    const ov: NoteOverride = { tick: 0, midi: 38, note: 'greenTom', dynamic: 'accent' };
    applyOverrides(base, [ov]);
    expect(base[0]).toEqual({ tick: 0, note: 'red', dynamic: 'neutral', midi: 38 });
  });
});

describe('applyDeletions', () => {
  it('removes only notes matching a deletion (tick, midi)', () => {
    const out = applyDeletions(base, [{ tick: 0, midi: 42 }]);
    expect(out).toEqual([
      { tick: 0, note: 'red', dynamic: 'neutral', midi: 38 },
      { tick: 480, note: 'blueTom', dynamic: 'neutral', midi: 47 },
    ]);
  });

  it('removes multiple matching notes', () => {
    const out = applyDeletions(base, [
      { tick: 0, midi: 38 },
      { tick: 480, midi: 47 },
    ]);
    expect(out).toEqual([{ tick: 0, note: 'yellowCymbal', dynamic: 'ghost', midi: 42 }]);
  });

  it('is a no-op when no deletion matches', () => {
    expect(applyDeletions(base, [{ tick: 999, midi: 99 }])).toEqual(base);
  });

  it('returns all notes for an empty deletion list', () => {
    expect(applyDeletions(base, [])).toEqual(base);
  });

  it('does not mutate the input notes', () => {
    applyDeletions(base, [{ tick: 0, midi: 38 }]);
    expect(base).toHaveLength(3);
    expect(base[0]).toEqual({ tick: 0, note: 'red', dynamic: 'neutral', midi: 38 });
  });
});

describe('displayedNotes', () => {
  it('applies overrides, then removes deletions', () => {
    const ov: NoteOverride = { tick: 0, midi: 38, note: 'greenTom', dynamic: 'accent' };
    const out = displayedNotes(base, [ov], [{ tick: 480, midi: 47 }]);
    expect(out).toEqual([
      { tick: 0, note: 'greenTom', dynamic: 'accent', midi: 38 },
      { tick: 0, note: 'yellowCymbal', dynamic: 'ghost', midi: 42 },
    ]);
  });

  it('deletion wins when a note is both overridden and deleted', () => {
    const ov: NoteOverride = { tick: 0, midi: 38, note: 'greenTom', dynamic: 'neutral' };
    const out = displayedNotes(base, [ov], [{ tick: 0, midi: 38 }]);
    expect(out.find((n) => n.midi === 38)).toBeUndefined();
  });

  it('equals the plain notes when there are no overrides or deletions', () => {
    expect(displayedNotes(base, [], [])).toEqual(base);
  });

  it('deleting a colliding note clears its blocking error (regression: save/gate honor deletions)', () => {
    const erroring: YargNote[] = [
      { tick: 0, note: 'yellowCymbal', dynamic: 'neutral', midi: 42 },
      { tick: 0, note: 'yellowTom', dynamic: 'neutral', midi: 43 },
    ];
    expect(detectChartErrors(erroring)).not.toEqual([]);

    const afterDeletion = displayedNotes(erroring, [], [{ tick: 0, midi: 43 }]);
    expect(detectChartErrors(afterDeletion)).toEqual([]);
  });
});
