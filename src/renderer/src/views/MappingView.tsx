import { Fragment, useEffect } from 'react';
import { detectOverlaps } from '../../../shared/convert/index';
import { MidiMapView } from '../components/MidiMapView';
import { MidiTag } from '../components/MidiTag';
import { combineOverlaps } from '../state/combineOverlaps';
import { useSettingsStore } from '../state/settingsStore';
import { trackMidiNumbers } from '../state/trackMidiNumbers';
import { useWizardStore } from '../state/wizardStore';

// Mapping step (FUNCTIONALITY steps 8-11): the shared MidiMapView over a session
// map, wrapped with the three-hand-note overlap warnings (docs/DESIGN.md → MIDI map
// component → What this component does not own). The "Confirm" action lives in the
// wizard footer (WizardShell), which runs the conversion and, if the session map
// was edited, offers to promote it to the global map (§10).
export function MappingView() {
  const score = useWizardStore((s) => s.score);
  const selectedTrackIds = useWizardStore((s) => s.selectedTrackIds);
  const sessionMap = useWizardStore((s) => s.sessionMap);
  const sessionSettings = useWizardStore((s) => s.sessionSettings);
  const startSession = useWizardStore((s) => s.startSession);
  const setSessionMap = useWizardStore((s) => s.setSessionMap);
  const setSessionSettings = useWizardStore((s) => s.setSessionSettings);

  const globalMap = useSettingsStore((s) => s.globalMap);
  const conversionSettings = useSettingsStore((s) => s.conversionSettings);

  // Clone the global map into the session on first entry (docs/DESIGN.md → data flow).
  useEffect(() => {
    if (sessionMap === null) startSession(globalMap, conversionSettings);
  }, [sessionMap, startSession, globalMap, conversionSettings]);

  const selectedTracks = score?.tracks.filter((track) => selectedTrackIds.includes(track.id));
  if (score === null || selectedTracks === undefined || selectedTracks.length === 0) return null;

  const activeMap = sessionMap ?? globalMap;
  const displayNumbers = trackMidiNumbers(selectedTracks);
  const overlaps = detectOverlaps(selectedTracks, activeMap);
  const combinedOverlaps = combineOverlaps(overlaps);

  return (
    <div>
      <h1 className="view-title">Verify MIDI mapping</h1>

      {combinedOverlaps.length > 0 && (
        <section className="settings-section">
          <div className="settings-label">Issues</div>
          <p className="view-hint">
            {combinedOverlaps.length} issue{combinedOverlaps.length === 1 ? '' : 's'} found during
            the mapping. You can either attempt to address them here by remapping MIDI notes if
            possible, or you can address them manually in the following Preview section.
          </p>
          <div className="overlap-warnings">
            {combinedOverlaps.map((o) => (
              <div key={o.midi.join(',')} className="overlap-warning">
                <span className="warning-icon">⚠</span>
                <span className="warning-text">
                  MIDI notes{' '}
                  {o.midi.map((m, i) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: fixed list, midi values may repeat
                    <Fragment key={i}>
                      {i > 0 && ', '}
                      <MidiTag midi={m} />
                    </Fragment>
                  ))}{' '}
                  overlap on bar{o.bars.length === 1 ? '' : 's'} {o.bars.join(', ')}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="settings-section">
        <div className="settings-label">Settings</div>
        <p className="view-hint">
          Confirm how the selected tracks' MIDI notes map to YARG gems. Drag MIDI notes between YARG
          gems to change how they are mapped. Changes here apply to this song only unless you choose
          to update the global map (you will be prompted).
        </p>
        <MidiMapView
          map={activeMap}
          displayNumbers={displayNumbers}
          bucketLabel="Unmapped"
          onChange={setSessionMap}
          settings={sessionSettings}
          onSettingsChange={setSessionSettings}
        />
      </section>
    </div>
  );
}
