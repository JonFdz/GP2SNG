import {
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  arrayMove,
  horizontalListSortingStrategy,
  SortableContext,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useState } from 'react';
import {
  applyRemap,
  CHINA_NOTES,
  CRASH_HIGH_NOTES,
  CYMBAL_COLORS,
  type CymbalColor,
  getCymbalColor,
  isRideBellAndHiHatAccented,
  midiLabel,
  SPLASH_NOTES,
  setCymbalColor,
  setRideBellAndHiHatAccented,
} from '../../../shared/midi/index';
import {
  BASE_YARG_NOTES,
  type BaseYargNote,
  type ConversionSettings,
  type CymbalPriorities,
  type CymbalPriority,
  GRACE_NOTE_SPACINGS,
  type GraceNoteSpacing,
  type MidiMap,
  type YargNoteId,
} from '../../../shared/types/index';
import { AnchoredTooltip, anchorBottomRight } from './AnchoredTooltip';
import { HelpIcon } from './HelpIcon';
import { YargNoteSwatch, yargNoteLabel } from './YargNoteSwatch';

// Sentinel droppable id for the bottom bucket (Unused / Unmapped). Chosen so it
// can never collide with a row id (YargNoteId) or a card id (a MIDI number).
const BUCKET_ID = '__bucket__';

const GRACE_SPACING_LABEL: Record<GraceNoteSpacing, string> = { '32nd': '1/32', '64th': '1/64' };

export type MidiMapViewProps = {
  map: MidiMap; // the global map or the session map
  displayNumbers: number[]; // universe of MIDI numbers to render as cards
  bucketLabel: 'Unused' | 'Unmapped';
  onChange: (next: MidiMap) => void; // fired on every drop and accent-checkbox toggle
  settings: ConversionSettings;
  onSettingsChange: (next: ConversionSettings) => void;
};

type HoverInfo = { midi: number; x: number; y: number };

