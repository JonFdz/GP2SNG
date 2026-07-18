import { create } from 'zustand';
import type {
  ConversionSettings,
  ConversionWarning,
  CymbalPriorities,
  MidiMap,
  ParsedGpScore,
  SongMetadata,
  YargChart,
  YargNoteId,
} from '../../../shared/types/index';
import { DEFAULT_CONVERSION_SETTINGS, YARG_NOTE_IDS } from '../../../shared/types/index';
import type { NoteOverride } from '../playback/overrides';
import { detectDrumTrack } from './detectDrumTrack';

// A selected chart note, identified the same way overrides are (docs/DESIGN.md →
// Chart preview → Override layer): (tick, midi) survives re-conversion.
export type NoteRef = { tick: number; midi: number };

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

// Default highway scroll speed in px/s (docs/DESIGN.md → Highway scroll speed):
// a view-only preference, not persisted.
const DEFAULT_PIXELS_PER_SECOND = 700;

const BLANK_METADATA: SongMetadata = {
  name: '',
  artist: '',
  album: '',
  genre: '',
  year: '',
  charter: '',
  drumsDifficulty: Number.NaN,
};

// The four linear wizard steps (docs/DESIGN.md → UI top-level structure → Convert tab).
export type WizardStep = 'load' | 'mapping' | 'preview' | 'finalize';

const STEP_ORDER: readonly WizardStep[] = ['load', 'mapping', 'preview', 'finalize'];

// Per-row array copy so session edits can never mutate the live global map. Edits
// route through applyRemap (immutable) anyway, but the copy makes that guarantee
// local to the store.
function cloneMap(map: MidiMap): MidiMap {
  const out = {} as MidiMap;
  for (const id of YARG_NOTE_IDS) out[id] = [...map[id]];
  return out;
}

// Value equality for two maps. Rows are canonically ascending/deduped (see
// validateMidiMap), so element-wise comparison is sufficient. Used to tell whether
// the session map has actually diverged from its seed, driving the §10 prompt.
function mapsEqual(a: MidiMap, b: MidiMap | null): boolean {
  if (b === null) return false;
  for (const id of YARG_NOTE_IDS) {
    const x = a[id];
    const y = b[id];
    if (x.length !== y.length) return false;
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
  }
  return true;
}

function prioritiesEqual(a: CymbalPriorities, b: CymbalPriorities): boolean {
  return (Object.keys(a) as (keyof CymbalPriorities)[]).every(
    (k) => a[k][0] === b[k][0] && a[k][1] === b[k][1] && a[k][2] === b[k][2],
  );
}

// Field-wise equality for the tuning settings, not a serialized comparison — key
// order is an implementation detail, and a false "dirty" would nag the user with
// the promote prompt on every mapping.
function conversionSettingsEqual(a: ConversionSettings, b: ConversionSettings): boolean {
  return (
    a.graceNoteSpacing === b.graceNoteSpacing &&
    a.snareGhostNotes === b.snareGhostNotes &&
    a.tomGhostNotes === b.tomGhostNotes &&
    a.cymbalGhostNotes === b.cymbalGhostNotes &&
    a.dynamicCymbalSelection === b.dynamicCymbalSelection &&
    a.leadInBars === b.leadInBars &&
    a.snareAccentedNotes === b.snareAccentedNotes &&
    a.tomAccentedNotes === b.tomAccentedNotes &&
    a.cymbalAccentedNotes === b.cymbalAccentedNotes &&
    prioritiesEqual(a.cymbalPriorities, b.cymbalPriorities)
  );
}

// The next recency stamp: one past the highest stamp across all edit layers.
function nextSeq(s: WizardState): number {
  let max = 0;
  for (const o of s.overrides) if (o.seq > max) max = o.seq;
  for (const d of s.deletions) if (d.seq > max) max = d.seq;
  for (const r of s.previewRemaps) if (r.seq > max) max = r.seq;
  return max + 1;
}

