import { CHART_RESOLUTION, type TempoEvent, type TimeSignatureEvent } from '../types/index';

export type Frac = [number, number];

function gcd(a: number, b: number): number {
  return b === 0 ? Math.abs(a) : gcd(b, a % b);
}

export function addFrac(a: Frac, b: Frac): Frac {
  const num = a[0] * b[1] + b[0] * a[1];
  const den = a[1] * b[1];
  const g = gcd(num, den) || 1;
  return [num / g, den / g];
}

// A musical position (whole-note fraction) to an absolute-within-bar tick.
export function fracToTick(frac: Frac, ppq: number): number {
  return Math.round((frac[0] * 4 * ppq) / frac[1]);
}

export function barTicks(ts: { numerator: number; denominator: number }, ppq: number): number {
  return Math.round((ts.numerator * 4 * ppq) / ts.denominator);
}

const DEFAULT_US_PER_QUARTER = 500000; // 120 BPM

export function bpmToUsPerQuarter(bpm: number): number {
  return Math.round(60000000 / bpm);
}

export interface TempoPoint {
  tick: number;
  bpm: number;
  linear: boolean; // true = ramp toward the next point
}

// Granularity of the stepped ramp approximation: a 16th note at CHART_RESOLUTION.
// Finer only tightens agreement with the GP audio's continuous ramp. Tunable.
export const RAMP_STEP_TICKS = CHART_RESOLUTION / 4;

// Resolve GP tempo points (played-timeline order, sorted by tick) into a stepped
// tempo map. Non-linear points are single steps; a linear point ramps toward the
// next point, approximated by steps every RAMP_STEP_TICKS whose BPM is sampled at
// each segment's midpoint (removing directional drift); a trailing linear point
// with no next point is a single step. Consecutive equal tempos are dropped.
//
// GP renders a linear ramp on its real-time playback clock, i.e. BPM varies
// linearly in *seconds*, not in ticks. As a function of musical position that is
// the quadratic mean sqrt(a²(1−f) + b²f), NOT the arithmetic a+(b−a)f: a tick-
// linear ramp over-slows a ritardando and accumulates a lasting lag (~1/4 bar on
// the "toe - Goodbye" chorus→outro 138→80 ramp) that de-syncs the chart from the
// GP audio (docs/DESIGN.md → Timing model → Tempo ramps).
export function buildTempoMap(points: TempoPoint[]): TempoEvent[] {
  const events: TempoEvent[] = [];
  const push = (tick: number, usPerQuarter: number) => {
    const last = events[events.length - 1];
    if (last === undefined || last.usPerQuarter !== usPerQuarter) {
      events.push({ tick, usPerQuarter });
    }
  };
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const next = points[i + 1];
    if (!p.linear || next === undefined || next.tick <= p.tick) {
      push(p.tick, bpmToUsPerQuarter(p.bpm));
      continue;
    }
    const span = next.tick - p.tick;
    for (let t = p.tick; t < next.tick; t += RAMP_STEP_TICKS) {
      const mid = Math.min(t + RAMP_STEP_TICKS / 2, next.tick);
      const frac = (mid - p.tick) / span;
      const bpm = Math.sqrt(p.bpm * p.bpm * (1 - frac) + next.bpm * next.bpm * frac);
      push(t, bpmToUsPerQuarter(bpm));
    }
  }
  return events;
}

export function tickToSeconds(tick: number, tempoMap: TempoEvent[], ppq: number): number {
  let seconds = 0;
  let prevTick = 0;
  let curUs = tempoMap[0]?.usPerQuarter ?? DEFAULT_US_PER_QUARTER;
  for (const ev of tempoMap) {
    if (ev.tick <= 0) {
      curUs = ev.usPerQuarter;
      continue;
    }
    if (ev.tick >= tick) break;
    seconds += ((ev.tick - prevTick) / ppq) * (curUs / 1e6);
    prevTick = ev.tick;
    curUs = ev.usPerQuarter;
  }
  seconds += ((tick - prevTick) / ppq) * (curUs / 1e6);
  return seconds;
}