// The shared MIDI Map view (docs/DESIGN.md → MIDI map component), reused by both the
// Settings global map and the per-song Mapping step. Presentational and
// context-agnostic: the call site supplies the data and handles persistence /
// session-remap recording via `onChange`.
export function MidiMapView({
  map,
  displayNumbers,
  bucketLabel,
  onChange,
  settings,
  onSettingsChange,
}: MidiMapViewProps) {
  const [activeMidi, setActiveMidi] = useState<number | null>(null);
  const [hover, setHover] = useState<HoverInfo | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  // Placement rule (docs/DESIGN.md → MIDI map component): map-row members render in
  // their row; a displayNumber not in any row renders in the bucket. Kick shows no
  // accented row (kick carries no dynamic), so orangeAccented is excluded here too —
  // any stray number there falls to the bucket rather than vanishing.
  const inRows = new Set<number>();
  for (const id of BASE_YARG_NOTES.flatMap((n): YargNoteId[] =>
    n === 'orange' ? [n] : [n, `${n}Accented`],
  )) {
    for (const midi of map[id]) inRows.add(midi);
  }
  const bucketNumbers = [...new Set(displayNumbers)]
    .filter((n) => !inRows.has(n))
    .sort((a, b) => a - b);
  const displaySet = new Set(displayNumbers);

  function handleDragStart(e: DragStartEvent) {
    setActiveMidi(e.active.data.current?.midi as number);
    setHover(null);
  }

  function handleDragEnd(e: DragEndEvent) {
    setActiveMidi(null);
    const { active, over } = e;
    if (over === null) return; // dropped outside any zone — no change
    const midi = active.data.current?.midi as number;
    const overId = String(over.id);
    const target = overId === BUCKET_ID ? null : (overId as YargNoteId);
    onChange(applyRemap(map, midi, target));
  }

  const onHover = (midi: number, x: number, y: number) => setHover({ midi, x, y });
  const onHoverEnd = () => setHover(null);

  // Shared by both branches below so the toggle isn't duplicated: it sits inside
  // the outlined group when dynamic mapping is on, and flat in the list when off.
  const dynamicToggle = (
    <div className="setting-row">
      <label className="checkbox">
        <input
          type="checkbox"
          checked={settings.dynamicCymbalSelection}
          onChange={(e) =>
            onSettingsChange({ ...settings, dynamicCymbalSelection: e.target.checked })
          }
        />
        Enable dynamic cymbal gem mapping
      </label>
      <HelpIcon text="Rather than mapping the below cymbals to fixed colors which may overlap others during the conversion, dynamically assign them to colors based on a set priority. Priority is read left-to-right, and will use the first available color" />
    </div>
  );

  return (
    <div className="midi-map">
      <div className="midi-map__toolbar">
        <SegmentedSetting
          label="Grace note spacing"
          help="How far before the beat grace notes land, as a flam. Tighter (1/64) is more realistic; wider (1/32) is easier to read at fast tempos."
          options={GRACE_NOTE_SPACINGS}
          labelFor={(spacing) => GRACE_SPACING_LABEL[spacing]}
          value={settings.graceNoteSpacing}
          onChange={(graceNoteSpacing) => onSettingsChange({ ...settings, graceNoteSpacing })}
        />
        <label className="checkbox">
          <input
            type="checkbox"
            checked={settings.snareGhostNotes}
            onChange={(e) => onSettingsChange({ ...settings, snareGhostNotes: e.target.checked })}
          />
          Enable snare ghost notes
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={settings.snareAccentedNotes}
            onChange={(e) =>
              onSettingsChange({ ...settings, snareAccentedNotes: e.target.checked })
            }
          />
          Enable snare accented notes
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={settings.tomGhostNotes}
            onChange={(e) => onSettingsChange({ ...settings, tomGhostNotes: e.target.checked })}
          />
          Enable tom ghost notes
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={settings.tomAccentedNotes}
            onChange={(e) => onSettingsChange({ ...settings, tomAccentedNotes: e.target.checked })}
          />
          Enable tom accented notes
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={settings.cymbalGhostNotes}
            onChange={(e) => onSettingsChange({ ...settings, cymbalGhostNotes: e.target.checked })}
          />
          Enable cymbal ghost notes
        </label>
        <div className="setting-row">
          <label className="checkbox">
            <input
              type="checkbox"
              checked={settings.cymbalAccentedNotes}
              onChange={(e) =>
                onSettingsChange({ ...settings, cymbalAccentedNotes: e.target.checked })
              }
            />
            Enable cymbal accented notes
          </label>
          <HelpIcon text="Will only accent the Green cymbal if &quot;Accent ride bell &amp; open hi-hat&quot; is enabled, because Yellow and Blue accents are reserved for open hi-hat and ride bell" />
        </div>
        <div className="setting-row">
          <label className="checkbox">
            <input
              type="checkbox"
              checked={isRideBellAndHiHatAccented(map)}
              onChange={(e) => onChange(setRideBellAndHiHatAccented(map, e.target.checked))}
            />
            Accent ride bell &amp; open hi-hat
          </label>
          <HelpIcon text="Map the ride bell and open hi-hat to the accented versions of whichever color cymbal gem they are assigned to" />
        </div>
        {settings.dynamicCymbalSelection ? (
          // On: the toggle and the three fields it governs are one connected unit,
          // bound together by the shared outline (docs/DESIGN.md → MIDI map component).
          <div className="cymbal-group">
            {dynamicToggle}
            <span className="midi-map__color-label">
              Drag to reorder cymbal gem mapping priority:
            </span>
            {CYMBAL_FAMILIES.map((f) => (
              <PriorityList
                key={f.key}
                label={`${f.label} priority`}
                map={map}
                notes={f.notes}
                order={settings.cymbalPriorities[f.key]}
                onReorder={(next) => {
                  onSettingsChange({
                    ...settings,
                    cymbalPriorities: { ...settings.cymbalPriorities, [f.key]: next },
                  });
                  if (next[0] !== getCymbalColor(map, f.notes)) {
                    onChange(setCymbalColor(map, f.notes, next[0]));
                  }
                }}
              />
            ))}
          </div>
        ) : (
          // Off: the fields are independent fixed-color selectors with no shared
          // behavior, so they stay in the flat list — no grouping implied.
          <>
            {dynamicToggle}
            {CYMBAL_FAMILIES.map((f) => (
              <ColorSelect
                key={f.key}
                label={f.label}
                notes={f.notes}
                map={map}
                onChange={onChange}
              />
            ))}
          </>
        )}
      </div>

      <DndContext
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={() => setActiveMidi(null)}
      >
        <div className="midi-map__rows">
          {BASE_YARG_NOTES.map((note) => (
            <div key={note} className="midi-map__pair">
              <MapRow
                id={note}
                note={note}
                label={yargNoteLabel(note)}
                onHover={onHover}
                onHoverEnd={onHoverEnd}
                numbers={map[note].filter((n) => displaySet.has(n))}
              />
              {note !== 'orange' && (
                <MapRow
                  id={`${note}Accented`}
                  note={note}
                  label="Accent"
                  accented
                  numbers={map[`${note}Accented`].filter((n) => displaySet.has(n))}
                  onHover={onHover}
                  onHoverEnd={onHoverEnd}
                />
              )}
            </div>
          ))}
        </div>

        <Bucket
          label={bucketLabel}
          numbers={bucketNumbers}
          onHover={onHover}
          onHoverEnd={onHoverEnd}
        />

        <DragOverlay>
          {activeMidi !== null ? <CardFace midi={activeMidi} overlay /> : null}
        </DragOverlay>
      </DndContext>

      {hover !== null && activeMidi === null && (
        <AnchoredTooltip className="midi-tooltip" anchor={{ x: hover.x, y: hover.y }}>
          {midiLabel(hover.midi)}
        </AnchoredTooltip>
      )}
    </div>
  );
}

