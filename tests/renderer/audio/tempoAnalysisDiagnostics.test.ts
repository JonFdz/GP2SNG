// TEMPORARY QA DIAGNOSTICS. Remove with the diagnostic callback after calibration.
import { describe, expect, test, vi } from 'vitest';
import { analyzeTempo, type PcmAudio } from '../../../src/renderer/src/audio/tempoAnalysis';
import {
  logTempoAnalysisDiagnostics,
  type TempoAnalysisDiagnostics,
} from '../../../src/renderer/src/audio/tempoAnalysisDiagnostics';
import type { ParsedGpScore, YargChart } from '../../../src/shared/types/index';

function fixture(bpm = 120, laterBpm?: number): YargChart {
  const leadInTicks = 3840;
  return {
    resolution: 480,
    leadInTicks,
    endTick: leadInTicks + 360 * 480,
    tempoMap: [
      { tick: 0, usPerQuarter: Math.round(60_000_000 / bpm) },
      ...(laterBpm === undefined
        ? []
        : [{ tick: leadInTicks + 192 * 480, usPerQuarter: Math.round(60_000_000 / laterBpm) }]),
    ],
    notes: Array.from({ length: 360 }, (_, beat) => beat)
      .filter((beat) => beat % 7 !== 4 && beat % 11 !== 9)
      .map((beat) => ({
        tick: leadInTicks + beat * 480 + (beat % 5 === 2 ? 120 : 0),
        note: beat % 2 === 0 ? 'orange' : 'red',
        dynamic: 'neutral',
        midi: 36,
      })),
    timeSignatures: [{ tick: 0, numerator: 4, denominator: 4 }],
    sections: [],
  };
}

function recording(chart: YargChart, bpm: number, silent = false): PcmAudio {
  const sampleRate = 1000;
  const data = new Float32Array(240 * sampleRate);
  if (!silent) {
    for (const note of chart.notes) {
      const time = ((note.tick - chart.leadInTicks) / chart.resolution) * (60 / bpm) + 0.21;
      const start = Math.round(time * sampleRate);
      data.fill(0.8, start, start + 10);
    }
  }
  return { sampleRate, numberOfChannels: 1, length: data.length, getChannelData: () => data };
}

function gpScore(changeBar = 48): ParsedGpScore {
  return {
    metadata: { title: '', subtitle: '', artist: '', album: '', copyright: '', tabber: '' },
    tracks: [],
    masterBars: Array.from({ length: 90 }, () => ({
      timeSignature: { numerator: 4, denominator: 4 },
      section: null,
      repeatStart: false,
      repeatEnd: false,
      repeatCount: 0,
      alternateEndings: [],
      hasDirections: false,
    })),
    tempoAutomations: [
      { bar: 0, position: 0, bpm: 164, linear: false },
      { bar: changeBar, position: 0, bpm: 160, linear: false },
    ],
  };
}

function inspect(chart: YargChart, audio: PcmAudio, score?: ParsedGpScore) {
  const reports: TempoAnalysisDiagnostics[] = [];
  const result = analyzeTempo(chart, 1, audio, 0, score, (report) => reports.push(report));
  expect(reports).toHaveLength(1);
  // The callback must not change any returned field, including offsets/confidence.
  expect(result).toEqual(analyzeTempo(chart, 1, audio, 0, score));
  expect(reports[0].result).toEqual(result);
  return { result, diagnostics: reports[0] };
}

