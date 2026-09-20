import { isRideBellAndHiHatAccented, lookup } from '../midi/index';
import {
  type BaseYargNote,
  CHART_RESOLUTION,
  type ChartSection,
  ConversionError,
  type ConversionSettings,
  type ConversionWarning,
  DEFAULT_CONVERSION_SETTINGS,
  type DrumDynamic,
  type GpBeat,
  type GraceNoteSpacing,
  type MidiMap,
  type ParsedGpScore,
  type ParsedGpTrack,
  type TimeSignatureEvent,
  type YargChart,
  type YargNote,
} from '../types/index';
import { resolveDynamicCymbalColors } from './dynamicCymbalColor';
import { leadInBarsFor, openingBpm } from './leadIn';
import { expandTimeline } from './timeline';
import {
  addFrac,
  barTicks,
  bpmToUsPerQuarter,
  buildTempoMap,
  type Frac,
  fracToTick,
  type TempoPoint,
} from './timing';

const DYNAMIC_RANK: Record<DrumDynamic, number> = { accent: 2, neutral: 1, ghost: 0 };

// A grace note is placed as a flam this fraction of a whole note before its beat.
const GRACE_SPACING_FRACTION: Record<GraceNoteSpacing, Frac> = { '32nd': [1, 32], '64th': [1, 64] };

type DynamicToggles = {
  snareGhost: boolean;
  tomGhost: boolean;
  cymbalGhost: boolean;
  snareAccent: boolean;
  tomAccent: boolean;
  cymbalAccent: boolean;
};

function ghostEnabled(note: BaseYargNote, toggles: DynamicToggles): boolean {
  if (note.endsWith('Cymbal')) return toggles.cymbalGhost;
  if (note.endsWith('Tom')) return toggles.tomGhost;
  return toggles.snareGhost; // 'red' — the only remaining hand note (kick returned earlier)
}

function accentEnabled(note: BaseYargNote, toggles: DynamicToggles): boolean {
  if (note.endsWith('Cymbal')) return toggles.cymbalAccent;
  if (note.endsWith('Tom')) return toggles.tomAccent;
  return toggles.snareAccent; // 'red'
}

function resolveDynamic(
  note: BaseYargNote,
  ghost: boolean,
  gpAccent: boolean,
  mapAccented: boolean,
  toggles: DynamicToggles,
  strictCymbalAccent: boolean,
): DrumDynamic {
  // Accent outranks ghost (matching the collision-merge order in `decollide`).
  if (note === 'orange') return 'neutral';
  // When "Accent ride bell & open hi-hat" is on, accented yellow/blue cymbals are
  // reserved for open hi-hat (46/92) and ride bell (53/127), reaching us via their
  // accented row. A GP accent on any OTHER yellow/blue cymbal must not promote it.
  const suppressGpAccent = strictCymbalAccent && (note === 'yellowCymbal' || note === 'blueCymbal');
  // A GP-authored accent survives only if its kind's accent toggle is on (and it is
  // not suppressed above). Accented-row membership (mapAccented) is never gated.
  const gpAccentSurvives = gpAccent && !suppressGpAccent && accentEnabled(note, toggles);
  if (mapAccented || gpAccentSurvives) return 'accent';
  // A GP ghost survives only if its kind's ghost toggle is on (docs/DESIGN.md → Dynamics).
  if (ghost && ghostEnabled(note, toggles)) return 'ghost';
  return 'neutral';
}

export function detectOverlaps(
  tracks: readonly ParsedGpTrack[],
  map: MidiMap,
  graceNoteSpacing: GraceNoteSpacing = DEFAULT_CONVERSION_SETTINGS.graceNoteSpacing,
): ConversionWarning[] {
  const warnings: ConversionWarning[] = [];
  const positions = new Map<string, { bar: number; positionFrac: Frac; midi: number[] }>();
  const graceTicks = fracToTick(GRACE_SPACING_FRACTION[graceNoteSpacing], CHART_RESOLUTION);
  for (const track of tracks)
    track.bars.forEach((bar, barIdx) => {
      for (const voice of bar.voices) {
        let pos: Frac = [0, 1];
        let graceRun: GpBeat[] = [];
        const recordAt = (beat: GpBeat, tick: number, positionFrac: Frac) => {
          const hands = beat.notes.filter((n) => {
            const r = lookup(map, n.midi);
            return r !== null && r.note !== 'orange';
          });
          if (hands.length === 0) return;
          const key = `${barIdx}:${tick}`;
          const group = positions.get(key);
          if (group) group.midi.push(...hands.map((n) => n.midi));
          else
            positions.set(key, {
              bar: barIdx + 1,
              positionFrac,
              midi: hands.map((n) => n.midi),
            });
        };
        const flushGraces = (anchorTick: number) => {
          const k = graceRun.length;
          graceRun.forEach((beat, i) => {
            const offset = (k - i) * graceTicks;
            recordAt(beat, anchorTick - offset, addFrac(pos, [-offset, 4 * CHART_RESOLUTION]));
          });
          graceRun = [];
        };
        for (const beat of voice.beats) {
          if (beat.isGrace) {
            graceRun.push(beat);
            continue;
          }
          const beatTick = fracToTick(pos, CHART_RESOLUTION);
          flushGraces(beatTick);
          recordAt(beat, beatTick, pos);
          pos = addFrac(pos, [beat.durationNum, beat.durationDen]);
        }
        flushGraces(fracToTick(pos, CHART_RESOLUTION));
      }
    });
  for (const { bar, positionFrac, midi } of positions.values()) {
    if (midi.length < 3) continue;
    warnings.push({
      kind: 'threeHandNotes',
      message: `MIDI notes ${midi.join(', ')} overlap on bar ${bar}`,
      context: { bar, midi, positionFrac },
    });
  }
  return warnings;
}

