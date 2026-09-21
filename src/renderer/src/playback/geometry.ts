import type { BaseYargNote, YargNote } from '../../../shared/types/index';

// Pure note<->pixel math and hit-testing for the chart preview
// (docs/DESIGN.md → Chart geometry). The canvas holds no math of its own; it
// calls this module and paints.

export interface PlacedNote {
  note: YargNote;
  seconds: number;
}

// Static highway layout in canvas pixels. `width`/`height` are the canvas; the
// painted highway is a centered strip (`highwayLeft`, `highwayWidth`). `hitLineY`
// is the top edge of the thick hit bar — a note's *bottom* lands there at hit time.
export interface ChartLayout {
  width: number;
  height: number;
  highwayLeft: number;
  highwayWidth: number;
  hitLineY: number;
  // The y where the painted highway (gray tail) ends; hit-testing stops here so a
  // note that has scrolled into the dark bottom margin is no longer hoverable.
  highwayBottomY: number;
  pixelsPerSecond: number;
}

// Widest the highway is ever painted; on a wider canvas it stays this size and
// centers, so the four lanes don't drift cartoonishly far apart (docs spec §1).
export const HIGHWAY_MAX_WIDTH = 280; // narrow, zoomed-out highway (spec §11, tune)

const PAD_WIDTH_FRAC = 0.92; // pad width as a fraction of lane width (tune)
const PAD_ASPECT = 0.34; // padHeight / padWidth (tune)
const CYMBAL_WIDTH_FRAC = 0.9; // cymbal base as a fraction of lane width — fits the lane (spec §7)
const CYMBAL_HEIGHT_SCALE = 1.2; // cymbals stay ~20% taller than pads for prominence (spec §7)

export const LANE_COUNT = 4;

// Gem footprints derived from lane width, so gems scale with the highway.
export interface NoteDims {
  padWidth: number;
  padHeight: number;
  cymbalWidth: number;
  cymbalHeight: number;
  kickHeight: number;
}

export function noteDims(laneWidth: number): NoteDims {
  const padWidth = laneWidth * PAD_WIDTH_FRAC;
  const padHeight = padWidth * PAD_ASPECT;
  return {
    padWidth,
    padHeight,
    cymbalWidth: laneWidth * CYMBAL_WIDTH_FRAC,
    cymbalHeight: padHeight * CYMBAL_HEIGHT_SCALE,
    kickHeight: padHeight / 2,
  };
}

// The centered highway strip for a given canvas width.
export function highwayMetrics(canvasWidth: number): {
  highwayLeft: number;
  highwayWidth: number;
} {
  const highwayWidth = Math.min(canvasWidth, HIGHWAY_MAX_WIDTH);
  return { highwayLeft: (canvasWidth - highwayWidth) / 2, highwayWidth };
}

// The four scrolling lanes red/yellow/blue/green left→right; kick has no lane
// (it rides the full-width orange bar), so it returns null.
export function laneIndex(note: BaseYargNote): 0 | 1 | 2 | 3 | null {
  if (note === 'orange') return null;
  if (note === 'red') return 0;
  if (note.startsWith('yellow')) return 1;
  if (note.startsWith('blue')) return 2;
  return 3; // green
}

// Horizontal center of a lane within the highway strip.
export function laneX(lane: number, layout: ChartLayout): number {
  const laneWidth = layout.highwayWidth / LANE_COUNT;
  return layout.highwayLeft + (lane + 0.5) * laneWidth;
}

// y = hitLineY − (noteTime − viewTime) × pixelsPerSecond. Yields the note's
// BOTTOM edge, so a pad/cymbal and a kick on the same tick sit flush (spec §3).
export function noteToY(seconds: number, viewTime: number, layout: ChartLayout): number {
  return layout.hitLineY - (seconds - viewTime) * layout.pixelsPerSecond;
}

// Inverse of noteToY: the chart time drawn at a given y for a given viewTime.
export function yToTime(y: number, viewTime: number, layout: ChartLayout): number {
  return viewTime + (layout.hitLineY - y) / layout.pixelsPerSecond;
}

// Playback maps chartTime to audioTime by adding offsetSeconds. Project an audio
// sample through the inverse mapping and the same geometry used by chart notes.
export function waveformToY(
  audioTime: number,
  offsetSeconds: number,
  viewTime: number,
  layout: ChartLayout,
): number {
  return noteToY(audioTime - offsetSeconds, viewTime, layout);
}

