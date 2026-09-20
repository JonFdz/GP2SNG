import { describe, expect, test } from 'vitest';
import { deriveTempoScale, scaleChartTempo } from '../../../src/renderer/src/state/tempoCorrection';
import { useWizardStore } from '../../../src/renderer/src/state/wizardStore';
import { tickToSeconds } from '../../../src/shared/convert/timing';
import type { ParsedGpScore, YargChart } from '../../../src/shared/types/index';

const chart: YargChart = {
  resolution: 480,
  tempoMap: [
    { tick: 0, usPerQuarter: 500000 },
    { tick: 3840, usPerQuarter: 400000 },
  ],
  timeSignatures: [{ tick: 0, numerator: 4, denominator: 4 }],
  notes: [{ tick: 2400, note: 'red', dynamic: 'neutral', midi: 38 }],
  sections: [{ tick: 3840, name: 'Verse' }],
  endTick: 10000,
  leadInTicks: 1920,
};

function score(bpm?: number): ParsedGpScore {
  return {
    metadata: { title: '', subtitle: '', artist: '', album: '', copyright: '', tabber: '' },
    masterBars: [
      {
        timeSignature: { numerator: 4, denominator: 4 },
        section: null,
        repeatStart: false,
        repeatEnd: false,
        repeatCount: 0,
        alternateEndings: [],
        hasDirections: false,
      },
    ],
    tracks: [],
    tempoAutomations: bpm === undefined ? [] : [{ bar: 0, position: 0, bpm, linear: false }],
  };
}

describe('tempo correction', () => {
  test('scales every event, preserves ticks, and targets an absolute scale', () => {
    const safeChart = { ...chart, leadInTicks: 3840 };
    const first = scaleChartTempo(safeChart, 1, 1.1);
    const second = scaleChartTempo(first, 1.1, 1.2);
    const direct = scaleChartTempo(safeChart, 1, 1.2);
    second.tempoMap.forEach((event, i) => {
      expect(event.usPerQuarter).toBeCloseTo(direct.tempoMap[i].usPerQuarter, -1);
    });
    expect(second.tempoMap.map((e) => e.tick)).toEqual([0, 3840]);
    expect(second.notes).toBe(safeChart.notes);
    expect(second.sections).toBe(safeChart.sections);
    expect(second.timeSignatures).toBe(safeChart.timeSignatures);
    expect(second.endTick).toBe(safeChart.endTick);
    expect(second.leadInTicks).toBe(safeChart.leadInTicks);
    expect(scaleChartTempo(second, 1.2, 1).tempoMap[0].usPerQuarter).toBeCloseTo(500000, -1);
  });

  test('invalid inputs do not mutate the chart and lead-in stays at least two seconds', () => {
    expect(() => scaleChartTempo(chart, 1, 0)).toThrow();
    expect(() => scaleChartTempo(chart, 1, Number.NaN)).toThrow();
    expect(() => scaleChartTempo(chart, 1, 1.01)).toThrow(/lead-in/);
    expect(tickToSeconds(chart.leadInTicks, chart.tempoMap, chart.resolution)).toBe(2);
    expect(chart.tempoMap[0].usPerQuarter).toBe(500000);
  });

  test('reopens adjusted and unmodified sessions without a blob field', () => {
    expect(deriveTempoScale(score(120), chart)).toBeCloseTo(1);
    expect(deriveTempoScale(score(), chart)).toBeCloseTo(1); // 120 BPM fallback
    const saved = scaleChartTempo({ ...chart, leadInTicks: 3840 }, 1, 1.007);
    expect(deriveTempoScale(score(120), saved)).toBeCloseTo(1.007, 5);
    const slow = {
      ...chart,
      tempoMap: [{ tick: 0, usPerQuarter: Math.round(60000000 / 71) }],
      leadInTicks: 3840,
    };
    const slowSaved = scaleChartTempo(slow, 1, 71.5 / 71);
    expect(deriveTempoScale(score(71), slowSaved)).toBeCloseTo(71.5 / 71, 5);
    expect(deriveTempoScale(score(0), saved)).toBe(1);
    expect(
      deriveTempoScale(score(120), { ...chart, tempoMap: [{ tick: 0, usPerQuarter: 0 }] }),
    ).toBe(1);
  });

  test('store preserves correction through reconversion and resets on a new GP', () => {
    const store = useWizardStore.getState();
    store.reset();
    const safeChart = { ...chart, leadInTicks: 3840 };
    store.setConversion(safeChart, []);
    store.setTempoScale(1.007);
    expect(useWizardStore.getState().tempoScale).toBeCloseTo(1.007);
    store.setConversion(safeChart, []);
    expect(useWizardStore.getState().chart?.tempoMap[0].usPerQuarter).toBe(
      Math.round(500000 / 1.007),
    );
    expect(() => store.setTempoScale(3)).toThrow();
    expect(useWizardStore.getState().tempoScale).toBeCloseTo(1.007);
    store.loadScore('next.gp', new Uint8Array(), score(120));
    expect(useWizardStore.getState().tempoScale).toBe(1);
  });
});