// Everything scoped to converting one song (docs/DESIGN.md → Architecture → State
// model). Task 24 populated the Load/Track fields; Task 25 adds the session map,
// its dirty flag (feeds the "Update global MIDI map?" prompt), and the converted
// chart + warnings produced at the Confirm-mapping transition.
export interface WizardState {
  step: WizardStep;
  gpFilePath: string | null;
  score: ParsedGpScore | null;
  selectedTrackId: number | null;
  // Session-local MIDI map for the Mapping step: a clone of the global map, edited
  // session-locally. Null until the Mapping step initializes it.
  sessionMap: MidiMap | null;
  // Whether the session map currently differs from the seed (drives the §10 prompt).
  // Recomputed against the baseline on every edit, so reverting an edit clears it.
  mapDirty: boolean;
  // Session-local tuning settings (grace-note spacing, ghost-note toggles, dynamic
  // cymbal selection + priorities), seeded from the global defaults on startSession
  // and promotable to global via the "Update global map?" prompt.
  sessionSettings: ConversionSettings;
  // Whether the tuning settings currently differ from the seed (also drives the §10 prompt).
  settingsDirty: boolean;
  // The values that seeded this session (captured on startSession). The dirty flags
  // above are derived by comparing the session values against these, so a change and
  // its reversal net to "not dirty".
  baselineMap: MidiMap | null;
  baselineSettings: ConversionSettings;
  chart: YargChart | null;
  warnings: ConversionWarning[];

  // Preview-scoped state (docs/DESIGN.md → Chart preview → Data-model impact).
  metadata: SongMetadata | null; // editable form values, seeded from the score
  audioBuffer: AudioBuffer | null; // decoded for playback
  audioBytes: Uint8Array | null; // original source bytes, bundled by the writer
  audioExtension: string | null; // e.g. "ogg" for the song.<ext> slot
  audioOffsetMs: number; // the SNG `delay` value
  viewTime: number; // seconds from chart start currently at the hit line
  pixelsPerSecond: number; // highway scroll speed (view-only preference)
  previewVolume: number; // preview audio gain, 1 = 100% (view-only preference)
  playbackRate: number; // preview playback speed, 1 = 100% (view-only preference)
  metronomeOn: boolean; // preview metronome toggle (view-only preference)
  metronomeVolume: number; // preview metronome click level, 1 = 100% (view-only preference)
  overrides: SeqOverride[]; // one-off reassigns applied on top of the chart
  deletions: SeqDeletion[]; // gems removed from the displayed chart (Delete gem / unassign)
  previewRemaps: PreviewRemap[]; // "all notes on MIDI n" reassigns done in Preview

  // Load a freshly parsed score. Auto-selects the drum track (FUNCTIONALITY step
  // 4) and returns to the Load step so any forward progress is discarded — the
  // "changing an upstream decision invalidates downstream state" rule.
  loadScore: (path: string, score: ParsedGpScore) => void;
  selectTrack: (trackId: number) => void;
  // Initialize the session map from the global map on entering Mapping. A no-op
  // once a session already exists, so re-entering the step preserves session edits
  // (only an upstream change — via selectTrack/loadScore — clears them).
  startSession: (globalMap: MidiMap, settings: ConversionSettings) => void;
  setSessionMap: (next: MidiMap) => void;
  setSessionSettings: (next: ConversionSettings) => void;
  setConversion: (chart: YargChart, warnings: ConversionWarning[]) => void;
  setMetadata: (patch: Partial<SongMetadata>) => void;
  setAudio: (audio: { buffer: AudioBuffer; bytes: Uint8Array; extension: string }) => void;
  clearAudio: () => void;
  setAudioOffsetMs: (ms: number) => void;
  setViewTime: (t: number) => void;
  setPixelsPerSecond: (pps: number) => void;
  setPreviewVolume: (v: number) => void;
  setPlaybackRate: (r: number) => void;
  setMetronomeOn: (on: boolean) => void;
  setMetronomeVolume: (v: number) => void;
  addOverride: (override: NoteOverride) => void;
  deleteNote: (ref: NoteRef) => void;
  removeOverride: (tick: number, midi: number) => void;
  removeDeletion: (tick: number, midi: number) => void;
  recordPreviewRemap: (args: {
    midi: number;
    from: YargNoteId | null;
    to: YargNoteId | null;
    nextMap: MidiMap;
  }) => void;
  removePreviewRemap: (midi: number, revertMap: MidiMap) => void;
  goNext: () => void;
  goBack: () => void;
  goToStep: (step: WizardStep) => void;
  reset: () => void;
}

