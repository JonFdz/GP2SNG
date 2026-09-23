import type { DrumDynamic } from './chart';
import type { BaseYargNote, YargNoteId } from './midi';

// A selected chart note, identified the same way overrides are (docs/DESIGN.md →
// Chart preview → Override layer): (tick, midi) survives re-conversion.
export type NoteRef = { tick: number; midi: number };

// Preview's per-note override layer is applied on top of the raw converted chart.
// A note is identified by (tick, midi), including when reopening an older session
// whose persisted global Preview remap requires re-conversion during undo.
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

// Compatibility data from older builds that allowed global MIDI remaps in Preview.
// New Preview edits never create these entries; restored entries remain undoable.
export type PreviewRemap = {
  midi: number;
  from: YargNoteId | null;
  to: YargNoteId | null;
  seq: number;
};
