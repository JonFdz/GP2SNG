// Non-halting conversion warnings (docs/DESIGN.md → Error handling → Case inventory).
export type ConversionWarningKind =
  | 'threeHandNotes' // 3+ hand notes on one beat
  | 'unmappedNotesDropped' // MIDI notes left unmapped were dropped
  | 'yargNoteCollision' // two MIDI notes on a beat map to the same YARG note
  | 'directionSignsUnsupported'; // <Directions> present; converted in naive linear order

export interface ConversionWarning {
  kind: ConversionWarningKind;
  message: string; // human-readable, ready to show in the UI
  context?: Record<string, unknown>; // structured extras (bar, midi numbers, ...)
}
