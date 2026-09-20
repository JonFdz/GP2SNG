import { describe, expect, test } from 'vitest';
import { previewAudioOffsetSeconds } from '../../../src/renderer/src/audio/exportAudio';
import {
  analyzeTempo,
  authoredTempoDiagnostic,
  type PcmAudio,
} from '../../../src/renderer/src/audio/tempoAnalysis';
import { computeAudioStart } from '../../../src/renderer/src/playback/scheduler';
import { buildTempoMap, tickToSeconds } from '../../../src/shared/convert/timing';
import type { GpTempoAutomation, ParsedGpScore, YargChart } from '../../../src/shared/types/index';

const RATE = 1000;

function score(bpm: number, later: GpTempoAutomation[] = []): ParsedGpScore {
  return {
    metadata: { title: '', subtitle: '', artist: '', album: '', copyright: '', tabber: '' },
    tempoAutomations: [{ bar: 0, position: 0, bpm, linear: false }, ...later],
    masterBars: Array.from({ length: 90 }, () => ({
      timeSignature: { numerator: 4, denominator: 4 },
      section: null,
      repeatStart: false,
      repeatEnd: false,
      repeatCount: 0,
      alternateEndings: [],
      hasDirections: false,
    })),
    tracks: [],
  };
}

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

// audioDelaySeconds follows Preview's Audio Offset sign: positive means each
// recorded attack occurs later in the source file than its chart event.
function audioFor(
  chart: YargChart,
  scale = 1,
  audioDelaySeconds = 0,
  constantBpm?: number,
): PcmAudio {
  const songDuration =
    constantBpm === undefined
      ? tickToSeconds(chart.endTick, chart.tempoMap, chart.resolution) -
        tickToSeconds(chart.leadInTicks, chart.tempoMap, chart.resolution)
      : ((chart.endTick - chart.leadInTicks) / 480) * (60 / constantBpm);
  const data = new Float32Array(
    Math.ceil((songDuration / scale + Math.abs(audioDelaySeconds) + 20) * RATE),
  );
  const lead = tickToSeconds(chart.leadInTicks, chart.tempoMap, chart.resolution);
  for (const note of chart.notes) {
    const songTime =
      constantBpm === undefined
        ? tickToSeconds(note.tick, chart.tempoMap, chart.resolution) - lead
        : ((note.tick - chart.leadInTicks) / 480) * (60 / constantBpm);
    const start = Math.round((songTime / scale + audioDelaySeconds) * RATE);
    for (let j = 0; j < 10; j++)
      if (start + j >= 0 && start + j < data.length) data[start + j] = 0.8;
  }
  return { sampleRate: RATE, length: data.length, numberOfChannels: 1, getChannelData: () => data };
}

function pulses(times: number[], duration: number): PcmAudio {
  const data = new Float32Array(Math.ceil(duration * RATE));
  for (const time of times) {
    const start = Math.round(time * RATE);
    for (let j = 0; j < 10; j++) {
      if (start + j >= 0 && start + j < data.length) data[start + j] = 0.8;
    }
  }
  return { sampleRate: RATE, length: data.length, numberOfChannels: 1, getChannelData: () => data };
}

// Musical source fixture: recording attacks are placed directly from their
// quarter-note position and a separately specified recording BPM.
function recordedAtBpm(c: YargChart, bpm: number, audioDelaySeconds = 0): PcmAudio {
  const times = c.notes.map(
    (note) => ((note.tick - c.leadInTicks) / c.resolution) * (60 / bpm) + audioDelaySeconds,
  );
  return pulses(times, Math.max(...times) + 20);
}

function chartWithTenSecondAttack(): YargChart {
  const c = chart();
  return {
    ...c,
    notes: [
      ...c.notes,
      { tick: c.leadInTicks + 20 * 480, note: 'red', dynamic: 'neutral', midi: 38 },
    ],
  };
}

