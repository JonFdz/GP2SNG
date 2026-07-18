import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { STANDARD_DRUM_MIDI_NAMES } from '../../../shared/midi/index';
import type { BaseYargNote, YargNote, YargNoteId } from '../../../shared/types/index';
import { YargNoteSwatch } from './YargNoteSwatch';

// The gem context menu (docs/DESIGN.md → Chart preview → Selection, hover &
// reassign). Raised by clicking a gem on the highway; reassigns or deletes it.

export type ReassignScope = 'one' | 'all';

interface GemContextMenuProps {
  note: YargNote; // the displayed target gem
  x: number; // client X of the click
  y: number; // client Y of the click
  onReassign: (target: YargNoteId | null, scope: ReassignScope) => void;
  onClose: () => void;
}

// The 15 reassign targets in grid order (4 columns, filled row-major): pads,
// accented pads, orange+cymbals, blank+accented-cymbals. The blank spacer is the
// 4th cell so `yellowTom` starts row 2.
const PICKER_TARGETS: { id: YargNoteId; note: BaseYargNote; accented: boolean }[] = [
  { id: 'red', note: 'red', accented: false },
  { id: 'redAccented', note: 'red', accented: true },
  { id: 'orange', note: 'orange', accented: false },
  // (row 1, col 4 is a blank spacer — inserted in the JSX, not this list)
  { id: 'yellowTom', note: 'yellowTom', accented: false },
  { id: 'yellowTomAccented', note: 'yellowTom', accented: true },
  { id: 'yellowCymbal', note: 'yellowCymbal', accented: false },
  { id: 'yellowCymbalAccented', note: 'yellowCymbal', accented: true },
  { id: 'blueTom', note: 'blueTom', accented: false },
  { id: 'blueTomAccented', note: 'blueTom', accented: true },
  { id: 'blueCymbal', note: 'blueCymbal', accented: false },
  { id: 'blueCymbalAccented', note: 'blueCymbal', accented: true },
  { id: 'greenTom', note: 'greenTom', accented: false },
  { id: 'greenTomAccented', note: 'greenTom', accented: true },
  { id: 'greenCymbal', note: 'greenCymbal', accented: false },
  { id: 'greenCymbalAccented', note: 'greenCymbal', accented: true },
];

const MENU_MARGIN = 8; // keep the menu this far inside the viewport edges

export function GemContextMenu({ note, x, y, onReassign, onClose }: GemContextMenuProps) {
  const [scope, setScope] = useState<ReassignScope>('one');
  const [pos, setPos] = useState({ left: x, top: y });
  const rootRef = useRef<HTMLDivElement>(null);

  // Latest onClose for the once-attached document listeners.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Clamp the menu inside the viewport.
  useLayoutEffect(() => {
    const el = rootRef.current;
    if (el === null) return;
    const { width, height } = el.getBoundingClientRect();
    const left = Math.min(x, window.innerWidth - width - MENU_MARGIN);
    const top = Math.min(y, window.innerHeight - height - MENU_MARGIN);
    setPos({ left: Math.max(MENU_MARGIN, left), top: Math.max(MENU_MARGIN, top) });
  }, [x, y]);

  // Close on Escape or a click outside the menu (attached once; reads latest
  // onClose via the ref).
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (rootRef.current !== null && !rootRef.current.contains(e.target as Node)) {
        onCloseRef.current();
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  // The title mirrors the hover tooltip: "Editing {midi} — {GM name}", or just the number.
  const gmName = STANDARD_DRUM_MIDI_NAMES[note.midi];
  const title = gmName ? `Editing ${note.midi} — ${gmName}` : `Editing ${note.midi}`;

  return (
    <div ref={rootRef} className="gem-menu" style={{ left: pos.left, top: pos.top }}>
      <div className="gem-menu__header">
        <span className="gem-menu__title">{title}</span>
        <button type="button" className="gem-menu__close" onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>

      <div className="gem-menu__reassign">
        <div className="gem-menu__scope">
          <label>
            <input
              type="radio"
              name="gem-menu-scope"
              checked={scope === 'one'}
              onChange={() => setScope('one')}
            />
            This note only
          </label>
          <label>
            <input
              type="radio"
              name="gem-menu-scope"
              checked={scope === 'all'}
              onChange={() => setScope('all')}
            />
            All notes on MIDI {note.midi}
          </label>
        </div>

        <div className="gem-menu__grid">
          {PICKER_TARGETS.map((t, i) => (
            <Fragment key={t.id}>
              {i === 3 && <div className="gem-menu__spacer" aria-hidden="true" />}
              <button
                type="button"
                className="gem-menu__target"
                aria-label={t.id}
                onClick={() => {
                  onReassign(t.id, scope);
                  onClose();
                }}
              >
                <YargNoteSwatch note={t.note} accented={t.accented} />
              </button>
            </Fragment>
          ))}
        </div>

        <button
          type="button"
          className="btn btn--destructive gem-menu__action-btn"
          onClick={() => {
            onReassign(null, scope);
            onClose();
          }}
        >
          Delete gem
        </button>
      </div>
    </div>
  );
}
