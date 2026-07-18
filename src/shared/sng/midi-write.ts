import type { BaseYargNote, YargChart, YargNote } from '../types/index';

const GEM: Record<BaseYargNote, number> = {
  orange: 96,
  red: 97,
  yellowCymbal: 98,
  yellowTom: 98,
  blueCymbal: 99,
  blueTom: 99,
  greenCymbal: 100,
  greenTom: 100,
};
const TOM_MARKER: Partial<Record<BaseYargNote, number>> = {
  yellowTom: 110,
  blueTom: 111,
  greenTom: 112,
};
const VELOCITY = { accent: 127, ghost: 1, neutral: 100 } as const;
const GATE_TICKS = 1; // instantaneous hit; duration is cosmetic for drums

interface Ev {
  tick: number;
  bytes: number[];
  order: number; // tie-break at equal tick: note-off (0) before note-on (1)
}

function vlq(value: number): number[] {
  const out = [value & 0x7f];
  let v = value >>> 7;
  while (v > 0) {
    out.unshift((v & 0x7f) | 0x80);
    v >>>= 7;
  }
  return out;
}

function metaText(type: number, s: string): number[] {
  const data = [...new TextEncoder().encode(s)];
  return [0xff, type, ...vlq(data.length), ...data];
}

function serializeTrack(events: Ev[]): number[] {
  events.sort((a, b) => a.tick - b.tick || a.order - b.order);
  const body: number[] = [];
  let prev = 0;
  for (const e of events) {
    body.push(...vlq(e.tick - prev), ...e.bytes);
    prev = e.tick;
  }
  body.push(...vlq(0), 0xff, 0x2f, 0x00); // end of track
  const len = body.length;
  return [
    0x4d,
    0x54,
    0x72,
    0x6b, // "MTrk"
    (len >>> 24) & 0xff,
    (len >>> 16) & 0xff,
    (len >>> 8) & 0xff,
    len & 0xff,
    ...body,
  ];
}

function noteVelocity(note: YargNote): number {
  if (note.note === 'orange') return VELOCITY.neutral; // kick never scaled
  return VELOCITY[note.dynamic];
}

export function buildMidi(chart: YargChart): Uint8Array {
  // Conductor track: tempo + time signatures.
  const conductor: Ev[] = [];
  const tempos = chart.tempoMap.length > 0 ? chart.tempoMap : [{ tick: 0, usPerQuarter: 500000 }];
  for (const t of tempos) {
    conductor.push({
      tick: t.tick,
      order: 0,
      bytes: [
        0xff,
        0x51,
        0x03,
        (t.usPerQuarter >>> 16) & 0xff,
        (t.usPerQuarter >>> 8) & 0xff,
        t.usPerQuarter & 0xff,
      ],
    });
  }
  for (const ts of chart.timeSignatures) {
    conductor.push({
      tick: ts.tick,
      order: 1,
      bytes: [0xff, 0x58, 0x04, ts.numerator, Math.log2(ts.denominator), 24, 8],
    });
  }

  // PART DRUMS track: name + dynamics-enable, then gems + tom markers.
  const drums: Ev[] = [
    { tick: 0, order: -2, bytes: metaText(0x03, 'PART DRUMS') },
    { tick: 0, order: -1, bytes: metaText(0x01, '[ENABLE_CHART_DYNAMICS]') },
  ];
  for (const n of chart.notes) {
    const gem = GEM[n.note];
    const vel = noteVelocity(n);
    drums.push({ tick: n.tick, order: 1, bytes: [0x90, gem, vel] });
    drums.push({ tick: n.tick + GATE_TICKS, order: 0, bytes: [0x80, gem, 0] });
    const marker = TOM_MARKER[n.note];
    if (marker !== undefined) {
      drums.push({ tick: n.tick, order: 1, bytes: [0x90, marker, VELOCITY.neutral] });
      drums.push({ tick: n.tick + GATE_TICKS, order: 0, bytes: [0x80, marker, 0] });
    }
  }

  // EVENTS track: sections.
  const events: Ev[] = [{ tick: 0, order: -2, bytes: metaText(0x03, 'EVENTS') }];
  for (const s of chart.sections) {
    events.push({ tick: s.tick, order: 0, bytes: metaText(0x01, `[section ${s.name}]`) });
  }

  const header = [
    0x4d,
    0x54,
    0x68,
    0x64, // "MThd"
    0,
    0,
    0,
    6, // header length
    0,
    1, // format 1
    0,
    3, // 3 tracks
    (chart.resolution >>> 8) & 0xff,
    chart.resolution & 0xff,
  ];
  return Uint8Array.from([
    ...header,
    ...serializeTrack(conductor),
    ...serializeTrack(drums),
    ...serializeTrack(events),
  ]);
}
