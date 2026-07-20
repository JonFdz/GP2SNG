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

export interface ResolveFinalizeAudioInput {
  audioBytes: Uint8Array | null;
  audioBuffer: AudioBuffer | null;
  audioPaddingMs: number;
  leadInMs: number;
}

export interface ResolvedFinalizeAudio {
  audio: { bytes: Uint8Array; extension: string } | undefined;
  paddingMs: number;
}

// The audio to bundle into an exported .sng, gating the one way this can silently
// lose data: `audioBytes` alone does not mean playback is ready — Preview decodes
// it asynchronously (100-400 ms for a multi-MB file), and a restored session can
// land on Preview with that decode still in flight. Exporting during that window
// must fail loudly rather than write a `.sng` with no audio member at all, which
// `readSngSession` then refuses to ever reopen.
export async function resolveFinalizeAudio(
  input: ResolveFinalizeAudioInput,
): Promise<ResolvedFinalizeAudio> {
  const { audioBytes, audioBuffer, audioPaddingMs, leadInMs } = input;
  if (audioBytes === null) return { audio: undefined, paddingMs: 0 };
  if (audioBuffer === null) {
    throw new Error('The audio is still decoding — return to Preview and try again.');
  }
  const resolved = await resolveExportAudio({
    bytes: audioBytes,
    channels: Array.from({ length: audioBuffer.numberOfChannels }, (_, i) =>
      audioBuffer.getChannelData(i),
    ),
    sampleRate: audioBuffer.sampleRate,
    currentPaddingMs: audioPaddingMs,
    targetPaddingMs: leadInMs,
  });
  return {
    audio: { bytes: resolved.bytes, extension: resolved.extension },
    paddingMs: resolved.paddingMs,
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
