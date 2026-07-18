import type { BaseYargNote } from './midi';

// Fixed ticks-per-quarter for the output chart (docs/DESIGN.md → Timing model).
export const CHART_RESOLUTION = 480;

export type DrumDynamic = 'neutral' | 'ghost' | 'accent';

export interface YargNote {
  tick: number; // absolute position in ticks at CHART_RESOLUTION
  note: BaseYargNote; // lane + tom/cymbal identity
  dynamic: DrumDynamic; // Kick is always 'neutral'
  midi: number; // source GP MIDI number (provenance for the preview; ignored by the writer)
}

export interface TempoEvent {
  tick: number;
  usPerQuarter: number; // microseconds per quarter note
}

export interface TimeSignatureEvent {
  tick: number;
  numerator: number;
  denominator: number;
}

export interface ChartSection {
  tick: number;
  name: string;
}

export interface YargChart {
  resolution: number; // always CHART_RESOLUTION for now
  tempoMap: TempoEvent[]; // ordered by tick, first at tick 0
  timeSignatures: TimeSignatureEvent[]; // ordered by tick, first at tick 0
  notes: YargNote[]; // ordered by tick
  sections: ChartSection[]; // ordered by tick
  endTick: number; // tick of the end of the final bar (for song_length)
  leadInTicks: number; // tick at which the song's first bar begins; the empty lead-in precedes it
}