type CardHoverProps = {
  onHover: (midi: number, x: number, y: number) => void;
  onHoverEnd: () => void;
};

// A draggable MIDI card. Drag is wired through dnd-kit; the mouse handlers drive the
// custom tooltip, anchored to the card's bottom-right corner (docs/DESIGN.md → MIDI
// map component → Hover help).
function MidiCard({ midi, onHover, onHoverEnd }: { midi: number } & CardHoverProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: String(midi),
    data: { midi },
  });
  return (
    <button
      type="button"
      ref={setNodeRef}
      className={isDragging ? 'midi-card midi-card--dragging' : 'midi-card'}
      {...listeners}
      {...attributes}
      onMouseEnter={(e) => {
        const { x, y } = anchorBottomRight(e.currentTarget);
        onHover(midi, x, y);
      }}
      onMouseLeave={onHoverEnd}
    >
      {midi}
    </button>
  );
}

// The static card visual used by the drag overlay that follows the cursor.
function CardFace({ midi, overlay }: { midi: number; overlay?: boolean }) {
  return <div className={overlay ? 'midi-card midi-card--overlay' : 'midi-card'}>{midi}</div>;
}

// A labelled segmented picker for one ConversionSettings field (docs/DESIGN.md →
// MIDI map component), e.g. grace-note spacing.
function SegmentedSetting<T extends string | number>({
  label,
  help,
  options,
  labelFor,
  value,
  onChange,
}: {
  label: string;
  help: string;
  options: readonly T[];
  labelFor: (option: T) => string;
  value: T;
  onChange: (next: T) => void;
}) {
  return (
    <div className="setting-row">
      <span className="midi-map__color-label">{label}</span>
      <HelpIcon text={help} />
      <div className="segmented">
        {options.map((option) => (
          <button
            key={String(option)}
            type="button"
            className={`btn btn--small${option === value ? ' btn--primary' : ''}`}
            onClick={() => option !== value && onChange(option)}
          >
            {labelFor(option)}
          </button>
        ))}
      </div>
    </div>
  );
}

const COLOR_LABEL: Record<CymbalColor, string> = { yellow: 'Yellow', blue: 'Blue', green: 'Green' };

// The three cymbal families a dynamic-selection priority list (or single-color
// selector, when dynamic selection is off) governs (docs/DESIGN.md → MIDI map
// component → dynamic cymbal selection).
const CYMBAL_FAMILIES: readonly {
  key: keyof CymbalPriorities;
  label: string;
  notes: readonly number[];
}[] = [
  { key: 'crashHigh', label: 'High crash color', notes: CRASH_HIGH_NOTES },
  { key: 'splash', label: 'Splash color', notes: SPLASH_NOTES },
  { key: 'china', label: 'China color', notes: CHINA_NOTES },
];

