import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { STANDARD_DRUM_MIDI_NAMES } from '../../../shared/midi/index';
import type { BaseYargNote, DrumDynamic, YargNote } from '../../../shared/types/index';
import { YargNoteSwatch, yargNoteLabel } from './YargNoteSwatch';

// The gem context menu (docs/DESIGN.md → Chart preview → Selection, hover &
// reassign). Raised by clicking a gem on the highway; reassigns or deletes it.

interface GemContextMenuProps {
  note: YargNote; // the displayed target gem
  x: number; // client X of the click
  y: number; // client Y of the click
  onEdit: (note: BaseYargNote, dynamic: DrumDynamic) => void;
  onDelete: () => void;
  onClose: () => void;
}

const LANE_TARGETS: BaseYargNote[] = [
  'red',
  'orange',
  'yellowTom',
  'yellowCymbal',
  'blueTom',
  'blueCymbal',
  'greenTom',
  'greenCymbal',
];

const DYNAMIC_TARGETS: { dynamic: DrumDynamic; label: string }[] = [
  { dynamic: 'neutral', label: 'Normal' },
  { dynamic: 'ghost', label: 'Ghost' },
  { dynamic: 'accent', label: 'Accent' },
];

export function selectLane(
  current: Pick<YargNote, 'note' | 'dynamic'>,
  note: BaseYargNote,
): Pick<YargNote, 'note' | 'dynamic'> {
  return { note, dynamic: note === 'orange' ? 'neutral' : current.dynamic };
}

export function selectDynamic(
  current: Pick<YargNote, 'note' | 'dynamic'>,
  dynamic: DrumDynamic,
): Pick<YargNote, 'note' | 'dynamic'> | null {
  if (current.note === 'orange' && dynamic !== 'neutral') return null;
  return { note: current.note, dynamic };
}

interface GemMenuEditorProps {
  note: YargNote;
  onEdit: (note: BaseYargNote, dynamic: DrumDynamic) => void;
  onDelete: () => void;
  onClose: () => void;
}

export function GemMenuEditor({ note, onEdit, onDelete, onClose }: GemMenuEditorProps) {
  return (
    <div className="gem-menu__reassign">
      <div className="settings-label">Lane</div>
      <div className="gem-menu__grid">
        {LANE_TARGETS.map((target) => (
          <button
            key={target}
            type="button"
            className={`gem-menu__target${note.note === target ? ' gem-menu__target--selected' : ''}`}
            aria-label={yargNoteLabel(target)}
            aria-pressed={note.note === target}
            title={yargNoteLabel(target)}
            onClick={() => {
              const selected = selectLane(note, target);
              onEdit(selected.note, selected.dynamic);
            }}
          >
            <YargNoteSwatch note={target} />
          </button>
        ))}
      </div>

      <div className="settings-label">Dynamic</div>
      <div className="gem-menu__dynamics">
        {DYNAMIC_TARGETS.map(({ dynamic, label }) => {
          const disabled = note.note === 'orange' && dynamic !== 'neutral';
          return (
            <button
              key={dynamic}
              type="button"
              className={`gem-menu__target${note.dynamic === dynamic ? ' gem-menu__target--selected' : ''}`}
              aria-label={label}
              aria-pressed={note.dynamic === dynamic}
              title={label}
              disabled={disabled}
              onClick={() => {
                const selected = selectDynamic(note, dynamic);
                if (selected !== null) onEdit(selected.note, selected.dynamic);
              }}
            >
              <YargNoteSwatch note={note.note} dynamic={dynamic} />
            </button>
          );
        })}
      </div>

      <button
        type="button"
        className="btn btn--destructive gem-menu__action-btn"
        onClick={() => {
          onDelete();
          onClose();
        }}
      >
        Delete gem
      </button>
    </div>
  );
}

const MENU_MARGIN = 8; // keep the menu this far inside the viewport edges

export function GemContextMenu({ note, x, y, onEdit, onDelete, onClose }: GemContextMenuProps) {
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

      <GemMenuEditor note={note} onEdit={onEdit} onDelete={onDelete} onClose={onClose} />
    </div>
  );
}
