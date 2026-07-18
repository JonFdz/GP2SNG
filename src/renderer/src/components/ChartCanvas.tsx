import { useEffect, useRef } from 'react';
import type { DrumDynamic, YargNote } from '../../../shared/types/index';
import {
  type ChartLayout,
  currentBarIndex,
  currentSectionName,
  errorLineAt,
  flashIntensity,
  flashNote,
  highwayMetrics,
  hitTest,
  laneIndex,
  laneX,
  noteBottomRight,
  noteDims,
  noteToY,
  type PlacedNote,
} from '../playback/geometry';
import type { NoteRef } from '../state/wizardStore';
import {
  CONE_DARKEN,
  CONE_STOPS,
  CYLINDER_STOPS,
  darken,
  darkenChannels,
  GHOST_DARKEN,
  NEUTRAL_EDGE,
} from './noteShading';
import {
  ACCENT_SIDE_FRAC,
  CYMBAL_BOTTOM_BOW,
  CYMBAL_RIM_FRAC,
  cymbalCapPath,
  cymbalOutline,
  cymbalRimBand,
  NEUTRAL_SIDE_FRAC,
  type PathCommand,
} from './noteShapes';
import { NOTE_COLORS } from './YargNoteSwatch';

// The 4-lane scrolling chart (docs/DESIGN.md → Chart preview → Chart geometry &
// rendering). Canvas 2D + a RAF loop; all note↔pixel math lives in
// playback/geometry.ts — this component only paints and forwards pointer events.

const HIT_BAR_THICK = 8; // white strike bar (tune)
const GRAY_TAIL = 36; // gray highway continues this far below the thick bar (tune)
// The hit line sits exactly a thick bar + gray tail above the canvas bottom, so the
// highway strip fills the canvas and its rounded bottom ends right below the bar
// label — no dead page-colored margin, and nothing to overlap the bar-nav buttons.
const HIT_LINE_MARGIN = HIT_BAR_THICK + GRAY_TAIL;
const FLASH_MAX_ALPHA = 0.9; // peak alpha of the note-colored flash overlay on the bars (tune)
const CORNER_RADIUS = 4; // pad corner radius (tune)
const KICK_Y_OFFSET = 4; // nudge the kick bar down so it reads below the lane gems (tune)
const WHEEL_NOTCH = 0.2; // seconds scrubbed per wheel notch (docs/DESIGN.md → Scroll-wheel)

const WHITE = '#e6eaf0'; // the accent white: pad side strips + accent-cymbal apex cap & bottom rim (--text-primary)
export const HIT_LINE = '#ffffff'; // resting hit-line bars, full white; shared with the minimap's current-position line
const GEM_OUTLINE = '#ffffff'; // white outline on the hovered gem and the context-menu target
const CANVAS_BG = '#0e1319'; // --bg-base (canvas margins beside the highway)
const HIGHWAY_BG = '#171e27'; // --bg-surface (the highway strip)
const BAR_LINE = '#7c8794'; // measure lines under the gems, the lighter/more prominent of the two grays (tune)
const BAR_LINE_WIDTH = 4; // measure lines, 4x the earlier 1px (spec §3, tune)
const SUBDIVISION_LINE = '#4b5563'; // beat-subdivision lines: darker than the measure lines, still light gray (tune)
const SUBDIVISION_LINE_WIDTH = 2; // subdivision lines, thinner than the measure lines (tune)
const HIGHWAY_RADIUS = 10; // matches --radius-lg; rounds the highway strip's bottom to match its top
const BAR_LABEL_FONT = '400 16px Inter, system-ui, sans-serif'; // live bar label in the gray tail
const BAR_LABEL_COLOR = '#8a93a0'; // --text-muted: dim/thin so the label reads without glare
const ERROR_LINE = '#ff3b30'; // blocking-error underline; matches the gutter error dot, brighter than the red snare
const ERROR_LINE_RGB = darkenChannels(ERROR_LINE, 0); // "r,g,b" of ERROR_LINE, for the edge-fade gradient
const ERROR_LINE_THICK = 32; // error-underline thickness (tune) — 4x its earlier height, flat middle with soft top/bottom edges
const ERROR_LINE_OVERHANG = 8; // px each rounded end spills past the highway edges for visibility (tune)
const ERROR_LINE_ALPHA = 0.6; // flat opacity held across the band's middle (spec)
const ERROR_LINE_FADE = 0.15; // fraction of the band height at each edge over which the fill ramps to 0 (tune)
const ERROR_LINE_PINK_RGB = '255,150,170'; // lighter pink at the band's vertical center (tune)

