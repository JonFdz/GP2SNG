import type { DrumDynamic } from './chart';
import type { BaseYargNote, YargNoteId } from './midi';

// A selected chart note, identified the same way overrides are (docs/DESIGN.md →
// Chart preview → Override layer): (tick, midi) survives re-conversion.
export type NoteRef = { tick: number; midi: number };

// The one-off override layer (docs/DESIGN.md → Chart preview → Override layer).
// One-off reassigns ("This note only") and the §11 collision override are modeled
// as a post-conversion layer, not mutations of the converted chart: the displayed
// chart = convert(track, sessionMap) with these overrides applied on top. A note
// is identified by (tick, midi) so an override survives re-conversion after an
// "all notes" remap.
interface NoteOverrideTarget {
  tick: number;
  midi: number;
  note: BaseYargNote; // the reassigned YARG note (lane + tom/cymbal)
}

// Current overrides store the resulting dynamic explicitly. The legacy shape is
// retained only so sessions written before explicit dynamics can keep their exact
// behavior: true forces accent, while false preserves the converted note's dynamic.
export type NoteOverride = NoteOverrideTarget &
  ({ dynamic: DrumDynamic; accented?: never } | { accented: boolean; dynamic?: never });

export type ExplicitNoteOverride = NoteOverrideTarget & { dynamic: DrumDynamic };

// Recency-stamped variants of the edit-layer entries. The stamp orders the Action
// Log newest-first (docs/DESIGN.md → Chart preview → Action Log); it lives only on
// the store's arrays, never in the pure override/deletion layer.
export type SeqOverride = NoteOverride & { seq: number };
export type SeqDeletion = NoteRef & { seq: number };

// A Preview-scoped "all notes on MIDI n" reassign. `from` is the row the MIDI held
// before its FIRST Preview remap (so undo can restore it and re-convert); `to` is
// the current target (null = unassigned).
export type PreviewRemap = {
  midi: number;
  from: YargNoteId | null;
  to: YargNoteId | null;
  seq: number;
};
