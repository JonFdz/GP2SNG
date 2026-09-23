import { useState } from 'react';
import { parseGp } from '../../../shared/gp/index';
import { readSngSession } from '../../../shared/sng/index';
import { hasSectionNames } from '../state/hasSectionNames';
import { sourceFileName } from '../state/sourceFile';
import { useWizardStore } from '../state/wizardStore';

// Load step (FUNCTIONALITY steps 2-7): pick a GP file, parse it, load it into the
// wizard, then pick the tracks to combine — all on one page (docs/DESIGN.md →
// Convert tab). Detected drum-kit tracks start selected; a selection containing
// no notes blocks Next.
export function LoadView() {
  const gpFilePath = useWizardStore((s) => s.gpFilePath);
  const score = useWizardStore((s) => s.score);
  const selectedTrackIds = useWizardStore((s) => s.selectedTrackIds);
  const loadScore = useWizardStore((s) => s.loadScore);
  const restoreSession = useWizardStore((s) => s.restoreSession);
  const toggleTrack = useWizardStore((s) => s.toggleTrack);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleLoad() {
    setError(null);
    setBusy(true);
    try {
      const picked = await window.gp2sng.loadGpFile();
      if (picked === null) return; // user cancelled the dialog — silent
      const parsed = parseGp(picked.bytes);
      loadScore(picked.path, picked.bytes, parsed);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The file could not be loaded.');
    } finally {
      setBusy(false);
    }
  }

  async function handleLoadSng() {
    setError(null);
    setBusy(true);
    try {
      const picked = await window.gp2sng.loadSngFile();
      if (picked === null) return; // user cancelled the dialog — silent
      const { blob, audioBytes, albumArt } = readSngSession(picked.bytes);
      // Parsed here rather than in shared/sng for the same reason a fresh GP file is
      // parsed in the renderer: parse errors belong in the runtime that shows them.
      const parsed = parseGp(blob.gpBytes);
      restoreSession({
        sngFilePath: picked.path,
        gpFilePath: blob.gpFilePath,
        gpFileBytes: blob.gpBytes,
        score: parsed,
        blob,
        audioBytes,
        albumArt,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That .sng could not be opened.');
    } finally {
      setBusy(false);
    }
  }

  const fileName = gpFilePath === null ? null : sourceFileName(gpFilePath);
  const noteless =
    selectedTrackIds.length > 0 &&
    !score?.tracks.some((track) => selectedTrackIds.includes(track.id) && track.noteCount > 0);

  return (
    <div>
      <h1 className="view-title">Select a file to load</h1>

      <section className="settings-section">
        <div className="settings-label">Guitar Pro file</div>
        <p className="view-hint">
          Select a .gp file, then choose tracks to combine into one drum chart.
        </p>
        <button
          type="button"
          className={score ? 'btn' : 'btn btn--primary'}
          onClick={handleLoad}
          disabled={busy}
        >
          {score ? 'Load a different file' : 'Load GP file'}
        </button>
      </section>

      <section className="settings-section">
        <div className="settings-label">Prior GP2SNG conversion</div>
        <p className="view-hint">Load a prior .sng file generated via GP2SNG and edit it.</p>
        <button type="button" className="btn" onClick={handleLoadSng} disabled={busy}>
          Load .sng file
        </button>
      </section>

      {error && <div className="error-banner">{error}</div>}

      {score && (
        <section className="settings-section">
          <div className="settings-label">File Information</div>

          <div className="load-summary">
            <div className="load-summary__file">{fileName}</div>
            <div className="load-summary__meta">
              {score.metadata.title || '(untitled)'} — {score.metadata.artist || '(unknown artist)'}
            </div>
            <div className="load-summary__meta">
              {score.tracks.length} track{score.tracks.length === 1 ? '' : 's'}
            </div>
          </div>

          {!hasSectionNames(score.masterBars) && (
            <div className="warning-banner">
              <span className="warning-icon">⚠</span>
              <span className="warning-text">
                No section names detected in this tab. Consider adding section names in Guitar Pro
                (via Shift+Ins) and reloading to assist with Practice mode navigation in YARG
              </span>
            </div>
          )}

          <div className="track-select">
            <div className="settings-label">Tracks to combine</div>
            <p className="view-hint">
              Select the tracks to combine into the drum chart. Detected drum tracks are selected
              automatically.
            </p>

            {!score.tracks.some((track) => track.isDrumKit) && (
              <div className="warning-banner">
                <span className="warning-icon">⚠</span>
                <span className="warning-text">
                  No drum tracks were detected automatically. Select the track or tracks that should
                  be used for the drum chart.
                </span>
              </div>
            )}

            <div className="track-list">
              {score.tracks.map((track) => (
                <label
                  key={track.id}
                  className={
                    selectedTrackIds.includes(track.id)
                      ? 'track-row track-row--selected'
                      : 'track-row'
                  }
                >
                  <input
                    type="checkbox"
                    checked={selectedTrackIds.includes(track.id)}
                    onChange={() => toggleTrack(track.id)}
                  />
                  <span className="track-row__name">{track.name || `Track ${track.id}`}</span>
                  <span className="track-row__meta">
                    {track.isDrumKit && <span className="track-tag">Drums</span>}
                    <span className="track-row__count">
                      {track.noteCount} note{track.noteCount === 1 ? '' : 's'}
                    </span>
                  </span>
                </label>
              ))}
            </div>

            {selectedTrackIds.length === 0 && (
              <div className="error-banner">Select at least one track to continue.</div>
            )}

            {noteless && (
              <div className="error-banner">
                The selected tracks have no notes. Select a track that contains notes to continue.
              </div>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
