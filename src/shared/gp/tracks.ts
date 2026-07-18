import type { GpBar, GpBeat, GpNote, GpVoice, ParsedGpTrack } from '../types/index';
import { attr, child, text, toArray, type XmlNode } from './xml';

// NoteValue -> [numerator, denominator] as a fraction of a whole note.
const NOTE_VALUE_FRACTION: Record<string, [number, number]> = {
  Whole: [1, 1],
  Half: [1, 2],
  Quarter: [1, 4],
  Eighth: [1, 8],
  '16th': [1, 16],
  '32nd': [1, 32],
  '64th': [1, 64],
  '128th': [1, 128],
  '256th': [1, 256],
};

interface Pools {
  bars: Map<string, XmlNode>;
  voices: Map<string, XmlNode>;
  beats: Map<string, XmlNode>;
  notes: Map<string, XmlNode>;
  rhythms: Map<string, XmlNode>;
}

function indexPool(gpif: XmlNode, container: string, item: string): Map<string, XmlNode> {
  const map = new Map<string, XmlNode>();
  for (const it of toArray<XmlNode>(child(child(gpif, container), item))) {
    const id = attr(it, 'id');
    if (id !== undefined) map.set(id, it);
  }
  return map;
}

function buildPools(gpif: XmlNode): Pools {
  return {
    bars: indexPool(gpif, 'Bars', 'Bar'),
    voices: indexPool(gpif, 'Voices', 'Voice'),
    beats: indexPool(gpif, 'Beats', 'Beat'),
    notes: indexPool(gpif, 'Notes', 'Note'),
    rhythms: indexPool(gpif, 'Rhythms', 'Rhythm'),
  };
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

// Duration of a beat as a reduced fraction of a whole note, honoring the
// primary tuplet and augmentation dots (docs/GP_FORMAT.md → Timing).
function beatDuration(rhythm: XmlNode | undefined): [number, number] {
  if (!rhythm) return [1, 4];
  let [num, den] = NOTE_VALUE_FRACTION[text(child(rhythm, 'NoteValue'))] ?? [1, 4];
  const tuplet = child(rhythm, 'PrimaryTuplet');
  if (tuplet !== undefined) {
    // "num in the time of den": each note lasts den/num of its nominal value.
    num *= Number.parseInt(attr(tuplet, 'den') ?? '1', 10);
    den *= Number.parseInt(attr(tuplet, 'num') ?? '1', 10);
  }
  const dot = child(rhythm, 'AugmentationDot');
  if (dot !== undefined) {
    const count = Number.parseInt(attr(dot, 'count') ?? '1', 10);
    num *= 2 ** (count + 1) - 1; // 1 dot -> x3/2, 2 dots -> x7/4
    den *= 2 ** count;
  }
  const g = gcd(num, den);
  return [num / g, den / g];
}

function noteMidi(note: XmlNode): number | null {
  for (const p of toArray<XmlNode>(child(child(note, 'Properties'), 'Property'))) {
    if (attr(p, 'name') === 'Midi') {
      const n = text(child(p, 'Number'));
      if (n !== '') return Number.parseInt(n, 10);
    }
  }
  return null;
}

function parseBeat(beat: XmlNode, pools: Pools): GpBeat {
  const isGrace = child(beat, 'GraceNotes') !== undefined;
  const rhythmRef = attr(child(beat, 'Rhythm'), 'ref');
  const [durationNum, durationDen] = beatDuration(
    rhythmRef !== undefined ? pools.rhythms.get(rhythmRef) : undefined,
  );
  const notesText = text(child(beat, 'Notes'));
  const notes: GpNote[] = [];
  if (notesText !== '') {
    for (const nid of notesText.split(/\s+/)) {
      const note = pools.notes.get(nid);
      if (!note) continue;
      const tie = child(note, 'Tie');
      if (tie !== undefined && attr(tie, 'destination') === 'true') continue; // skip tie dest
      const midi = noteMidi(note);
      if (midi === null) continue;
      const accentVal = text(child(note, 'Accent'));
      notes.push({
        midi,
        ghost: child(note, 'AntiAccent') !== undefined || isGrace,
        accent: accentVal === '8' || accentVal === '4',
      });
    }
  }
  return { durationNum, durationDen, notes, isGrace };
}

export function parseTracks(gpif: XmlNode): ParsedGpTrack[] {
  const pools = buildPools(gpif);
  const masterBars = toArray<XmlNode>(child(child(gpif, 'MasterBars'), 'MasterBar'));
  // MasterTrack/Tracks lists participating track ids in column order; the Nth
  // id is the Nth entry of every MasterBar <Bars> list.
  const trackOrder = text(child(child(gpif, 'MasterTrack'), 'Tracks'))
    .split(/\s+/)
    .filter((s) => s !== '')
    .map((s) => Number.parseInt(s, 10));

  return toArray<XmlNode>(child(child(gpif, 'Tracks'), 'Track')).map((tn): ParsedGpTrack => {
    const id = Number.parseInt(attr(tn, 'id') ?? '0', 10);
    const column = trackOrder.indexOf(id);
    const bars: GpBar[] = [];
    let noteCount = 0;

    for (const mb of masterBars) {
      const barIds = text(child(mb, 'Bars'))
        .split(/\s+/)
        .filter((s) => s !== '');
      const barId = barIds[column >= 0 ? column : 0];
      const barNode = barId !== undefined ? pools.bars.get(barId) : undefined;
      const voices: GpVoice[] = [];
      if (barNode) {
        for (const vid of text(child(barNode, 'Voices')).split(/\s+/)) {
          if (vid === '-1' || vid === '') continue;
          const voiceNode = pools.voices.get(vid);
          if (!voiceNode) continue;
          const beats: GpBeat[] = [];
          for (const bid of text(child(voiceNode, 'Beats'))
            .split(/\s+/)
            .filter((s) => s !== '')) {
            const beatNode = pools.beats.get(bid);
            if (!beatNode) continue;
            const beat = parseBeat(beatNode, pools);
            noteCount += beat.notes.length;
            beats.push(beat);
          }
          voices.push({ beats });
        }
      }
      bars.push({ voices });
    }

    return {
      id,
      name: text(child(tn, 'Name')),
      isDrumKit: text(child(child(tn, 'InstrumentSet'), 'Type')) === 'drumKit',
      noteCount,
      bars,
    };
  });
}
