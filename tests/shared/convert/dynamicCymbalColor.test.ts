import { describe, expect, it } from 'vitest';
import { resolveDynamicCymbalColors } from '../../../src/shared/convert/dynamicCymbalColor';
import { DEFAULT_CYMBAL_PRIORITIES, type YargNote } from '../../../src/shared/types/index';

const note = (tick: number, n: YargNote['note'], midi: number): YargNote => ({
  tick,
  note: n,
  dynamic: 'neutral',
  midi,
});

describe('resolveDynamicCymbalColors', () => {
  it('dodges a splash off a fixed ride sharing the tick', () => {
    // 51 = ride middle (fixed blue); 55 = splash (pref blue) → green.
    const out = resolveDynamicCymbalColors(
      [note(0, 'blueCymbal', 51), note(0, 'blueCymbal', 55)],
      DEFAULT_CYMBAL_PRIORITIES,
    );
    expect(out.find((n) => n.midi === 51)?.note).toBe('blueCymbal');
    expect(out.find((n) => n.midi === 55)?.note).toBe('greenCymbal');
  });

  it('spreads three same-preference cymbals onto three distinct lanes', () => {
    const out = resolveDynamicCymbalColors(
      [note(0, 'blueCymbal', 49), note(0, 'blueCymbal', 55), note(0, 'greenCymbal', 52)],
      DEFAULT_CYMBAL_PRIORITIES,
    );
    expect(new Set(out.map((n) => n.note)).size).toBe(3);
  });

  it('gives a family base + choke the same lane', () => {
    const out = resolveDynamicCymbalColors(
      [note(0, 'blueCymbal', 51), note(0, 'blueCymbal', 55), note(0, 'blueCymbal', 95)],
      DEFAULT_CYMBAL_PRIORITIES,
    );
    expect(out.find((n) => n.midi === 55)?.note).toBe('greenCymbal');
    expect(out.find((n) => n.midi === 95)?.note).toBe('greenCymbal');
  });

  it('leaves a non-overlapping accent cymbal at its preferred color', () => {
    const out = resolveDynamicCymbalColors([note(0, 'blueCymbal', 55)], DEFAULT_CYMBAL_PRIORITIES);
    expect(out[0].note).toBe('blueCymbal');
  });

  it('reconciles the front to the actual map color, not stored[0]', () => {
    // China note currently sits in blueCymbal; with a fixed blue anchor it falls to
    // green (next in the reconciled [blue, green, yellow] order), not to stored[0].
    const out = resolveDynamicCymbalColors(
      [note(0, 'blueCymbal', 51), note(0, 'blueCymbal', 52)],
      DEFAULT_CYMBAL_PRIORITIES,
    );
    expect(out.find((n) => n.midi === 52)?.note).toBe('greenCymbal');
  });

  it('leaves non-cymbal notes untouched', () => {
    const out = resolveDynamicCymbalColors(
      [note(0, 'red', 38), note(0, 'yellowTom', 48)],
      DEFAULT_CYMBAL_PRIORITIES,
    );
    expect(out.map((n) => n.note)).toEqual(['red', 'yellowTom']);
  });

  it('keeps a reconciled front color that diverges from stored[0] when free', () => {
    // China (52) currently sits in yellowCymbal; nothing else at the tick. The
    // reconciled front (yellow) is free, so it must stay yellow — a naive impl
    // using china's stored priority [green,...] would wrongly pick green.
    const out = resolveDynamicCymbalColors(
      [note(0, 'yellowCymbal', 52)],
      DEFAULT_CYMBAL_PRIORITIES,
    );
    expect(out[0].note).toBe('yellowCymbal');
  });

  it('keeps the front color when all three lanes are reserved (>3 cymbals)', () => {
    // Three fixed anchors reserve all lanes; splash (55, blueCymbal) cannot move.
    const out = resolveDynamicCymbalColors(
      [
        note(0, 'yellowCymbal', 42),
        note(0, 'blueCymbal', 51),
        note(0, 'greenCymbal', 30),
        note(0, 'blueCymbal', 55),
      ],
      DEFAULT_CYMBAL_PRIORITIES,
    );
    expect(out.find((n) => n.midi === 55)?.note).toBe('blueCymbal');
  });

  it('does not mutate the input notes', () => {
    const input = [note(0, 'blueCymbal', 51), note(0, 'blueCymbal', 55)];
    const snapshot = input.map((n) => ({ ...n }));
    resolveDynamicCymbalColors(input, DEFAULT_CYMBAL_PRIORITIES);
    expect(input).toEqual(snapshot);
  });
});