const INITIAL = {
  step: 'load' as WizardStep,
  gpFilePath: null,
  score: null,
  selectedTrackId: null,
  sessionMap: null,
  mapDirty: false,
  sessionSettings: DEFAULT_CONVERSION_SETTINGS,
  baselineSettings: DEFAULT_CONVERSION_SETTINGS,
  settingsDirty: false,
  baselineMap: null,
  chart: null,
  warnings: [] as ConversionWarning[],
  metadata: null,
  audioBuffer: null,
  audioBytes: null,
  audioExtension: null,
  audioOffsetMs: 0,
  viewTime: 0,
  pixelsPerSecond: DEFAULT_PIXELS_PER_SECOND,
  previewVolume: 1,
  playbackRate: 1,
  metronomeOn: false,
  metronomeVolume: 1,
  overrides: [] as SeqOverride[],
  deletions: [] as SeqDeletion[],
  previewRemaps: [] as PreviewRemap[],
};

// Whether the current step is satisfied enough to advance. The wizard shell uses
// this to enable Next; the Load case also encodes the zero-note error (a
// note-less selection blocks Next — docs/DESIGN.md → Error handling → Load).
export function canAdvance(
  step: WizardStep,
  score: ParsedGpScore | null,
  selectedTrackId: number | null,
): boolean {
  switch (step) {
    case 'load': {
      if (score === null || selectedTrackId === null) return false;
      const t = score.tracks.find((track) => track.id === selectedTrackId);
      return t !== undefined && t.noteCount > 0;
    }
    case 'preview':
      return true;
    default:
      return false;
  }
}

