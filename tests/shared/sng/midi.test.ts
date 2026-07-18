import { describe, expect, it } from 'vitest';
import { buildMidi, readMidi } from '../../../src/shared/sng/index';
import type { YargChart } from '../../../src/shared/types/index';

const chart: YargChart = {
  resolution: 480,
  tempoMap: [
    { tick: 0, usPerQuarter: 500000 },
    { tick: 1920, usPerQuarter: 250000 },
  ],
  timeSignatures: [
    { tick: 0, numerator: 4, denominator: 4 },
    { tick: 1920, numerator: 7, denominator: 8 },
  ],
  notes: [
    { tick: 0, note: 'orange', dynamic: 'neutral', midi: 36 }, // kick 96 vel 100
    { tick: 0, note: 'red', dynamic: 'accent', midi: 38 }, // 97 vel 127
    { tick: 480, note: 'yellowCymbal', dynamic: 'ghost', midi: 42 }, // 98 vel 1, no marker
    { tick: 960, note: 'blueTom', dynamic: 'neutral', midi: 47 }, // 99 vel 100 + marker 111
    { tick: 1440, note: 'greenTom', dynamic: 'neutral', midi: 43 }, // 100 vel 100 + marker 112
  ],
  sections: [
    { tick: 0, name: 'Intro' },
    { tick: 1920, name: 'Verse' },
  ],
  endTick: 3840,
  leadInTicks: 0,
};

describe('buildMidi / readMidi round-trip', () => {
  const decoded = readMidi(buildMidi(chart));

  it('is a 480-division, 3-track format-1 file', () => {
    expect(decoded.division).toBe(480);
    expect(decoded.tracks).toHaveLength(3);
  });

  it('preserves the tempo map', () => {
    expect(decoded.tempos).toEqual([
      { tick: 0, usPerQuarter: 500000 },
      { tick: 1920, usPerQuarter: 250000 },
    ]);
  });

  it('preserves the time signatures', () => {
    expect(decoded.timeSignatures).toEqual([
      { tick: 0, numerator: 4, denominator: 4 },
      { tick: 1920, numerator: 7, denominator: 8 },
    ]);
  });

  it('writes PART DRUMS with the dynamics-enable event', () => {
    const drums = decoded.tracks.find((t) => t.name === 'PART DRUMS');
    expect(drums).toBeTruthy();
    expect(drums?.texts.some((t) => t.text === '[ENABLE_CHART_DYNAMICS]')).toBe(true);
  });

  it('encodes gems, velocities and tom markers', () => {
    const drums = decoded.tracks.find((t) => t.name === 'PART DRUMS');
    const ons = drums?.notes ?? [];
    // gems
    expect(ons.some((n) => n.tick === 0 && n.note === 96 && n.velocity === 100)).toBe(true); // kick
    expect(ons.some((n) => n.tick === 0 && n.note === 97 && n.velocity === 127)).toBe(true); // red accent
    expect(ons.some((n) => n.tick === 480 && n.note === 98 && n.velocity === 1)).toBe(true); // yellow ghost
    expect(ons.some((n) => n.tick === 960 && n.note === 99)).toBe(true); // blue gem
    expect(ons.some((n) => n.tick === 1440 && n.note === 100)).toBe(true); // green gem
    // tom markers span the tom gems, not the cymbal
    expect(ons.some((n) => n.tick === 960 && n.note === 111)).toBe(true); // blueTom marker
    expect(ons.some((n) => n.tick === 1440 && n.note === 112)).toBe(true); // greenTom marker
    expect(ons.some((n) => n.note === 110)).toBe(false); // no yellow-tom in this chart
  });

  it('writes sections as [section Name] on the EVENTS track', () => {
    const events = decoded.tracks.find((t) => t.name === 'EVENTS');
    expect(events?.texts.map((t) => t.text)).toEqual(['[section Intro]', '[section Verse]']);
  });
});
