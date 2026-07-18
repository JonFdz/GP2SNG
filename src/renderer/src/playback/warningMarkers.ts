import type { ChartError } from '../../../shared/convert/index';
import type { ConversionWarning } from '../../../shared/types/index';

// Resolves conversion warnings and chart errors to timeline positions for the
// Preview issue-dot gutter (docs spec -> Preview errors vs. warnings). Pure so the
// view holds no math. Warnings render yellow; errors render red atop them.

export interface WarningMarker {
  seconds: number;
  messages: string[];
}

// Group positioned messages sharing a resolved time into one dot, preserving
// message order; returns the list sorted by time ascending.
function groupBySeconds(items: { seconds: number; message: string }[]): WarningMarker[] {
  const bySeconds = new Map<number, string[]>();
  for (const { seconds, message } of items) {
    const messages = bySeconds.get(seconds);
    if (messages === undefined) bySeconds.set(seconds, [message]);
    else messages.push(message);
  }
  return [...bySeconds.entries()]
    .map(([seconds, messages]) => ({ seconds, messages }))
    .sort((a, b) => a.seconds - b.seconds);
}

// Each warning carries a played `context.tick` when it has a position;
// position-less warnings fall to 0:00.
export function warningMarkers(
  warnings: ConversionWarning[],
  tickToSec: (tick: number) => number,
): WarningMarker[] {
  return groupBySeconds(
    warnings.map((warning) => {
      const tick = warning.context?.tick;
      return {
        seconds: typeof tick === 'number' ? tickToSec(tick) : 0,
        message: warning.message,
      };
    }),
  );
}

// Errors always carry a tick. `describe` renders the human message (lane names
// live in the renderer), keeping this module pure and unit-testable.
export function errorMarkers(
  errors: ChartError[],
  tickToSec: (tick: number) => number,
  describe: (error: ChartError) => string,
): WarningMarker[] {
  return groupBySeconds(
    errors.map((error) => ({ seconds: tickToSec(error.tick), message: describe(error) })),
  );
}
