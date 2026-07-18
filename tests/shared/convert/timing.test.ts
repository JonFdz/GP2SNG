import { describe, expect, it } from 'vitest';
import {
  barTicks,
  buildTempoMap,
  secondsToTick,
  tickToSeconds,
} from '../../../src/shared/convert/timing';
import type { TempoEvent } from '../../../src/shared/types/index';

describe('barTicks', () => {
  it('computes ticks per bar for common signatures at 480 PPQ', () => {
    expect(barTicks({ numerator: 4, denominator: 4 }, 480)).toBe(1920);
    expect(barTicks({ numerator: 3, denominator: 4 }, 480)).toBe(1440);
    expect(barTicks({ numerator: 7, denominator: 8 }, 480)).toBe(1680);
  });
});

describe('tickToSeconds', () => {
  const map: TempoEvent[] = [
    { tick: 0, usPerQuarter: 500000 }, // 120 BPM
    { tick: 1920, usPerQuarter: 250000 }, // 240 BPM from bar 2
  ];

  it('integrates a stepwise tempo map', () => {
    expect(tickToSeconds(0, map, 480)).toBeCloseTo(0, 6);
    expect(tickToSeconds(480, map, 480)).toBeCloseTo(0.5, 6); // one quarter at 120bpm
    expect(tickToSeconds(1920, map, 480)).toBeCloseTo(2.0, 6); // one bar at 120bpm
    expect(tickToSeconds(1920 + 480, map, 480)).toBeCloseTo(2.25, 6); // + one quarter at 240
  });

  it('round-trips through secondsToTick', () => {
    expect(secondsToTick(tickToSeconds(3000, map, 480), map, 480)).toBe(3000);
  });

  it('falls back to 120 BPM with an empty map', () => {
    expect(tickToSeconds(480, [], 480)).toBeCloseTo(0.5, 6);
  });
});

describe('buildTempoMap', () => {
  const us = (bpm: number) => Math.round(60_000_000 / bpm);

  it('emits one step per non-linear point, deduping equal tempos', () => {
    expect(
      buildTempoMap([
        { tick: 0, bpm: 120, linear: false },
        { tick: 1920, bpm: 120, linear: false }, // unchanged → dropped
        { tick: 3840, bpm: 240, linear: false },
      ]),
    ).toEqual([
      { tick: 0, usPerQuarter: us(120) },
      { tick: 3840, usPerQuarter: us(240) },
    ]);
  });

  it('interpolates a linear ramp into midpoint-sampled steps', () => {
    const map = buildTempoMap([
      { tick: 0, bpm: 120, linear: true },
      { tick: 480, bpm: 240, linear: false },
    ]);
    // Steps every 120 ticks across [0,480), then the exact target at 480.
    expect(map.map((e) => e.tick)).toEqual([0, 120, 240, 360, 480]);
    // GP ramps are real-time-linear, so BPM at musical fraction f is the quadratic
    // mean sqrt(a²(1−f) + b²f). First step samples the midpoint (tick 60, f=0.125):
    // sqrt(120²·0.875 + 240²·0.125) = sqrt(19800) ≈ 140.71 BPM.
    expect(map[0]).toEqual({ tick: 0, usPerQuarter: us(Math.sqrt(19800)) });
    expect(map[map.length - 1]).toEqual({ tick: 480, usPerQuarter: us(240) });
    for (let i = 1; i < map.length; i++) {
      expect(map[i].usPerQuarter).toBeLessThan(map[i - 1].usPerQuarter); // tempo rises
    }
  });

  // Regression: GP interpolates linear tempo ramps on its real-time clock (BPM
  // linear in seconds), so the wall-clock duration of a ramp must equal the
  // average-BPM formula T = 2·quarters / (a + b) — NOT the tick-linear integral,
  // which runs longer for a ritardando. A tick-linear ramp added ~0.47 s of lag
  // across the "toe - Goodbye" chorus→outro 138→80 ramp, de-syncing the chart
  // from the GP audio by about a quarter bar.
  it('gives a linear ramp its real-time (average-BPM) duration', () => {
    const a = 138;
    const b = 80;
    const spanTicks = 16792; // matches the toe - Goodbye chorus→outro ramp span
    const map = buildTempoMap([
      { tick: 0, bpm: a, linear: true },
      { tick: spanTicks, bpm: b, linear: false },
    ]);
    const quarters = spanTicks / 480;
    const expectedSeconds = (quarters / ((a + b) / 2)) * 60; // real-time-linear
    // Fine steps (a 16th note) keep the stepped approximation within a few ms.
    expect(tickToSeconds(spanTicks, map, 480)).toBeCloseTo(expectedSeconds, 2);
  });

  it('treats a trailing linear point (no next) as a single step', () => {
    expect(buildTempoMap([{ tick: 0, bpm: 150, linear: true }])).toEqual([
      { tick: 0, usPerQuarter: us(150) },
    ]);
  });
});
