import { describe, expect, it } from 'vitest';
import { errorMarkers, warningMarkers } from '../../../src/renderer/src/playback/warningMarkers';
import type { ChartError } from '../../../src/shared/convert/index';
import type { ConversionWarning } from '../../../src/shared/types/index';

// 960 ticks/second, so tick T → T/960 seconds.
const tickToSec = (tick: number) => tick / 960;

const w = (partial: Partial<ConversionWarning> & { message: string }): ConversionWarning => ({
  kind: 'yargNoteCollision',
  ...partial,
});

describe('warningMarkers', () => {
  it('places a warning at its context.tick time', () => {
    const markers = warningMarkers(
      [w({ message: 'at tick', context: { bar: 3, tick: 3840 } })],
      tickToSec,
    );
    expect(markers).toEqual([{ seconds: 3840 / 960, messages: ['at tick'] }]);
  });

  it('places a mid-bar tick at its exact time, not snapped', () => {
    const markers = warningMarkers(
      [w({ kind: 'yargNoteCollision', message: 'collision', context: { tick: 4000 } })],
      tickToSec,
    );
    expect(markers).toEqual([{ seconds: 4000 / 960, messages: ['collision'] }]);
  });

  it('places a position-less warning at 0:00', () => {
    const markers = warningMarkers(
      [w({ kind: 'directionSignsUnsupported', message: 'directions' })],
      tickToSec,
    );
    expect(markers).toEqual([{ seconds: 0, messages: ['directions'] }]);
  });

  it('ignores a bar-only context (no tick) and places it at 0:00', () => {
    // Defensive: after the convert fix every positionable warning carries a tick, so
    // a lone context.bar is not a position source here.
    const markers = warningMarkers([w({ message: 'bar only', context: { bar: 7 } })], tickToSec);
    expect(markers).toEqual([{ seconds: 0, messages: ['bar only'] }]);
  });

  it('merges warnings sharing a time into one dot, message order preserved', () => {
    const markers = warningMarkers(
      [
        w({ message: 'first', context: { tick: 3840 } }),
        w({ kind: 'yargNoteCollision', message: 'second', context: { tick: 3840 } }),
      ],
      tickToSec,
    );
    expect(markers).toEqual([{ seconds: 3840 / 960, messages: ['first', 'second'] }]);
  });

  it('does not merge warnings at different ticks', () => {
    const markers = warningMarkers(
      [
        w({ message: 'a', context: { tick: 3840 } }),
        w({ kind: 'yargNoteCollision', message: 'b', context: { tick: 4000 } }),
      ],
      tickToSec,
    );
    expect(markers).toEqual([
      { seconds: 3840 / 960, messages: ['a'] },
      { seconds: 4000 / 960, messages: ['b'] },
    ]);
  });

  it('merges position-less warnings at 0:00', () => {
    const markers = warningMarkers(
      [
        w({ kind: 'unmappedNotesDropped', message: 'dyn' }),
        w({ kind: 'directionSignsUnsupported', message: 'dir' }),
      ],
      tickToSec,
    );
    expect(markers).toEqual([{ seconds: 0, messages: ['dyn', 'dir'] }]);
  });

  it('sorts markers by seconds ascending', () => {
    const markers = warningMarkers(
      [
        w({ message: 'late', context: { tick: 5760 } }),
        w({ message: 'early', context: { tick: 1920 } }),
        w({ kind: 'unmappedNotesDropped', message: 'zero' }),
      ],
      tickToSec,
    );
    expect(markers.map((m) => m.seconds)).toEqual([0, 1920 / 960, 5760 / 960]);
  });

  it('returns an empty list for no warnings', () => {
    expect(warningMarkers([], tickToSec)).toEqual([]);
  });
});

const describeStub = (e: ChartError) => `${e.kind}@${e.tick}`;

describe('errorMarkers', () => {
  it('places an error at its tick time with the described message', () => {
    const markers = errorMarkers(
      [{ tick: 3840, kind: 'threeHandNotes', notes: ['red', 'yellowTom', 'blueTom'] }],
      tickToSec,
      describeStub,
    );
    expect(markers).toEqual([{ seconds: 3840 / 960, messages: ['threeHandNotes@3840'] }]);
  });

  it('merges errors sharing a tick into one dot, order preserved', () => {
    const markers = errorMarkers(
      [
        { tick: 0, kind: 'cymbalPadCollision', notes: ['yellowCymbal', 'yellowTom'] },
        { tick: 0, kind: 'threeHandNotes', notes: ['yellowCymbal', 'yellowTom', 'blueTom'] },
      ],
      tickToSec,
      describeStub,
    );
    expect(markers).toEqual([
      { seconds: 0, messages: ['cymbalPadCollision@0', 'threeHandNotes@0'] },
    ]);
  });

  it('sorts error dots by seconds ascending', () => {
    const markers = errorMarkers(
      [
        { tick: 5760, kind: 'threeHandNotes', notes: ['red', 'yellowTom', 'blueTom'] },
        { tick: 1920, kind: 'cymbalPadCollision', notes: ['blueCymbal', 'blueTom'] },
      ],
      tickToSec,
      describeStub,
    );
    expect(markers.map((m) => m.seconds)).toEqual([1920 / 960, 5760 / 960]);
  });

  it('returns an empty list for no errors', () => {
    expect(errorMarkers([], tickToSec, describeStub)).toEqual([]);
  });
});
