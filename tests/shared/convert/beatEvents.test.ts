import { describe, expect, it } from 'vitest';
import { beatEvents } from '../../../src/shared/convert/index';
import type { TimeSignatureEvent } from '../../../src/shared/types/index';

const fourFour: TimeSignatureEvent[] = [{ tick: 0, numerator: 4, denominator: 4 }];

describe('beatEvents', () => {
  it('emits one beat per quarter in 4/4 with the downbeat accented', () => {
    // two 4/4 bars at 480 PPQ: beats every 480 ticks, accent every 4th (bar start).
    expect(beatEvents(fourFour, 3840, 480)).toEqual([
      { tick: 0, accent: true },
      { tick: 480, accent: false },
      { tick: 960, accent: false },
      { tick: 1440, accent: false },
      { tick: 1920, accent: true },
      { tick: 2400, accent: false },
      { tick: 2880, accent: false },
      { tick: 3360, accent: false },
    ]);
  });

  it('emits six eighth-note beats per 6/8 bar, only the first accented', () => {
    const sixEight: TimeSignatureEvent[] = [{ tick: 0, numerator: 6, denominator: 8 }];
    // one 6/8 bar = 6 * (4*480/8=240) = 1440 ticks.
    expect(beatEvents(sixEight, 1440, 480)).toEqual([
      { tick: 0, accent: true },
      { tick: 240, accent: false },
      { tick: 480, accent: false },
      { tick: 720, accent: false },
      { tick: 960, accent: false },
      { tick: 1200, accent: false },
    ]);
  });

  it('restarts the accent cycle at a mid-chart time-signature change', () => {
    const sigs: TimeSignatureEvent[] = [
      { tick: 0, numerator: 4, denominator: 4 }, // one 1920-tick bar
      { tick: 1920, numerator: 3, denominator: 4 }, // two 1440-tick bars
    ];
    const beats = beatEvents(sigs, 4800, 480);
    expect(beats.filter((b) => b.accent).map((b) => b.tick)).toEqual([0, 1920, 3360]);
    expect(beats).toHaveLength(10); // 4 + 3 + 3
  });

  it('defaults to 4/4 when no signatures are given', () => {
    expect(beatEvents([], 1920, 480)).toEqual([
      { tick: 0, accent: true },
      { tick: 480, accent: false },
      { tick: 960, accent: false },
      { tick: 1440, accent: false },
    ]);
  });

  it('returns no beats for an empty chart', () => {
    expect(beatEvents(fourFour, 0, 480)).toEqual([]);
  });
});
