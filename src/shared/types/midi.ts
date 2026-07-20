export type BaseYargNote =
  | 'red'
  | 'orange'
  | 'yellowCymbal'
  | 'yellowTom'
  | 'blueCymbal'
  | 'blueTom'
  | 'greenCymbal'
  | 'greenTom';

export type YargNoteId = BaseYargNote | `${BaseYargNote}Accented`;

export const BASE_YARG_NOTES: readonly BaseYargNote[] = [
  'red',
  'orange',
  'yellowCymbal',
  'yellowTom',
  'blueCymbal',
  'blueTom',
  'greenCymbal',
  'greenTom',
];

// Base rows and their accented variants, in a stable order (base, then accented).
export const YARG_NOTE_IDS: readonly YargNoteId[] = [
  ...BASE_YARG_NOTES,
  ...BASE_YARG_NOTES.map((n): YargNoteId => `${n}Accented`),
];

export type MidiMap = Record<YargNoteId, number[]>;

// How far before its beat a grace note is placed, as a flam (docs/DESIGN.md →
// Timing model → Grace notes). '64th' is tighter/more realistic; '32nd' is
// easier to read at fast tempos. A note value, resolved to ticks by the converter.
export type GraceNoteSpacing = '32nd' | '64th';

export const GRACE_NOTE_SPACINGS: readonly GraceNoteSpacing[] = ['32nd', '64th'];

// A YARG cymbal lane color. The cymbal-color controls (docs/DESIGN.md → MIDI map
// component) place a physical cymbal on one of these three lanes.
export type CymbalColor = 'yellow' | 'blue' | 'green';
export const CYMBAL_COLORS: readonly CymbalColor[] = ['yellow', 'blue', 'green'];

// A per-cymbal color priority: a permutation of the three colors, highest first.
export type CymbalPriority = readonly [CymbalColor, CymbalColor, CymbalColor];

// Ordered fallback colors for each adaptive accent cymbal (High crash / Splash /
// China), used by dynamic cymbal selection (docs/DESIGN.md → Drum output mapping).
export type CymbalPriorities = {
  crashHigh: CymbalPriority;
  splash: CymbalPriority;
  china: CymbalPriority;
};

// Defaults: priority[0] matches DEFAULT_MIDI_MAP (crash-high/splash blue, china
// green); the fallback is the cyclic yellow→blue→green rotation.
export const DEFAULT_CYMBAL_PRIORITIES: CymbalPriorities = {
  crashHigh: ['blue', 'green', 'yellow'],
  splash: ['blue', 'green', 'yellow'],
  china: ['green', 'yellow', 'blue'],
};

// The conversion-tuning settings — everything persisted except the output directory
// (a user-chosen environment path, not a tuning preference). The Settings tab edits
// the global default; the Mapping step clones a session-local copy that is promoted
// back to global only if the user opts in (docs/INTRO.md FUNCTIONALITY step 10).
export type ConversionSettings = {
  graceNoteSpacing: GraceNoteSpacing;
  // Whether GP ghost notes survive as ghosts in the chart, per note kind
  // (docs/DESIGN.md → Dynamics). Snare is the red pad; toms are the yellow, blue
  // and green pads; kick carries no dynamic and is never ghosted.
  snareGhostNotes: boolean;
  tomGhostNotes: boolean;
  cymbalGhostNotes: boolean;
  // Whether GP-authored accents survive as accents in the chart, per note kind
  // (docs/DESIGN.md → Dynamics). Gates GP accents ONLY — a note sitting in an
  // accented MIDI row is always accented regardless of these flags.
  snareAccentedNotes: boolean;
  tomAccentedNotes: boolean;
  cymbalAccentedNotes: boolean;
  // Adaptive accent-cymbal coloring (docs/DESIGN.md → Drum output mapping). When on,
  // the converter spreads overlapping cymbals across lanes by priority.
  dynamicCymbalSelection: boolean;
  cymbalPriorities: CymbalPriorities;
};

export type PersistedSettings = { outputDir: string | null } & ConversionSettings;

// Accent-on-by-default (docs/DESIGN.md → MIDI map): 91 (rim shot), 46 (open
// hi-hat) and 92 (half hi-hat), and 53/127 (ride bell) ship in their accented
// rows, which is the "Accent ride bell & open hi-hat" checkbox in its
// default-checked state. Cymbal-color defaults: high crash (49/97) and splash
// (55/95) blue; china (52/96) green (docs/DESIGN.md → MIDI map component).
export const DEFAULT_MIDI_MAP: MidiMap = {
  red: [31, 33, 37, 38, 39, 40, 56],
  redAccented: [91],
  orange: [35, 36],
  orangeAccented: [],
  yellowCymbal: [42, 44, 54, 69, 70, 80, 81, 82, 83, 85],
  yellowCymbalAccented: [46, 92],
  yellowTom: [48, 50, 60, 62, 63, 65, 76],
  yellowTomAccented: [],
  blueCymbal: [29, 34, 49, 51, 55, 59, 93, 94, 95, 97, 126],
  blueCymbalAccented: [53, 127],
  blueTom: [47, 61, 64, 66, 77],
  blueTomAccented: [],
  greenCymbal: [30, 52, 57, 96, 98],
  greenCymbalAccented: [],
  greenTom: [41, 43, 45],
  greenTomAccented: [],
};

export const DEFAULT_CONVERSION_SETTINGS: ConversionSettings = {
  graceNoteSpacing: '64th',
  snareGhostNotes: true,
  tomGhostNotes: false,
  cymbalGhostNotes: false,
  snareAccentedNotes: true,
  tomAccentedNotes: false,
  cymbalAccentedNotes: false,
  dynamicCymbalSelection: true,
  cymbalPriorities: DEFAULT_CYMBAL_PRIORITIES,
};

export const DEFAULT_SETTINGS: PersistedSettings = {
  outputDir: null,
  ...DEFAULT_CONVERSION_SETTINGS,
};
