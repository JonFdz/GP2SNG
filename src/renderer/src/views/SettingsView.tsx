import { useEffect, useState } from 'react';
import { STANDARD_DRUM_MIDI_NUMBERS } from '../../../shared/midi/index';
import type { ConversionSettings, MidiMap } from '../../../shared/types/index';
import { MidiMapView } from '../components/MidiMapView';
import { useSettingsStore } from '../state/settingsStore';

// Settings tab (docs/DESIGN.md → UI top-level structure → Settings tab): the
// persisted output directory and the global MIDI Map. Both are cross-session
// config; every change writes through to disk immediately over IPC.
export function SettingsView() {
  const outputDir = useSettingsStore((s) => s.outputDir);
  const globalMap = useSettingsStore((s) => s.globalMap);
  const conversionSettings = useSettingsStore((s) => s.conversionSettings);
  const setOutputDir = useSettingsStore((s) => s.setOutputDir);
  const setGlobalMap = useSettingsStore((s) => s.setGlobalMap);
  const setConversionSettings = useSettingsStore((s) => s.setConversionSettings);
  const resetToDefaults = useSettingsStore((s) => s.resetToDefaults);

  const [dirDraft, setDirDraft] = useState(outputDir ?? '');
  const [dirError, setDirError] = useState(false);
  const [settingsError, setSettingsError] = useState(false);
  const [mapError, setMapError] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [resetError, setResetError] = useState(false);

  // Keep the editable field in sync when the store hydrates or changes elsewhere.
  useEffect(() => setDirDraft(outputDir ?? ''), [outputDir]);

  async function persistDir(dir: string | null) {
    try {
      await setOutputDir(dir);
      setDirError(false);
    } catch {
      setDirError(true); // in-memory value retained; offer a retry
    }
  }

  function commitDir() {
    const trimmed = dirDraft.trim();
    const value = trimmed === '' ? null : trimmed;
    if (value !== outputDir) persistDir(value);
  }

  async function browse() {
    const dir = await window.gp2sng.chooseOutputDir();
    if (dir === null) return; // cancelled
    setDirDraft(dir);
    persistDir(dir);
  }

  async function persistSettings(next: ConversionSettings) {
    try {
      await setConversionSettings(next);
      setSettingsError(false);
    } catch {
      setSettingsError(true); // in-memory value retained; offer a retry
    }
  }

  async function persistMap(next: MidiMap) {
    try {
      await setGlobalMap(next);
      setMapError(false);
    } catch {
      setMapError(true); // in-memory value retained; offer a retry
    }
  }

  async function persistReset() {
    try {
      await resetToDefaults();
      setResetError(false);
    } catch {
      setResetError(true); // in-memory reset retained; offer a retry
    }
    setShowResetConfirm(false);
  }

  // Global call site (docs/DESIGN.md → MIDI map component): the standard drum
  // numbers plus anything the map already holds; leftover cards land in "Unused".
  const displayNumbers = [
    ...new Set([...STANDARD_DRUM_MIDI_NUMBERS, ...Object.values(globalMap).flat()]),
  ];

  return (
    <div>
      <h1 className="view-title">Settings</h1>

      <section className="settings-section">
        <div className="settings-label">Output directory</div>
        <p className="view-hint">Where generated .sng files are saved by default.</p>
        <div className="settings-dir">
          <input
            className="text-input"
            value={dirDraft}
            placeholder="No output directory chosen"
            onChange={(e) => setDirDraft(e.target.value)}
            onBlur={commitDir}
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          />
          <button type="button" className="btn" onClick={browse}>
            Browse…
          </button>
        </div>
        {dirError && (
          <div className="error-banner error-banner--inline">
            Could not save the output directory.
            <button type="button" className="btn btn--small" onClick={() => persistDir(outputDir)}>
              Retry
            </button>
          </div>
        )}
      </section>

      <section className="settings-section">
        <div className="settings-label">Global MIDI map</div>
        <p className="view-hint">
          Drag MIDI notes between YARG gems to change how they are mapped. Changes are saved
          automatically.
        </p>
        {mapError && (
          <div className="error-banner error-banner--inline">
            Could not save the MIDI map.
            <button type="button" className="btn btn--small" onClick={() => persistMap(globalMap)}>
              Retry
            </button>
          </div>
        )}
        <MidiMapView
          map={globalMap}
          displayNumbers={displayNumbers}
          bucketLabel="Unused"
          onChange={persistMap}
          settings={conversionSettings}
          onSettingsChange={persistSettings}
        />
        {settingsError && (
          <div className="error-banner error-banner--inline">
            Could not save the settings.
            <button
              type="button"
              className="btn btn--small"
              onClick={() => persistSettings(conversionSettings)}
            >
              Retry
            </button>
          </div>
        )}
      </section>

      <section className="settings-section">
        <button
          type="button"
          className="btn btn--destructive"
          onClick={() => setShowResetConfirm(true)}
        >
          Reset to Defaults
        </button>
        {resetError && (
          <div className="error-banner error-banner--inline">
            Could not reset settings.
            <button type="button" className="btn btn--small" onClick={persistReset}>
              Retry
            </button>
          </div>
        )}
      </section>

      {showResetConfirm && (
        <div className="modal-scrim">
          <div className="modal">
            <div className="modal__title">Reset all settings?</div>
            <p className="modal__body">
              This restores the default MIDI map, ghost-note, cymbal, and grace-note settings. Your
              output directory is kept. This can’t be undone.
            </p>
            <div className="modal__actions">
              <button type="button" className="btn" onClick={() => setShowResetConfirm(false)}>
                Cancel
              </button>
              <button type="button" className="btn btn--destructive" onClick={persistReset}>
                Reset
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
