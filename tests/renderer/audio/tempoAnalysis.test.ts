import { describe, expect, test } from 'vitest';
import { analyzeTempo, type PcmAudio } from '../../../src/renderer/src/audio/tempoAnalysis';
import { scaleChartTempo } from '../../../src/renderer/src/state/tempoCorrection';
import { tickToSeconds } from '../../../src/shared/convert/timing';
import type { YargChart } from '../../../src/shared/types/index';

const RATE = 1000;

function chart(bpm = 120, structural = false): YargChart {
  const leadInTicks = 3840;
  const notes: YargChart['notes'] = [];
  // Non-periodic attacks make the chart prior identifiable even with a generous
  // offset search. The same tick pattern drives each synthetic recording.
  for (let beat = 0; beat < 360; beat++) {
    if (beat % 7 === 4 || beat % 11 === 9) continue;
    notes.push({
      tick: leadInTicks + beat * 480 + (beat % 5 === 2 ? 120 : 0),
      note: beat % 2 === 0 ? 'orange' : 'red',
      dynamic: 'neutral',
      midi: 36,
    });
  }
  return {
    resolution: 480,
    tempoMap: structural
      ? [
          { tick: 0, usPerQuarter: Math.round(60000000 / bpm) },
          { tick: leadInTicks + 192 * 480, usPerQuarter: Math.round(60000000 / (bpm - 4)) },
        ]
      : [{ tick: 0, usPerQuarter: Math.round(60000000 / bpm) }],
    timeSignatures: [{ tick: 0, numerator: 4, denominator: 4 }],
    notes,
    sections: [],
    endTick: leadInTicks + 360 * 480,
    leadInTicks,
  };
}

function audioFor(chart: YargChart, scale = 1, offset = 0, constantBpm?: number): PcmAudio {
  const songDuration =
    constantBpm === undefined
      ? tickToSeconds(chart.endTick, chart.tempoMap, chart.resolution) -
        tickToSeconds(chart.leadInTicks, chart.tempoMap, chart.resolution)
      : ((chart.endTick - chart.leadInTicks) / 480) * (60 / constantBpm);
  const data = new Float32Array(Math.ceil((songDuration / scale + Math.abs(offset) + 20) * RATE));
  const lead = tickToSeconds(chart.leadInTicks, chart.tempoMap, chart.resolution);
  for (const note of chart.notes) {
    const songTime =
      constantBpm === undefined
        ? tickToSeconds(note.tick, chart.tempoMap, chart.resolution) - lead
        : ((note.tick - chart.leadInTicks) / 480) * (60 / constantBpm);
    const start = Math.round((songTime / scale - offset) * RATE);
    for (let j = 0; j < 10; j++)
      if (start + j >= 0 && start + j < data.length) data[start + j] = 0.8;
  }
  return { sampleRate: RATE, length: data.length, numberOfChannels: 1, getChannelData: () => data };
}

describe('GP-prior tempo analysis', () => {
  test('exact alignment', () => {
    const c = chart();
    expect(analyzeTempo(c, 1, audioFor(c)).kind).toBe('aligned');
  });

  test('constant positive drift', () => {
    const c = chart();
    const result = analyzeTempo(c, 1, audioFor(c, 1.007, 0.21));
    expect(result.kind).toBe('uniformTempoAdjustment');
    expect(result.scale).toBeCloseTo(1.007, 3);
    expect(result.offsetMs).toBeCloseTo(210, -1);
  });

  test('71 BPM GP with 71.5 BPM audio', () => {
    const c = chart(71);
    const result = analyzeTempo(c, 1, audioFor(c, 71.5 / 71));
    expect(result.kind).toBe('uniformTempoAdjustment');
    expect(result.scale).toBeCloseTo(71.5 / 71, 3);
    expect(result.confidence).toBe('High');
  });

  test('constant negative drift', () => {
    const c = chart();
    const result = analyzeTempo(c, 1, audioFor(c, 0.99, -0.18));
    expect(result.kind).toBe('uniformTempoAdjustment');
    expect(result.scale).toBeCloseTo(0.99, 3);
  });

  test('suggestion remains absolute after a manual correction', () => {
    const c = chart();
    const adjusted = scaleChartTempo(c, 1, 1.003);
    const result = analyzeTempo(adjusted, 1.003, audioFor(c, 1.007));
    expect(result.kind).toBe('uniformTempoAdjustment');
    expect(result.scale).toBeCloseTo(1.007, 3);
  });

  test('constant offset alone is not tempo drift', () => {
    const c = chart();
    const result = analyzeTempo(c, 1, audioFor(c, 1, -0.43));
    expect(result.kind).toBe('aligned');
    expect(result.offsetMs).toBeCloseTo(-430, -1);
  });

  test('silence is inconclusive', () => {
    const c = chart();
    const data = new Float32Array(230 * RATE);
    expect(
      analyzeTempo(c, 1, {
        sampleRate: RATE,
        length: data.length,
        numberOfChannels: 1,
        getChannelData: () => data,
      }).kind,
    ).toBe('inconclusive');
  });

  test('one analyzable passage cannot establish whole-song confidence', () => {
    const c = chart();
    const sparse = { ...c, notes: c.notes.filter((note) => note.tick < c.leadInTicks + 60 * 480) };
    expect(analyzeTempo(sparse, 1, audioFor(sparse)).kind).toBe('inconclusive');
  });

  test('a wrong local tempo event is a tempo-map mismatch', () => {
    const c = chart(164, true);
    const result = analyzeTempo(c, 1, audioFor(c, 1, 0, 164));
    expect(result.kind).toBe('tempoMapMismatch');
    expect(result.mismatch?.bar).toBe(49);
  });
});
