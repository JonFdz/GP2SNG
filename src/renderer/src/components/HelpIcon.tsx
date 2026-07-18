import { useId, useRef, useState } from 'react';

// A small filled "?" disc that reveals a short help tooltip on hover. The tooltip is
// icon-anchored — pinned above the glyph — but positioned `fixed` from the icon's
// bounding rect so it escapes any scroll/overflow container it sits in (e.g. the
// Preview sidebar), which a purely-absolute tip would be clipped by. Reusable
// primitive — drop it after any setting or label (docs/STYLE_GUIDE.md → Iconography,
// Tooltips).
export function HelpIcon({ text }: { text: string }) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const ref = useRef<HTMLSpanElement>(null);
  const maskId = useId();

  function showTip() {
    const rect = ref.current?.getBoundingClientRect();
    if (rect) setPos({ x: rect.left + rect.width / 2, y: rect.top });
  }

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: read-only hover help, not interactive
    <span ref={ref} className="help-icon" onMouseEnter={showTip} onMouseLeave={() => setPos(null)}>
      <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
        {/* The "?" is a knockout in the mask (black = hidden), so it shows the
            background through the filled disc rather than being drawn in a color. */}
        <mask id={maskId}>
          <rect x="0" y="0" width="16" height="16" fill="white" />
          <text
            x="8"
            y="8"
            textAnchor="middle"
            dominantBaseline="central"
            fontSize="12.5"
            fontWeight="700"
            fill="black"
          >
            ?
          </text>
        </mask>
        <circle cx="8" cy="8" r="7.5" fill="currentColor" mask={`url(#${maskId})`} />
      </svg>
      {pos && (
        <span className="help-icon__tip" style={{ left: pos.x, top: pos.y }}>
          {text}
        </span>
      )}
    </span>
  );
}
