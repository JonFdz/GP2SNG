import { describe, expect, test } from 'vitest';
import { previewAudioOffsetSeconds } from '../../../src/renderer/src/audio/exportAudio';
import {
  analyzeTempo,
  authoredTempoPoints,
  globalWindowStarts,
  type PcmAudio,
} from '../../../src/renderer/src/audio/tempoAnalysis';
import type { TempoAnalysisDiagnostics } from '../../../src/renderer/src/audio/tempoAnalysisDiagnostics';
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

function boundarySensitiveChart(bpm: number): YargChart {
  const c = chart(bpm);
  // One strong attack changes 18-second membership between 145 and 144 BPM.
  // The rest of the song has useful cymbal attacks, so the old whole-song
  // strong-only switch discarded its evidence at 144 BPM.
  const strongBeats = [0, 1, 2].flatMap((window) =>
    Array.from({ length: 9 }, (_, i) => window * 43.5 + 3 + i * 4),
  );
  strongBeats.push(...Array.from({ length: 8 }, (_, i) => 3 * 43.5 + 3 + i * 4), 173.8);
  return {
    ...c,
    notes: [
      ...strongBeats.map((beat) => ({
        tick: c.leadInTicks + Math.round(beat * 480),
        note: 'red' as const,
        dynamic: 'neutral' as const,
        midi: 38,
      })),
      ...Array.from({ length: 120 }, (_, i) => ({
        tick: c.leadInTicks + Math.round((i * 3 + (i % 7) * 0.2) * 480),
        note: 'yellowCymbal' as const,
        dynamic: 'neutral' as const,
        midi: 42,
      })),
    ],
  };
}

