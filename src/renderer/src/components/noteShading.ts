// Note-shape edge shading, shared by the MIDI-map swatch (SVG) and the chart
// preview gems (canvas) so both agree exactly (docs/STYLE_GUIDE.md → Note visuals).

function scaledChannels(hex: string, amount: number): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  const scale = (channel: number) => Math.round(channel * (1 - amount));
  return [scale((n >> 16) & 0xff), scale((n >> 8) & 0xff), scale(n & 0xff)];
}

// Darken a `#rrggbb` color by mixing each channel toward black.
export function darken(hex: string, amount = 0.25): string {
  const [r, g, b] = scaledChannels(hex, amount);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

// The darkened channels as an "r,g,b" string, for composing rgba() canvas fills
// (the cone shade needs per-stop alpha, which darken's hex output can't carry).
export function darkenChannels(hex: string, amount = 0.25): string {
  return scaledChannels(hex, amount).join(',');
}

// Neutral/ghost gem edge decoration: the pad side strips and the cymbal bottom rim. A light,
// blue-tinted gray — darker (and drawn narrower) than the accent white so accents still read
// as the brighter, wider treatment. Tunable.
export const NEUTRAL_EDGE = '#a7b0bc';

// Ghost gems render their base color this much darker (fed to darken()) so they read as
// quieter than normal hits, on top of being narrower/shorter. Tunable.
export const GHOST_DARKEN = 0.22;

// Vertical cylinder gradient for pads and the kick bar: base color held across the
// middle, darkening toward the top/bottom edges and ramping steeper near the very
// edge (exponential-style) so the gem reads as a cylinder on its side. `darken` is
// the amount fed to darken() at each offset (0 = base color). Tunable.
export const CYLINDER_STOPS: readonly { offset: number; darken: number }[] = [
  { offset: 0, darken: 0.55 },
  { offset: 0.12, darken: 0.3 },
  { offset: 0.3, darken: 0.08 },
  { offset: 0.5, darken: 0 },
  { offset: 0.7, darken: 0.08 },
  { offset: 0.88, darken: 0.3 },
  { offset: 1, darken: 0.55 },
];

// How dark the cymbal cone edge-shade is (fed to darken/darkenChannels). Tunable.
export const CONE_DARKEN = 0.5;

// Horizontal cone shade for cymbals: the CONE_DARKEN shade fully opaque at the
// left/right edges, fading to transparent at the center, so the triangle reads as a
// lit cone. `alpha` is the shade's opacity at each offset. Tunable.
export const CONE_STOPS: readonly { offset: number; alpha: number }[] = [
  { offset: 0, alpha: 1 },
  { offset: 0.3, alpha: 0.35 },
  { offset: 0.5, alpha: 0 },
  { offset: 0.7, alpha: 0.35 },
  { offset: 1, alpha: 1 },
];
