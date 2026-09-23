import { describe, expect, it } from 'vitest';
import { buildActionLog } from '../../../src/renderer/src/state/actionLog';

// 4 played bars, 1920 ticks each (played-bar start ticks, ascending).
const barStarts = [0, 1920, 3840, 5760];

describe('buildActionLog', () => {
  it('emits a reassign row with the played bar and target', () => {
    const rows = buildActionLog({
      overrides: [{ tick: 2000, midi: 38, note: 'blueCymbal', dynamic: 'ghost', seq: 1 }],
      deletions: [],
      previewRemaps: [],
      barStarts,
    });
    expect(rows).toEqual([
      {
        kind: 'reassign',
        seq: 1,
        tick: 2000,
        midi: 38,
        bar: 2,
        note: 'blueCymbal',
        dynamic: 'ghost',
      },
    ]);
  });

  it('emits a delete row', () => {
    const rows = buildActionLog({
      overrides: [],
      deletions: [{ tick: 4000, midi: 46, seq: 3 }],
      previewRemaps: [],
      barStarts,
    });
    expect(rows).toEqual([{ kind: 'delete', seq: 3, tick: 4000, midi: 46, bar: 3 }]);
  });

  it('emits global rows for restored legacy previewRemaps', () => {
    const rows = buildActionLog({
      overrides: [],
      deletions: [],
      previewRemaps: [
        { midi: 49, from: 'blueCymbal', to: 'greenCymbal', seq: 5 },
        { midi: 52, from: 'greenCymbal', to: null, seq: 6 },
      ],
      barStarts,
    });
    expect(rows).toEqual([
      { kind: 'globalUnassign', seq: 6, midi: 52 },
      { kind: 'globalReassign', seq: 5, midi: 49, note: 'greenCymbal', accented: false },
    ]);
  });

  it('a deleted note supersedes its override (single delete row)', () => {
    const rows = buildActionLog({
      overrides: [{ tick: 0, midi: 38, note: 'red', dynamic: 'neutral', seq: 1 }],
      deletions: [{ tick: 0, midi: 38, seq: 2 }],
      previewRemaps: [],
      barStarts,
    });
    expect(rows).toEqual([{ kind: 'delete', seq: 2, tick: 0, midi: 38, bar: 1 }]);
  });

  it('orders per-note rows by descending tick (bar not needed to sort)', () => {
    const rows = buildActionLog({
      overrides: [],
      deletions: [
        { tick: 300, midi: 38, seq: 1 },
        { tick: 100, midi: 39, seq: 2 },
        { tick: 400, midi: 40, seq: 3 },
      ],
      previewRemaps: [],
      barStarts,
    });
    expect(rows.map((r) => (r as { tick: number }).tick)).toEqual([400, 300, 100]);
  });

  it('floats restored legacy global rows above per-note rows, newest first', () => {
    const rows = buildActionLog({
      overrides: [{ tick: 5000, midi: 38, note: 'red', dynamic: 'neutral', seq: 1 }],
      deletions: [{ tick: 1000, midi: 40, seq: 2 }],
      previewRemaps: [
        { midi: 49, from: 'blueCymbal', to: 'greenCymbal', seq: 3 },
        { midi: 52, from: 'greenCymbal', to: null, seq: 5 },
      ],
      barStarts,
    });
    expect(rows.map((r) => r.kind)).toEqual([
      'globalUnassign', // seq 5 — newest global, top
      'globalReassign', // seq 3
      'reassign', // tick 5000
      'delete', // tick 1000
    ]);
  });

  it('maps a tick to its played bar (repeat: played bars from playedBars order)', () => {
    const rows = buildActionLog({
      overrides: [],
      deletions: [{ tick: 2500, midi: 38, seq: 1 }],
      previewRemaps: [],
      barStarts: [0, 1920, 3840],
    });
    expect(rows[0]).toMatchObject({ bar: 2 });
  });

  it('returns no rows for empty input', () => {
    expect(buildActionLog({ overrides: [], deletions: [], previewRemaps: [], barStarts })).toEqual(
      [],
    );
  });
});
