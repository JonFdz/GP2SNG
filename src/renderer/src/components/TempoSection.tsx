import { useEffect, useRef, useState } from 'react';
import type { ParsedGpScore, YargChart } from '../../../shared/types/index';
import { analyzeTempo, type TempoAnalysisResult } from '../audio/tempoAnalysis';
import { openingChartBpm, originalOpeningBpm } from '../state/tempoCorrection';

interface Props {
  chart: YargChart;
  score: ParsedGpScore;
  tempoScale: number;
  audioBuffer: AudioBuffer | null;
  audioPaddingMs: number;
  onApplyTempo: (scale: number) => void;
  onApplyOffset: (ms: number) => void;
}

export function TempoSection({
  chart,
  score,
  tempoScale,
  audioBuffer,
  audioPaddingMs,
  onApplyTempo,
  onApplyOffset,
}: Props) {
  const gpBpm = originalOpeningBpm(score);
  const multiple = chart.tempoMap.length > 1;
  const displayed = multiple ? tempoScale * 100 : openingChartBpm(chart);
  const [draft, setDraft] = useState(displayed.toFixed(2));
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<TempoAnalysisResult | null>(null);
  const [busy, setBusy] = useState(false);
  const analysisEpoch = useRef(0);
  const analysisSource = useRef({ chart, audioBuffer });

  useEffect(() => setDraft(displayed.toFixed(2)), [displayed]);
  useEffect(() => {
    if (
      analysisSource.current.chart !== chart ||
      analysisSource.current.audioBuffer !== audioBuffer
    ) {
      analysisSource.current = { chart, audioBuffer };
      analysisEpoch.current++;
      setResult(null);
      setBusy(false);
    }
  }, [audioBuffer, chart]);

  function apply(scale: number) {
    try {
      onApplyTempo(scale);
      setError(null);
      setResult(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not apply that tempo.');
    }
  }

  function commit() {
    const value = Number(draft);
    const scale = multiple ? value / 100 : value / gpBpm;
    if (draft.trim() === '' || !Number.isFinite(scale) || scale < 0.5 || scale > 2) {
      setError(
        multiple
          ? 'Enter a value from 50% to 200%.'
          : `Enter a tempo from ${(gpBpm * 0.5).toFixed(2)} to ${(gpBpm * 2).toFixed(2)} BPM.`,
      );
      return;
    }
    apply(scale);
  }

  function analyze() {
    if (audioBuffer === null) return;
    setBusy(true);
    setError(null);
    const epoch = analysisEpoch.current;
    // Yield a frame so the progress label renders before CPU analysis begins.
    window.setTimeout(() => {
      if (epoch !== analysisEpoch.current) return;
      try {
        setResult(analyzeTempo(chart, tempoScale, audioBuffer, audioPaddingMs));
      } catch {
        setResult({ kind: 'inconclusive' });
      }
      setBusy(false);
    }, 0);
  }

  const suggestedBpm = result?.scale === undefined ? null : gpBpm * result.scale;
  return (
    <section className="transport tempo-section">
      <div className="settings-label">Tempo</div>
      <div className="transport__field">
        <span>{multiple ? 'GP tempo map' : 'GP tempo'}</span>
        <strong>
          {multiple ? `${chart.tempoMap.length} tempo events` : `${gpBpm.toFixed(2)} BPM`}
        </strong>
      </div>
      <label className="transport__field">
        <span>{multiple ? 'Tempo adjustment' : 'Adjusted tempo'}</span>
        <span className="tempo-section__edit">
          <input
            className="text-input"
            type="number"
            min={multiple ? 50 : gpBpm * 0.5}
            max={multiple ? 200 : gpBpm * 2}
            step={0.01}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              setError(null);
            }}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
            }}
          />
          <span>{multiple ? '%' : 'BPM'}</span>
          <button type="button" className="btn" onClick={() => apply(1)}>
            Reset
          </button>
        </span>
      </label>
      {error !== null && <div className="error-banner error-banner--inline">{error}</div>}
      <button
        type="button"
        className="btn"
        disabled={audioBuffer === null || busy}
        onClick={analyze}
      >
        {busy ? 'Analyzing audio…' : 'Analyze audio'}
      </button>
      {audioBuffer === null && (
        <p className="transport__note">
          Add audio to analyze synchronization. Manual tempo adjustment works without audio.
        </p>
      )}
      {result !== null && (
        <div className="tempo-section__result">
          {result.kind === 'aligned' && (
            <>
              <strong>Tempo matches the audio</strong>
              <p>
                The chart stays consistently aligned with the audio. No tempo adjustment is
                recommended.
              </p>
              {result.differencePercent !== undefined && (
                <p>
                  Estimated difference: {result.differencePercent >= 0 ? '+' : ''}
                  {result.differencePercent.toFixed(2)}%
                </p>
              )}
            </>
          )}
          {result.kind === 'uniformTempoAdjustment' && result.scale !== undefined && (
            <>
              <strong>A consistent tempo adjustment was found</strong>
              <p>
                The chart gradually drifts from the audio, but a single tempo adjustment keeps it
                aligned across the song.
              </p>
              <dl>
                <dt>{multiple ? 'Suggested adjustment' : 'Suggested tempo'}</dt>
                <dd>
                  {multiple
                    ? `${(result.scale * 100).toFixed(2)}%`
                    : `${suggestedBpm?.toFixed(2)} BPM`}
                </dd>
                <dt>Difference</dt>
                <dd>
                  {result.differencePercent && result.differencePercent >= 0 ? '+' : ''}
                  {result.differencePercent?.toFixed(2)}%
                </dd>
                <dt>Estimated drift before correction</dt>
                <dd>{result.driftSecondsPerMinute?.toFixed(2)} s/min</dd>
                <dt>Suggested audio offset</dt>
                <dd>{result.offsetMs} ms</dd>
                <dt>Confidence</dt>
                <dd>{result.confidence}</dd>
              </dl>
              {result.confidence === 'Medium' && (
                <p>Verify this adjustment in Preview before exporting.</p>
              )}
              <div className="tempo-section__actions">
                <button
                  type="button"
                  className="btn btn--primary"
                  onClick={() => apply(result.scale ?? 1)}
                >
                  Apply{' '}
                  {multiple
                    ? `${(result.scale * 100).toFixed(2)}%`
                    : `${suggestedBpm?.toFixed(2)} BPM`}
                </button>
                {result.offsetMs !== undefined && (
                  <button
                    type="button"
                    className="btn"
                    onClick={() => onApplyOffset(result.offsetMs ?? 0)}
                  >
                    Apply {result.offsetMs} ms
                  </button>
                )}
              </div>
            </>
          )}
          {result.kind === 'tempoMapMismatch' && (
            <>
              <strong>Tempo changes do not match the audio</strong>
              <p>
                The chart does not drift consistently across the whole song. A single tempo
                adjustment would not fix the synchronization.
              </p>
              {result.mismatch !== undefined && (
                <p>
                  Possible mismatch near bar {result.mismatch.bar}. GP tempo change:{' '}
                  {result.mismatch.fromBpm.toFixed(0)} → {result.mismatch.toBpm.toFixed(0)} BPM.
                </p>
              )}
            </>
          )}
          {result.kind === 'inconclusive' && (
            <>
              <strong>Could not determine a reliable tempo adjustment</strong>
              <p>
                The audio did not provide enough consistent rhythmic information to recommend a
                tempo change. Quiet passages, free-time intros, few attacks, or performance
                differences can cause this. Inspect the chart and metronome manually in Preview.
              </p>
            </>
          )}
        </div>
      )}
    </section>
  );
}
