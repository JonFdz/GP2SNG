import { describe, expect, it } from 'vitest';
import { detectChartErrors } from '../../../src/shared/convert/index';
import type { BaseYargNote, YargNote } from '../../../src/shared/types/index';

const note = (tick: number, n: BaseYargNote, midi = 0): YargNote => ({
  tick,
  note: n,
  dynamic: 'neutral',
  midi,
});

describe('detectChartErrors', () => {
  it('flags 3 distinct hand lanes on one tick as threeHandNotes', () => {
    const errors = detectChartErrors([
      note(480, 'red'),
      note(480, 'yellowTom'),
      note(480, 'blueTom'),
    ]);
    expect(errors).toEqual([
      { tick: 480, kind: 'threeHandNotes', notes: ['red', 'yellowTom', 'blueTom'] },
    ]);
  });

  it('does not flag 2 hand lanes on one tick', () => {
    expect(detectChartErrors([note(480, 'red'), note(480, 'blueTom')])).toEqual([]);
  });

  it('flags a same-colour cymbal + tom on one tick as cymbalPadCollision', () => {
    const errors = detectChartErrors([note(0, 'yellowCymbal'), note(0, 'yellowTom')]);
    expect(errors).toEqual([
      { tick: 0, kind: 'cymbalPadCollision', notes: ['yellowCymbal', 'yellowTom'] },
    ]);
  });

  it('does not flag a different-colour cymbal + tom (playable two hands)', () => {
    expect(detectChartErrors([note(0, 'yellowCymbal'), note(0, 'blueTom')])).toEqual([]);
  });

  it('does not count kick (orange) toward the 3-hand threshold', () => {
    expect(detectChartErrors([note(0, 'orange'), note(0, 'red'), note(0, 'blueTom')])).toEqual([]);
  });

  it('emits both kinds for one tick that trips both, cymbalPadCollision first', () => {
    const errors = detectChartErrors([
      note(0, 'yellowCymbal'),
      note(0, 'yellowTom'),
      note(0, 'blueTom'),
    ]);
    expect(errors).toEqual([
      { tick: 0, kind: 'cymbalPadCollision', notes: ['yellowCymbal', 'yellowTom'] },
      { tick: 0, kind: 'threeHandNotes', notes: ['yellowCymbal', 'yellowTom', 'blueTom'] },
    ]);
  });

  it('keeps errors on independent ticks separate, sorted by tick', () => {
    const errors = detectChartErrors([
      note(960, 'yellowCymbal'),
      note(960, 'yellowTom'),
      note(0, 'blueCymbal'),
      note(0, 'blueTom'),
    ]);
    expect(errors).toEqual([
      { tick: 0, kind: 'cymbalPadCollision', notes: ['blueCymbal', 'blueTom'] },
      { tick: 960, kind: 'cymbalPadCollision', notes: ['yellowCymbal', 'yellowTom'] },
    ]);
  });
});
