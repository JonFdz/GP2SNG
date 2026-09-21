import { describe, expect, it } from 'vitest';
import { previewAudioOffsetSeconds } from '../../../src/renderer/src/audio/index';
import {
  type ChartLayout,
  currentBarIndex,
  currentSectionName,
  ERROR_LINE_HIT_HALF,
  errorLineAt,
  FLASH_DURATION,
  flashIntensity,
  flashNote,
  highwayMetrics,
  hitTest,
  laneIndex,
  laneX,
  minimapLaneX,
  minimapTimeAt,
  minimapY,
  nextBarStart,
  nextErrorTime,
  noteBottomRight,
  noteDims,
  noteToY,
  type PlacedNote,
  previousBarStart,
  previousErrorTime,
  waveformToY,
  yToTime,
} from '../../../src/renderer/src/playback/geometry';
import type { YargNote } from '../../../src/shared/types/index';

// A layout whose highway fills the whole canvas (highwayLeft 0, highwayWidth 800)
// so lane centers land on round numbers.
const layout: ChartLayout = {
  width: 800,
  height: 600,
  highwayLeft: 0,
  highwayWidth: 800,
  hitLineY: 520,
  highwayBottomY: 570,
  pixelsPerSecond: 300,
};

function placed(note: YargNote['note'], seconds: number, midi = 0): PlacedNote {
  return { note: { tick: 0, note, dynamic: 'neutral', midi }, seconds };
}

describe('laneIndex', () => {
  it('maps each YARG note to its lane (kick has none)', () => {
    expect(laneIndex('red')).toBe(0);
    expect(laneIndex('yellowTom')).toBe(1);
    expect(laneIndex('yellowCymbal')).toBe(1);
    expect(laneIndex('blueTom')).toBe(2);
    expect(laneIndex('blueCymbal')).toBe(2);
    expect(laneIndex('greenTom')).toBe(3);
    expect(laneIndex('greenCymbal')).toBe(3);
    expect(laneIndex('orange')).toBeNull();
  });
});

describe('highwayMetrics', () => {
  it('centers a capped-width highway inside a wide canvas', () => {
    // HIGHWAY_MAX_WIDTH is 280; an 800px canvas gets 260px margins.
    expect(highwayMetrics(800)).toEqual({ highwayLeft: 260, highwayWidth: 280 });
  });

  it('lets a narrow canvas use its full width', () => {
    expect(highwayMetrics(250)).toEqual({ highwayLeft: 0, highwayWidth: 250 });
  });
});

describe('noteDims', () => {
  it('scales gems to lane width; cymbal base fits the lane; cymbals 20% taller', () => {
    const d = noteDims(100);
    expect(d.padWidth).toBeCloseTo(92); // 0.92 * 100
    expect(d.padHeight).toBeCloseTo(31.28); // 0.34 * 92
    expect(d.cymbalWidth).toBeCloseTo(90); // 0.9 * 100 (lane width)
    expect(d.cymbalHeight).toBeCloseTo(37.536); // 31.28 * 1.2
    expect(d.kickHeight).toBeCloseTo(15.64); // 31.28 / 2
  });

  it('keeps a cymbal within its lane and taller than a pad', () => {
    const laneWidth = 100;
    const d = noteDims(laneWidth);
    expect(d.cymbalWidth).toBeLessThanOrEqual(laneWidth); // no spill into a neighbor lane
    expect(d.cymbalHeight).toBeGreaterThan(d.padHeight); // stays prominent
  });
});

describe('laneX', () => {
  it('returns the horizontal center of each lane within the highway', () => {
    expect(laneX(0, layout)).toBe(100);
    expect(laneX(1, layout)).toBe(300);
    expect(laneX(2, layout)).toBe(500);
    expect(laneX(3, layout)).toBe(700);
  });

  it('offsets lane centers by highwayLeft on a centered highway', () => {
    const centered: ChartLayout = { ...layout, highwayLeft: 180, highwayWidth: 440 };
    expect(laneX(0, centered)).toBe(180 + 55); // laneWidth 110, half 55
  });
});

