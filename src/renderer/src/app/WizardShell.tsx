import { Fragment, useEffect, useRef, useState } from 'react';
import { convertToYargChart } from '../../../shared/convert/index';
import { useSettingsStore } from '../state/settingsStore';
import { useChartErrors } from '../state/useChartErrors';
import {
  canAdvance,
  useWizardStore,
  type WizardState,
  type WizardStep,
} from '../state/wizardStore';
import { FinalizeView } from '../views/FinalizeView';
import { LoadView } from '../views/LoadView';
import { MappingView } from '../views/MappingView';
import { PreviewView } from '../views/PreviewView';

const STEPS: readonly { id: WizardStep; label: string }[] = [
  { id: 'load', label: 'Load' },
  { id: 'mapping', label: 'Mapping' },
  { id: 'preview', label: 'Preview' },
  { id: 'finalize', label: 'Finalize' },
];

function stepClass(index: number, current: number, reachable: boolean): string {
  if (index === current) return 'progress__step progress__step--active';
  if (index < current) return 'progress__step progress__step--done';
  // Upcoming: lighter styling when the user may jump to it, dim when they cannot.
  if (reachable) return 'progress__step progress__step--reachable';
  return 'progress__step';
}

// A step is clickable only when it can render without a blank screen: Load/Mapping
// once selected tracks contain notes, Preview/Finalize once Confirm mapping has
// produced the chart (both early-return blank without it).
function stepReachable(
  id: WizardStep,
  score: WizardState['score'],
  selectedTrackIds: WizardState['selectedTrackIds'],
  chart: WizardState['chart'],
  hasErrors: boolean,
  hasAudio: boolean,
): boolean {
  switch (id) {
    case 'load':
      return score !== null;
    case 'mapping':
      return canAdvance('load', score, selectedTrackIds);
    case 'preview':
      return chart !== null;
    default: // 'finalize'
      // Audio is required (YARG refuses to play a stem-less .sng), so Finalize is
      // unreachable without it — mirrors the Preview → Next gate below.
      return chart !== null && !hasErrors && hasAudio;
  }
}

