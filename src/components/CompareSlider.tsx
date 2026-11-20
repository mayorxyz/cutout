import { useCallback, useEffect, useRef, useState } from 'react';
import type { BackgroundOption } from '../config';
import { clamp } from '../lib/format';
import { SliderArrowsIcon } from './icons';

interface CompareSliderProps {
  beforeSrc: string;
  afterSrc: string;
  beforeAlt: string;
  afterAlt: string;
  afterBackground?: BackgroundOption;
  autoAnimate?: boolean;
  aspectClassName?: string;
}

export function CompareSlider({
  beforeSrc,
  afterSrc,
  beforeAlt,
  afterAlt,
  afterBackground = { type: 'transparent' },
  autoAnimate = false,
  aspectClassName = 'aspect-[4/3]',
}: CompareSliderProps) {
  const [position, setPosition] = useState(50);
  const [isUserControlled, setIsUserControlled] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!autoAnimate || isUserControlled || isDragging) return;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reducedMotion) return;

    let frameId = 0;
    const startTime = performance.now();

    const tick = (now: number) => {
      const elapsed = (now - startTime) / 1000;
      const next = 50 + Math.sin(elapsed * 1.15) * 30;
      setPosition(next);
      frameId = requestAnimationFrame(tick);
    };

    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, [autoAnimate, isUserControlled, isDragging]);

  const updateFromClientX = useCallback((clientX: number) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return;
    const pct = ((clientX - rect.left) / rect.width) * 100;
    setPosition(clamp(pct, 0, 100));
  }, []);

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    setIsUserControlled(true);
    setIsDragging(true);
    updateFromClientX(event.clientX);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging) return;
    updateFromClientX(event.clientX);
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setIsDragging(false);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 10 : 2;
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      setIsUserControlled(true);
      setPosition((prev) => clamp(prev - step, 0, 100));
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      setIsUserControlled(true);
      setPosition((prev) => clamp(prev + step, 0, 100));
    } else if (event.key === 'Home') {
      event.preventDefault();
      setIsUserControlled(true);
      setPosition(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      setIsUserControlled(true);
      setPosition(100);
    }
  };

  const afterBgClass = afterBackground.type === 'transparent' ? 'checkerboard' : '';
  const afterBgStyle =
    afterBackground.type === 'color' ? { backgroundColor: afterBackground.value } : undefined;

  return (
    <div
      ref={containerRef}
      role="slider"
      tabIndex={0}
      aria-label="Before and after comparison slider. Use left and right arrow keys to move divider."
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(position)}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onKeyDown={handleKeyDown}
      onMouseEnter={() => autoAnimate && setIsUserControlled(true)}
      className={`relative w-full select-none overflow-hidden rounded-card border border-border bg-panel touch-none cursor-ew-resize ${aspectClassName}`}
    >
      {/* After (Result) layer underneath */}
      <div className={`absolute inset-0 ${afterBgClass}`} style={afterBgStyle}>
        <img
          src={afterSrc}
          alt={afterAlt}
          draggable={false}
          className="h-full w-full object-contain pointer-events-none"
        />
      </div>

      {/* Before (Original) layer clipped from right */}
      <div
        className="absolute inset-0 bg-panel"
        style={{ clipPath: `inset(0 ${100 - position}% 0 0)` }}
      >
        <img
          src={beforeSrc}
          alt={beforeAlt}
          draggable={false}
          className="h-full w-full object-contain pointer-events-none"
        />
      </div>

      {/* Labels */}
      <span className="pointer-events-none absolute top-3 left-3 rounded-md border border-border/80 bg-bg/85 px-2.5 py-1 text-xs font-medium text-ink backdrop-blur-sm">
        Original
      </span>
      <span className="pointer-events-none absolute top-3 right-3 rounded-md border border-border/80 bg-bg/85 px-2.5 py-1 text-xs font-medium text-ink backdrop-blur-sm">
        Cutout
      </span>

      {/* Divider line and handle */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 w-0.5 -translate-x-1/2 bg-white/90 shadow-sm"
        style={{ left: `${position}%` }}
      >
        <div className="absolute top-1/2 left-1/2 flex h-10 w-10 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-panel text-ink shadow-soft">
          <SliderArrowsIcon className="h-4 w-4" />
        </div>
      </div>
    </div>
  );
}