describe('noteToY / yToTime', () => {
  it('places a note bottom at the hit line when its time equals the view time', () => {
    expect(noteToY(1, 1, layout)).toBe(520);
  });

  it('places future notes above the hit line', () => {
    expect(noteToY(2, 1, layout)).toBe(220); // 520 - 1s * 300px/s
  });

  it('is the inverse of yToTime', () => {
    expect(yToTime(220, 1, layout)).toBeCloseTo(2);
    expect(yToTime(520, 1, layout)).toBeCloseTo(1);
  });
});

describe('waveformToY', () => {
  const fastLayout: ChartLayout = { ...layout, pixelsPerSecond: 700 };
  const chart = {
    leadInTicks: 1920,
    resolution: 480,
    tempoMap: [{ tick: 0, usPerQuarter: 500000 }],
  };

  it('maps a zero-offset audio point to the same chart position as a note', () => {
    const offset = previewAudioOffsetSeconds(chart, 0, 2000);
    expect(offset).toBe(0);
    expect(waveformToY(2, offset, 2, fastLayout)).toBe(noteToY(2, 2, fastLayout));
  });

  it('moves a fixed audio point down 70 px at +100 ms without moving chart notes', () => {
    const noteY = noteToY(2, 2, fastLayout);
    const offset = previewAudioOffsetSeconds(chart, 100, 2000);
    expect(waveformToY(2, offset, 2, fastLayout) - noteY).toBeCloseTo(70);
    expect(noteToY(2, 2, fastLayout)).toBe(noteY);
  });

  it('moves a fixed audio point up 70 px at -100 ms', () => {
    const noteY = noteToY(2, 2, fastLayout);
    const offset = previewAudioOffsetSeconds(chart, -100, 2000);
    expect(waveformToY(2, offset, 2, fastLayout) - noteY).toBeCloseTo(-70);
  });
});

describe('hitTest (bottom-anchored)', () => {
  it('returns a pad note when the cursor is over it', () => {
    const notes = [placed('red', 1, 38)]; // bottom at y=520
    const hit = hitTest(100, 510, 1, notes, layout);
    expect(hit?.midi).toBe(38);
  });

  it('returns null when the cursor is in an empty lane', () => {
    const notes = [placed('red', 1, 38)];
    expect(hitTest(700, 510, 1, notes, layout)).toBeNull();
  });

  it('hit-tests a kick anywhere across the full highway bar', () => {
    const notes = [placed('orange', 1, 36)];
    const hit = hitTest(400, 515, 1, notes, layout);
    expect(hit?.midi).toBe(36);
  });

  it('picks the note nearest the cursor when two overlap in a lane', () => {
    const near = placed('red', 1.0, 38); // bottom at 520
    const far = placed('red', 1.05, 40); // bottom at 505
    const hit = hitTest(100, 505, 1, [far, near], layout);
    expect(hit?.midi).toBe(38);
  });

  it('does not hit a note below the visible highway bottom', () => {
    // A kick whose bottom sits at y=580, past the highway bottom (570). The part of
    // its box above 570 is still visible/hittable; below 570 is the dark margin.
    const notes = [placed('orange', 0.8, 36)]; // noteToY = 520 - (0.8-1)*300 = 580
    expect(hitTest(400, 565, 1, notes, layout)?.midi).toBe(36); // above the bottom → hit
    expect(hitTest(400, 575, 1, notes, layout)).toBeNull(); // below the visible highway → no hit
  });
});

