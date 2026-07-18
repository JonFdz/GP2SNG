import { type ReactNode, useLayoutEffect, useRef, useState } from 'react';

const VIEWPORT_MARGIN = 8; // keep the tooltip this far inside the viewport edges

// The item's bottom-right corner in client (viewport) coordinates — the anchor point
// for its hover tooltip. For DOM targets (MIDI cards, error/warning dots); canvas
// gems supply their own corner via geometry.noteBottomRight.
export function anchorBottomRight(el: Element): { x: number; y: number } {
  const rect = el.getBoundingClientRect();
  return { x: rect.right, y: rect.bottom };
}

// A help tooltip pinned by one of its corners to the item it describes, then nudged
// back inside the viewport if that corner would push it off-screen. Anchored to the
// item — not the cursor — so the text holds still while hovering (docs/DESIGN.md →
// Tooltips). `anchor` is the pin point in client coordinates; `anchorCorner` picks
// which of the tooltip's corners sits there — `top-left` (default; the tooltip grows
// down-right) or `bottom-left` (it grows up-right). Styling comes from `className`.
export function AnchoredTooltip({
  anchor,
  anchorCorner = 'top-left',
  className,
  children,
}: {
  anchor: { x: number; y: number };
  anchorCorner?: 'top-left' | 'bottom-left';
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState(anchor);

  // Measure after layout (before paint, so there's no flash) and clamp the corner in
  // so the tooltip can't spill past a viewport edge. Re-runs whenever the anchor
  // moves to a new item. For a bottom-left pin the tooltip rises from the point, so
  // its top edge is a height above the anchor.
  useLayoutEffect(() => {
    const el = ref.current;
    if (el === null) return;
    const { width, height } = el.getBoundingClientRect();
    const anchorTop = anchorCorner === 'bottom-left' ? anchor.y - height : anchor.y;
    const left = Math.min(anchor.x, window.innerWidth - width - VIEWPORT_MARGIN);
    const top = Math.min(anchorTop, window.innerHeight - height - VIEWPORT_MARGIN);
    setPos({ x: Math.max(VIEWPORT_MARGIN, left), y: Math.max(VIEWPORT_MARGIN, top) });
  }, [anchor.x, anchor.y, anchorCorner]);

  return (
    <div ref={ref} className={className} style={{ left: pos.x, top: pos.y }}>
      {children}
    </div>
  );
}
