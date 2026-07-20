import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { tickToSeconds } from '../../../shared/convert/index';
import { writeSng } from '../../../shared/sng/index';
import type { YargChart } from '../../../shared/types/index';
import { resolveExportAudio } from '../audio/index';
import { MetadataForm } from '../components/MetadataForm';
import { displayedNotes } from '../playback/overrides';
import { defaultMetadata, isMetadataValid, metadataErrors } from '../state/metadata';
import { buildSessionBlob } from '../state/sessionBlob';
import { useSettingsStore } from '../state/settingsStore';
import { useWizardStore } from '../state/wizardStore';

// A filename safe for Windows/POSIX (docs/DESIGN.md → UI top-level structure → Save).
function sanitizeFilename(name: string): string {
  const cleaned = name.replace(/[<>:"/\\|?*]/g, '_').trim();
  return cleaned === '' ? 'song' : cleaned;
}

// The Finalize step: the editable song-metadata form and the save destination,
// split out of Preview so the chart-review surface stays focused. Save writes the
// displayed chart (conversion output + one-off overrides + deletions), matching
// the preview. The Save action (and the output filename beside it) render into the
// wizard footer via `footerSlot` — a node WizardShell supplies so the terminal
// action sits in the shared Back/primary action bar, not in the scrolling body.
export function FinalizeView({ footerSlot }: { footerSlot: HTMLElement | null }) {
  const score = useWizardStore((s) => s.score);
  const chart = useWizardStore((s) => s.chart);
  const overrides = useWizardStore((s) => s.overrides);
  const deletions = useWizardStore((s) => s.deletions);
  const metadata = useWizardStore((s) => s.metadata);
  const audioBuffer = useWizardStore((s) => s.audioBuffer);
  const audioBytes = useWizardStore((s) => s.audioBytes);
  const audioOffsetMs = useWizardStore((s) => s.audioOffsetMs);
  const audioPaddingMs = useWizardStore((s) => s.audioPaddingMs);
  const setMetadata = useWizardStore((s) => s.setMetadata);
  const reset = useWizardStore((s) => s.reset);
  const gpFilePath = useWizardStore((s) => s.gpFilePath);
  const gpFileBytes = useWizardStore((s) => s.gpFileBytes);
  const selectedTrackId = useWizardStore((s) => s.selectedTrackId);
  const sessionMap = useWizardStore((s) => s.sessionMap);
  const sessionSettings = useWizardStore((s) => s.sessionSettings);
  const warnings = useWizardStore((s) => s.warnings);
  const previewRemaps = useWizardStore((s) => s.previewRemaps);

  const outputDir = useSettingsStore((s) => s.outputDir);
  const setOutputDir = useSettingsStore((s) => s.setOutputDir);

  const [saveDir, setSaveDir] = useState(outputDir ?? '');
  const [pendingSave, setPendingSave] = useState<{ dir: string; filename: string } | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  // Seed the metadata form from the parsed score on first entry.
  useEffect(() => {
    if (metadata === null && score !== null) setMetadata(defaultMetadata(score.metadata));
  }, [metadata, score, setMetadata]);

  // Keep the "Saving to" field aligned with Settings until the user overrides it.
  useEffect(() => setSaveDir(outputDir ?? ''), [outputDir]);

  const displayed = useMemo(
    () => (chart === null ? [] : displayedNotes(chart.notes, overrides, deletions)),
    [chart, overrides, deletions],
  );

  // Metadata seeds via the effect above, so it is briefly null on first render.
  if (
    chart === null ||
    metadata === null ||
    gpFileBytes === null ||
    sessionMap === null ||
    selectedTrackId === null ||
    gpFilePath === null
  ) {
    return null;
  }
  const gpChart = chart;
  const gpMetadata = metadata;
  const gpBytes = gpFileBytes;
  const map = sessionMap;
  const trackId = selectedTrackId;
  const filePath = gpFilePath;
  const errors = metadataErrors(gpMetadata);

  async function doWrite(dir: string, filename: string) {
    setPendingSave(null);
    setSaving(true);
    try {
      const displayedChart: YargChart = { ...gpChart, notes: displayed };
      const leadInMs = Math.round(
        tickToSeconds(gpChart.leadInTicks, gpChart.tempoMap, gpChart.resolution) * 1000,
      );
      let audio: { bytes: Uint8Array; extension: string } | undefined;
      let paddingMs = 0;
      if (audioBytes !== null && audioBuffer !== null) {
        const resolved = await resolveExportAudio({
          bytes: audioBytes,
          channels: Array.from({ length: audioBuffer.numberOfChannels }, (_, i) =>
            audioBuffer.getChannelData(i),
          ),
          sampleRate: audioBuffer.sampleRate,
          currentPaddingMs: audioPaddingMs,
          targetPaddingMs: leadInMs,
        });
        audio = { bytes: resolved.bytes, extension: resolved.extension };
        paddingMs = resolved.paddingMs;
      }
      const session = buildSessionBlob({
        gpFilePath: filePath,
        gpBytes,
        selectedTrackId: trackId,
        sessionMap: map,
        sessionSettings,
        chart: gpChart,
        warnings,
        overrides,
        deletions,
        previewRemaps,
        metadata: gpMetadata,
        audioOffsetMs,
        audioPaddingMs: paddingMs,
      });
      const bytes = writeSng(displayedChart, gpMetadata, audio, audioOffsetMs, session);
      await window.gp2sng.writeSng(dir, filename, bytes);
      setSaved(true);
      setSaveError(null);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Could not save the .sng file.');
    } finally {
      setSaving(false);
    }
  }

  async function handleSave() {
    setSaveError(null);
    let dir = saveDir.trim();
    if (dir === '') {
      const chosen = await window.gp2sng.chooseOutputDir();
      if (chosen === null) return; // user cancelled
      dir = chosen;
      setSaveDir(chosen);
      // First save with no configured directory: persist the choice so it becomes
      // the default for every later conversion. Best-effort — a persistence failure
      // must not block this save (the value is retained in-memory).
      void setOutputDir(chosen).catch(() => {});
    }
    const filename = `${sanitizeFilename(gpMetadata.name)}.sng`;
    try {
      if (await window.gp2sng.pathExists(dir, filename)) {
        setPendingSave({ dir, filename });
        return;
      }
      await doWrite(dir, filename);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Could not save the .sng file.');
    }
  }

  const filenamePreview = `${sanitizeFilename(gpMetadata.name)}.sng`;

  return (
    <div className="finalize">
      <h1 className="view-title">Finalize</h1>
      <p className="view-hint">Review the song details and choose where to save the .sng file.</p>

      <MetadataForm metadata={gpMetadata} errors={errors} onChange={setMetadata} />

      <section className="save-section">
        <div className="save-section__dir">
          <div className="settings-label">Saving to</div>
          <div className="settings-dir">
            <input
              className="text-input"
              value={saveDir}
              placeholder="Choose an output directory"
              onChange={(e) => setSaveDir(e.target.value)}
            />
            <button
              type="button"
              className="btn"
              onClick={async () => {
                const dir = await window.gp2sng.chooseOutputDir();
                if (dir !== null) setSaveDir(dir);
              }}
            >
              Browse…
            </button>
          </div>
        </div>
        {saveError !== null && <div className="error-banner">{saveError}</div>}
      </section>

      {footerSlot !== null &&
        createPortal(
          <>
            <div
              className={`save-section__filename${saved ? ' save-section__filename--success' : ''}`}
            >
              {saved ? 'Success!' : filenamePreview}
            </div>
            {saved ? (
              <button type="button" className="btn btn--primary" onClick={() => reset()}>
                Convert Another Song
              </button>
            ) : (
              <button
                type="button"
                className="btn btn--affirmative"
                onClick={handleSave}
                disabled={!isMetadataValid(gpMetadata) || saving}
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
            )}
          </>,
          footerSlot,
        )}

      {pendingSave !== null && (
        <div className="modal-scrim">
          <div className="modal">
            <div className="modal__title">Overwrite existing file?</div>
            <p className="modal__body">
              {pendingSave.filename} already exists in this folder. Overwrite it?
            </p>
            <div className="modal__actions">
              <button type="button" className="btn" onClick={() => setPendingSave(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn--primary"
                onClick={() => doWrite(pendingSave.dir, pendingSave.filename)}
              >
                Overwrite
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
