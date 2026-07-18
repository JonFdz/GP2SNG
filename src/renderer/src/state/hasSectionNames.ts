import type { GpMasterBar } from '../../../shared/types/index';

// Whether the score defines any named section. A section counts only when its
// name is non-empty — the same rule the converter uses to emit `[section …]`
// events (src/shared/convert/convert.ts), so an empty <Section> node (parsed to
// '' by src/shared/gp/score.ts) is treated as no section. Drives the Load-step
// advisory that nudges the user to add sections for YARG Practice mode.
export function hasSectionNames(masterBars: GpMasterBar[]): boolean {
  return masterBars.some((mb) => mb.section !== null && mb.section !== '');
}