// A Yellow/Blue/Green selector that relocates a physical cymbal's note family
// between the cymbal rows (docs/DESIGN.md → MIDI map component). Map-derived: the
// active color is read from the map and selecting one routes through `onChange`.
function ColorSelect({
  label,
  notes,
  map,
  onChange,
}: {
  label: string;
  notes: readonly number[];
  map: MidiMap;
  onChange: (next: MidiMap) => void;
}) {
  const current = getCymbalColor(map, notes);
  return (
    <div className="midi-map__color">
      <span className="midi-map__color-label">{label}</span>
      <div className="segmented">
        {CYMBAL_COLORS.map((color) => (
          <button
            key={color}
            type="button"
            className={`btn btn--small cymbal-chip cymbal-chip--${color}${color === current ? ' cymbal-chip--active' : ''}`}
            onClick={() => color !== current && onChange(setCymbalColor(map, notes, color))}
          >
            {COLOR_LABEL[color]}
          </button>
        ))}
      </div>
    </div>
  );
}

// A single drag-reorder chip within a cymbal family's priority list (docs/DESIGN.md
// → MIDI map component → dynamic cymbal selection). Sortable via dnd-kit; every chip
// shows its YARG lane color — all three are active mappings, distinguished only by
// order — and the leftmost is the highest-priority (preferred) color.
function PriorityChip({ color }: { color: CymbalColor }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: color,
  });
  return (
    <button
      type="button"
      ref={setNodeRef}
      className={`btn btn--small cymbal-chip cymbal-chip--${color} cymbal-chip--active`}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
      }}
      {...attributes}
      {...listeners}
    >
      {COLOR_LABEL[color]}
    </button>
  );
}

// A drag-reorder priority list for one cymbal family (docs/DESIGN.md → MIDI map
// component → dynamic cymbal selection). The map's current color always renders
// first regardless of stored order — `onReorder` is invoked with the map color
// included so a drag both records the priority and (if it changed the leading
// color) relocates the family in the map via `onChange` upstream.
function PriorityList({
  label,
  map,
  notes,
  order,
  onReorder,
}: {
  label: string;
  map: MidiMap;
  notes: readonly number[];
  order: CymbalPriority;
  onReorder: (next: CymbalPriority) => void;
}) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  const mapColor = getCymbalColor(map, notes);
  const displayOrder = [mapColor, ...order.filter((c) => c !== mapColor)] as CymbalColor[];
  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (over === null || active.id === over.id) return;
    const from = displayOrder.indexOf(active.id as CymbalColor);
    const to = displayOrder.indexOf(over.id as CymbalColor);
    onReorder(arrayMove(displayOrder, from, to) as unknown as CymbalPriority);
  }
  return (
    <div className="midi-map__color">
      <span className="midi-map__color-label">{label}</span>
      <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
        <SortableContext items={displayOrder} strategy={horizontalListSortingStrategy}>
          <div className="segmented cymbal-priority">
            {displayOrder.map((color) => (
              <PriorityChip key={color} color={color} />
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  );
}

type RowProps = CardHoverProps & {
  id: YargNoteId;
  note: BaseYargNote;
  label: string;
  numbers: number[];
  accented?: boolean;
};

function MapRow({ id, note, label, numbers, accented, onHover, onHoverEnd }: RowProps) {
  const { setNodeRef, isOver } = useDroppable({ id });
  const cls = ['midi-row', accented ? 'midi-row--accented' : '', isOver ? 'midi-row--over' : '']
    .filter(Boolean)
    .join(' ');
  return (
    <div className={cls}>
      <div className="midi-row__label">
        <YargNoteSwatch note={note} accented={accented} />
        <span>{label}</span>
      </div>
      <div ref={setNodeRef} className="midi-row__zone">
        {numbers.map((midi) => (
          <MidiCard key={midi} midi={midi} onHover={onHover} onHoverEnd={onHoverEnd} />
        ))}
      </div>
    </div>
  );
}

function Bucket({
  label,
  numbers,
  onHover,
  onHoverEnd,
}: { label: string; numbers: number[] } & CardHoverProps) {
  const { setNodeRef, isOver } = useDroppable({ id: BUCKET_ID });
  return (
    <div className={isOver ? 'midi-bucket midi-bucket--over' : 'midi-bucket'}>
      <div className="midi-bucket__label">{label}</div>
      <div ref={setNodeRef} className="midi-bucket__zone">
        {numbers.map((midi) => (
          <MidiCard key={midi} midi={midi} onHover={onHover} onHoverEnd={onHoverEnd} />
        ))}
      </div>
    </div>
  );
}
