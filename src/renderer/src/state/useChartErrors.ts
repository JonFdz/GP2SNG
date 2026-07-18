import { useMemo } from 'react';
import { type ChartError, detectChartErrors } from '../../../shared/convert/index';
import { displayedNotes } from '../playback/overrides';
import { useWizardStore } from './wizardStore';

// Blocking chart errors derived from the displayed (post-override, post-deletion)
// chart. Shared by the Preview dots and the WizardShell Finalize gate so both
// agree (docs spec -> Preview errors vs. warnings).
export function useChartErrors(): ChartError[] {
  const chart = useWizardStore((s) => s.chart);
  const overrides = useWizardStore((s) => s.overrides);
  const deletions = useWizardStore((s) => s.deletions);
  return useMemo(
    () =>
      chart === null ? [] : detectChartErrors(displayedNotes(chart.notes, overrides, deletions)),
    [chart, overrides, deletions],
  );
}