export const useWizardStore = create<WizardState>((set) => ({
  ...INITIAL,
  loadScore: (path, score) =>
    set({
      ...INITIAL,
      gpFilePath: path,
      score,
      selectedTrackId: detectDrumTrack(score.tracks),
    }),
  selectTrack: (trackId) =>
    set((s) =>
      trackId === s.selectedTrackId
        ? {}
        : {
            selectedTrackId: trackId,
            sessionMap: null,
            mapDirty: false,
            settingsDirty: false,
            chart: null,
            warnings: [],
            // Chart-derived preview state is invalid once the track changes.
            overrides: [],
            deletions: [],
            previewRemaps: [],
            viewTime: 0,
          },
    ),
  startSession: (globalMap, settings) =>
    set((s) => {
      if (s.sessionMap !== null) return {};
      // One clone seeds both the editable session map and the immutable baseline;
      // edits replace the map object wholesale (never mutate), so sharing is safe.
      const seed = cloneMap(globalMap);
      return {
        sessionMap: seed,
        baselineMap: seed,
        mapDirty: false,
        sessionSettings: settings,
        baselineSettings: settings,
        settingsDirty: false,
      };
    }),
  // Editing the session map invalidates the last conversion (the "upstream change
  // invalidates downstream state" rule, as selectTrack does), so preview/finalize
  // re-gate to unreachable until Confirm mapping rebuilds the chart. mapDirty tracks
  // divergence from the seed, so reverting an edit back to it clears the §10 prompt.
  setSessionMap: (next) =>
    set((s) => ({
      sessionMap: next,
      mapDirty: !mapsEqual(next, s.baselineMap),
      chart: null,
      warnings: [],
      previewRemaps: [],
    })),
  // Changing any tuning setting changes conversion output, so it invalidates the
  // chart just like a session-map edit. settingsDirty tracks divergence from the
  // seed, so an edit and its reversal net to "not dirty".
  setSessionSettings: (next) =>
    set((s) => ({
      sessionSettings: next,
      settingsDirty: !conversionSettingsEqual(next, s.baselineSettings),
      chart: null,
      warnings: [],
    })),
  setConversion: (chart, warnings) => set({ chart, warnings }),
  setMetadata: (patch) =>
    set((s) => ({ metadata: { ...(s.metadata ?? BLANK_METADATA), ...patch } })),
  setAudio: ({ buffer, bytes, extension }) =>
    set({ audioBuffer: buffer, audioBytes: bytes, audioExtension: extension }),
  clearAudio: () => set({ audioBuffer: null, audioBytes: null, audioExtension: null }),
  setAudioOffsetMs: (ms) => set({ audioOffsetMs: ms }),
  setViewTime: (t) => set({ viewTime: t }),
  setPixelsPerSecond: (pps) => set({ pixelsPerSecond: pps }),
  setPreviewVolume: (v) => set({ previewVolume: v }),
  setPlaybackRate: (r) => set({ playbackRate: r }),
  setMetronomeOn: (on) => set({ metronomeOn: on }),
  setMetronomeVolume: (v) => set({ metronomeVolume: v }),
  // A note has at most one one-off override: a new one for the same (tick, midi)
  // replaces the old (docs/DESIGN.md → Chart preview → Override layer).
  addOverride: (override) =>
    set((s) => ({
      overrides: [
        ...s.overrides.filter((o) => o.tick !== override.tick || o.midi !== override.midi),
        { ...override, seq: nextSeq(s) },
      ],
    })),
  // A gem may be deleted once; a repeat delete of the same (tick, midi) is a no-op.
  // Keyed like overrides so deletions survive re-conversion after an "all notes" remap.
  deleteNote: (ref) =>
    set((s) => ({
      deletions: s.deletions.some((d) => d.tick === ref.tick && d.midi === ref.midi)
        ? s.deletions
        : [...s.deletions, { ...ref, seq: nextSeq(s) }],
    })),
  // Undo a one-off reassign / delete: remove the keyed edit-layer entry.
  removeOverride: (tick, midi) =>
    set((s) => ({ overrides: s.overrides.filter((o) => o.tick !== tick || o.midi !== midi) })),
  removeDeletion: (tick, midi) =>
    set((s) => ({ deletions: s.deletions.filter((d) => d.tick !== tick || d.midi !== midi) })),
  // Record a Preview "all notes" remap. Captures `from` only on the MIDI's first
  // remap; a later remap keeps that original and updates `to`. If `to` returns the
  // MIDI to its original row, the entry drops (net no-op). Sets the session map to
  // the caller's already-computed nextMap without clearing the other remaps.
  recordPreviewRemap: ({ midi, from, to, nextMap }) =>
    set((s) => {
      const existing = s.previewRemaps.find((r) => r.midi === midi);
      const effectiveFrom = existing ? existing.from : from;
      const seq = nextSeq(s);
      let previewRemaps: PreviewRemap[];
      if (effectiveFrom === to) {
        previewRemaps = s.previewRemaps.filter((r) => r.midi !== midi);
      } else if (existing) {
        previewRemaps = s.previewRemaps.map((r) => (r.midi === midi ? { ...r, to, seq } : r));
      } else {
        previewRemaps = [...s.previewRemaps, { midi, from, to, seq }];
      }
      return { sessionMap: nextMap, mapDirty: !mapsEqual(nextMap, s.baselineMap), previewRemaps };
    }),
  // Undo a Preview "all notes" remap: the caller supplies the reverted map (already
  // re-converted); drop the entry.
  removePreviewRemap: (midi, revertMap) =>
    set((s) => ({
      sessionMap: revertMap,
      mapDirty: !mapsEqual(revertMap, s.baselineMap),
      previewRemaps: s.previewRemaps.filter((r) => r.midi !== midi),
    })),
  goNext: () =>
    set((s) => ({
      step: STEP_ORDER[Math.min(STEP_ORDER.indexOf(s.step) + 1, STEP_ORDER.length - 1)],
    })),
  goBack: () => set((s) => ({ step: STEP_ORDER[Math.max(STEP_ORDER.indexOf(s.step) - 1, 0)] })),
  goToStep: (step) => set({ step }),
  reset: () => set({ ...INITIAL }),
}));
