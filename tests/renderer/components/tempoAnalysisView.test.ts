import { describe, expect, test } from 'vitest';
import type { TempoAnalysisResult } from '../../../src/renderer/src/audio/tempoAnalysis';
import {
  formatSuggestedOffset,
  preserveAnalysisOnSourceChange,
  suggestedOffsetApplied,
  suggestedOffsetAvailable,
  suggestedTempoApplied,
} from '../../../src/renderer/src/components/tempoAnalysisView';

describe('tempo analysis recommendation lifecycle', () => {
  const suggestion: TempoAnalysisResult = {
    kind: 'uniformTempoAdjustment',
    scale: 147 / 144,
    offsetMs: 210,
    confidence: 'High',
  };

  test('applying the analyzed tempo preserves its remaining offset recommendation', () => {
    expect(suggestedTempoApplied(suggestion, 1)).toBe(false);
    expect(suggestedOffsetAvailable(suggestion)).toBe(true);
    expect(preserveAnalysisOnSourceChange(suggestion, true, false, 147 / 144, 147 / 144)).toBe(
      true,
    );
    expect(suggestedTempoApplied(suggestion, 147 / 144)).toBe(true);
    expect(suggestedOffsetApplied(suggestion, 0)).toBe(false);
  });

  test('applying the offset leaves the diagnosis and both applied states available', () => {
    expect(suggestedTempoApplied(suggestion, 147 / 144)).toBe(true);
    expect(suggestedOffsetApplied(suggestion, 210)).toBe(true);
    expect(formatSuggestedOffset(210)).toBe('+210 ms');
    expect(formatSuggestedOffset(-300)).toBe('-300 ms');
  });

  test('manual different tempo and audio replacement or removal invalidate the result', () => {
    expect(preserveAnalysisOnSourceChange(suggestion, true, false, null, 1.01)).toBe(false);
    expect(preserveAnalysisOnSourceChange(suggestion, true, false, 147 / 144, 1.01)).toBe(false);
    expect(preserveAnalysisOnSourceChange(suggestion, true, true, 147 / 144, 147 / 144)).toBe(
      false,
    );
    expect(preserveAnalysisOnSourceChange(suggestion, false, true, null, 1)).toBe(false);
    expect(preserveAnalysisOnSourceChange(suggestion, true, false, null, 147 / 144)).toBe(false);
  });

  test('aligned tempo can still recommend a meaningful offset, but not bucket noise', () => {
    const aligned: TempoAnalysisResult = { kind: 'aligned', offsetMs: 180 };
    expect(suggestedOffsetAvailable(aligned)).toBe(true);
    expect(suggestedOffsetApplied(aligned, 180)).toBe(true);
    expect(suggestedOffsetAvailable({ kind: 'aligned', offsetMs: 20 })).toBe(false);
    expect(suggestedOffsetAvailable({ kind: 'inconclusive', offsetMs: 180 })).toBe(false);
  });
});