describe('errorLineAt', () => {
  // A line at seconds=1 with viewTime=1 sits at y=520 (the hit line) on this layout.
  const line = (seconds: number, messages: string[]) => ({ seconds, messages });

  it('returns the hovered line entry when the cursor is on it, anywhere across the highway', () => {
    const lines = [line(1, ['boom'])];
    expect(errorLineAt(0, 520, 1, lines, layout)).toEqual(line(1, ['boom']));
    expect(errorLineAt(400, 520, 1, lines, layout)).toEqual(line(1, ['boom']));
    expect(errorLineAt(800, 520, 1, lines, layout)).toEqual(line(1, ['boom']));
  });

  it('hits within the vertical pad and misses just beyond it', () => {
    const lines = [line(1, ['boom'])]; // y=520
    expect(errorLineAt(400, 520 + ERROR_LINE_HIT_HALF, 1, lines, layout)).toEqual(
      line(1, ['boom']),
    );
    expect(errorLineAt(400, 520 - ERROR_LINE_HIT_HALF, 1, lines, layout)).toEqual(
      line(1, ['boom']),
    );
    expect(errorLineAt(400, 520 + ERROR_LINE_HIT_HALF + 1, 1, lines, layout)).toBeNull();
  });

  it('returns null outside the centered highway strip', () => {
    const lines = [line(1, ['boom'])];
    expect(errorLineAt(-1, 520, 1, lines, layout)).toBeNull();
    expect(errorLineAt(801, 520, 1, lines, layout)).toBeNull();
  });

  it('returns null below the visible highway bottom even if a line is near', () => {
    const lines = [line(0.85, ['low'])]; // noteToY = 520 - (0.85-1)*300 = 565
    expect(errorLineAt(400, 566, 1, lines, layout)).toEqual(line(0.85, ['low'])); // above the bottom → hit
    expect(errorLineAt(400, 575, 1, lines, layout)).toBeNull(); // past 570 → no hit
  });

  it('picks the nearest line when two stack within reach', () => {
    const lines = [line(1, ['near']), line(0.99, ['far'])]; // y=520 and y=523
    expect(errorLineAt(400, 521, 1, lines, layout)).toEqual(line(1, ['near']));
  });

  it('returns null when there are no error lines', () => {
    expect(errorLineAt(400, 520, 1, [], layout)).toBeNull();
  });
});

describe('noteBottomRight', () => {
  it('returns the bottom-right corner of a pad gem in canvas pixels', () => {
    const note = placed('red', 1, 38); // lane 0, bottom at y=520
    // padWidth = 0.92 * 200 = 184; x1 = laneX(0)=100 + 92 = 192; y1 = yBottom = 520
    expect(noteBottomRight(note.note, 1, [note], layout)).toEqual({ x: 192, y: 520 });
  });

  it('returns the bottom-right corner of a cymbal gem', () => {
    const note = placed('yellowCymbal', 1, 46); // lane 1
    // cymbalWidth = 0.9 * 200 = 180; x1 = laneX(1)=300 + 90 = 390; y1 = 520
    expect(noteBottomRight(note.note, 1, [note], layout)).toEqual({ x: 390, y: 520 });
  });

  it('spans the full highway width for a kick', () => {
    const note = placed('orange', 1, 36);
    // kick box is the whole strip: x1 = highwayLeft + highwayWidth = 800; y1 = 520
    expect(noteBottomRight(note.note, 1, [note], layout)).toEqual({ x: 800, y: 520 });
  });

  it('places the bottom edge by the note time relative to the view time', () => {
    const note = placed('red', 2, 38); // 1s in the future
    // yBottom = 520 - (2-1)*300 = 220
    expect(noteBottomRight(note.note, 1, [note], layout)).toEqual({ x: 192, y: 220 });
  });

  it('returns null when the note is not among the placed notes', () => {
    const other = placed('red', 1, 38);
    const missing: YargNote = { tick: 999, note: 'red', dynamic: 'neutral', midi: 40 };
    expect(noteBottomRight(missing, 1, [other], layout)).toBeNull();
  });
});

