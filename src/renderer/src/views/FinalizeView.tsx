import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { tickToSeconds } from '../../../shared/convert/index';
import { writeSng } from '../../../shared/sng/index';
import type { YargChart } from '../../../shared/types/index';
import { resolveFinalizeAudio } from '../audio/index';
import { MetadataForm } from '../components/MetadataForm';
import { displayedNotes } from '../playback/overrides';
import { defaultMetadata, isMetadataValid, metadataErrors } from '../state/metadata';
import {
  automaticOutputFilenameBase,
  outputFilename,
  withoutSngExtension,
} from '../state/outputFilename';
import { buildSessionBlob } from '../state/sessionBlob';
import { useSettingsStore } from '../state/settingsStore';
import { useWizardStore } from '../state/wizardStore';

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
  const outputFilenameOverride = useWizardStore((s) => s.outputFilenameOverride);
  const audioBuffer = useWizardStore((s) => s.audioBuffer);
  const audioBytes = useWizardStore((s) => s.audioBytes);
  const audioOffsetMs = useWizardStore((s) => s.audioOffsetMs);
  const audioPaddingMs = useWizardStore((s) => s.audioPaddingMs);
  const albumArt = useWizardStore((s) => s.albumArt);
  const setMetadata = useWizardStore((s) => s.setMetadata);
  const setOutputFilenameOverride = useWizardStore((s) => s.setOutputFilenameOverride);
  const reset = useWizardStore((s) => s.reset);
  const setAlbumArt = useWizardStore((s) => s.setAlbumArt);
  const clearAlbumArt = useWizardStore((s) => s.clearAlbumArt);
  const gpFilePath = useWizardStore((s) => s.gpFilePath);
  const gpFileBytes = useWizardStore((s) => s.gpFileBytes);
  const selectedTrackIds = useWizardStore((s) => s.selectedTrackIds);
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
  const [albumArtError, setAlbumArtError] = useState<string | null>(null);
  const [albumArtLoading, setAlbumArtLoading] = useState(false);
  const [albumArtUrl, setAlbumArtUrl] = useState<string | null>(null);
  const albumArtInputRef = useRef<HTMLInputElement>(null);

  // Seed the metadata form from the parsed score on first entry.
  useEffect(() => {
    if (metadata === null && score !== null) setMetadata(defaultMetadata(score.metadata));
  }, [metadata, score, setMetadata]);

  // Keep the "Saving to" field aligned with Settings until the user overrides it.
  useEffect(() => setSaveDir(outputDir ?? ''), [outputDir]);

  useEffect(() => {
    if (albumArt === null) {
      setAlbumArtUrl(null);
      return;
    }
    const url = URL.createObjectURL(
      new Blob([Uint8Array.from(albumArt.bytes)], {
        type: albumArt.extension === 'jpg' ? 'image/jpeg' : 'image/png',
      }),
    );
    setAlbumArtUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [albumArt]);

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
    selectedTrackIds.length === 0 ||
    gpFilePath === null
  ) {
    return null;
  }
  const gpChart = chart;
  const gpMetadata = metadata;
  const gpBytes = gpFileBytes;
  const map = sessionMap;
  const trackIds = selectedTrackIds;
  const filePath = gpFilePath;
  const errors = metadataErrors(gpMetadata);
  const filenameBase =
    outputFilenameOverride ?? automaticOutputFilenameBase(gpMetadata.name, gpMetadata.artist);
  const filename = outputFilename(gpMetadata.name, gpMetadata.artist, outputFilenameOverride);
  const filenameError = outputFilenameOverride !== null && filename === null;

  async function doWrite(dir: string, filename: string) {
    setPendingSave(null);
    setSaving(true);
    try {
      const displayedChart: YargChart = { ...gpChart, notes: displayed };
      const leadInMs = Math.round(
        tickToSeconds(gpChart.leadInTicks, gpChart.tempoMap, gpChart.resolution) * 1000,
      );
      const { audio, paddingMs } = await resolveFinalizeAudio({
        audioBytes,
        audioBuffer,
        audioPaddingMs,
        leadInMs,
      });
      const session = buildSessionBlob({
        gpFilePath: filePath,
        gpBytes,
        selectedTrackIds: trackIds,
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
      const bytes = writeSng(
        displayedChart,
        gpMetadata,
        audio,
        audioOffsetMs,
        session,
        albumArt ?? undefined,
      );
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
    if (filename === null || !isMetadataValid(gpMetadata)) return;
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

  async function handleAlbumArtFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow selecting the same file after replacing or removing it
    if (file === undefined) return;
    const extension = file.name.split('.').pop()?.toLowerCase();
    if (extension !== 'png' && extension !== 'jpg' && extension !== 'jpeg') {
      setAlbumArtError('Choose a PNG or JPEG image.');
      return;
    }
    setAlbumArtLoading(true);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      setAlbumArt({ bytes, extension: extension === 'png' ? 'png' : 'jpg' });
      setAlbumArtError(null);
    } catch {
      setAlbumArtError('Could not read that image file. Pick a different file.');
    } finally {
      setAlbumArtLoading(false);
    }
  }

  return (
    <div className="finalize">
      <h1 className="view-title">Finalize</h1>
      <p className="view-hint">Review the song details and choose where to save the .sng file.</p>

      <MetadataForm metadata={gpMetadata} errors={errors} onChange={setMetadata} />

      <section className="save-section">
        <div className="save-section__dir">
          <div className="settings-label">Album artwork</div>
          <div className="album-art">
            {albumArtUrl === null ? (
              <span className="album-art__empty">No artwork selected</span>
            ) : (
              <img className="album-art__preview" src={albumArtUrl} alt="Album artwork" />
            )}
            <div className="album-art__actions">
              <button
                type="button"
                className="btn"
                onClick={() => albumArtInputRef.current?.click()}
                disabled={albumArtLoading}
              >
                {albumArt === null ? 'Choose artwork' : 'Change'}
              </button>
              {albumArt !== null && (
                <button
                  type="button"
                  className="btn btn--destructive"
                  onClick={clearAlbumArt}
                  disabled={albumArtLoading}
                >
                  Remove
                </button>
              )}
            </div>
          </div>
        </div>
        <input
          ref={albumArtInputRef}
          type="file"
          accept=".png,.jpg,.jpeg,image/png,image/jpeg"
          hidden
          onChange={handleAlbumArtFile}
        />
        {albumArtError !== null && (
          <div className="error-banner error-banner--inline">{albumArtError}</div>
        )}
      </section>

      <section className="save-section">
        <div className="save-section__dir">
          <label className="settings-label" htmlFor="output-filename">
            File name
          </label>
          <div className="save-section__filename-field">
            <div className="save-section__filename-controls">
              <input
                id="output-filename"
                className={`text-input${filenameError ? ' text-input--invalid' : ''}`}
                value={filenameBase}
                aria-invalid={filenameError}
                aria-describedby={filenameError ? 'output-filename-error' : undefined}
                onChange={(e) => setOutputFilenameOverride(withoutSngExtension(e.target.value))}
              />
              <span className="save-section__extension">.sng</span>
              <button
                type="button"
                className="btn"
                disabled={outputFilenameOverride === null}
                onClick={() => setOutputFilenameOverride(null)}
              >
                Reset
              </button>
            </div>
            {filenameError && (
              <span id="output-filename-error" className="metadata-field__error">
                File name is required
              </span>
            )}
          </div>
        </div>
      </section>

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
              {saved ? 'Success!' : (filename ?? 'Enter a valid file name')}
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
                disabled={
                  !isMetadataValid(gpMetadata) || filename === null || saving || albumArtLoading
                }
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