export function convertToYargChart(
  score: ParsedGpScore,
  trackIds: readonly number[],
  map: MidiMap,
  settings: ConversionSettings = DEFAULT_CONVERSION_SETTINGS,
): { chart: YargChart; warnings: ConversionWarning[] } {
  const {
    graceNoteSpacing,
    snareGhostNotes,
    tomGhostNotes,
    cymbalGhostNotes,
    snareAccentedNotes,
    tomAccentedNotes,
    cymbalAccentedNotes,
    dynamicCymbalSelection,
    cymbalPriorities,
  } = settings;
  if (trackIds.length === 0) throw new ConversionError('No tracks selected', { trackIds });
  const requested = new Set(trackIds);
  const tracks = score.tracks.filter((track) => requested.has(track.id));
  if (tracks.length !== requested.size) {
    const missing = [...requested].filter((id) => !tracks.some((track) => track.id === id));
    throw new ConversionError(`No track with id ${missing.join(', ')}`, { trackIds, missing });
  }

  const ppq = CHART_RESOLUTION;
  const graceTicks = fracToTick(GRACE_SPACING_FRACTION[graceNoteSpacing], ppq);
  const played = expandTimeline(score.masterBars);
  const warnings: ConversionWarning[] = [];

  // The lead-in bars inherit the song's opening time signature so the chart stays
  // bar-aligned (docs/DESIGN.md → Timing model → Lead-in), and their count comes
  // from the chart's own opening tempo and meter per YARN. A score with no played
  // bars gets none; that path throws for having no notes below anyway. Computed
  // once and reused below for the tick-0 tempo point, so the lead-in's bar count
  // and the tempo it actually runs at can never disagree.
  const firstBar = played.length > 0 ? score.masterBars[played[0]] : null;
  const openingTempo = openingBpm(score.tempoAutomations, played);
  const leadInTicks =
    firstBar === null
      ? 0
      : leadInBarsFor(firstBar.timeSignature, openingTempo, ppq) *
        barTicks(firstBar.timeSignature, ppq);

  // "Accent ride bell & open hi-hat" on ⇒ accented yellow/blue cymbals denote open
  // hi-hat / ride bell, so a GP accent must not promote other yellow/blue cymbal
  // notes into those rows (docs/DESIGN.md → Dynamics). Derived from the map.
  const strictCymbalAccent = isRideBellAndHiHatAccented(map);

  const toggles: DynamicToggles = {
    snareGhost: snareGhostNotes,
    tomGhost: tomGhostNotes,
    cymbalGhost: cymbalGhostNotes,
    snareAccent: snareAccentedNotes,
    tomAccent: tomAccentedNotes,
    cymbalAccent: cymbalAccentedNotes,
  };

  const rawNotes: YargNote[] = [];
  const tempoPoints: TempoPoint[] = [];
  const timeSignatures: TimeSignatureEvent[] = [];
  const sections: ChartSection[] = [];
  const droppedMidi = new Set<number>();
  const emittedSection = new Set<number>();
  let barStart = leadInTicks;
  let lastSigKey = '';

  // The opening signature is emitted at tick 0 so it governs the lead-in bars too.
  // Seeding lastSigKey with it means the loop's first bar reads as unchanged and
  // does not emit a duplicate event at leadInTicks.
  if (firstBar !== null) {
    const { numerator, denominator } = firstBar.timeSignature;
    timeSignatures.push({ tick: 0, numerator, denominator });
    lastSigKey = `${numerator}/${denominator}`;
  }

  for (const masterIndex of played) {
    const mb = score.masterBars[masterIndex];
    const bt = barTicks(mb.timeSignature, ppq);

    const sigKey = `${mb.timeSignature.numerator}/${mb.timeSignature.denominator}`;
    if (sigKey !== lastSigKey) {
      timeSignatures.push({
        tick: barStart,
        numerator: mb.timeSignature.numerator,
        denominator: mb.timeSignature.denominator,
      });
      lastSigKey = sigKey;
    }

    // Tempo automations targeting this played bar re-fire on every pass through a
    // repeat so a repeated range keeps its tempo. Collected raw; linear ramps are
    // interpolated into steps after the loop (buildTempoMap).
    for (const auto of score.tempoAutomations) {
      if (auto.bar !== masterIndex) continue;
      tempoPoints.push({
        tick: barStart + Math.round(auto.position * bt),
        bpm: auto.bpm,
        linear: auto.linear,
      });
    }

    if (mb.section !== null && mb.section !== '' && !emittedSection.has(masterIndex)) {
      sections.push({ tick: barStart, name: mb.section });
      emittedSection.add(masterIndex);
    }

    for (const track of tracks) {
      const gpBar = track.bars[masterIndex];
      if (!gpBar) continue;
      for (const voice of gpBar.voices) {
        let pos: Frac = [0, 1];
        // Grace notes carry no grid time; they render as a flam just before the
        // beat they ornament (docs/DESIGN.md → Timing model → Grace notes). We
        // buffer a run of consecutive graces and, at the next primary beat, place
        // them on distinct earlier ticks in reading order so a drag stays ordered.
        let graceRun: GpBeat[] = [];
        const emitAt = (beat: GpBeat, tick: number) => {
          for (const gp of beat.notes) {
            const resolved = lookup(map, gp.midi);
            if (resolved === null) {
              droppedMidi.add(gp.midi);
              continue;
            }
            const dynamic = resolveDynamic(
              resolved.note,
              gp.ghost,
              gp.accent,
              resolved.accented,
              toggles,
              strictCymbalAccent,
            );
            rawNotes.push({ tick, note: resolved.note, dynamic, midi: gp.midi });
          }
        };
        const flushGraces = (anchorTick: number) => {
          const k = graceRun.length;
          graceRun.forEach((g, i) => {
            emitAt(g, Math.max(0, anchorTick - (k - i) * graceTicks));
          });
          graceRun = [];
        };
        for (const beat of voice.beats) {
          if (beat.isGrace) {
            graceRun.push(beat);
            continue;
          }
          const beatTick = barStart + fracToTick(pos, ppq);
          flushGraces(beatTick);
          emitAt(beat, beatTick);
          pos = addFrac(pos, [beat.durationNum, beat.durationDen]);
        }
        // A run of graces with no following primary (rare) anchors to the bar end.
        flushGraces(barStart + fracToTick(pos, ppq));
      }
    }
    barStart += bt;
  }

  // The lead-in runs at the song's opening tempo, not the 120 BPM fallback — and
  // not whichever automation happened to come first in document order, which can
  // disagree with openingTempo (and thus the lead-in's own bar count) when a bar
  // carries multiple automations stored out of position order. A non-linear point
  // at tick 0 carries it; buildTempoMap drops consecutive equal tempos, so the
  // now-redundant event at leadInTicks collapses on its own, while a linear
  // opening point still ramps correctly from leadInTicks.
  if (leadInTicks > 0 && tempoPoints.length > 0 && tempoPoints[0].tick > 0) {
    tempoPoints.unshift({ tick: 0, bpm: openingTempo, linear: false });
  }

  const tempoMap = buildTempoMap(tempoPoints);
  if (tempoMap.length === 0) tempoMap.push({ tick: 0, usPerQuarter: bpmToUsPerQuarter(120) });

  const colored = dynamicCymbalSelection
    ? resolveDynamicCymbalColors(rawNotes, cymbalPriorities)
    : rawNotes;
  const notes = decollide(colored, warnings);
  notes.sort((a, b) => a.tick - b.tick);

  if (notes.length === 0) {
    throw new ConversionError('No MIDI notes in the selected tracks map to any YARG note', {
      trackIds,
    });
  }

  if (droppedMidi.size > 0) {
    const list = [...droppedMidi].sort((a, b) => a - b);
    warnings.push({
      kind: 'unmappedNotesDropped',
      message: `${list.length} MIDI note value(s) were unmapped and dropped: ${list.join(', ')}`,
      context: { midi: list },
    });
  }
  if (score.masterBars.some((mb) => mb.hasDirections)) {
    warnings.push({
      kind: 'directionSignsUnsupported',
      message: 'Direction signs are not simulated; the chart was converted in linear order',
    });
  }
  const chart: YargChart = {
    resolution: ppq,
    tempoMap,
    timeSignatures,
    notes,
    sections,
    endTick: barStart,
    leadInTicks,
  };
  return { chart, warnings };
}

// Collapse notes sharing (tick, note) to a single note, keeping the strongest
// dynamic, and warn once per collision.
function decollide(rawNotes: YargNote[], warnings: ConversionWarning[]): YargNote[] {
  const byKey = new Map<string, YargNote>();
  for (const n of rawNotes) {
    const key = `${n.tick}:${n.note}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, { ...n });
      continue;
    }
    warnings.push({
      kind: 'yargNoteCollision',
      message: `Two notes mapped to ${n.note} at tick ${n.tick}; merged`,
      context: { tick: n.tick, note: n.note },
    });
    if (DYNAMIC_RANK[n.dynamic] > DYNAMIC_RANK[existing.dynamic]) existing.dynamic = n.dynamic;
  }
  return [...byKey.values()];
}