// The Convert-tab wizard (docs/DESIGN.md → UI top-level structure): a
// Load → Mapping → Preview → Finalize progress indicator (reachable steps are
// clickable), the current step's view, and an always-visible Back/primary footer.
// The footer is the wizard's single action bar: its primary button is Next on
// Load/Preview and Confirm on Mapping (which runs the conversion and, if the
// session map was edited, offers to promote it to the global map — §10). Finalize
// has no shell-owned primary; instead FinalizeView portals its own Save (and the
// output filename) into the footer's right slot beside Back.
export function WizardShell() {
  const step = useWizardStore((s) => s.step);
  const score = useWizardStore((s) => s.score);
  const selectedTrackIds = useWizardStore((s) => s.selectedTrackIds);
  const chart = useWizardStore((s) => s.chart);
  const audioBytes = useWizardStore((s) => s.audioBytes);
  const sessionMap = useWizardStore((s) => s.sessionMap);
  const mapDirty = useWizardStore((s) => s.mapDirty);
  const settingsDirty = useWizardStore((s) => s.settingsDirty);
  const sessionSettings = useWizardStore((s) => s.sessionSettings);
  const setConversion = useWizardStore((s) => s.setConversion);
  const goNext = useWizardStore((s) => s.goNext);
  const goBack = useWizardStore((s) => s.goBack);
  const goToStep = useWizardStore((s) => s.goToStep);

  const globalMap = useSettingsStore((s) => s.globalMap);
  const setGlobalMap = useSettingsStore((s) => s.setGlobalMap);
  const setConversionSettings = useSettingsStore((s) => s.setConversionSettings);

  const errors = useChartErrors();
  const hasErrors = errors.length > 0;
  const hasAudio = audioBytes !== null;

  const [showPrompt, setShowPrompt] = useState(false);
  const [promptError, setPromptError] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  // The footer node FinalizeView portals its Save action into (see below).
  const [finalizeFooter, setFinalizeFooter] = useState<HTMLDivElement | null>(null);

  // The wizard body is its own scroll region (the footer stays pinned); reset it to
  // the top on every step change so a new view never opens mid-scroll.
  const bodyRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bodyRef.current?.scrollTo({ top: 0 });
    // Confirm-flow state is Mapping-only; drop any lingering prompt/error on leaving.
    if (step !== 'mapping') {
      setShowPrompt(false);
      setPromptError(false);
      setConfirmError(null);
    }
  }, [step]);

  const currentIndex = STEPS.findIndex((s) => s.id === step);

  function handleConfirm() {
    if (score === null || selectedTrackIds.length === 0) return;
    setConfirmError(null);
    const activeMap = sessionMap ?? globalMap;
    try {
      const { chart: newChart, warnings } = convertToYargChart(
        score,
        selectedTrackIds,
        activeMap,
        sessionSettings,
      );
      setConversion(newChart, warnings);
      if (mapDirty || settingsDirty) setShowPrompt(true);
      else goNext();
    } catch (e) {
      setConfirmError(e instanceof Error ? e.message : 'Conversion failed.');
    }
  }

  async function updateGlobalYes() {
    const activeMap = sessionMap ?? globalMap;
    try {
      if (mapDirty) await setGlobalMap(activeMap);
      if (settingsDirty) await setConversionSettings(sessionSettings);
      setShowPrompt(false);
      goNext();
    } catch {
      setPromptError(true); // keep the prompt open; the in-memory values are retained
    }
  }

  function updateGlobalNo() {
    setShowPrompt(false);
    goNext();
  }

  // The footer's primary action per step. Mapping confirms; Load/Preview advance;
  // Finalize has none — FinalizeView portals its own Save into the footer slot.
  const primary =
    step === 'mapping'
      ? { label: 'Confirm', onClick: handleConfirm, disabled: false }
      : step === 'load' || step === 'preview'
        ? {
            label: 'Next',
            onClick: goNext,
            disabled:
              !canAdvance(step, score, selectedTrackIds) ||
              (step === 'preview' && (hasErrors || !hasAudio)),
          }
        : null;

  // Red text shown just left of the primary button. Only the Mapping confirm error
  // now — Preview surfaces blocking errors in its own sidebar Errors section, and the
  // missing-audio requirement in its transport note, so the footer stays quiet there.
  const footerMsg = step === 'mapping' && confirmError !== null ? confirmError : null;

  return (
    <div className="wizard">
      <ol className="progress">
        {STEPS.map((s, i) => {
          const reachable = stepReachable(
            s.id,
            score,
            selectedTrackIds,
            chart,
            hasErrors,
            hasAudio,
          );
          return (
            <Fragment key={s.id}>
              {i > 0 && <li className="progress__line" aria-hidden="true" />}
              <li className={stepClass(i, currentIndex, reachable)}>
                {reachable && i !== currentIndex ? (
                  <button
                    type="button"
                    className="progress__step-link"
                    onClick={() => goToStep(s.id)}
                  >
                    <span className="progress__dot" />
                    <span>{s.label}</span>
                  </button>
                ) : (
                  <>
                    <span className="progress__dot" />
                    <span>{s.label}</span>
                  </>
                )}
              </li>
            </Fragment>
          );
        })}
      </ol>

      <div className="wizard__body" ref={bodyRef}>
        {step === 'load' && <LoadView />}
        {step === 'mapping' && <MappingView />}
        {step === 'preview' && <PreviewView />}
        {step === 'finalize' && <FinalizeView footerSlot={finalizeFooter} />}
      </div>

      <div className="wizard__footer">
        <button type="button" className="btn" onClick={goBack} disabled={currentIndex === 0}>
          Back
        </button>
        <div className="wizard__footer-right">
          {footerMsg !== null && (
            <span className="wizard__footer-msg" role="alert">
              {footerMsg}
            </span>
          )}
          {primary !== null && (
            <button
              type="button"
              className="btn btn--primary"
              onClick={primary.onClick}
              disabled={primary.disabled}
            >
              {primary.label}
            </button>
          )}
          {step === 'finalize' && (
            <div className="finalize-footer-actions" ref={setFinalizeFooter} />
          )}
        </div>
      </div>

      {showPrompt && (
        <div className="modal-scrim">
          <div className="modal">
            <div className="modal__title">Update global MIDI map?</div>
            <p className="modal__body">
              You changed the mapping settings for this song. Apply these changes to the global map
              for future conversions too?
            </p>
            {promptError && (
              <div className="error-banner error-banner--inline">
                Could not save the global map. Try again, or keep the change for this song only.
              </div>
            )}
            <div className="modal__actions">
              <button type="button" className="btn" onClick={updateGlobalYes}>
                Yes, update global map
              </button>
              {/* "No" is the default (docs/INTRO.md FUNCTIONALITY §10): styled primary. */}
              <button type="button" className="btn btn--primary" onClick={updateGlobalNo}>
                No, this song only
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
