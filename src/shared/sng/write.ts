import { tickToSeconds } from '../convert/index';
import { SngWriteError, type SongMetadata, type YargChart } from '../types/index';
import { buildSngContainer } from './container';
import { buildMidi } from './midi-write';

function randomMask(): Uint8Array {
  const m = new Uint8Array(16);
  for (let i = 0; i < 16; i++) m[i] = Math.floor(Math.random() * 256);
  return m;
}

// The SNG `delay` value. Audio position at chart time t is t + delay/1000 (YARG
// SongRunner.SetSongTime; mirrored by the preview's computeAudioStart), so a chart
// with a lead-in needs a NEGATIVE delay to hold the audio until the music starts.
// Sole owner of this sign: chart and audio drifting apart by a whole lead-in is
// silent and only reproducible in YARG.
export function sngDelayMs(chart: YargChart, audioOffsetMs: number): number {
  return (
    audioOffsetMs -
    Math.round(tickToSeconds(chart.leadInTicks, chart.tempoMap, chart.resolution) * 1000)
  );
}

export function writeSng(
  chart: YargChart,
  metadata: SongMetadata,
  audio: { bytes: Uint8Array; extension: string } | undefined,
  offsetMs: number,
): Uint8Array {
  if (metadata.name === '' || metadata.artist === '') {
    throw new SngWriteError('Song name and artist are required', {
      name: metadata.name,
      artist: metadata.artist,
    });
  }

  const files: { name: string; bytes: Uint8Array }[] = [
    { name: 'notes.mid', bytes: buildMidi(chart) },
  ];
  if (audio) files.push({ name: `song.${audio.extension.toLowerCase()}`, bytes: audio.bytes });

  const songLengthMs = Math.round(
    tickToSeconds(chart.endTick, chart.tempoMap, chart.resolution) * 1000,
  );
  const diff = String(metadata.drumsDifficulty);
  const pairs: [string, string][] = [
    ['name', metadata.name],
    ['artist', metadata.artist],
    ['charter', metadata.charter],
    ['album', metadata.album],
    ['genre', metadata.genre],
    ['year', metadata.year],
    ['song_length', String(songLengthMs)],
    ['delay', String(sngDelayMs(chart, offsetMs))],
    ['pro_drums', 'True'],
    ['diff_drums', diff],
    ['diff_drums_real', diff],
  ];

  return buildSngContainer(files, pairs, randomMask());
}
