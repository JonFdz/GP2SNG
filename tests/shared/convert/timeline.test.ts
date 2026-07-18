import { describe, expect, it } from 'vitest';
import { expandTimeline, playedBars } from '../../../src/shared/convert/timeline';
import type { GpMasterBar } from '../../../src/shared/types/index';

function bar(overrides: Partial<GpMasterBar> = {}): GpMasterBar {
  return {
    timeSignature: { numerator: 4, denominator: 4 },
    section: null,
    repeatStart: false,
    repeatEnd: false,
    repeatCount: 0,
    alternateEndings: [],
    hasDirections: false,
    ...overrides,
  };
}

describe('expandTimeline', () => {
  it('leaves a plain sequence untouched', () => {
    expect(expandTimeline([bar(), bar(), bar()])).toEqual([0, 1, 2]);
  });

  it('expands a 2-bar repeat played twice', () => {
    const bars = [bar({ repeatStart: true }), bar({ repeatEnd: true, repeatCount: 2 }), bar()];
    expect(expandTimeline(bars)).toEqual([0, 1, 0, 1, 2]);
  });

  it('applies alternate endings across repeat passes', () => {
    // A B [1st ending: C] [2nd ending: D], A..B repeated twice.
    const bars = [
      bar({ repeatStart: true }), // 0 A
      bar(), // 1 B
      bar({ repeatEnd: true, repeatCount: 2, alternateEndings: [1] }), // 2 C (pass 1 only)
      bar({ alternateEndings: [2] }), // 3 D (pass 2 only)
      bar(), // 4 tail
    ];
    expect(expandTimeline(bars)).toEqual([0, 1, 2, 0, 1, 3, 4]);
  });
});

describe('playedBars', () => {
  it('pairs each played bar with its start tick and 1-based GP bar (plain sequence)', () => {
    expect(playedBars([bar(), bar(), bar()], 480)).toEqual([
      { tick: 0, gpBar: 1 },
      { tick: 1920, gpBar: 2 },
      { tick: 3840, gpBar: 3 },
    ]);
  });

  it('replays a document bar with the same GP number on each pass', () => {
    const bars = [bar({ repeatStart: true }), bar({ repeatEnd: true, repeatCount: 2 }), bar()];
    expect(playedBars(bars, 480)).toEqual([
      { tick: 0, gpBar: 1 },
      { tick: 1920, gpBar: 2 },
      { tick: 3840, gpBar: 1 }, // 2nd pass of document bar 1
      { tick: 5760, gpBar: 2 },
      { tick: 7680, gpBar: 3 },
    ]);
  });

  it("advances ticks by each bar's own time signature", () => {
    const bars = [bar(), bar({ timeSignature: { numerator: 3, denominator: 4 } }), bar()];
    // 4/4 = 1920 ticks, 3/4 = 1440 ticks at 480 PPQ.
    expect(playedBars(bars, 480)).toEqual([
      { tick: 0, gpBar: 1 },
      { tick: 1920, gpBar: 2 },
      { tick: 3360, gpBar: 3 },
    ]);
  });
});