interface ChartCanvasProps {
  placed: PlacedNote[];
  barLines: number[]; // measure-start times in seconds
  divisionLines: number[]; // interior beat-subdivision times in seconds
  errorLines: { seconds: number; messages: string[] }[]; // blocking-error ticks (time + messages) drawn as red underlines
  barNumbers: (number | null)[]; // GP document bar per measure line, aligned with barLines; null for lead-in bars
  leadInBars: number; // count of leading empty lead-in bars (labeled "Lead-in 1", "Lead-in 2", …)
  viewTime: number; // used while stopped
  isPlaying: boolean;
  pixelsPerSecond: number;
  songEnd: number;
  selectedRef: NoteRef | null;
  getChartTime: () => number; // scheduler master clock, used while playing
  onScrub: (deltaSeconds: number) => void;
  onReachEnd: () => void;
  onHover: (note: YargNote | null, clientX: number, clientY: number) => void;
  onErrorHover: (messages: string[] | null, clientX: number, clientY: number) => void;
  onActivate: (note: YargNote | null, clientX: number, clientY: number) => void;
  onDelete: (note: YargNote) => void; // right-click deletes the gem under the cursor
  sections: { name: string; seconds: number }[];
}

export function ChartCanvas(props: ChartCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Latest props for the RAF loop / event handlers, avoiding stale closures.
  const propsRef = useRef(props);
  propsRef.current = props;
  const endFired = useRef(false);
  // The gem under the cursor, or null when off any gem. Tracked in a ref so mouse
  // moves paint the hover outline without re-rendering; the RAF loop reads it each frame.
  const hoveredRef = useRef<NoteRef | null>(null);

  // Reset the end-of-song guard whenever playback (re)starts.
  useEffect(() => {
    if (props.isPlaying) endFired.current = false;
  }, [props.isPlaying]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    const ctx = canvas.getContext('2d');
    if (ctx === null) return;

    let raf = 0;
    const draw = () => {
      const p = propsRef.current;
      const dpr = window.devicePixelRatio || 1;
      const cssWidth = canvas.clientWidth;
      const cssHeight = canvas.clientHeight;
      if (canvas.width !== cssWidth * dpr || canvas.height !== cssHeight * dpr) {
        canvas.width = cssWidth * dpr;
        canvas.height = cssHeight * dpr;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const time = p.isPlaying ? p.getChartTime() : p.viewTime;
      if (p.isPlaying && time >= p.songEnd && !endFired.current) {
        endFired.current = true;
        p.onReachEnd();
      }
      const { highwayLeft, highwayWidth } = highwayMetrics(cssWidth);
      const hitLineY = cssHeight - HIT_LINE_MARGIN;
      const layout: ChartLayout = {
        width: cssWidth,
        height: cssHeight,
        highwayLeft,
        highwayWidth,
        hitLineY,
        highwayBottomY: hitLineY + HIT_BAR_THICK + GRAY_TAIL,
        pixelsPerSecond: p.pixelsPerSecond,
      };
      const flash = p.isPlaying ? flashIntensity(p.placed, time) : 0;
      const flashBase = p.isPlaying ? flashNote(p.placed, time) : null;
      paint(
        ctx,
        layout,
        p.placed,
        p.barLines,
        p.divisionLines,
        time,
        p.selectedRef,
        hoveredRef.current,
        flash,
        flashBase === null ? null : NOTE_COLORS[flashBase],
        p.sections,
        p.barNumbers,
        p.leadInBars,
        p.errorLines,
      );
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  // Capture wheel over the canvas so scrubbing the highway does not also scroll
  // the page. React's onWheel is passive (preventDefault ignored), so bind a
  // native non-passive listener (docs/DESIGN.md → Scroll-wheel navigation).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      // Inverted: wheel down navigates down (forward), wheel up navigates up.
      propsRef.current.onScrub(-Math.sign(e.deltaY) * WHEEL_NOTCH);
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, []);

  function localPoint(e: { clientX: number; clientY: number }) {
    const rect = canvasRef.current?.getBoundingClientRect();
    return { x: e.clientX - (rect?.left ?? 0), y: e.clientY - (rect?.top ?? 0) };
  }

  function currentLayout(): ChartLayout {
    const canvas = canvasRef.current;
    const w = canvas?.clientWidth ?? 0;
    const h = canvas?.clientHeight ?? 0;
    const { highwayLeft, highwayWidth } = highwayMetrics(w);
    const hitLineY = h - HIT_LINE_MARGIN;
    return {
      width: w,
      height: h,
      highwayLeft,
      highwayWidth,
      hitLineY,
      highwayBottomY: hitLineY + HIT_BAR_THICK + GRAY_TAIL,
      pixelsPerSecond: propsRef.current.pixelsPerSecond,
    };
  }

  function effectiveTime(): number {
    const p = propsRef.current;
    return p.isPlaying ? p.getChartTime() : p.viewTime;
  }

  // The gem's bottom-right corner in client (viewport) coordinates — where the hover
  // tooltip and the context menu anchor. Null when the note isn't currently placed.
  function gemAnchor(note: YargNote): { x: number; y: number } | null {
    const canvas = canvasRef.current;
    if (canvas === null) return null;
    const corner = noteBottomRight(note, effectiveTime(), propsRef.current.placed, currentLayout());
    if (corner === null) return null;
    const rect = canvas.getBoundingClientRect();
    return { x: rect.left + corner.x, y: rect.top + corner.y };
  }

  // The middle of an error underline in client coordinates — the horizontal center of
  // the highway at the line's tick, where its hover tooltip pins its bottom-left corner
  // (the tooltip then grows up and to the right). Pinned to the line, not the cursor,
  // so the text holds still while hovering.
  function errorLineAnchor(seconds: number): { x: number; y: number } {
    const canvas = canvasRef.current;
    const layout = currentLayout();
    const rect = canvas?.getBoundingClientRect();
    const y = noteToY(seconds, effectiveTime(), layout);
    return {
      x: (rect?.left ?? 0) + layout.highwayLeft + layout.highwayWidth / 2,
      y: (rect?.top ?? 0) + y,
    };
  }

  return (
    <canvas
      ref={canvasRef}
      className="chart-canvas"
      onMouseMove={(e) => {
        const { x, y } = localPoint(e);
        // A gem takes priority over an error underline beneath it: hovering a gem shows
        // its MIDI tooltip, and only bare highway over a line shows the error message.
        const hit = hitTest(x, y, effectiveTime(), propsRef.current.placed, currentLayout());
        if (hit !== null) {
          propsRef.current.onErrorHover(null, 0, 0);
          hoveredRef.current = { tick: hit.tick, midi: hit.midi };
          const anchor = gemAnchor(hit);
          propsRef.current.onHover(hit, anchor?.x ?? 0, anchor?.y ?? 0);
          return;
        }
        hoveredRef.current = null;
        propsRef.current.onHover(null, 0, 0);
        const errorLine = errorLineAt(
          x,
          y,
          effectiveTime(),
          propsRef.current.errorLines,
          currentLayout(),
        );
        if (errorLine !== null) {
          const anchor = errorLineAnchor(errorLine.seconds);
          propsRef.current.onErrorHover(errorLine.messages, anchor.x, anchor.y);
          return;
        }
        propsRef.current.onErrorHover(null, 0, 0);
      }}
      onMouseLeave={() => {
        hoveredRef.current = null;
        propsRef.current.onHover(null, 0, 0);
        propsRef.current.onErrorHover(null, 0, 0);
      }}
      onClick={(e) => {
        const { x, y } = localPoint(e);
        const hit = hitTest(x, y, effectiveTime(), propsRef.current.placed, currentLayout());
        const anchor = hit === null ? null : gemAnchor(hit);
        propsRef.current.onActivate(hit, anchor?.x ?? e.clientX, anchor?.y ?? e.clientY);
      }}
      onContextMenu={(e) => {
        // Right-click quick-deletes the gem under the cursor; left-click (above) opens the
        // reassign/delete menu. preventDefault suppresses the native context menu.
        e.preventDefault();
        const { x, y } = localPoint(e);
        const hit = hitTest(x, y, effectiveTime(), propsRef.current.placed, currentLayout());
        if (hit !== null) propsRef.current.onDelete(hit);
      }}
    />
  );
}

function paint(
  ctx: CanvasRenderingContext2D,
  layout: ChartLayout,
  placed: PlacedNote[],
  barLines: number[],
  divisionLines: number[],
  viewTime: number,
  selectedRef: NoteRef | null,
  hoveredRef: NoteRef | null,
  flash: number,
  flashColor: string | null,
  sections: { name: string; seconds: number }[],
  barNumbers: (number | null)[],
  leadInBars: number,
  errorLines: { seconds: number; messages: string[] }[],
) {
  const { width, height, highwayLeft, highwayWidth, hitLineY, highwayBottomY } = layout;
  const grayEndY = highwayBottomY;

  // Dark canvas, then the centered highway strip down to the end of the gray tail. The
  // canvas is a little wider than the highway (thin dark margins each side, so the error
  // caps can overhang), so the strip no longer touches the element's rounded edges — all
  // four corners are rounded here instead of leaning on the canvas border-radius.
  ctx.fillStyle = CANVAS_BG;
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = HIGHWAY_BG;
  ctx.beginPath();
  ctx.roundRect(highwayLeft, 0, highwayWidth, grayEndY, HIGHWAY_RADIUS);
  ctx.fill();

  // Beat-subdivision lines under the gems (culled to the play area), drawn beneath the
  // measure lines so the heavier bar lines read on top of any coincident pixels.
  ctx.strokeStyle = SUBDIVISION_LINE;
  ctx.lineWidth = SUBDIVISION_LINE_WIDTH;
  for (const seconds of divisionLines) {
    const y = noteToY(seconds, viewTime, layout);
    if (y < 0 || y > hitLineY) continue;
    ctx.beginPath();
    ctx.moveTo(highwayLeft, y);
    ctx.lineTo(highwayLeft + highwayWidth, y);
    ctx.stroke();
  }

  // Gray measure lines under the gems (culled to the play area).
  ctx.strokeStyle = BAR_LINE;
  ctx.lineWidth = BAR_LINE_WIDTH;
  for (const seconds of barLines) {
    const y = noteToY(seconds, viewTime, layout);
    if (y < 0 || y > hitLineY) continue;
    ctx.beginPath();
    ctx.moveTo(highwayLeft, y);
    ctx.lineTo(highwayLeft + highwayWidth, y);
    ctx.stroke();
  }

  // Thick white strike bar (gems pass over it).
  ctx.fillStyle = HIT_LINE;
  ctx.fillRect(highwayLeft, hitLineY, highwayWidth, HIT_BAR_THICK);

  // Gems, clipped to the highway/gray region so they vanish at the gray end. The clip
  // is widened horizontally by ERROR_LINE_OVERHANG so the error underlines' rounded
  // caps can spill past the strip edges into the dark margin; gems never reach the
  // edges, so the extra width only affects those caps. Bottom corners stay rounded so
  // gems still vanish at the gray end. Two passes so pad/cymbal gems always render over
  // the kick (spec §3).
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(
    highwayLeft - ERROR_LINE_OVERHANG,
    0,
    highwayWidth + 2 * ERROR_LINE_OVERHANG,
    grayEndY,
    [0, 0, HIGHWAY_RADIUS, HIGHWAY_RADIUS],
  );
  ctx.clip();

  // Kick pass first, then the red error underlines, then the pad/cymbal pass. This
  // stacks each error underline *beneath* the lane gems it marks (so it no longer cuts
  // them off) yet above the kick bar and the gray bar/subdivision lines, so an error
  // stays visible whatever lanes are filled or whether a kick sits on the tick. Each
  // line is full highway width plus overhanging pill caps, centered on the tick (a
  // gem's bottom edge), with a top/bottom alpha fade that softens its edges into the
  // highway.
  drawPass(ctx, placed, viewTime, layout, selectedRef, hoveredRef, grayEndY, true);
  for (const e of errorLines) {
    const y = noteToY(e.seconds, viewTime, layout);
    // Cull by the band's *edges* (not just its center) so a tall line near the highway
    // top/bottom doesn't pop in/out; the clip trims whatever spills past the ends.
    if (y < -ERROR_LINE_THICK / 2 || y > grayEndY + ERROR_LINE_THICK / 2) continue;
    const top = y - ERROR_LINE_THICK / 2;
    ctx.fillStyle = errorLineGradient(ctx, top, top + ERROR_LINE_THICK);
    roundRect(
      ctx,
      highwayLeft - ERROR_LINE_OVERHANG,
      top,
      highwayWidth + 2 * ERROR_LINE_OVERHANG,
      ERROR_LINE_THICK,
      ERROR_LINE_THICK / 2,
    );
    ctx.fill();
  }
  drawPass(ctx, placed, viewTime, layout, selectedRef, hoveredRef, grayEndY, false);
  ctx.restore();

  // Playback flash: tint the bar toward the crossing note's color (spec §6).
  if (flash > 0) {
    ctx.save();
    ctx.globalAlpha = flash * FLASH_MAX_ALPHA;
    ctx.fillStyle = flashColor ?? '#ffffff';
    ctx.fillRect(highwayLeft, hitLineY, highwayWidth, HIT_BAR_THICK);
    ctx.restore();
  }

  // Section + bar label in the gray tail, over the highway: "{section} - bar N",
  // adding "(GP bar M)" only when the played bar differs from the GP bar under a
  // repeat. While the hit line is inside the lead-in bars the core reads
  // "Lead-in N" (1-based; those bars belong to no song bar). White with a
  // highway-colored outline for legibility (batch 4 §3).
  const idx = currentBarIndex(barLines, viewTime);
  if (idx >= 0) {
    let core: string;
    if (idx < leadInBars) {
      core = `Lead-in ${idx + 1}`;
    } else {
      const playedBar = idx - leadInBars + 1;
      const gpBar = barNumbers[idx];
      core =
        gpBar != null && gpBar !== playedBar
          ? `bar ${playedBar} (GP bar ${gpBar})`
          : `bar ${playedBar}`;
    }
    const section = currentSectionName(sections, viewTime);
    const label = section === null ? core : `${section} - ${core}`;
    const lx = highwayLeft + highwayWidth / 2;
    const ly = (hitLineY + HIT_BAR_THICK + grayEndY) / 2;
    ctx.save();
    ctx.font = BAR_LABEL_FONT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 3;
    ctx.strokeStyle = HIGHWAY_BG;
    ctx.strokeText(label, lx, ly);
    ctx.fillStyle = BAR_LABEL_COLOR;
    ctx.fillText(label, lx, ly);
    ctx.restore();
  }
}

function refMatches(ref: NoteRef | null, note: YargNote): boolean {
  return ref !== null && note.tick === ref.tick && note.midi === ref.midi;
}

// One z-order pass: `kicks` true draws only kicks, false draws only lane gems.
function drawPass(
  ctx: CanvasRenderingContext2D,
  placed: PlacedNote[],
  viewTime: number,
  layout: ChartLayout,
  selectedRef: NoteRef | null,
  hoveredRef: NoteRef | null,
  grayEndY: number,
  kicks: boolean,
) {
  for (const p of placed) {
    const isKick = laneIndex(p.note.note) === null;
    if (isKick !== kicks) continue;
    const yBottom = noteToY(p.seconds, viewTime, layout);
    if (yBottom < -80 || yBottom > grayEndY + 80) continue;
    // Outline the gem the cursor is over (hover) and the one the context menu targets
    // (selection); the selection outline holds even after the cursor leaves the gem.
    const outlined = refMatches(hoveredRef, p.note) || refMatches(selectedRef, p.note);
    drawNote(ctx, p.note, yBottom, layout, outlined);
  }
}

// A vertical fill (darker top/bottom edges, base in the center) so a gem reads as a
// cylinder lying on its side (docs/STYLE_GUIDE.md → Note visuals).
function vGradient(
  ctx: CanvasRenderingContext2D,
  yTop: number,
  yBottom: number,
  color: string,
): CanvasGradient {
  const grad = ctx.createLinearGradient(0, yTop, 0, yBottom);
  for (const stop of CYLINDER_STOPS) {
    grad.addColorStop(stop.offset, stop.darken === 0 ? color : darken(color, stop.darken));
  }
  return grad;
}

// Horizontal cone shade for a cymbal in `color`: darkened toward the left/right edges,
// transparent at the center (docs/STYLE_GUIDE.md → Note visuals). Shared by the base fill and
// the bottom rim so the rim reads as part of the same lit cone.
function coneGradient(
  ctx: CanvasRenderingContext2D,
  cx: number,
  half: number,
  color: string,
): CanvasGradient {
  const grad = ctx.createLinearGradient(cx - half, 0, cx + half, 0);
  const channels = darkenChannels(color, CONE_DARKEN);
  for (const stop of CONE_STOPS) grad.addColorStop(stop.offset, `rgba(${channels},${stop.alpha})`);
  return grad;
}

// The error underline's vertical fill: red at ERROR_LINE_ALPHA that lightens to pink at the
// band's vertical center and ramps to transparent over ERROR_LINE_FADE of the height at each
// edge, so the band reads pinker in the middle and melts into the highway at top and bottom.
function errorLineGradient(
  ctx: CanvasRenderingContext2D,
  yTop: number,
  yBottom: number,
): CanvasGradient {
  const grad = ctx.createLinearGradient(0, yTop, 0, yBottom);
  grad.addColorStop(0, `rgba(${ERROR_LINE_RGB},0)`);
  grad.addColorStop(ERROR_LINE_FADE, `rgba(${ERROR_LINE_RGB},${ERROR_LINE_ALPHA})`);
  grad.addColorStop(0.5, `rgba(${ERROR_LINE_PINK_RGB},${ERROR_LINE_ALPHA})`);
  grad.addColorStop(1 - ERROR_LINE_FADE, `rgba(${ERROR_LINE_RGB},${ERROR_LINE_ALPHA})`);
  grad.addColorStop(1, `rgba(${ERROR_LINE_RGB},0)`);
  return grad;
}

function drawNote(
  ctx: CanvasRenderingContext2D,
  note: YargNote,
  yBottom: number,
  layout: ChartLayout,
  outlined: boolean,
) {
  const dims = noteDims(layout.highwayWidth / 4);
  const lane = laneIndex(note.note);
  const color = NOTE_COLORS[note.note];
  if (lane === null) {
    drawKick(ctx, yBottom, dims.kickHeight, layout, outlined);
    return;
  }
  const cx = laneX(lane, layout);
  const gf = ghostFactor(note.dynamic);
  if (note.note.endsWith('Cymbal')) {
    const w = dims.cymbalWidth * gf;
    let h = dims.cymbalHeight;
    if (note.dynamic === 'ghost') h *= 0.8; // ghost cymbals ~20% shorter
    drawCymbal(ctx, cx, yBottom, w, h, color, note.dynamic, outlined);
  } else {
    drawPad(ctx, cx, yBottom, dims.padWidth * gf, dims.padHeight, color, note.dynamic, outlined);
  }
}

function ghostFactor(dynamic: DrumDynamic): number {
  return dynamic === 'ghost' ? 0.5 : 1; // 50% narrower (docs/STYLE_GUIDE.md)
}

function drawKick(
  ctx: CanvasRenderingContext2D,
  yBottom: number,
  h: number,
  layout: ChartLayout,
  outlined: boolean,
) {
  const x = layout.highwayLeft;
  const w = layout.highwayWidth;
  const y = yBottom - h + KICK_Y_OFFSET;
  ctx.fillStyle = vGradient(ctx, y, y + h, NOTE_COLORS.orange);
  roundRect(ctx, x, y, w, h, 3);
  ctx.fill();
  if (outlined) {
    roundRect(ctx, x, y, w, h, 3);
    strokeOutline(ctx);
  }
}

function drawPad(
  ctx: CanvasRenderingContext2D,
  cx: number,
  yBottom: number,
  w: number,
  h: number,
  color: string,
  dynamic: DrumDynamic,
  outlined: boolean,
) {
  const base = dynamic === 'ghost' ? darken(color, GHOST_DARKEN) : color;
  const x = cx - w / 2;
  const y = yBottom - h;
  ctx.fillStyle = vGradient(ctx, y, y + h, base);
  roundRect(ctx, x, y, w, h, CORNER_RADIUS);
  ctx.fill();
  // Left/right side strips, clipped to the rounded rect (docs/STYLE_GUIDE.md → Dynamics):
  // white and wide for accents, light gray and narrow for normal/ghost. Carry the same
  // vertical cylinder gradient as the body so they read as part of the same 3D gem.
  const accent = dynamic === 'accent';
  ctx.save();
  roundRect(ctx, x, y, w, h, CORNER_RADIUS);
  ctx.clip();
  ctx.fillStyle = vGradient(ctx, y, y + h, accent ? WHITE : NEUTRAL_EDGE);
  const strip = w * (accent ? ACCENT_SIDE_FRAC : NEUTRAL_SIDE_FRAC);
  ctx.fillRect(x, y, strip, h);
  ctx.fillRect(x + w - strip, y, strip, h);
  ctx.restore();
  if (outlined) {
    roundRect(ctx, x, y, w, h, CORNER_RADIUS);
    strokeOutline(ctx);
  }
}

function drawCymbal(
  ctx: CanvasRenderingContext2D,
  cx: number,
  yBottom: number,
  w: number,
  h: number,
  color: string,
  dynamic: DrumDynamic,
  outlined: boolean,
) {
  const base = dynamic === 'ghost' ? darken(color, GHOST_DARKEN) : color;
  const bottom = yBottom;
  const top = yBottom - h;
  const half = w / 2;
  const bow = CYMBAL_BOTTOM_BOW * h; // how far the bottom edge dips below `bottom`
  // Base cymbal shape in the lane color.
  ctx.fillStyle = base;
  traceCymbal(ctx, cx, top, half, bottom);
  ctx.fill();
  // Cone shade: a horizontal gradient (dark at the left/right edges, transparent at the
  // center) clipped to the cymbal shape, so it reads as a lit cone. The fill extends through
  // the bow (h + bow) so the shading reaches the bowed bottom instead of cutting off flat.
  ctx.save();
  traceCymbal(ctx, cx, top, half, bottom);
  ctx.clip();
  ctx.fillStyle = coneGradient(ctx, cx, half, base);
  ctx.fillRect(cx - half, top, w, h + bow);
  ctx.restore();
  // Bottom rim (docs/STYLE_GUIDE.md → Dynamics): white for accents, light gray otherwise,
  // cone-shaded like the body so it reads as part of the same lit cone. Clipped to the shape
  // (and the band) so its raised inner edge is trimmed by the slanted sides.
  const rimColor = dynamic === 'accent' ? WHITE : NEUTRAL_EDGE;
  ctx.save();
  traceCymbal(ctx, cx, top, half, bottom);
  ctx.clip();
  tracePath(ctx, cymbalRimBand(cx, top, half, bottom, h * CYMBAL_RIM_FRAC));
  ctx.clip();
  ctx.fillStyle = rimColor;
  ctx.fillRect(cx - half, top, w, h + bow);
  ctx.fillStyle = coneGradient(ctx, cx, half, rimColor);
  ctx.fillRect(cx - half, top, w, h + bow);
  ctx.restore();
  if (dynamic === 'accent') {
    // Apex cap: the top portion, its bottom edge bowed to match the cone's tilt. Filled with
    // the accent white (WHITE), slightly duller than the pure-white rim so it reads less harshly.
    tracePath(ctx, cymbalCapPath(cx, top, half, bottom));
    ctx.fillStyle = WHITE;
    ctx.fill();
  }
  if (outlined) {
    traceCymbal(ctx, cx, top, half, bottom);
    strokeOutline(ctx);
  }
}

function strokeOutline(ctx: CanvasRenderingContext2D) {
  // Called immediately after a path is built; strokes that path as a white outline.
  ctx.strokeStyle = GEM_OUTLINE;
  ctx.lineWidth = 2;
  ctx.stroke();
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

// Build a closed canvas path from a list of shared path commands (the caller then fills or
// clips). Shared by the cymbal outline, its bottom rim, and the accent cap.
function tracePath(ctx: CanvasRenderingContext2D, cmds: readonly PathCommand[]) {
  ctx.beginPath();
  for (const c of cmds) {
    if (c.cmd === 'M') ctx.moveTo(c.x, c.y);
    else if (c.cmd === 'L') ctx.lineTo(c.x, c.y);
    else ctx.quadraticCurveTo(c.cx, c.cy, c.x, c.y);
  }
  ctx.closePath();
}

function traceCymbal(
  ctx: CanvasRenderingContext2D,
  cx: number,
  apexY: number,
  halfWidth: number,
  bottomY: number,
) {
  tracePath(ctx, cymbalOutline(cx, apexY, halfWidth, bottomY));
}
