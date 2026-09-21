import { tickToSeconds } from '../convert/index';
import {
  type AlbumArt,
  SESSION_BLOB_FILENAME,
  type SessionBlob,
  SngWriteError,
  type SongMetadata,
  type YargChart,
} from '../types/index';
import { buildSngContainer } from './container';
import { buildMidi } from './midi-write';
import { encodeSessionBlob } from './session';

function randomMask(): Uint8Array {
  const m = new Uint8Array(16);
  for (let i = 0; i < 16; i++) m[i] = Math.floor(Math.random() * 256);
  return m;
}

export function writeSng(
  chart: YargChart,
  metadata: SongMetadata,
  audio: { bytes: Uint8Array; extension: string } | undefined,
  offsetMs: number,
  session: SessionBlob,
  albumArt?: AlbumArt,
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
  if (albumArt) files.push({ name: `album.${albumArt.extension}`, bytes: albumArt.bytes });
  // The editing session, so this .sng can be reopened and edited later. YARG looks
  // files up by known name and never enumerates, so an unknown member is inert.
  files.push({ name: SESSION_BLOB_FILENAME, bytes: encodeSessionBlob(session) });

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
    ['delay', String(offsetMs)],
    ['pro_drums', 'True'],
    ['diff_drums', diff],
    ['diff_drums_real', diff],
  ];

  return buildSngContainer(files, pairs, randomMask());
}
