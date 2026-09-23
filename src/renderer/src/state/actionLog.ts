import { splitYargNoteId } from '../../../shared/midi/index';
import type {
  BaseYargNote,
  DrumDynamic,
  PreviewRemap,
  SeqDeletion,
  SeqOverride,
} from '../../../shared/types/index';

// One row of the Preview Action Log (docs/DESIGN.md → Chart preview → Action Log).
// A live view of an active edit, not a historical event: reassign/delete rows are
// keyed to a note (with its played bar), global rows to a MIDI number.
export type LoggedAction =
  | ({
      kind: 'reassign';
      seq: number;
      tick: number;
      midi: number;
      bar: number;
      note: BaseYargNote;
    } & ({ dynamic: DrumDynamic; accented?: never } | { accented: boolean; dynamic?: never }))
  | { kind: 'delete'; seq: number; tick: number; midi: number; bar: number }
  | { kind: 'globalReassign'; seq: number; midi: number; note: BaseYargNote; accented: boolean }
  | { kind: 'globalUnassign'; seq: number; midi: number };

export interface ActionLogInput {
  overrides: readonly SeqOverride[];
  deletions: readonly SeqDeletion[];
  previewRemaps: readonly PreviewRemap[];
  barStarts: readonly number[]; // played-bar start ticks, ascending (playedBars order)
}

// The 1-based played (song) bar for a tick: the count of song-bar starts at or before
// it. barStarts holds the song bars only, beginning at the lead-in offset, so a note
// that flams back into the lead-in (tick < the first song bar) counts zero; clamp to 1,
// since such an ornament belongs to the song's first bar.
function playedBarOf(barStarts: readonly number[], tick: number): number {
  let n = 0;
  for (const start of barStarts) {
    if (start <= tick) n++;
    else break;
  }
  return Math.max(1, n);
}

// Derive the ordered log from the current edit layers. Deletions supersede a
// coincident override (one row per edited note). Rows sort by descending tick;
// global "all notes" rows have no tick (song-wide) and float to the top, with
// recency (newest first) breaking ties and ordering the global rows among themselves.
export function buildActionLog({
  overrides,
  deletions,
  previewRemaps,
  barStarts,
}: ActionLogInput): LoggedAction[] {
  const rows: LoggedAction[] = [];
  const deletedKeys = new Set(deletions.map((d) => `${d.tick}:${d.midi}`));

  for (const d of deletions) {
    rows.push({
      kind: 'delete',
      seq: d.seq,
      tick: d.tick,
      midi: d.midi,
      bar: playedBarOf(barStarts, d.tick),
    });
  }
  for (const o of overrides) {
    if (deletedKeys.has(`${o.tick}:${o.midi}`)) continue; // deletion wins for display + undo
    rows.push({
      kind: 'reassign',
      seq: o.seq,
      tick: o.tick,
      midi: o.midi,
      bar: playedBarOf(barStarts, o.tick),
      note: o.note,
      ...(o.dynamic !== undefined ? { dynamic: o.dynamic } : { accented: o.accented }),
    });
  }
  for (const r of previewRemaps) {
    if (r.to === null) {
      rows.push({ kind: 'globalUnassign', seq: r.seq, midi: r.midi });
    } else {
      const { note, accented } = splitYargNoteId(r.to);
      rows.push({ kind: 'globalReassign', seq: r.seq, midi: r.midi, note, accented });
    }
  }
  const sortTick = (a: LoggedAction): number =>
    a.kind === 'reassign' || a.kind === 'delete' ? a.tick : Number.POSITIVE_INFINITY;
  return rows.sort((a, b) => {
    const ta = sortTick(a);
    const tb = sortTick(b);
    if (ta !== tb) return tb - ta; // descending tick; global (Infinity) floats to the top
    return b.seq - a.seq; // tie-break: newest first
  });
}
