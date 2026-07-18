import type { SongMetadata } from '../../../shared/types/index';
import type { MetadataErrors } from '../state/metadata';

// The editable song-metadata form (docs/DESIGN.md → Chart preview → Metadata form).
// Pre-populated from the GP score; required-field / range errors are inline and
// gate Save (validation lives in state/metadata.ts).

interface MetadataFormProps {
  metadata: SongMetadata;
  errors: MetadataErrors;
  onChange: (patch: Partial<SongMetadata>) => void;
}

export function MetadataForm({ metadata, errors, onChange }: MetadataFormProps) {
  const difficultyValue = Number.isNaN(metadata.drumsDifficulty)
    ? ''
    : String(metadata.drumsDifficulty);

  return (
    <div className="metadata-form">
      <Field label="Song name" required error={errors.name}>
        <input
          className={inputClass(errors.name)}
          value={metadata.name}
          onChange={(e) => onChange({ name: e.target.value })}
        />
      </Field>
      <Field label="Artist" required error={errors.artist}>
        <input
          className={inputClass(errors.artist)}
          value={metadata.artist}
          onChange={(e) => onChange({ artist: e.target.value })}
        />
      </Field>
      <Field label="Album">
        <input
          className="text-input"
          value={metadata.album}
          onChange={(e) => onChange({ album: e.target.value })}
        />
      </Field>
      <Field label="Genre">
        <input
          className="text-input"
          value={metadata.genre}
          onChange={(e) => onChange({ genre: e.target.value })}
        />
      </Field>
      <Field label="Year">
        <input
          className="text-input"
          value={metadata.year}
          onChange={(e) => onChange({ year: e.target.value })}
        />
      </Field>
      <Field label="Charter">
        <input
          className="text-input"
          value={metadata.charter}
          onChange={(e) => onChange({ charter: e.target.value })}
        />
      </Field>
      <Field label="Drums difficulty" required error={errors.drumsDifficulty}>
        <input
          className={inputClass(errors.drumsDifficulty)}
          type="number"
          min={0}
          max={6}
          step={1}
          placeholder="0–6"
          value={difficultyValue}
          onChange={(e) =>
            onChange({
              drumsDifficulty: e.target.value === '' ? Number.NaN : Number(e.target.value),
            })
          }
        />
      </Field>
    </div>
  );
}

function inputClass(error?: string): string {
  return error ? 'text-input text-input--invalid' : 'text-input';
}

interface FieldProps {
  label: string;
  required?: boolean;
  error?: string;
  children: React.ReactNode;
}

function Field({ label, required, error, children }: FieldProps) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: the field input is passed as children
    <label className="metadata-field">
      <span className="metadata-field__label">
        {label}
        {required && <span className="metadata-field__req"> *</span>}
      </span>
      {children}
      {error && <span className="metadata-field__error">{error}</span>}
    </label>
  );
}
