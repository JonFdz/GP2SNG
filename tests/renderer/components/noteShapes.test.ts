import { describe, expect, it } from 'vitest';
import {
  CYMBAL_BOTTOM_BOW,
  CYMBAL_CAP_BOW,
  CYMBAL_CAP_FRAC,
  CYMBAL_CORNER_RADIUS,
  cymbalCapPath,
  cymbalOutline,
  cymbalPathData,
  cymbalRimBand,
  pathData,
} from '../../../src/renderer/src/components/noteShapes';

// Swatch box: apex (12,2), bottom corners (2,15) and (22,15).
const cmds = cymbalOutline(12, 2, 10, 15);

describe('cymbalOutline', () => {
  it('is a 5-command outline starting at the sharp top apex', () => {
    expect(cmds).toHaveLength(5);
    expect(cmds.map((c) => c.cmd)).toEqual(['M', 'L', 'Q', 'Q', 'Q']);
    expect(cmds[0]).toEqual({ cmd: 'M', x: 12, y: 2 });
  });

  it('rounds each bottom corner with a quadratic controlled at the sharp vertex', () => {
    const r = CYMBAL_CORNER_RADIUS * 20; // fraction of full width (2 * halfWidth)
    // Bottom-right corner: control at BR (22,15), ending r left along the bottom.
    expect(cmds[2]).toMatchObject({ cmd: 'Q', cx: 22, cy: 15 });
    expect(cmds[2].x).toBeCloseTo(22 - r, 6); // x is common to every PathCommand
    // Bottom-left corner: control at BL (2,15).
    expect(cmds[4]).toMatchObject({ cmd: 'Q', cx: 2, cy: 15 });
  });

  it('bows the bottom edge downward, centered', () => {
    const bow = cmds[3];
    expect(bow.cmd).toBe('Q');
    if (bow.cmd === 'Q') {
      expect(bow.cx).toBe(12);
      expect(bow.cy).toBeCloseTo(15 + CYMBAL_BOTTOM_BOW * 13, 6);
      expect(bow.cy).toBeGreaterThan(15);
      expect(bow.x).toBeCloseTo(2 + CYMBAL_CORNER_RADIUS * 20, 6); // ends at L2
    }
  });

  it('is symmetric about the vertical center line', () => {
    const r1 = cmds[1]; // L to the right-side round start
    const l1 = cmds[4]; // Q ending on the left-side round start
    if (r1.cmd === 'L' && l1.cmd === 'Q') {
      expect(r1.x - 12).toBeCloseTo(12 - l1.x, 6);
      expect(r1.y).toBeCloseTo(l1.y, 6);
    }
  });
});

describe('cymbalPathData', () => {
  it('serializes the outline as a closed SVG path', () => {
    const d = cymbalPathData(12, 2, 10, 15);
    expect(d.startsWith('M12 2')).toBe(true);
    expect(d.endsWith('Z')).toBe(true);
  });
});

describe('pathData', () => {
  it('serializes M, L and Q commands and closes the path', () => {
    const d = pathData([
      { cmd: 'M', x: 1, y: 2 },
      { cmd: 'L', x: 3, y: 4 },
      { cmd: 'Q', cx: 5, cy: 6, x: 7, y: 8 },
    ]);
    expect(d).toBe('M1 2 L3 4 Q5 6 7 8 Z');
  });
});

describe('cymbalCapPath', () => {
  // Swatch box: apex (12,2), bottom corners (2,15)/(22,15), height 13.
  const cap = cymbalCapPath(12, 2, 10, 15);
  const capY = 2 + CYMBAL_CAP_FRAC * 13; // cap bottom edge, CYMBAL_CAP_FRAC down the height
  const capHalf = CYMBAL_CAP_FRAC * 10; // half-width matching the cone cross-section there

  it('runs apex → right cap-corner → bowed bottom to the left cap-corner', () => {
    expect(cap.map((c) => c.cmd)).toEqual(['M', 'L', 'Q']);
    expect(cap[0]).toEqual({ cmd: 'M', x: 12, y: 2 });
    // Corners sit on the cone slant at CYMBAL_CAP_FRAC of the height.
    expect(cap[1].cmd).toBe('L');
    expect(cap[1].x).toBeCloseTo(12 + capHalf, 6);
    expect(cap[1].y).toBeCloseTo(capY, 6);
  });

  it('bows its bottom edge downward, exaggerated so the small cap still reads as a cone', () => {
    const bow = cap[2];
    expect(bow.cmd).toBe('Q');
    if (bow.cmd === 'Q') {
      expect(bow.cx).toBe(12);
      expect(bow.x).toBeCloseTo(12 - capHalf, 6);
      expect(bow.y).toBeCloseTo(capY, 6);
      expect(bow.cy).toBeCloseTo(capY + CYMBAL_CAP_BOW * 13, 6);
      expect(bow.cy).toBeGreaterThan(capY);
    }
  });
});

describe('cymbalRimBand', () => {
  const rim = 3;
  const o = cymbalOutline(12, 2, 10, 15);
  const band = cymbalRimBand(12, 2, 10, 15, rim);

  it('traces the outline bottom edge, then the same edge raised by `rim`', () => {
    expect(band.map((c) => c.cmd)).toEqual(['M', 'Q', 'Q', 'Q', 'L', 'Q', 'Q', 'Q']);
    // Forward pass = the outline's bottom edge (its right tangent, then the three curves).
    expect(band[0]).toEqual({ cmd: 'M', x: o[1].x, y: o[1].y });
    expect(band[1]).toEqual(o[2]);
    expect(band[2]).toEqual(o[3]);
    expect(band[3]).toEqual(o[4]);
  });

  it('returns along a copy of that edge shifted uniformly up by `rim`', () => {
    // Step up from the left tangent to the raised inner edge.
    expect(band[4]).toEqual({ cmd: 'L', x: o[4].x, y: o[4].y - rim });
    // Final curve mirrors the outline's bottom-right round, raised by `rim`, back to the start.
    const last = band[7];
    if (last.cmd === 'Q' && o[2].cmd === 'Q') {
      expect(last.cx).toBe(o[2].cx);
      expect(last.cy).toBeCloseTo(o[2].cy - rim, 6);
      expect(last.x).toBe(o[1].x);
      expect(last.y).toBeCloseTo(o[1].y - rim, 6);
    }
  });
});
