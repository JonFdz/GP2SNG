import { useState } from 'react';
import { midiLabel } from '../../../shared/midi/index';
import { AnchoredTooltip, anchorBottomRight } from './AnchoredTooltip';

// A read-only, non-draggable MIDI card whose tooltip (the drum name) anchors to the
// card's bottom-right corner — for inline use inside warning text. Mirrors the MIDI
// map card's hover help (docs/DESIGN.md → MIDI map component → Hover help).
export function MidiTag({ midi }: { midi: number }) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  return (
    <>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: read-only hover card, not interactive */}
      <span
        className="midi-card midi-card--static"
        onMouseEnter={(e) => setPos(anchorBottomRight(e.currentTarget))}
        onMouseLeave={() => setPos(null)}
      >
        {midi}
      </span>
      {pos !== null && (
        <AnchoredTooltip className="midi-tooltip" anchor={pos}>
          {midiLabel(midi)}
        </AnchoredTooltip>
      )}
    </>
  );
}