describe('temporary tempo diagnostics', () => {
  test.each([
    [120, 'aligned', 'aligned'],
    [120.84, 'uniformTempoAdjustment', 'uniformAdjustment'],
  ] as const)('records the successful reason for %s BPM audio', (bpm, kind, reason) => {
    const chart = fixture();
    const { result, diagnostics } = inspect(chart, recording(chart, bpm));
    expect(result.kind).toBe(kind);
    expect(diagnostics.finalReason).toBe(reason);
    expect(diagnostics.search?.topScaleCandidates).toHaveLength(5);
    expect(
      new Set(diagnostics.search?.topScaleCandidates.map((candidate) => candidate.scale)).size,
    ).toBe(5);
    expect(diagnostics.eventSummary?.uniqueTicks).toBe(chart.notes.length);
    expect(diagnostics.audio.nonZeroRatio).toBeGreaterThan(0);
    expect(diagnostics.globalValidation?.windows.some((window) => window.accepted)).toBe(true);
    expect(diagnostics.fallback.entered).toBe(false);
  });

  test('silence identifies the no-onset exit', () => {
    const chart = fixture();
    const { result, diagnostics } = inspect(chart, recording(chart, 120, true));
    expect(result.kind).toBe('inconclusive');
    expect(diagnostics.finalReason).toBe('noOnsetEvidence');
    expect(diagnostics.audio.nonZeroRatio).toBe(0);
    expect(diagnostics.search).toBeUndefined();
  });

  test('insufficient coverage exposes both the fallback trigger and final exit', () => {
    const chart = fixture();
    chart.notes = chart.notes.filter((note) => note.tick < chart.leadInTicks + 60 * 480);
    const { result, diagnostics } = inspect(chart, recording(chart, 120));
    expect(result.kind).toBe('inconclusive');
    expect(diagnostics.finalReason).toBe('insufficientLocalCoverage');
    expect(diagnostics.fallback.entryReasons).toContain('insufficientGlobalCoverage');
    expect(diagnostics.globalValidation?.rejectedForTooFewEvents).toBeGreaterThan(0);
    expect(diagnostics.fallback.boundariesEvaluated).toBe(false);
  });

  test.each([
    [48, 'selectedUniqueCandidate'],
    [1, 'noCandidates'],
    [undefined, 'noScoreAvailable'],
  ] as const)('records mismatch attribution for authored bar %s', (bar, reason) => {
    const chart = fixture(164, 160);
    const score = bar === undefined ? undefined : gpScore(bar);
    const { result, diagnostics } = inspect(chart, recording(chart, 164), score);
    expect(result.kind).toBe('tempoMapMismatch');
    expect(diagnostics.finalReason).toBe('tempoMapMismatch');
    expect(diagnostics.fallback.entered).toBe(true);
    expect(diagnostics.fallback.boundariesEvaluated).toBe(true);
    expect(diagnostics.fallback.selectedBoundarySource).not.toBe('none');
    expect(diagnostics.fallback.selectedBoundary).not.toBeNull();
    expect(diagnostics.authoredAttribution.finalReason).toBe(reason);
    if (bar === 48) {
      expect(result.mismatch?.bar).toBe(49);
      expect(diagnostics.authoredAttribution.selectedBar).toBe(49);
      const candidate = diagnostics.authoredAttribution.candidates[0];
      expect(candidate.acceptedAsCandidate).toBe(true);
      expect(candidate.rejectionReasons).toEqual([]);
      expect(candidate.beforeOffsetSlope).not.toBeNull();
      // A failed global fit can leave too few accepted windows on one side.
      // Report unavailable trajectories as null rather than inventing a slope.
      expect(candidate.afterOffsetSlope !== null).toBe(candidate.afterOffsetWindowCount >= 2);
      expect(candidate.estimatedOffsetJumpAtEvent !== null).toBe(
        candidate.beforeOffsetWindowCount >= 2 && candidate.afterOffsetWindowCount >= 2,
      );
    } else if (bar === 1) {
      expect(result.mismatch).toBeUndefined();
      expect(diagnostics.authoredAttribution.candidates[0].rejectionReasons).toContain(
        'notEnoughBeforeWindows',
      );
    }
  });

  test('emits one copyable block and preserves failures if reporting throws', () => {
    const chart = fixture();
    const audio = recording(chart, 120, true);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      analyzeTempo(chart, 1, audio, 0, undefined, logTempoAnalysisDiagnostics);
      expect(log).toHaveBeenCalledTimes(1);
      expect(log.mock.calls[0][0]).toBe('[GP2SNG tempo analysis debug]');
      expect(JSON.parse(log.mock.calls[0][1]).finalReason).toBe('noOnsetEvidence');
    } finally {
      log.mockRestore();
    }
    expect(
      analyzeTempo(chart, 1, audio, 0, undefined, () => {
        throw new Error('reporting failed');
      }),
    ).toEqual({ kind: 'inconclusive' });

    const error = new Error('decode buffer unavailable');
    const reports: TempoAnalysisDiagnostics[] = [];
    expect(() =>
      analyzeTempo(
        chart,
        1,
        {
          ...audio,
          getChannelData: () => {
            throw error;
          },
        },
        0,
        undefined,
        (report) => reports.push(report),
      ),
    ).toThrow(error);
    expect(reports).toHaveLength(1);
    expect(reports[0].finalReason).toBe('unexpectedError');
  });
});
