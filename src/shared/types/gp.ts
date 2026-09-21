// Parsed, UN-expanded GP7 score. Timeline expansion (repeats / alternate
// endings) and tick computation happen later in shared/convert (Plan 3).
// docs/GP_FORMAT.md is the authority for these shapes.

export interface GpTimeSignature {
  numerator: number;
  denominator: number;
}

export interface GpTempoAutomation {
  bar: number; // 0-indexed master bar
  position: number; // float ratio within the bar, [0, 1]
  bpm: number; // normalized to quarter-note BPM
  linear: boolean; // true = ramp to next automation (flattened later, with a warning)
}

export interface GpNote {
  midi: number; // input MIDI number (docs/GP_FORMAT.md → MIDI number extraction)
  ghost: boolean; // AntiAccent=Normal, or a grace-beat note
  accent: boolean; // Accent 8 (regular) or 4 (heavy)
}

export interface GpBeat {
  // Duration as an exact rational fraction of a whole note (e.g. a quarter is 1/4).
  durationNum: number;
  durationDen: number;
  notes: GpNote[]; // empty for a rest beat
  isGrace: boolean; // beat carried a <GraceNotes> child
}

export interface GpVoice {
  beats: GpBeat[]; // in performance order
}

export interface GpBar {
  voices: GpVoice[]; // populated voice slots only
}

export interface GpMasterBar {
  timeSignature: GpTimeSignature;
  section: string | null; // section name if this bar STARTS a section, else null
  repeatStart: boolean;
  repeatEnd: boolean;
  repeatCount: number; // total play count; meaningful when repeatEnd is true
  alternateEndings: number[]; // pass numbers this bar plays on; empty if none
  hasDirections: boolean; // any <Directions> present (triggers a warning later)
}

export interface GpMetadata {
  title: string;
  subtitle: string;
  artist: string;
  album: string;
  copyright: string;
  tabber: string;
}

export interface ParsedGpTrack {
  id: number;
  name: string;
  isDrumKit: boolean;
  noteCount: number; // total notes across all beats (drives Load validation)
  bars: GpBar[]; // one per master bar, aligned by index to ParsedGpScore.masterBars
}

export interface ParsedGpScore {
  metadata: GpMetadata;
  tempoAutomations: GpTempoAutomation[];
  masterBars: GpMasterBar[];
  tracks: ParsedGpTrack[];
}
