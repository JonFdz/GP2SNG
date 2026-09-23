import { SESSION_BLOB_VERSION, type SessionBlob } from '../../../shared/types/index';
import { sourceFileName } from './sourceFile';

export type BuildSessionBlobArgs = Omit<SessionBlob, 'version'>;

// Assembles the session blob bundled into every exported .sng (docs/DESIGN.md →
// Session blob). Pulled out of FinalizeView.doWrite as a pure function so the
// invariant that matters most — `chart` here is the RAW conversion output, never
// the displayed chart passed to `writeSng` — is unit-testable on its own.
export function buildSessionBlob(args: BuildSessionBlobArgs): SessionBlob {
  return {
    version: SESSION_BLOB_VERSION,
    ...args,
    gpFilePath: sourceFileName(args.gpFilePath),
  };
}