describe('flashIntensity', () => {
  it('peaks at 1 the instant a note is hit', () => {
    expect(flashIntensity([placed('red', 1)], 1)).toBeCloseTo(1);
  });

  it('decays linearly to 0 over FLASH_DURATION after the hit', () => {
    const half = 1 + FLASH_DURATION / 2;
    expect(flashIntensity([placed('red', 1)], half)).toBeCloseTo(0.5);
  });

  it('is 0 before a note is hit and after the window closes', () => {
    expect(flashIntensity([placed('red', 1)], 0.9)).toBe(0);
    expect(flashIntensity([placed('red', 1)], 1 + FLASH_DURATION + 0.01)).toBe(0);
  });

  it('takes the strongest of several recent hits, and 0 for none', () => {
    const notes = [placed('red', 1), placed('blueTom', 1 + FLASH_DURATION / 2)];
    expect(flashIntensity(notes, 1 + FLASH_DURATION / 2)).toBeCloseTo(1);
    expect(flashIntensity([], 5)).toBe(0);
  });
});

describe('flashNote', () => {
  it('returns the crossing note at the flash instant', () => {
    expect(flashNote([placed('red', 1)], 1)).toBe('red');
  });

  it('is null before the note and after the window closes', () => {
    expect(flashNote([placed('red', 1)], 0.9)).toBeNull();
    expect(flashNote([placed('red', 1)], 1 + FLASH_DURATION + 0.01)).toBeNull();
  });

  it('picks the highest-priority color among simultaneous notes', () => {
    // orange > red > green > blue > yellow
    const rgby = [placed('yellowTom', 1), placed('blueCymbal', 1), placed('red', 1)];
    expect(flashNote(rgby, 1)).toBe('red');
    expect(flashNote([...rgby, placed('orange', 1)], 1)).toBe('orange');
    expect(flashNote([placed('blueTom', 1), placed('greenCymbal', 1)], 1)).toBe('greenCymbal');
  });

  it('is null when nothing is in the window', () => {
    expect(flashNote([], 5)).toBeNull();
  });
});

describe('minimapY / minimapTimeAt', () => {
  it('maps song time onto the minimap height bottom-to-top', () => {
    expect(minimapY(0, 200, 800)).toBe(800); // song start at the bottom
    expect(minimapY(100, 200, 800)).toBe(400);
    expect(minimapY(200, 200, 800)).toBe(0); // song end at the top
  });

  it('returns 0 when the song has no length', () => {
    expect(minimapY(5, 0, 800)).toBe(0);
  });

  it('inverts minimapY and clamps to the song bounds', () => {
    expect(minimapTimeAt(400, 200, 800)).toBeCloseTo(100);
    expect(minimapTimeAt(900, 200, 800)).toBe(0); // below the strip → song start
    expect(minimapTimeAt(-50, 200, 800)).toBe(200); // above the strip → song end
  });
});

describe('minimapLaneX', () => {
  it('returns the horizontal center of each lane scaled to the minimap width', () => {
    expect(minimapLaneX(0, 80)).toBe(10);
    expect(minimapLaneX(1, 80)).toBe(30);
    expect(minimapLaneX(3, 80)).toBe(70);
  });
});

describe('currentSectionName', () => {
  const sections = [
    { name: 'Intro', seconds: 0 },
    { name: 'Verse', seconds: 10 },
    { name: 'Chorus', seconds: 20 },
  ];

  it('returns the latest section whose time has passed', () => {
    expect(currentSectionName(sections, 5)).toBe('Intro');
    expect(currentSectionName(sections, 10)).toBe('Verse');
    expect(currentSectionName(sections, 25)).toBe('Chorus');
  });

  it('returns null before the first section and for no sections', () => {
    expect(currentSectionName(sections, -1)).toBeNull();
    expect(currentSectionName([], 5)).toBeNull();
  });
});

describe('currentBarIndex', () => {
  const barLines = [0, 2, 5, 9];

  it('returns -1 before the first bar start', () => {
    expect(currentBarIndex(barLines, -1)).toBe(-1);
  });

  it('returns the index of the last bar start at or before the time', () => {
    expect(currentBarIndex(barLines, 0)).toBe(0);
    expect(currentBarIndex(barLines, 1)).toBe(0);
    expect(currentBarIndex(barLines, 2)).toBe(1);
    expect(currentBarIndex(barLines, 8.9)).toBe(2);
    expect(currentBarIndex(barLines, 100)).toBe(3);
  });

  it('returns -1 for an empty chart', () => {
    expect(currentBarIndex([], 5)).toBe(-1);
  });
});