describe('GP-prior tempo analysis', () => {
  test('one isolated offset alias does not veto a strong uniform correction', () => {
    const c = chart(144);
    const baseTimes = c.notes.map(
      (note) => ((note.tick - c.leadInTicks) / 480) * (60 / 147) + 0.81,
    );
    const region = c.notes
      .map((note, index) => ({
        time: ((note.tick - c.leadInTicks) / 480) * (60 / 144),
        index,
      }))
      .filter(({ time }) => time >= 90 && time < 108);
    // An extra rhythmic layer wins only this full window. Neighboring windows
    // still prefer the source attacks, which remain present throughout the song.
    const aliases = region.map(({ index }) => baseTimes[index] - 1.22);
    const omitted = new Set(region.filter((_, i) => i % 7 === 0).map(({ index }) => index));
    const audio = pulses([...baseTimes.filter((_, i) => !omitted.has(i)), ...aliases], 180);
    let debug: TempoAnalysisDiagnostics | undefined;
    const result = analyzeTempo(c, 1, audio, 0, undefined, (value) => {
      debug = value;
    });
    expect(result.kind).toBe('uniformTempoAdjustment');
    expect(144 * (result.scale ?? 0)).toBeCloseTo(147, 0);
    expect(result.confidence).toBe('Medium');
    expect(debug?.globalValidation?.acceptedViaRobustConsensus).toBe(true);
    expect(debug?.globalValidation?.outlierWindowCount).toBeGreaterThan(0);
    expect(debug?.fallback.selectedBoundarySource).toBe('none');
  });

  test('sustained offset structure wins even with a 90% global consensus', () => {
    const c = chart(144);
    c.notes = Array.from({ length: 6 }, (_, repeat) =>
      c.notes.map((note) => ({ ...note, tick: note.tick + repeat * 360 * 480 })),
    ).flat();
    c.endTick = c.leadInTicks + 2160 * 480;
    const times = c.notes.map((note) => {
      const beat = (note.tick - c.leadInTicks) / 480;
      return beat * (60 / 147) + (beat < 1980 ? 0.21 : 1.43);
    });
    let debug: TempoAnalysisDiagnostics | undefined;
    const result = analyzeTempo(c, 1, pulses(times, 920), 0, undefined, (value) => {
      debug = value;
    });
    expect(result.kind).toBe('tempoMapMismatch');
    expect(debug?.globalValidation?.inlierRatio).toBeGreaterThanOrEqual(0.9);
    expect(debug?.globalValidation?.acceptedViaRobustConsensus).toBe(false);
  });

  test.each([150, 160])('authored 147 → %i at bar 69 is a local mismatch', (wrongBpm) => {
    const c = chart(147);
    // Enough independent windows on both sides of bar 69.
    c.notes = [...c.notes, ...c.notes.map((note) => ({ ...note, tick: note.tick + 360 * 480 }))];
    c.endTick = c.leadInTicks + 720 * 480;
    c.tempoMap.push({
      tick: c.leadInTicks + 272 * 480,
      usPerQuarter: Math.round(60000000 / wrongBpm),
    });
    const gp = score(147, [{ bar: 68, position: 0, bpm: wrongBpm, linear: false }]);
    let debug: TempoAnalysisDiagnostics | undefined;
    const result = analyzeTempo(c, 1, recordedAtBpm(c, 147), 0, gp, (value) => {
      debug = value;
    });
    expect(result.kind).toBe('tempoMapMismatch');
    expect(result.mismatch).toMatchObject({ bar: 69, fromBpm: 147, toBpm: wrongBpm });
    expect(debug?.globalValidation?.acceptedViaRobustConsensus).toBe(false);
    expect(debug?.fallback.extendedDiagnosticSearchUsed).toBe(wrongBpm === 160);
    if (wrongBpm === 160) {
      expect(debug?.fallback.extendedDiagnosticSearchUsed).toBe(true);
      const candidate = debug?.authoredAttribution.candidates.find(
        (candidate) => candidate.bar === 69,
      );
      expect(candidate?.afterScaleMedian).toBeCloseTo(147 / 160, 2);
    }
  });

  test('extended attribution distinguishes a correct earlier change from the wrong event', () => {
    const c = chart(147);
    c.notes = [...c.notes, ...c.notes.map((note) => ({ ...note, tick: note.tick + 360 * 480 }))];
    c.endTick = c.leadInTicks + 720 * 480;
    c.tempoMap.push(
      { tick: c.leadInTicks + 80 * 480, usPerQuarter: Math.round(60000000 / 149) },
      { tick: c.leadInTicks + 272 * 480, usPerQuarter: Math.round(60000000 / 160) },
    );
    const recording = audioFor({ ...c, tempoMap: c.tempoMap.slice(0, 2) });
    const gp = score(147, [
      { bar: 20, position: 0, bpm: 149, linear: false },
      { bar: 68, position: 0, bpm: 160, linear: false },
    ]);
    let debug: TempoAnalysisDiagnostics | undefined;
    const result = analyzeTempo(c, 1, recording, 0, gp, (value) => {
      debug = value;
    });
    expect(debug?.fallback.extendedDiagnosticSearchUsed).toBe(true);
    expect(result.kind).toBe('tempoMapMismatch');
    expect(result.mismatch).toMatchObject({ bar: 69, fromBpm: 149, toBpm: 160 });
  });

  test('lost post-event audio evidence alone cannot earn an extended attribution', () => {
    const c = chart(147);
    c.notes = [...c.notes, ...c.notes.map((note) => ({ ...note, tick: note.tick + 360 * 480 }))];
    c.endTick = c.leadInTicks + 720 * 480;
    c.tempoMap.push({ tick: c.leadInTicks + 272 * 480, usPerQuarter: Math.round(60000000 / 160) });
    const recording = recordedAtBpm(
      { ...c, notes: c.notes.filter((note) => note.tick < c.leadInTicks + 272 * 480) },
      147,
    );
    const gp = score(147, [{ bar: 68, position: 0, bpm: 160, linear: false }]);
    let debug: TempoAnalysisDiagnostics | undefined;
    const result = analyzeTempo(c, 1, recording, 0, gp, (value) => {
      debug = value;
    });
    expect(debug?.fallback.extendedDiagnosticSearchUsed).toBe(true);
    expect(result.kind).toBe('inconclusive');
    expect(result.mismatch).toBeUndefined();
  });

  test('a whole-song 160 vs 147 mismatch cannot unlock the wider diagnostic range', () => {
    const c = chart(160);
    let debug: TempoAnalysisDiagnostics | undefined;
    const result = analyzeTempo(c, 1, recordedAtBpm(c, 147), 0, score(160), (value) => {
      debug = value;
    });
    expect(result.kind).not.toBe('uniformTempoAdjustment');
    expect(debug?.fallback.extendedDiagnosticSearchUsed).toBe(false);
    expect(debug?.search?.bestScale).toBeGreaterThanOrEqual(0.9489);
  });

  test('global search-edge corrections have at most Medium confidence', () => {
    const c = chart(155);
    let debug: TempoAnalysisDiagnostics | undefined;
    const result = analyzeTempo(c, 1, recordedAtBpm(c, 147), 0, undefined, (value) => {
      debug = value;
    });
    expect(debug?.search?.nearScaleBoundary).toBe(true);
    expect(result.kind).toBe('uniformTempoAdjustment');
    expect(result.confidence).toBe('Medium');
  });

  test.each([
    180, 180.000144, 179.999856,
  ])('final window is unique and end-anchored at %f seconds', (duration) => {
    const starts = globalWindowStarts(duration);
    expect(starts.at(-1)).toBe(duration - 18);
    for (let i = 1; i < starts.length; i++) expect(starts[i] - starts[i - 1]).toBeGreaterThan(0.01);
    expect(starts.filter((start) => Math.abs(start - 162) < 0.01)).toHaveLength(1);
    expect(globalWindowStarts(duration)).toEqual(starts);
  });

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

  test('nearby GP tempos fit the same 147 BPM recording', () => {
    const recording = recordedAtBpm(chart(147), 147, 0.21);
    for (const gpBpm of [144, 145, 147, 150, 155]) {
      const result = analyzeTempo(chart(gpBpm), 1, recording);
      expect(result.kind, `GP ${gpBpm} BPM`).toBe(
        gpBpm === 147 ? 'aligned' : 'uniformTempoAdjustment',
      );
      expect(gpBpm * (result.scale ?? 0), `GP ${gpBpm} BPM`).toBeCloseTo(147, 0);
    }
  });

  test('attacks at regional boundaries do not create a 144 BPM coverage cliff', () => {
    const recording = recordedAtBpm(boundarySensitiveChart(147), 147, 0.21);
    for (const gpBpm of [144, 145]) {
      const result = analyzeTempo(boundarySensitiveChart(gpBpm), 1, recording);
      expect(result.kind, `GP ${gpBpm} BPM`).toBe('uniformTempoAdjustment');
      expect(gpBpm * (result.scale ?? 0), `GP ${gpBpm} BPM`).toBeCloseTo(147, 0);
    }
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

  test('a small authored tempo error is attributed even when drift becomes clear later', () => {
    const c = chart(164);
    c.endTick = c.leadInTicks + 700 * 480;
    c.notes = Array.from({ length: 700 }, (_, beat) => beat)
      .filter((beat) => (beat < 192 || beat >= 320) && beat % 7 !== 4 && beat % 11 !== 9)
      .map((beat) => ({
        tick: c.leadInTicks + beat * 480 + (beat % 5 === 2 ? 120 : 0),
        note: beat % 2 === 0 ? ('orange' as const) : ('red' as const),
        dynamic: 'neutral' as const,
        midi: 36,
      }));
    const eventTick = c.leadInTicks + 192 * 480;
    c.tempoMap.push({ tick: eventTick, usPerQuarter: Math.round(60000000 / 162) });
    const gp = score(164, [{ bar: 48, position: 0, bpm: 162, linear: false }]);
    const eventTime =
      tickToSeconds(eventTick, c.tempoMap, c.resolution) -
      tickToSeconds(c.leadInTicks, c.tempoMap, c.resolution);
    const firstPostGap = c.notes.find((note) => note.tick >= c.leadInTicks + 320 * 480);
    expect(firstPostGap).toBeDefined();
    const firstPostTime =
      tickToSeconds(firstPostGap?.tick ?? 0, c.tempoMap, c.resolution) -
      tickToSeconds(c.leadInTicks, c.tempoMap, c.resolution);
    // Useful attacks resume well after the old one-window proximity radius.
    expect(firstPostTime - eventTime).toBeGreaterThan(18);
    const result = analyzeTempo(c, 1, recordedAtBpm(c, 164), 0, gp);
    expect(result.kind).toBe('tempoMapMismatch');
    expect(result.mismatch).toMatchObject({ bar: 49, fromBpm: 164, toBpm: 162 });
  });

  test('only the wrong authored change is attributed among multiple tempo events', () => {
    const c = chart(164);
    const correctTick = c.leadInTicks + 32 * 480;
    const wrongTick = c.leadInTicks + 192 * 480;
    c.tempoMap.push(
      { tick: correctTick, usPerQuarter: Math.round(60000000 / 160) },
      { tick: wrongTick, usPerQuarter: Math.round(60000000 / 158) },
    );
    const recordingChart = {
      ...c,
      tempoMap: c.tempoMap.slice(0, 2),
    };
    const gp = score(164, [
      { bar: 8, position: 0, bpm: 160, linear: false },
      { bar: 48, position: 0, bpm: 158, linear: false },
    ]);
    const result = analyzeTempo(c, 1, audioFor(recordingChart), 0, gp);
    expect(result.kind).toBe('tempoMapMismatch');
    expect(result.mismatch).toMatchObject({ bar: 49, fromBpm: 160, toBpm: 158 });
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
    const authored = authoredTempoPoints(rampChart, gp);
    expect(rampChart.tempoMap.length).toBeGreaterThan(10);
    expect(authored.map((point) => point.bpm)).toEqual([138, 138, 80]);
    expect(authored.map((point) => point.bar)).toEqual([1, 21, 61]);
    const endTime =
      tickToSeconds(endTick, rampChart.tempoMap, 480) -
      tickToSeconds(c.leadInTicks, rampChart.tempoMap, 480);
    expect(authored[2].time).toBeCloseTo(endTime, 3);
    expect(authored[1].linear).toBe(true);
  });
});
