import { useEffect, useRef } from 'react';
import {
  LANE_COUNT,
  laneIndex,
  minimapLaneX,
  minimapTimeAt,
  minimapY,
  type PlacedNote,
} from '../playback/geometry';
import { HIT_LINE } from './ChartCanvas';
import { NOTE_COLORS } from './YargNoteSwatch';

// The fit-to-height minimap canvas (docs spec → Group C): the whole song scaled
// into the panel height, tiny lane-colored gems, and a current-position line that
// matches the live highway's hit line. Section labels are an HTML overlay rendered
// by PreviewView, not here. All time↔pixel math lives in playback/geometry.ts.

const GEM_HEIGHT = 1; // px height of a lane gem — a thin line so dense songs stay readable (tune)
const GEM_WIDTH_FRAC = 0.8; // lane gem width as a fraction of the minimap lane (tune)
const KICK_HEIGHT = 1; // px height of the full-width kick bar (tune)
const GEM_ALPHA = 0.5; // gems drawn half-transparent so overlaps don't read as solid blocks (tune)
const LINE_HEIGHT = 2; // current-position line thickness (tune)
const MINIMAP_BG = '#171e27'; // --bg-surface

interface MinimapCanvasProps {
  placed: PlacedNote[];
  songEnd: number;
  viewTime: number; // used while stopped
  isPlaying: boolean;
  getChartTime: () => number; // scheduler clock, used while playing
  onSeek: (seconds: number) => void;
}

export function MinimapCanvas(props: MinimapCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const propsRef = useRef(props);
  propsRef.current = props;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    const ctx = canvas.getContext('2d');
    if (ctx === null) return;

    let raf = 0;
    const draw = () => {
      const p = propsRef.current;
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
        canvas.width = w * dpr;
        canvas.height = h * dpr;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      ctx.fillStyle = MINIMAP_BG;
      ctx.fillRect(0, 0, w, h);

      const laneW = w / LANE_COUNT;
      const gemW = laneW * GEM_WIDTH_FRAC;
      ctx.globalAlpha = GEM_ALPHA;
      for (const pn of p.placed) {
        const y = minimapY(pn.seconds, p.songEnd, h);
        const lane = laneIndex(pn.note.note);
        if (lane === null) {
          ctx.fillStyle = NOTE_COLORS.orange;
          ctx.fillRect(0, y - KICK_HEIGHT / 2, w, KICK_HEIGHT);
        } else {
          ctx.fillStyle = NOTE_COLORS[pn.note.note];
          ctx.fillRect(minimapLaneX(lane, w) - gemW / 2, y - GEM_HEIGHT / 2, gemW, GEM_HEIGHT);
        }
      }
      ctx.globalAlpha = 1; // the current-position line stays fully opaque

      const time = p.isPlaying ? p.getChartTime() : p.viewTime;
      const ly = minimapY(time, p.songEnd, h);
      ctx.fillStyle = HIT_LINE;
      ctx.fillRect(0, ly - LINE_HEIGHT / 2, w, LINE_HEIGHT);

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="minimap-canvas"
      onClick={(e) => {
        const canvas = canvasRef.current;
        if (canvas === null) return;
        const y = e.clientY - canvas.getBoundingClientRect().top;
        propsRef.current.onSeek(minimapTimeAt(y, propsRef.current.songEnd, canvas.clientHeight));
      }}
    />
  );
}
