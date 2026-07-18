// Halt-worthy errors (docs/DESIGN.md → Error handling → Code shape).
export class Gp2SngError extends Error {
  readonly context?: Record<string, unknown>;

  constructor(message: string, context?: Record<string, unknown>) {
    super(message);
    // new.target is the actual subclass being constructed.
    this.name = new.target.name;
    this.context = context;
  }
}

export class GpParseError extends Gp2SngError {}
export class ConversionError extends Gp2SngError {}
export class SngWriteError extends Gp2SngError {}
export class PersistenceError extends Gp2SngError {}
export class AudioDecodeError extends Gp2SngError {}
