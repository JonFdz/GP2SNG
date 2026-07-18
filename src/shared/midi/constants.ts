import { DEFAULT_MIDI_MAP } from '../types/index';

// Drum MIDI names shown in the MIDI Map view's hover tooltip (docs/DESIGN.md →
// MIDI map component → Hover help). Numbers with no entry fall back to the bare
// number at the call site. The 35-81 range is General MIDI Level 1 percussion
// except where GP2SNG overrides it with a short articulation label (e.g. 35/36
// "Kick 1"/"Kick 2", 42 "Hi-hat (closed)"); the out-of-range numbers the default
// map also uses (29, 30, 31, 33, 34, 91, 92-98, 126, 127) carry GP2SNG's own labels.
export const STANDARD_DRUM_MIDI_NAMES: Record<number, string> = {
  29: 'Ride (choke)',
  30: 'Reverse Cymbal (hit)',
  31: 'Snare (side stick)',
  33: 'Metronome (hit)',
  34: 'Metronome (bell)',
  35: 'Kick 1',
  36: 'Kick 2',
  37: 'Snare (side stick)',
  38: 'Snare',
  39: 'Hand Clap',
  40: 'Electric Snare',
  41: 'Low Floor Tom',
  42: 'Hi-hat (closed)',
  43: 'High Floor Tom',
  44: 'Pedal Hi-Hat',
  45: 'Low Tom',
  46: 'Hi-hat (open)',
  47: 'Low-Mid Tom',
  48: 'Hi-Mid Tom',
  49: 'Crash high',
  50: 'High Tom',
  51: 'Ride (middle)',
  52: 'China',
  53: 'Ride (bell)',
  54: 'Tambourine',
  55: 'Splash',
  56: 'Cowbell',
  57: 'Crash medium',
  58: 'Vibraslap',
  59: 'Ride (edge)',
  60: 'Hi Bongo',
  61: 'Low Bongo',
  62: 'Mute Hi Conga',
  63: 'Open Hi Conga',
  64: 'Low Conga',
  65: 'High Timbale',
  66: 'Low Timbale',
  67: 'High Agogo',
  68: 'Low Agogo',
  69: 'Cabasa',
  70: 'Maracas',
  71: 'Short Whistle',
  72: 'Long Whistle',
  73: 'Short Guiro',
  74: 'Long Guiro',
  75: 'Claves',
  76: 'Hi Wood Block',
  77: 'Low Wood Block',
  78: 'Mute Cuica',
  79: 'Open Cuica',
  80: 'Mute Triangle',
  81: 'Open Triangle',
  91: 'Snare (rim shot)',
  92: 'Hi-hat (half)',
  93: 'Ride (edge)',
  94: 'Ride (choke)',
  95: 'Splash (choke)',
  96: 'China (choke)',
  97: 'Crash high (choke)',
  98: 'Crash medium (choke)',
  126: 'Ride (middle)',
  127: 'Ride (bell)',
};

// The "38 — Acoustic Snare" text shown in MIDI hover help; bare number when the
// value has no name (shared by the MIDI map tooltip and inline warning cards).
export function midiLabel(midi: number): string {
  const name = STANDARD_DRUM_MIDI_NAMES[midi];
  return name ? `${midi} — ${name}` : String(midi);
}

// The universe of MIDI numbers offered in the map view (docs/DESIGN.md →
// Persistence schema): the GM percussion range plus any numbers the default
// map assigns outside it (e.g. 29, 30, 31, 33, 34, 91, 92, 126, 127), sorted
// & deduped.
const GM_PERCUSSION_RANGE = Array.from({ length: 81 - 35 + 1 }, (_, i) => 35 + i);
const DEFAULT_MAP_NUMBERS = Object.values(DEFAULT_MIDI_MAP).flat();

export const STANDARD_DRUM_MIDI_NUMBERS: readonly number[] = [
  ...new Set([...GM_PERCUSSION_RANGE, ...DEFAULT_MAP_NUMBERS]),
].sort((a, b) => a - b);