// Bottom-anchored bounding box for hit-testing. Uses base (neutral) footprints so
// ghost/accent variants keep the same forgiving target.
function noteBox(note: BaseYargNote, yBottom: number, layout: ChartLayout) {
  const dims = noteDims(layout.highwayWidth / LANE_COUNT);
  const lane = laneIndex(note);
  if (lane === null) {
    const h = dims.kickHeight;
    return {
      x0: layout.highwayLeft,
      x1: layout.highwayLeft + layout.highwayWidth,
      y0: yBottom - h,
      y1: yBottom,
    };
  }
  const cx = laneX(lane, layout);
  const isCymbal = note.endsWith('Cymbal');
  const w = isCymbal ? dims.cymbalWidth : dims.padWidth;
  const h = isCymbal ? dims.cymbalHeight : dims.padHeight;
  return { x0: cx - w / 2, x1: cx + w / 2, y0: yBottom - h, y1: yBottom };
}

// The note under the cursor, or null. When several notes cover the point, the one
// whose box center is nearest the cursor wins (the visually-topmost).
export function hitTest(
  x: number,
  y: number,
  viewTime: number,
  placed: PlacedNote[],
  layout: ChartLayout,
): YargNote | null {
  // The cursor is below the visible highway — nothing is drawn there (paint clips
  // gems to highwayBottomY), so nothing is hittable (batch 4 §2).
  if (y > layout.highwayBottomY) return null;

  let best: YargNote | null = null;
  let bestDist = Infinity;
  for (const p of placed) {
    const yBottom = noteToY(p.seconds, viewTime, layout);
    const box = noteBox(p.note.note, yBottom, layout);
    if (x >= box.x0 && x <= box.x1 && y >= box.y0 && y <= box.y1) {
      const midY = (box.y0 + box.y1) / 2;
      const dist = Math.abs(midY - y);
      if (dist < bestDist) {
        bestDist = dist;
        best = p.note;
      }
    }
  }
  return best;
}

// Vertical reach (px) either side of an error underline's tick for hover-testing.
// Matches the drawn band's half-height (ChartCanvas ERROR_LINE_THICK / 2) so the whole
// visible line is hoverable, not just its middle.
export const ERROR_LINE_HIT_HALF = 16;

// The error underline under the cursor (its time + messages), or null. Error lines
// span the full highway width and sit centered on their tick's y, so the hit test is
// an x range plus a small vertical band around each line; the nearest line within
// reach wins. Returning `seconds` too lets the canvas anchor the hover tooltip to the
// line itself. Kept pure and unit-tested so the canvas holds no hit-test math.
export function errorLineAt(
  x: number,
  y: number,
  viewTime: number,
  errorLines: readonly { seconds: number; messages: string[] }[],
  layout: ChartLayout,
): { seconds: number; messages: string[] } | null {
  // Below the visible highway, or outside the centered strip — nothing to hit.
  if (y > layout.highwayBottomY) return null;
  if (x < layout.highwayLeft || x > layout.highwayLeft + layout.highwayWidth) return null;
  let best: { seconds: number; messages: string[] } | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const e of errorLines) {
    const dist = Math.abs(noteToY(e.seconds, viewTime, layout) - y);
    if (dist <= ERROR_LINE_HIT_HALF && dist < bestDist) {
      bestDist = dist;
      best = { seconds: e.seconds, messages: e.messages };
    }
  }
  return best;
}

// The bottom-right corner of a note's gem in canvas pixels, or null if the note is
// not among `placed`. Anchors the hover tooltip and the gem context menu to the gem
// itself (docs/DESIGN.md → Selection, hover & reassign) rather than the cursor.
export function noteBottomRight(
  note: YargNote,
  viewTime: number,
  placed: PlacedNote[],
  layout: ChartLayout,
): { x: number; y: number } | null {
  const found = placed.find((p) => p.note.tick === note.tick && p.note.midi === note.midi);
  if (found === undefined) return null;
  const box = noteBox(note.note, noteToY(found.seconds, viewTime, layout), layout);
  return { x: box.x1, y: box.y1 };
}

// How long the hit-line flash lingers after a note crosses it (seconds).
export const FLASH_DURATION = 0.12; // (tune)

// Peak flash intensity (1) at the moment any note is hit, decaying linearly to 0
// over FLASH_DURATION. The strongest recent hit wins. Stateless — computed fresh
// each frame from viewTime, so no crossing can be missed between frames. The
// canvas only applies this while playing (spec §6).
export function flashIntensity(placed: PlacedNote[], viewTime: number): number {
  let best = 0;
  for (const p of placed) {
    const dt = viewTime - p.seconds;
    if (dt >= 0 && dt <= FLASH_DURATION) {
      best = Math.max(best, 1 - dt / FLASH_DURATION);
    }
  }
  return best;
}

// Flash-color priority when several notes cross the hit line together (docs spec →
// preview note-colored flash): the higher-priority color wins. A color's tom and
// cymbal share its rank; the kick is `orange`.
const FLASH_PRIORITY: Record<BaseYargNote, number> = {
  orange: 0,
  red: 1,
  greenTom: 2,
  greenCymbal: 2,
  blueTom: 3,
  blueCymbal: 3,
  yellowTom: 4,
  yellowCymbal: 4,
};

