import { tickToSeconds } from '../../../shared/convert/index';
import type { YargChart } from '../../../shared/types/index';
import { encodeOggVorbis } from './encode';
import { padPcm, trimPcm } from './pcm';

export interface ExportAudio {
  bytes: Uint8Array;
  extension: string;
  paddingMs: number;
}

export interface ResolveExportAudioInput {
  bytes: Uint8Array;
  channels: Float32Array[];
  sampleRate: number;
  currentPaddingMs: number;
  targetPaddingMs: number;
}

// Swap however much leading silence the PCM already carries for however much it
// should. Trim before pad: re-padding must REPLACE the existing silence, never sit
// on top of it, or a reopened chart's lead-in would grow on every save.
export function repadPcm(
  channels: Float32Array[],
  sampleRate: number,
  currentPaddingMs: number,
  targetPaddingMs: number,
): Float32Array[] {
  const source = trimPcm(channels, sampleRate, currentPaddingMs / 1000);
  return padPcm(source, sampleRate, targetPaddingMs / 1000);
}

// The bundled audio must carry exactly `targetPaddingMs` of leading silence. When
// it already does — the common reopen-and-re-export path — the bytes are handed
// back untouched, so repeated save cycles never stack another lossy generation.
export async function resolveExportAudio(input: ResolveExportAudioInput): Promise<ExportAudio> {
  const { bytes, channels, sampleRate, currentPaddingMs, targetPaddingMs } = input;
  if (currentPaddingMs === targetPaddingMs) {
    return { bytes, extension: 'ogg', paddingMs: currentPaddingMs };
  }

  return {
    bytes: await encodeOggVorbis(
      repadPcm(channels, sampleRate, currentPaddingMs, targetPaddingMs),
      sampleRate,
    ),
    extension: 'ogg',
    paddingMs: targetPaddingMs,
  };
}

// Where the bundled audio's first sample sits on the preview's chart clock. Mirrors
// what YARG will do with the exported file: the writer's `delay` is the user's
// offset alone, and the lead-in comes from silence in the audio — which the preview
// reproduces by holding playback back when that silence is not there yet.
export function previewAudioOffsetSeconds(
  chart: Pick<YargChart, 'leadInTicks' | 'resolution' | 'tempoMap'>,
  audioOffsetMs: number,
  audioPaddingMs: number,
): number {
  const leadInSeconds = tickToSeconds(chart.leadInTicks, chart.tempoMap, chart.resolution);
  return audioOffsetMs / 1000 - leadInSeconds + audioPaddingMs / 1000;
}
