import type { LoggedAction } from '../state/actionLog';
import { YargNoteSwatch, yargNoteLabel } from './YargNoteSwatch';

interface ActionLogProps {
  actions: LoggedAction[];
  onUndo: (action: LoggedAction) => void;
}

function rowLabel(a: LoggedAction) {
  switch (a.kind) {
    case 'reassign':
      return (
        <>
          <span className="action-log__text">
            Bar {a.bar} · MIDI {a.midi} →
          </span>
          <YargNoteSwatch
            note={a.note}
            dynamic={a.dynamic}
            accented={'accented' in a ? a.accented : false}
          />
          <span className="action-log__text">{yargNoteLabel(a.note)}</span>
        </>
      );
    case 'delete':
      return (
        <span className="action-log__text">
          Bar {a.bar} · MIDI {a.midi} deleted
        </span>
      );
    case 'globalReassign':
      return (
        <>
          <span className="action-log__text">MIDI {a.midi} →</span>
          <YargNoteSwatch note={a.note} accented={a.accented} />
          <span className="action-log__text">{yargNoteLabel(a.note)} · all</span>
        </>
      );
    case 'globalUnassign':
      return <span className="action-log__text">MIDI {a.midi} unassigned · all</span>;
  }
}

// The Preview Action Log (docs/DESIGN.md → Chart preview → Action Log): a live list
// of the user's active chart edits, ordered high-to-low by bar. Each row is a
// button — hover turns it red, click undoes that edit. Purely presentational; the
// parent derives the rows (buildActionLog) and supplies the undo dispatcher.
export function ActionLog({ actions, onUndo }: ActionLogProps) {
  return (
    <section className="transport action-log">
      <div className="settings-label">Action Log</div>
      {actions.length === 0 ? (
        <p className="action-log__empty">No edits yet.</p>
      ) : (
        <>
          <p className="action-log__hint">Click any action to undo</p>
          <ul className="action-log__list">
            {actions.map((a) => (
              <li key={a.seq}>
                <button
                  type="button"
                  className="action-log__row"
                  onClick={() => onUndo(a)}
                  title="Click to undo"
                >
                  {rowLabel(a)}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
