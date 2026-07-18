// Shared cymbal-gem outline so the SVG swatch (MIDI map) and the canvas gems
// (preview) render an identical shape (docs/STYLE_GUIDE.md → Note visuals).

export type PathCommand =
  | { cmd: 'M'; x: number; y: number }
  | { cmd: 'L'; x: number; y: number }
  | { cmd: 'Q'; cx: number; cy: number; x: number; y: number };

// Softened cymbal bottom. Tunable.
export const CYMBAL_BOTTOM_BOW = 0.1; // bottom edge dips ~half this × triangle height
export const CYMBAL_CORNER_RADIUS = 0.14; // bottom-corner round, fraction of full width

// Dynamic edge-decoration sizes (docs/STYLE_GUIDE.md → Note visuals → Dynamics). Tunable.
export const ACCENT_SIDE_FRAC = 0.18; // accent pad white strip, fraction of width each side
export const NEUTRAL_SIDE_FRAC = 0.09; // neutral/ghost gray strip — narrower than accent
export const CYMBAL_RIM_FRAC = 0.18; // cymbal bottom rim thickness, fraction of gem height
// How far down the cone the white accent cap descends, as a fraction of the cymbal's height
// from the apex. The same fraction sets the cap's half-width, so its corners sit on the cone
// slant. Below mid-height (0.5) so the cap doesn't reach so far down the gem. Tunable.
export const CYMBAL_CAP_FRAC = 0.425;

// The cap's bottom edge bows down this fraction of the cymbal height — exaggerated past the
// strict cross-section bow so the small cap still reads as a cone slice, not a flat lid. Tunable.
export const CYMBAL_CAP_BOW = 0.075;

// A cymbal gem outline: sharp top apex, two rounded bottom corners, and a gently
// down-bowed bottom edge. The caller closes the path — the closing segment runs
// straight up the left side from the final point back to the apex.
export function cymbalOutline(
  cx: number,
  apexY: number,
  halfWidth: number,
  bottomY: number,
): PathCommand[] {
  const height = bottomY - apexY;
  const r = CYMBAL_CORNER_RADIUS * (2 * halfWidth);
  const bow = CYMBAL_BOTTOM_BOW * height;
  const rightX = cx + halfWidth;
  const leftX = cx - halfWidth;
  // Fraction r up each slanted side from its bottom corner toward the apex.
  const t = r / Math.hypot(halfWidth, height);
  const r1x = rightX + (cx - rightX) * t;
  const sideY = bottomY + (apexY - bottomY) * t; // shared by both sides (symmetric)
  const l1x = leftX + (cx - leftX) * t;
  return [
    { cmd: 'M', x: cx, y: apexY },
    { cmd: 'L', x: r1x, y: sideY },
    { cmd: 'Q', cx: rightX, cy: bottomY, x: rightX - r, y: bottomY }, // round BR
    { cmd: 'Q', cx, cy: bottomY + bow, x: leftX + r, y: bottomY }, // bowed bottom edge
    { cmd: 'Q', cx: leftX, cy: bottomY, x: l1x, y: sideY }, // round BL
  ];
}

// A list of path commands as a closed SVG path `d` string.
export function pathData(cmds: readonly PathCommand[]): string {
  const parts = cmds.map((c) =>
    c.cmd === 'M'
      ? `M${c.x} ${c.y}`
      : c.cmd === 'L'
        ? `L${c.x} ${c.y}`
        : `Q${c.cx} ${c.cy} ${c.x} ${c.y}`,
  );
  return `${parts.join(' ')} Z`;
}

// The outline as a closed SVG path `d` string.
export function cymbalPathData(
  cx: number,
  apexY: number,
  halfWidth: number,
  bottomY: number,
): string {
  return pathData(cymbalOutline(cx, apexY, halfWidth, bottomY));
}

// The accent white cap: the top portion of the cone lit white. Sharp apex, corners on the
// cone slant at CYMBAL_CAP_FRAC of the height (so the cap's half-width matches the cone's
// cross-section there), and a bottom edge that bows downward like the base — so the cap sits
// on the tilted cone, not flat across it. The caller closes the path (up the left slant).
export function cymbalCapPath(
  cx: number,
  apexY: number,
  halfWidth: number,
  bottomY: number,
): PathCommand[] {
  const height = bottomY - apexY;
  const capY = apexY + CYMBAL_CAP_FRAC * height;
  const capHalf = CYMBAL_CAP_FRAC * halfWidth;
  const bow = CYMBAL_CAP_BOW * height;
  return [
    { cmd: 'M', x: cx, y: apexY },
    { cmd: 'L', x: cx + capHalf, y: capY },
    { cmd: 'Q', cx, cy: capY + bow, x: cx - capHalf, y: capY },
  ];
}

// The cymbal bottom rim as a closed band: the outline's bowed bottom edge, plus that same
// edge raised by `rim`. The band is uniformly thick (measured vertically) and its top follows
// the bottom's bow — sweeping up at the sides like a cone's front rim in perspective. Draw it
// clipped to the cymbal outline so the raised inner edge is trimmed by the slanted sides.
export function cymbalRimBand(
  cx: number,
  apexY: number,
  halfWidth: number,
  bottomY: number,
  rim: number,
): PathCommand[] {
  const [, l, br, bow, bl] = cymbalOutline(cx, apexY, halfWidth, bottomY);
  const q = (c: PathCommand) => c as Extract<PathCommand, { cmd: 'Q' }>;
  return [
    { cmd: 'M', x: l.x, y: l.y }, // right tangent, where the bottom edge begins
    br,
    bow,
    bl, // forward along the bowed bottom edge
    { cmd: 'L', x: bl.x, y: bl.y - rim }, // up to the raised inner edge, then back along it
    { cmd: 'Q', cx: q(bl).cx, cy: q(bl).cy - rim, x: bow.x, y: bow.y - rim },
    { cmd: 'Q', cx: q(bow).cx, cy: q(bow).cy - rim, x: br.x, y: br.y - rim },
    { cmd: 'Q', cx: q(br).cx, cy: q(br).cy - rim, x: l.x, y: l.y - rim },
  ];
}