describe('previousBarStart', () => {
  const barLines = [0, 2, 5, 9];

  it('returns the current bar start when the time is inside a bar', () => {
    expect(previousBarStart(barLines, 3)).toBe(2);
    expect(previousBarStart(barLines, 8.9)).toBe(5);
  });

  it('steps back to the previous bar when already on a bar start', () => {
    expect(previousBarStart(barLines, 2)).toBe(0);
    expect(previousBarStart(barLines, 5)).toBe(2);
    // Within the epsilon of a bar start still counts as "on" it.
    expect(previousBarStart(barLines, 5.0005)).toBe(2);
  });

  it('returns null at or before the first bar so the caller clamps to the start', () => {
    expect(previousBarStart(barLines, 0)).toBeNull();
    expect(previousBarStart(barLines, -1)).toBeNull();
    expect(previousBarStart([], 5)).toBeNull();
  });
});

describe('nextBarStart', () => {
  const barLines = [0, 2, 5, 9];

  it('returns the next bar start after the time', () => {
    expect(nextBarStart(barLines, 0)).toBe(2);
    expect(nextBarStart(barLines, 3)).toBe(5);
    // Sitting on a bar start advances to the following one — including when float
    // error puts the time just shy of the line (within the epsilon counts as "on").
    expect(nextBarStart(barLines, 5)).toBe(9);
    expect(nextBarStart(barLines, 4.9995)).toBe(9);
  });

  it('returns null past the last bar so the caller clamps to the song end', () => {
    expect(nextBarStart(barLines, 9)).toBeNull();
    expect(nextBarStart(barLines, 100)).toBeNull();
    expect(nextBarStart([], 5)).toBeNull();
  });
});

describe('nextErrorTime', () => {
  const errors = [3, 8, 20]; // unsorted-safe, but ascending here for readability

  it('returns the nearest error strictly ahead of the current time', () => {
    expect(nextErrorTime(errors, 0)).toBe(3);
    expect(nextErrorTime(errors, 3)).toBe(8); // sitting on an error advances past it
    expect(nextErrorTime(errors, 10)).toBe(20);
  });

  it('wraps to the first error when all errors are behind', () => {
    expect(nextErrorTime(errors, 20)).toBe(3);
    expect(nextErrorTime(errors, 100)).toBe(3);
  });

  it('ignores input order and treats the epsilon window as "on" the error', () => {
    expect(nextErrorTime([20, 3, 8], 5)).toBe(8);
    expect(nextErrorTime(errors, 2.9995)).toBe(8); // within eps of 3 → past it
  });

  it('returns null when there are no errors', () => {
    expect(nextErrorTime([], 5)).toBeNull();
  });
});

describe('previousErrorTime', () => {
  const errors = [3, 8, 20];

  it('returns the nearest error strictly behind the current time', () => {
    expect(previousErrorTime(errors, 25)).toBe(20);
    expect(previousErrorTime(errors, 20)).toBe(8); // sitting on an error steps back past it
    expect(previousErrorTime(errors, 9)).toBe(8);
  });

  it('wraps to the last error when all errors are ahead', () => {
    expect(previousErrorTime(errors, 3)).toBe(20);
    expect(previousErrorTime(errors, 0)).toBe(20);
  });

  it('ignores input order and treats the epsilon window as "on" the error', () => {
    expect(previousErrorTime([20, 3, 8], 15)).toBe(8);
    expect(previousErrorTime(errors, 8.0005)).toBe(3); // within eps of 8 → before it
  });

  it('returns null when there are no errors', () => {
    expect(previousErrorTime([], 5)).toBeNull();
  });
});