describe('GP-prior tempo analysis', () => {
  test('exact alignment', () => {
    const c = chart();
    expect(analyzeTempo(c, 1, audioFor(c)).kind).toBe('aligned');
  });

  test('constant positive drift plus fixed audio delay', () => {
    const c = chart();
    const result = analyzeTempo(c, 1, recordedAtBpm(c, 120.84, 0.21));
    expect(result.kind).toBe('uniformTempoAdjustment');
    expect(result.scale).toBeCloseTo(1.007, 3);
    expect(result.offsetMs).toBeCloseTo(210, -1);
  });

  test('71 BPM GP with 71.5 BPM audio', () => {
    const c = chart(71);
    const result = analyzeTempo(c, 1, recordedAtBpm(c, 71.5));
    expect(result.kind).toBe('uniformTempoAdjustment');
    expect(71 * (result.scale ?? 0)).toBeCloseTo(71.5, 1);
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
    const adjusted = {
      ...c,
      tempoMap: [{ tick: 0, usPerQuarter: Math.round(60000000 / 120.36) }],
    };
    const result = analyzeTempo(adjusted, 1.003, recordedAtBpm(c, 120.84));
    expect(result.kind).toBe('uniformTempoAdjustment');
    expect(120 * (result.scale ?? 0)).toBeCloseTo(120.84, 1);
  });

  test('embedded SNG lead-in padding does not change the logical fit or offset', () => {
    const c = chart();
    const unpadded = recordedAtBpm(c, 120.84, 0.21);
    const leading = new Float32Array(3380);
    const paddedData = new Float32Array(leading.length + unpadded.length);
    paddedData.set(unpadded.getChannelData(0), leading.length);
    const padded: PcmAudio = {
      sampleRate: RATE,
      length: paddedData.length,
      numberOfChannels: 1,
      getChannelData: () => paddedData,
    };
    const plain = analyzeTempo(c, 1, unpadded);
    const reopened = analyzeTempo(c, 1, padded, 3380);
    expect(plain.kind).toBe('uniformTempoAdjustment');
    expect(reopened.kind).toBe(plain.kind);
    expect(reopened.scale).toBeCloseTo(plain.scale ?? 0, 3);
    expect(reopened.offsetMs).toBeCloseTo(plain.offsetMs ?? 0, -1);
    expect(plain.offsetMs).toBeCloseTo(210, -1);
    const lead = tickToSeconds(c.leadInTicks, c.tempoMap, c.resolution);
    const previewOffset = previewAudioOffsetSeconds(c, reopened.offsetMs ?? 0, 3380);
    expect(computeAudioStart(lead + 10, previewOffset).sourceOffsetSeconds).toBeCloseTo(13.59, 1);
  });

  test('uniform drift survives deterministic jitter, missing attacks, and extra transients', () => {
    const c = chart();
    const jitter = [-0.026, 0.012, 0.021, -0.008, 0.029, -0.017, 0.004];
    const kept = c.notes
      .filter((_, index) => index % 5 !== 0)
      .map(
        (note, index) =>
          ((note.tick - c.leadInTicks) / 480) * (60 / 120.84) + jitter[index % jitter.length],
      );
    const extras = Array.from({ length: 150 }, (_, index) => index * 1.17 + 0.31);
    const result = analyzeTempo(c, 1, pulses([...kept, ...extras], 200));
    expect(result.kind).toBe('uniformTempoAdjustment');
    expect(120 * (result.scale ?? 0)).toBeCloseTo(120.84, 0);
  });

  test('dense misleading cymbals do not outvote the kick and snare anchors', () => {
    const c = chart();
    const cymbals = c.notes.flatMap((note) =>
      [96, 192, 288, 384].map((delta) => ({
        ...note,
        tick: note.tick + delta,
        note: 'yellowCymbal' as const,
        midi: 42,
      })),
    );
    const withCymbals = { ...c, notes: [...c.notes, ...cymbals] };
    const trueAttacks = c.notes.map((note) => ((note.tick - c.leadInTicks) / 480) * (60 / 120.84));
    const distractingAttacks = cymbals.map((note) => ((note.tick - c.leadInTicks) / 480) * 0.5);
    const audio = pulses(trueAttacks, 200);
    const samples = audio.getChannelData(0);
    for (const time of distractingAttacks) {
      const start = Math.round(time * RATE);
      for (let j = 0; j < 10; j++) {
        if (start + j < samples.length) samples[start + j] = Math.max(samples[start + j], 0.5);
      }
    }
    const result = analyzeTempo(withCymbals, 1, audio);
    expect(result.kind).toBe('uniformTempoAdjustment');
    expect(120 * (result.scale ?? 0)).toBeCloseTo(120.84, 0);
  });

  test('audio 430 ms later than a chart attack needs +430 ms, without tempo drift', () => {
    const c = chartWithTenSecondAttack();
    const chartTimes = c.notes.map((note) => ((note.tick - c.leadInTicks) / 480) * 0.5);
    const audio = pulses(
      chartTimes.map((time) => time + 0.43),
      200,
    );
    const result = analyzeTempo(c, 1, audio);
    expect(result.kind).toBe('aligned');
    expect(result.offsetMs).toBeCloseTo(430, -1);
    // The explicit ten-second chart event is heard at 10.430 s in the source.
    const lead = tickToSeconds(c.leadInTicks, c.tempoMap, c.resolution);
    const previewOffset = previewAudioOffsetSeconds(c, result.offsetMs ?? 0, 0);
    expect(computeAudioStart(lead + 10, previewOffset).sourceOffsetSeconds).toBeCloseTo(10.43, 1);
  });

  test('audio 300 ms earlier than a chart attack needs -300 ms', () => {
    const c = chartWithTenSecondAttack();
    const chartTimes = c.notes.map((note) => ((note.tick - c.leadInTicks) / 480) * 0.5);
    const audio = pulses(
      chartTimes.map((time) => time - 0.3),
      200,
    );
    const result = analyzeTempo(c, 1, audio);
    expect(result.kind).toBe('aligned');
    expect(Math.abs((result.offsetMs ?? 0) + 300)).toBeLessThanOrEqual(20);
    // The explicit ten-second chart event is heard at 9.700 s in the source.
    const lead = tickToSeconds(c.leadInTicks, c.tempoMap, c.resolution);
    const previewOffset = previewAudioOffsetSeconds(c, result.offsetMs ?? 0, 0);
    expect(computeAudioStart(lead + 10, previewOffset).sourceOffsetSeconds).toBeCloseTo(9.7, 1);
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
    const gp = score(164, [{ bar: 48, position: 0, bpm: 160, linear: false }]);
    const result = analyzeTempo(c, 1, recordedAtBpm(c, 164), 0, gp);
    expect(result.kind).toBe('tempoMapMismatch');
    expect(result.mismatch?.bar).toBe(49);
    expect(result.mismatch).toMatchObject({ fromBpm: 164, toBpm: 160, ramp: false });
  });

  test('inconsistent regional timing with a constant GP is inconclusive', () => {
    const c = chart();
    const shift = [0, 0.53, -0.31, 0.22, -0.58, 0.44, -0.16, 0.61, -0.39, 0.13];
    const times = c.notes.map((note) => {
      const musicalTime = ((note.tick - c.leadInTicks) / 480) * 0.5;
      return musicalTime + shift[Math.min(shift.length - 1, Math.floor(musicalTime / 18))];
    });
    const result = analyzeTempo(c, 1, pulses(times, 200), 0, score(120));
    expect(result.kind).toBe('inconclusive');
  });

  test('generated ramp steps are not reported as authored GP changes', () => {
    const c = chart(138);
    const startTick = c.leadInTicks + 80 * 480;
    const endTick = c.leadInTicks + 240 * 480;
    const rampChart = {
      ...c,
      tempoMap: buildTempoMap([
        { tick: 0, bpm: 138, linear: false },
        { tick: startTick, bpm: 138, linear: true },
        { tick: endTick, bpm: 80, linear: false },
      ]),
    };
    const gp = score(138, [
      { bar: 20, position: 0, bpm: 138, linear: true },
      { bar: 60, position: 0, bpm: 80, linear: false },
    ]);
    const midpoint =
      tickToSeconds(c.leadInTicks + 160 * 480, rampChart.tempoMap, 480) -
      tickToSeconds(c.leadInTicks, rampChart.tempoMap, 480);
    expect(rampChart.tempoMap.length).toBeGreaterThan(10);
    expect(authoredTempoDiagnostic(rampChart, gp, midpoint)).toBeUndefined();
    const endTime =
      tickToSeconds(endTick, rampChart.tempoMap, 480) -
      tickToSeconds(c.leadInTicks, rampChart.tempoMap, 480);
    expect(authoredTempoDiagnostic(rampChart, gp, endTime)).toMatchObject({
      fromBpm: 138,
      toBpm: 80,
      bar: 61,
      ramp: true,
    });
  });
});
