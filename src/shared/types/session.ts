import type { YargChart } from './chart';
import type { PreviewRemap, SeqDeletion, SeqOverride } from './edits';
import type { SongMetadata } from './metadata';
import type { ConversionSettings, MidiMap } from './midi';
import type { ConversionWarning } from './warnings';

// The editing session bundled inside every generated .sng so the chart can be
// reopened and edited later (docs/DESIGN.md → Session blob). YARG ignores unknown
// container files, so this rides along harmlessly.
export const SESSION_BLOB_FILENAME = 'gp2sng.json';

// Bumped whenever this shape changes. Per the project's no-legacy rule there is no
// migration path: a mismatch is refused and the user re-converts from the GP file.
export const SESSION_BLOB_VERSION = 2;

export interface SessionBlob {
  version: number;
  gpFilePath: string; // for display only; the bytes below are the source of truth
  gpBytes: Uint8Array; // the source GP file, so reopening never depends on it still existing
  selectedTrackId: number;
  sessionMap: MidiMap;
  sessionSettings: ConversionSettings;
  // The RAW conversion output, not the displayed chart: the edit layers below are
  // stored separately so each stays individually revertable in the Action Log.
  chart: YargChart;
  warnings: ConversionWarning[];
  overrides: SeqOverride[];
  deletions: SeqDeletion[];
  previewRemaps: PreviewRemap[];
  metadata: SongMetadata;
  audioOffsetMs: number;
  // Milliseconds of silence already prepended to the bundled audio. Lets a reopened
  // .sng be re-exported without re-encoding: the writer only touches the audio when
  // the padding it needs differs from the padding it has.
  audioPaddingMs: number;
}
