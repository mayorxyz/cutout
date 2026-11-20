import { useEffect, useRef, useState } from 'react';
import type { AutoCandidateMask } from '../../hooks/useBackgroundRemoval';
import type { AutoDebugSnapshot } from '../../lib/autoRemoveEngine';

type DebugLayer = 'seeds' | 'segments' | 'sure-bg' | 'sure-fg' | 'unknown';

interface AutoDebugOverlayProps {
  debugData: AutoDebugSnapshot;
  candidates: AutoCandidateMask[];
  activeCandidateIndex: number;
  width: number;
  height: number;
  zoom: number;
  panOffset: { x: number; y: number };
  baseFitScale: number;
}

export function AutoDebugOverlay({
  debugData,
  candidates,
  activeCandidateIndex,
  width,
  height,
  zoom,
  panOffset,
  baseFitScale,
}: AutoDebugOverlayProps) {
  const [layer, setLayer] = useState<DebugLayer>('seeds');
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const displayScale = Math.max(0.05, baseFitScale * zoom);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const pw = debugData.procWidth;
    const ph = debugData.procHeight;
    if (canvas.width !== pw || canvas.height !== ph) {
      canvas.width = pw;
      canvas.height = ph;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, pw, ph);

    if (layer !== 'segments') {
      const imgData = ctx.createImageData(pw, ph);
      const dst = imgData.data;
      const len = pw * ph;
      for (let i = 0, p = 0; i < len; i += 1, p += 4) {
        if ((layer === 'seeds' || layer === 'sure-bg') && debugData.sureBgOverlay[i]) {
          dst[p] = 239;
          dst[p + 1] = 68;
          dst[p + 2] = 68;
          dst[p + 3] = 115;
        } else if ((layer === 'seeds' || layer === 'sure-fg') && debugData.sureFgOverlay[i]) {
          dst[p] = 16;
          dst[p + 1] = 185;
          dst[p + 2] = 129;
          dst[p + 3] = 135;
        } else if ((layer === 'seeds' || layer === 'unknown') && debugData.unknownOverlay[i]) {
          dst[p] = 245;
          dst[p + 1] = 158;
          dst[p + 2] = 11;
          dst[p + 3] = 95;
        }
      }
      ctx.putImageData(imgData, 0, 0);
    }

    if (layer === 'segments' || layer === 'seeds') {
      for (const seg of debugData.borderSegments) {
        ctx.strokeStyle = seg.isOutlier ? 'rgba(244, 63, 94, 0.95)' : 'rgba(56, 189, 248, 0.8)';
        ctx.lineWidth = Math.max(1, pw / 450);
        ctx.strokeRect(seg.x0 + 0.5, seg.y0 + 0.5, Math.max(1, seg.x1 - seg.x0 - 1), Math.max(1, seg.y1 - seg.y0 - 1));
      }
    }
  }, [debugData, layer]);

  return (
    <>
      <div
        className="pointer-events-none absolute left-1/2 top-1/2 origin-center"
        style={{
          width,
          height,
          transform: `translate(-50%, -50%) translate(${panOffset.x}px, ${panOffset.y}px) scale(${displayScale})`,
        }}
      >
        <canvas
          ref={canvasRef}
          className="h-full w-full"
          style={{ imageRendering: 'pixelated' }}
        />
      </div>

      <div className="absolute left-3 top-3 z-30 w-64 rounded-xl border border-border bg-panel/95 p-2.5 text-[11px] shadow-xl backdrop-blur">
        <div className="flex items-center justify-between border-b border-border pb-1.5">
          <span className="font-semibold text-ink">Dev Auto Debug ({debugData.modeUsed})</span>
          <span className="font-mono text-[10px] text-muted">
            {debugData.useSurfaceModel ? 'Surface 2D' : 'Palette'}
          </span>
        </div>

        <div className="mt-2 flex flex-wrap gap-1">
          {(
            [
              { id: 'seeds', label: 'All seeds' },
              { id: 'segments', label: 'Border segs' },
              { id: 'sure-bg', label: 'Sure BG' },
              { id: 'sure-fg', label: 'Sure FG' },
              { id: 'unknown', label: 'Unknown' },
            ] as const
          ).map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setLayer(item.id)}
              className={`rounded border px-1.5 py-0.5 text-[10px] ${
                layer === item.id
                  ? 'border-accent bg-accent/20 text-ink'
                  : 'border-border bg-bg text-muted hover:text-ink'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="mt-2">
          <p className="font-medium text-muted">Palette clusters ({debugData.paletteClusters.length})</p>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {debugData.paletteClusters.map((c, idx) => (
              <div key={idx} className="inline-flex items-center gap-1 rounded border border-border bg-bg px-1.5 py-0.5">
                <span
                  className="h-2.5 w-2.5 rounded-sm border border-white/20"
                  style={{ backgroundColor: `rgb(${c.rgb.join(',')})` }}
                />
                <span className="font-mono text-[10px] text-ink">
                  {Math.round(c.coverage * 100)}%
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-2 space-y-1">
          <p className="font-medium text-muted">Candidates ({candidates.length})</p>
          {candidates.map((cand, idx) => (
            <div
              key={cand.id}
              className={`flex items-center justify-between rounded border px-1.5 py-1 ${
                idx === activeCandidateIndex
                  ? 'border-accent bg-accent/15 text-ink'
                  : 'border-border bg-bg text-muted'
              }`}
            >
              <span className="truncate">{cand.label}</span>
              <span className="ml-2 shrink-0 font-mono text-[10px] tabular-nums">
                {cand.score.toFixed(1)} ({Math.round(cand.breakdown.fgFraction * 100)}%)
              </span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
