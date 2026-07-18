import { useId } from 'react';
import type { BaseYargNote } from '../../../shared/types/index';
import { CONE_DARKEN, CONE_STOPS, CYLINDER_STOPS, darken, NEUTRAL_EDGE } from './noteShading';
import {
  ACCENT_SIDE_FRAC,
  CYMBAL_RIM_FRAC,
  cymbalCapPath,
  cymbalPathData,
  cymbalRimBand,
  NEUTRAL_SIDE_FRAC,
  pathData,
} from './noteShapes';

// Note-palette hues (docs/STYLE_GUIDE.md → Note palette). Reused by the MIDI map
// left column and, later, the chart preview and reassign picker.
export const NOTE_COLORS: Record<BaseYargNote, string> = {
  orange: '#db6e24',
  red: '#df3d41',
  yellowTom: '#dbcb24',
  yellowCymbal: '#debc31',
  blueTom: '#24addb',
  blueCymbal: '#3f90e0',
  greenTom: '#75b621',
  greenCymbal: '#93b52b',
};

const NOTE_LABELS: Record<BaseYargNote, string> = {
  red: 'Red (snare)',
  orange: 'Kick',
  yellowCymbal: 'Yellow cymbal',
  yellowTom: 'Yellow tom',
  blueCymbal: 'Blue cymbal',
  blueTom: 'Blue tom',
  greenCymbal: 'Green cymbal',
  greenTom: 'Green tom',
};

export function yargNoteLabel(note: BaseYargNote): string {
  return NOTE_LABELS[note];
}

export function isCymbal(note: BaseYargNote): boolean {
  return note.endsWith('Cymbal');
}

// The accent white (docs/STYLE_GUIDE.md → Note visuals → Accent): pad side strips plus the
// accent-cymbal apex cap and bottom rim, matching ChartCanvas so the MIDI map's accented rows
// read the same as playback.
const ACCENT_WHITE = '#e6eaf0';

// The left-column visual (docs/DESIGN.md → MIDI map component → Layout): a rounded rectangle
// for kick/snare/tom rows, a rounded upward triangle for cymbal rows. A vertical gradient
// gives pads cylindrical depth; cymbals get cone side-shading. Every pad carries left/right
// side strips and every cymbal a bottom rim — white and wide for `accented`, light gray and
// narrow otherwise — and accented cymbals add an accent-white apex cap (docs → Dynamics).
export function YargNoteSwatch({
  note,
  accented = false,
}: {
  note: BaseYargNote;
  accented?: boolean;
}) {
  const color = NOTE_COLORS[note];
  const coneShade = darken(color, CONE_DARKEN);
  const gradientId = useId();
  const coneId = useId();
  const edgeGradId = useId();
  const rimConeId = useId();
  const clipId = useId();
  const cymClipId = useId();
  const cylinder = `url(#${gradientId})`;
  const cymbalPath = cymbalPathData(12, 2, 10, 15);
  const edgeColor = accented ? ACCENT_WHITE : NEUTRAL_EDGE;
  const strip = 20 * (accented ? ACCENT_SIDE_FRAC : NEUTRAL_SIDE_FRAC);
  const rimColor = accented ? ACCENT_WHITE : NEUTRAL_EDGE;
  const rimConeShade = darken(rimColor, CONE_DARKEN);
  const rimPath = pathData(cymbalRimBand(12, 2, 10, 15, (15 - 2) * CYMBAL_RIM_FRAC));
  const capPath = pathData(cymbalCapPath(12, 2, 10, 15));
  return (
    <svg className="swatch" viewBox="0 0 24 16" width="24" height="16" aria-hidden="true">
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          {CYLINDER_STOPS.map((s) => (
            <stop
              key={s.offset}
              offset={`${s.offset * 100}%`}
              stopColor={s.darken === 0 ? color : darken(color, s.darken)}
            />
          ))}
        </linearGradient>
        <linearGradient id={coneId} x1="0" y1="0" x2="1" y2="0">
          {CONE_STOPS.map((s) => (
            <stop
              key={s.offset}
              offset={`${s.offset * 100}%`}
              stopColor={coneShade}
              stopOpacity={s.alpha}
            />
          ))}
        </linearGradient>
        <linearGradient id={edgeGradId} x1="0" y1="0" x2="0" y2="1">
          {CYLINDER_STOPS.map((s) => (
            <stop
              key={s.offset}
              offset={`${s.offset * 100}%`}
              stopColor={s.darken === 0 ? edgeColor : darken(edgeColor, s.darken)}
            />
          ))}
        </linearGradient>
        <linearGradient id={rimConeId} x1="0" y1="0" x2="1" y2="0">
          {CONE_STOPS.map((s) => (
            <stop
              key={s.offset}
              offset={`${s.offset * 100}%`}
              stopColor={rimConeShade}
              stopOpacity={s.alpha}
            />
          ))}
        </linearGradient>
        <clipPath id={clipId}>
          <rect x="2" y="4" width="20" height="10" rx="2" />
        </clipPath>
        <clipPath id={cymClipId}>
          <path d={cymbalPath} />
        </clipPath>
      </defs>
      {isCymbal(note) ? (
        <>
          <path d={cymbalPath} fill={color} />
          <path d={cymbalPath} fill={`url(#${coneId})`} />
          <g clipPath={`url(#${cymClipId})`}>
            <path d={rimPath} fill={rimColor} />
            <path d={rimPath} fill={`url(#${rimConeId})`} />
          </g>
          {accented && <path d={capPath} fill={ACCENT_WHITE} />}
        </>
      ) : (
        <>
          <rect x="2" y="4" width="20" height="10" rx="2" fill={cylinder} />
          <g clipPath={`url(#${clipId})`}>
            <rect x="2" y="4" width={strip} height="10" fill={`url(#${edgeGradId})`} />
            <rect x={22 - strip} y="4" width={strip} height="10" fill={`url(#${edgeGradId})`} />
          </g>
        </>
      )}
    </svg>
  );
}
