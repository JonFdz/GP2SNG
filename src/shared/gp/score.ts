import type { GpMasterBar, GpMetadata, GpTempoAutomation, GpTimeSignature } from '../types/index';
import { attr, child, text, toArray, type XmlNode } from './xml';

export function parseMetadata(gpif: XmlNode): GpMetadata {
  const scoreNode = child(gpif, 'Score');
  return {
    title: text(child(scoreNode, 'Title')),
    subtitle: text(child(scoreNode, 'SubTitle')),
    artist: text(child(scoreNode, 'Artist')),
    album: text(child(scoreNode, 'Album')),
    copyright: text(child(scoreNode, 'Copyright')),
    tabber: text(child(scoreNode, 'Tabber')),
  };
}

// GP <Value> is "BPM REFERENCE"; REFERENCE is a beat-unit enum normalized to
// quarter-note BPM (docs/GP_FORMAT.md → Tempo automations). AlphaTab clamps an
// unknown REFERENCE to 2 (multiplier 1.0).
const TEMPO_REFERENCE_MULTIPLIER: Record<number, number> = { 1: 0.5, 2: 1, 3: 1.5, 4: 2, 5: 3 };

export function parseTempoAutomations(gpif: XmlNode): GpTempoAutomation[] {
  const automations = toArray(
    child(child(child(gpif, 'MasterTrack'), 'Automations'), 'Automation'),
  );
  const result: GpTempoAutomation[] = [];
  for (const a of automations) {
    if (text(child(a, 'Type')) !== 'Tempo') continue;
    const [bpmStr, refStr] = text(child(a, 'Value')).split(/\s+/);
    const reference = Number.parseInt(refStr ?? '2', 10);
    const multiplier = TEMPO_REFERENCE_MULTIPLIER[reference] ?? 1;
    result.push({
      bar: Number.parseInt(text(child(a, 'Bar')) || '0', 10),
      position: Number.parseFloat(text(child(a, 'Position')) || '0'),
      bpm: Number.parseFloat(bpmStr) * multiplier,
      linear: text(child(a, 'Linear')) === 'true',
    });
  }
  return result;
}

function parseTimeSignature(raw: string): GpTimeSignature {
  const [num, den] = raw.split('/');
  return { numerator: Number.parseInt(num, 10), denominator: Number.parseInt(den, 10) };
}

export function parseMasterBars(gpif: XmlNode): GpMasterBar[] {
  return toArray(child(child(gpif, 'MasterBars'), 'MasterBar')).map((mb): GpMasterBar => {
    const sectionNode = child(mb, 'Section');
    let section: string | null = null;
    if (sectionNode !== undefined) {
      const label = text(child(sectionNode, 'Text'));
      section = label !== '' ? label : text(child(sectionNode, 'Letter'));
    }
    const repeat = child(mb, 'Repeat');
    const alt = text(child(mb, 'AlternateEndings'));
    return {
      timeSignature: parseTimeSignature(text(child(mb, 'Time'))),
      section,
      repeatStart: repeat !== undefined && attr(repeat, 'start') === 'true',
      repeatEnd: repeat !== undefined && attr(repeat, 'end') === 'true',
      repeatCount: repeat !== undefined ? Number.parseInt(attr(repeat, 'count') ?? '0', 10) : 0,
      alternateEndings: alt === '' ? [] : alt.split(/\s+/).map((n) => Number.parseInt(n, 10)),
      hasDirections: child(mb, 'Directions') !== undefined,
    };
  });
}
