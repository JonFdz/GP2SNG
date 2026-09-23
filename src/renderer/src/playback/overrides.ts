import type { NoteOverride, YargNote } from '../../../shared/types/index';

function key(tick: number, midi: number): string {
  return `${tick}:${midi}`;
}

// Apply the override list to freshly converted notes, producing the displayed
// notes. Pure: returns a new array and never mutates the input.
export function applyOverrides(notes: YargNote[], overrides: NoteOverride[]): YargNote[] {
  if (overrides.length === 0) return notes.map((n) => ({ ...n }));
  const byKey = new Map<string, NoteOverride>();
  for (const ov of overrides) byKey.set(key(ov.tick, ov.midi), ov);
  return notes.map((n) => {
    const ov = byKey.get(key(n.tick, n.midi));
    if (!ov) return { ...n };
    const dynamic =
      ov.note === 'orange'
        ? 'neutral'
        : ov.dynamic !== undefined
          ? ov.dynamic
          : ov.accented
            ? 'accent'
            : n.dynamic;
    return { ...n, note: ov.note, dynamic };
  });
}

// A deletion removes a note from the displayed chart entirely. Like NoteOverride,
// it is keyed by (tick, midi), including across re-conversion when undoing a legacy
// Preview remap. Pure: returns a new array and never mutates it.
export function applyDeletions(
  notes: YargNote[],
  deletions: readonly { tick: number; midi: number }[],
): YargNote[] {
  if (deletions.length === 0) return notes;
  const gone = new Set(deletions.map((d) => key(d.tick, d.midi)));
  return notes.filter((n) => !gone.has(key(n.tick, n.midi)));
}

// The displayed chart notes: conversion output with one-off overrides applied,
// then deletions removed. The single source of truth for "what the user sees and
// saves", shared by the Preview view, the Finalize save, and the blocking-error
// hook so all three agree.
export function displayedNotes(
  notes: YargNote[],
  overrides: NoteOverride[],
  deletions: readonly { tick: number; midi: number }[],
): YargNote[] {
  return applyDeletions(applyOverrides(notes, overrides), deletions);
}
