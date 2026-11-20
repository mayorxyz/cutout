import { useCallback, useRef, useState } from 'react';
import type { BackgroundOption } from '../config';
import { clamp } from '../lib/format';
import { ResetIcon, ZoomInIcon, ZoomOutIcon } from './icons';

interface ZoomPaneProps {
  src: string;
  alt: string;
  background: BackgroundOption;
  aspectClassName?: string;
}

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 6;

export function ZoomPane({
  src,
  alt,
  background,
  aspectClassName = 'aspect-[4/3]',
}: ZoomPaneProps) {
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const panStartRef = useRef<{ x: number; y: number; origX: number; origY: number } | null>(null);
  const pinchStartRef = useRef<{ dist: number; startZoom: number } | null>(null);

  const resetView = useCallback(() => {
    setZoom(1);
    setOffset({ x: 0, y: 0 });
  }, []);

  const stepZoom = (delta: number) => {
    setZoom((prev) => clamp(Number((prev + delta).toFixed(2)), MIN_ZOOM, MAX_ZOOM));
  };

  const handleWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    const factor = event.deltaY < 0 ? 1.12 : 0.89;
    setZoom((prev) => clamp(Number((prev * factor).toFixed(2)), MIN_ZOOM, MAX_ZOOM));
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (pointersRef.current.size === 1) {
      panStartRef.current = {
        x: event.clientX,
        y: event.clientY,
        origX: offset.x,
        origY: offset.y,
      };
      pinchStartRef.current = null;
    } else if (pointersRef.current.size === 2) {
      const pts = Array.from(pointersRef.current.values());
      const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
      pinchStartRef.current = { dist: Math.max(dist, 1), startZoom: zoom };
      panStartRef.current = null;
    }
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!pointersRef.current.has(event.pointerId)) return;
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (pointersRef.current.size === 2 && pinchStartRef.current) {
      const pts = Array.from(pointersRef.current.values());
      const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
      const nextZoom = clamp(
        Number(((dist / pinchStartRef.current.dist) * pinchStartRef.current.startZoom).toFixed(2)),
        MIN_ZOOM,
        MAX_ZOOM
      );
      setZoom(nextZoom);
    } else if (pointersRef.current.size === 1 && panStartRef.current) {
      const dx = event.clientX - panStartRef.current.x;
      const dy = event.clientY - panStartRef.current.y;
      setOffset({
        x: panStartRef.current.origX + dx,
        y: panStartRef.current.origY + dy,
      });
    }
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    pointersRef.current.delete(event.pointerId);
    if (pointersRef.current.size === 0) {
      panStartRef.current = null;
      pinchStartRef.current = null;
    } else if (pointersRef.current.size === 1) {
      const remaining = Array.from(pointersRef.current.values())[0];
      panStartRef.current = {
        x: remaining.x,
        y: remaining.y,
        origX: offset.x,
        origY: offset.y,
      };
      pinchStartRef.current = null;
    }
  };

  const bgClass = background.type === 'transparent' ? 'checkerboard' : '';
  const bgStyle = background.type === 'color' ? { backgroundColor: background.value } : undefined;

  return (
    <div className="space-y-2.5">
      <div
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        tabIndex={0}
        aria-label="Zoomable result preview. Scroll or pinch to zoom, drag to pan."
        onKeyDown={(event) => {
          if (event.key === '+' || event.key === '=') {
            event.preventDefault();
            stepZoom(0.25);
          } else if (event.key === '-') {
            event.preventDefault();
            stepZoom(-0.25);
          } else if (event.key === '0') {
            event.preventDefault();
            resetView();
          }
        }}
        className={`relative w-full overflow-hidden rounded-card border border-border touch-none cursor-grab active:cursor-grabbing ${bgClass} ${aspectClassName}`}
        style={bgStyle}
      >
        <img
          src={src}
          alt={alt}
          draggable={false}
          className="h-full w-full object-contain pointer-events-none select-none will-change-transform"
          style={{
            transform: `translate3d(${offset.x}px, ${offset.y}px, 0) scale(${zoom})`,
          }}
        />
      </div>

      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted">Scroll or pinch to zoom · Drag to pan</span>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => stepZoom(-0.25)}
            aria-label="Zoom out"
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-surface text-ink transition-colors hover:bg-panel"
          >
            <ZoomOutIcon className="h-4 w-4" />
          </button>
          <span className="min-w-[48px] text-center font-mono text-xs tabular-nums text-ink">
            {Math.round(zoom * 100)}%
          </span>
          <button
            type="button"
            onClick={() => stepZoom(0.25)}
            aria-label="Zoom in"
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-surface text-ink transition-colors hover:bg-panel"
          >
            <ZoomInIcon className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={resetView}
            aria-label="Reset zoom and pan"
            className="inline-flex h-8 items-center gap-1 rounded-lg border border-border bg-surface px-2.5 text-xs font-medium text-ink transition-colors hover:bg-panel"
          >
            <ResetIcon className="h-3.5 w-3.5" />
            <span>Reset</span>
          </button>
        </div>
      </div>
    </div>
  );
}