export function secondsToTick(seconds: number, tempoMap: TempoEvent[], ppq: number): number {
  let acc = 0;
  let prevTick = 0;
  let curUs = tempoMap[0]?.usPerQuarter ?? DEFAULT_US_PER_QUARTER;
  for (const ev of tempoMap) {
    if (ev.tick <= 0) {
      curUs = ev.usPerQuarter;
      continue;
    }
    const segSeconds = ((ev.tick - prevTick) / ppq) * (curUs / 1e6);
    if (acc + segSeconds >= seconds) break;
    acc += segSeconds;
    prevTick = ev.tick;
    curUs = ev.usPerQuarter;
  }
  const remaining = seconds - acc;
  return Math.round(prevTick + (remaining / (curUs / 1e6)) * ppq);
}

// The absolute tick of every measure start from 0 up to (not including) endTick,
// walking each time-signature segment at its own bar length. Assumes the first
// signature sits at tick 0 (YargChart guarantees this); falls back to 4/4 when
// none are given. Used by the preview to draw gray measure lines under the gems.
export function barStartTicks(
  timeSignatures: TimeSignatureEvent[],
  endTick: number,
  ppq: number,
): number[] {
  if (endTick <= 0) return [];
  const sigs =
    timeSignatures.length > 0 ? timeSignatures : [{ tick: 0, numerator: 4, denominator: 4 }];
  const starts: number[] = [];
  for (let i = 0; i < sigs.length; i++) {
    const segStart = sigs[i].tick;
    const segEnd = i + 1 < sigs.length ? sigs[i + 1].tick : endTick;
    const span = barTicks(sigs[i], ppq);
    for (let t = segStart; t < segEnd; t += span) {
      starts.push(t);
    }
  }
  return starts;
}

export interface BeatEvent {
  tick: number;
  accent: boolean; // true on each bar's first beat
}

// Beat positions across the chart, mirroring barStartTicks. Within each
// time-signature segment beats are spaced one denominator-note apart
// (4*ppq/denominator ticks), `numerator` beats per bar; the first beat of every
// bar is accented. Drives the preview metronome (docs/DESIGN.md → Chart preview →
// Playback: metronome).
export function beatEvents(
  timeSignatures: TimeSignatureEvent[],
  endTick: number,
  ppq: number,
): BeatEvent[] {
  if (endTick <= 0) return [];
  const sigs =
    timeSignatures.length > 0 ? timeSignatures : [{ tick: 0, numerator: 4, denominator: 4 }];
  const beats: BeatEvent[] = [];
  for (let i = 0; i < sigs.length; i++) {
    const segStart = sigs[i].tick;
    const segEnd = i + 1 < sigs.length ? sigs[i + 1].tick : endTick;
    const beatSpan = Math.round((4 * ppq) / sigs[i].denominator);
    const perBar = sigs[i].numerator;
    let indexInBar = 0;
    for (let t = segStart; t < segEnd; t += beatSpan) {
      beats.push({ tick: t, accent: indexInBar === 0 });
      indexInBar = (indexInBar + 1) % perBar;
    }
  }
  return beats;
}

// The interior subdivision ticks of every bar from 0 up to (not including) endTick,
// a finer grid than the measure lines from barStartTicks. Within each time-signature
// segment the bar is split into equal segments of the largest note value that divides
// it evenly, preferring quarter notes: N*4/D quarters per bar when that is whole, else
// the value is halved (eighth, sixteenth, ...) until it is. Bar starts are excluded
// (they carry a measure line); a bar of `count` segments yields its `count - 1`
// interior boundaries. Drives the preview's subdivision grid.
export function barDivisionTicks(
  timeSignatures: TimeSignatureEvent[],
  endTick: number,
  ppq: number,
): number[] {
  if (endTick <= 0) return [];
  const sigs =
    timeSignatures.length > 0 ? timeSignatures : [{ tick: 0, numerator: 4, denominator: 4 }];
  const divisions: number[] = [];
  for (let i = 0; i < sigs.length; i++) {
    const segStart = sigs[i].tick;
    const segEnd = i + 1 < sigs.length ? sigs[i + 1].tick : endTick;
    const span = barTicks(sigs[i], ppq);
    if (span <= 0) continue;
    // Largest note value (quarter first) whose count divides the bar into equal parts.
    let count = (sigs[i].numerator * 4) / sigs[i].denominator;
    while (!Number.isInteger(count)) count *= 2;
    const step = span / count;
    for (let bar = segStart; bar < segEnd; bar += span) {
      for (let j = 1; j < count; j++) {
        const t = bar + j * step;
        if (t < segEnd) divisions.push(t);
      }
    }
  }
  return divisions;
}