// The base note whose color the flash should show this frame, or null when nothing
// is in-window. Shares flashIntensity's window test; among those notes the
// highest-priority (lowest-rank) one wins, ties broken by input order. Pure — it
// returns the note key, leaving the hex lookup to the canvas.
export function flashNote(placed: PlacedNote[], viewTime: number): BaseYargNote | null {
  let best: BaseYargNote | null = null;
  let bestRank = Number.POSITIVE_INFINITY;
  for (const p of placed) {
    const dt = viewTime - p.seconds;
    if (dt >= 0 && dt <= FLASH_DURATION) {
      const rank = FLASH_PRIORITY[p.note.note];
      if (rank < bestRank) {
        bestRank = rank;
        best = p.note.note;
      }
    }
  }
  return best;
}

// Minimap mapping (fit-to-height, bottom-to-top): song start sits at the bottom and
// the end at the top, matching the highway's "up = later" sense (docs spec → Group
// C). Pure so the minimap canvas holds no math.
export function minimapY(seconds: number, songEnd: number, height: number): number {
  if (songEnd <= 0) return 0;
  return height * (1 - seconds / songEnd);
}

// Inverse of minimapY, clamped to the song's time bounds (for click-to-seek).
export function minimapTimeAt(y: number, songEnd: number, height: number): number {
  if (height <= 0) return 0;
  return Math.max(0, Math.min(songEnd, songEnd * (1 - y / height)));
}

// Horizontal center of a lane scaled to the minimap width (its own 4-lane split).
export function minimapLaneX(lane: number, width: number): number {
  const laneWidth = width / LANE_COUNT;
  return (lane + 0.5) * laneWidth;
}

// The name of the latest section whose start time has passed, or null. Robust to
// unsorted input. Drives the live-highway current-section overlay.
export function currentSectionName(
  sections: { name: string; seconds: number }[],
  time: number,
): string | null {
  let best: string | null = null;
  let bestSeconds = Number.NEGATIVE_INFINITY;
  for (const s of sections) {
    if (s.seconds <= time && s.seconds >= bestSeconds) {
      best = s.name;
      bestSeconds = s.seconds;
    }
  }
  return best;
}

// Index of the bar the given time falls in: the last bar start ≤ time (barLines is
// ascending), or -1 before the first. The 1-based bar number is index + 1.
export function currentBarIndex(barLines: number[], time: number): number {
  let idx = -1;
  for (let i = 0; i < barLines.length; i++) {
    if (barLines[i] <= time) idx = i;
    else break;
  }
  return idx;
}

// Bar-nav epsilon: a seek lands viewTime near-exactly on a bar start, so treat a
// time within a few ms of a bar line as "on" it (the back button then steps past).
export const BAR_NAV_EPS = 1e-3;

// Back-button target: the start of the current bar, or — when already sitting on a
// bar start — the previous bar's start. That is just the last bar line strictly
// before `time` (minus the epsilon). Returns null before the first bar so the
// caller can clamp to the song start.
export function previousBarStart(
  barLines: number[],
  time: number,
  eps = BAR_NAV_EPS,
): number | null {
  let best: number | null = null;
  for (const b of barLines) {
    if (b < time - eps) best = b;
    else break; // ascending: no later line qualifies
  }
  return best;
}

// Forward-button target: the start of the next bar — the first bar line strictly
// after `time` (plus the epsilon). Returns null past the last bar so the caller can
// clamp to the song end.
export function nextBarStart(barLines: number[], time: number, eps = BAR_NAV_EPS): number | null {
  for (const b of barLines) {
    if (b > time + eps) return b; // ascending: the first one wins
  }
  return null;
}

// Error-nav targets for the Errors sidebar section: the nearest error time strictly
// after (`nextErrorTime`) or before (`previousErrorTime`) `time`, wrapping around the
// song when none lie ahead/behind — forward past the last error lands on the first,
// back before the first lands on the last. `times` need not be sorted. Both return
// null only when there are no errors.
export function nextErrorTime(times: number[], time: number, eps = BAR_NAV_EPS): number | null {
  let ahead: number | null = null;
  let earliest: number | null = null;
  for (const t of times) {
    if (earliest === null || t < earliest) earliest = t;
    if (t > time + eps && (ahead === null || t < ahead)) ahead = t;
  }
  return ahead ?? earliest; // wrap to the earliest error when none lie ahead
}

export function previousErrorTime(times: number[], time: number, eps = BAR_NAV_EPS): number | null {
  let behind: number | null = null;
  let latest: number | null = null;
  for (const t of times) {
    if (latest === null || t > latest) latest = t;
    if (t < time - eps && (behind === null || t > behind)) behind = t;
  }
  return behind ?? latest; // wrap to the latest error when none lie behind
}
