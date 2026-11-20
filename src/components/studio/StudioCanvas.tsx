import { Suspense, lazy, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type {
  BackgroundOption,
  OutputEffectSettings,
  ScribblePolarity,
  SelectionCombineMode,
  ToolId,
} from '../../config';
import type { AutoCandidateMask } from '../../hooks/useBackgroundRemoval';
import type { AutoDebugSnapshot } from '../../lib/autoRemoveEngine';
import { clamp } from '../../lib/format';
import { LivewireEngine, type LivewirePoint } from '../../lib/livewire';
import {
  applyEdgeSnappingBrushDab,
  applyStandardBrushDab,
  rgbToLab,
} from '../../lib/maskAlgorithms';
import type { StudioPhase, StudioViewMode } from '../../store/studioStore';
import { CompareSlider } from '../CompareSlider';
import { SelectionOverlay } from './SelectionOverlay';

const DevAutoDebugOverlay = import.meta.env.DEV
  ? lazy(() => import('./AutoDebugOverlay').then((m) => ({ default: m.AutoDebugOverlay })))
  : null;

interface StudioCanvasProps {
  phase: StudioPhase;
  width: number;
  height: number;
  rgba: Uint8ClampedArray;
  originalUrl: string;
  keepSelection: Uint8ClampedArray | null;
  effectiveKeepSelection: Uint8ClampedArray | null;
  appliedMask: Uint8ClampedArray | null;
  showSelectionOverlay: boolean;
  background: BackgroundOption;
  effects: OutputEffectSettings;

  activeTool: ToolId;
  brushSize: number;
  brushHardness: number;
  brushStrength: number;
  brushSmoothing: boolean;
  selectBrushMode: 'add' | 'subtract';
  refineBrushMode: 'restore' | 'erase';
  edgeBrushMode: 'restore' | 'erase';
  edgeBrushTolerance: number;

  scribblePolarity: ScribblePolarity;
  scribbleBrushSize: number;
  scribbleBuffer: Uint8Array;
  scribbleVersion: number;

  showMaskOverlay: boolean;
  maskOverlayOpacity: number;
  viewMode: StudioViewMode;
  zoom: number;
  panOffset: { x: number; y: number };
  onZoomChange: (zoom: number) => void;
  onPanOffsetChange: (offset: { x: number; y: number }) => void;

  // Callbacks
  onKeepStrokeLive: (nextKeep: Uint8ClampedArray) => void;
  onKeepStrokeCommit: (nextKeep: Uint8ClampedArray, label: string) => void;
  onAppliedStrokeLive: (nextMask: Uint8ClampedArray) => void;
  onAppliedStrokeCommit: (nextMask: Uint8ClampedArray, label: string) => void;
  onMagicWandClick: (x: number, y: number, overrideCombine?: SelectionCombineMode) => void;
  onColorKeyPick: (rgb: [number, number, number]) => void;
  onBgEyedropperPick: (rgb: [number, number, number]) => void;
  onGrabCutRectComplete: (
    rect: { x: number; y: number; w: number; h: number },
    overrideCombine?: SelectionCombineMode
  ) => void;
  onScribblesUpdated: () => void;
  onShapeOrLassoComplete: (
    selection: Uint8ClampedArray,
    label: string,
    overrideCombine?: SelectionCombineMode
  ) => void;
  onDrawingActiveChange?: (active: boolean) => void;
  showAutoDebug?: boolean;
  autoDebugData?: AutoDebugSnapshot | null;
  autoCandidates?: AutoCandidateMask[];
  activeCandidateIndex?: number;
}

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 8;

export function StudioCanvas({
  phase,
  width,
  height,
  rgba,
  originalUrl,
  keepSelection,
  effectiveKeepSelection,
  appliedMask,
  showSelectionOverlay,
  background,
  effects,
  activeTool,
  brushSize,
  brushHardness,
  brushStrength,
  brushSmoothing,
  selectBrushMode,
  refineBrushMode,
  edgeBrushMode,
  edgeBrushTolerance,
  scribblePolarity,
  scribbleBrushSize,
  scribbleBuffer,
  scribbleVersion,
  showMaskOverlay,
  maskOverlayOpacity,
  viewMode,
  zoom,
  panOffset,
  onZoomChange,
  onPanOffsetChange,
  onKeepStrokeLive,
  onKeepStrokeCommit,
  onAppliedStrokeLive,
  onAppliedStrokeCommit,
  onMagicWandClick,
  onColorKeyPick,
  onBgEyedropperPick,
  onGrabCutRectComplete,
  onScribblesUpdated,
  onShapeOrLassoComplete,
  onDrawingActiveChange,
  showAutoDebug,
  autoDebugData,
  autoCandidates,
  activeCandidateIndex,
}: StudioCanvasProps) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const subjectCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const maskOverlayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const scribbleCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const [viewportSize, setViewportSize] = useState({ w: 800, h: 560 });
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [splitPos, setSplitPos] = useState(50);
  const [cursorScreenPos, setCursorScreenPos] = useState<{ x: number; y: number } | null>(null);

  const workingBufRef = useRef<Uint8ClampedArray>(new Uint8ClampedArray(width * height));
  const strokeTargetRef = useRef<'keep' | 'applied'>('keep');
  const strokeOpRef = useRef<'restore' | 'erase'>('restore');
  const edgeRefLabRef = useRef<[number, number, number] | null>(null);

  const isDrawingRef = useRef(false);
  const lastImgPtRef = useRef<{ x: number; y: number } | null>(null);
  const smoothPtRef = useRef<{ x: number; y: number } | null>(null);
  const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const panStartRef = useRef<{ x: number; y: number; origX: number; origY: number } | null>(null);
  const pinchStartRef = useRef<{ dist: number; startZoom: number } | null>(null);

  const [lassoPoints, setLassoPoints] = useState<Array<{ x: number; y: number }>>([]);
  const [polyPoints, setPolyPoints] = useState<Array<{ x: number; y: number }>>([]);
  const [dragBox, setDragBox] = useState<{
    x0: number;
    y0: number;
    x1: number;
    y1: number;
  } | null>(null);

  // Livewire Magnetic Lasso state
  const livewireRef = useRef<LivewireEngine | null>(null);
  const livewireRgbaRef = useRef<Uint8ClampedArray | null>(null);
  const [magAnchors, setMagAnchors] = useState<LivewirePoint[]>([]);
  const [magSegments, setMagSegments] = useState<LivewirePoint[][]>([]);
  const [magPreview, setMagPreview] = useState<LivewirePoint[]>([]);
  const magRafRef = useRef<number | null>(null);

  const hasInProgressShape =
    lassoPoints.length > 0 ||
    polyPoints.length > 0 ||
    dragBox !== null ||
    magAnchors.length > 0;

  useEffect(() => {
    onDrawingActiveChange?.(hasInProgressShape);
  }, [hasInProgressShape, onDrawingActiveChange]);

  // Reset livewire engine when underlying image pixels change
  useEffect(() => {
    livewireRef.current = null;
    livewireRgbaRef.current = rgba;
    setMagAnchors([]);
    setMagSegments([]);
    setMagPreview([]);
  }, [rgba, width, height]);

  // Clear in-progress geometry when phase or tool changes
  useEffect(() => {
    setLassoPoints([]);
    setPolyPoints([]);
    setDragBox(null);
    setMagAnchors([]);
    setMagSegments([]);
    setMagPreview([]);
  }, [activeTool, phase]);

  useLayoutEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const update = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        setViewportSize({ w: rect.width, h: rect.height });
      }
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const baseFitScale = Math.min(
    (viewportSize.w - 32) / Math.max(1, width),
    (viewportSize.h - 32) / Math.max(1, height)
  );
  const displayScale = Math.max(0.05, baseFitScale * zoom);

  // Spacebar hold-to-pan
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !e.repeat) {
        const t = e.target as HTMLElement | null;
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
        e.preventDefault();
        setSpaceHeld(true);
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        setSpaceHeld(false);
      }
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  // Paint subject canvas: original full-opaque in Select phase, or appliedMask alpha in Refine phase
  const paintSubjectCanvas = useCallback(
    (alphaSource: Uint8ClampedArray | null) => {
      const canvas = subjectCanvasRef.current;
      if (!canvas) return;
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const imgData = ctx.createImageData(width, height);
      const dst = imgData.data;
      const len = width * height;
      if (phase === 'select' || !alphaSource) {
        for (let i = 0, p = 0; i < len; i += 1, p += 4) {
          dst[p] = rgba[p];
          dst[p + 1] = rgba[p + 1];
          dst[p + 2] = rgba[p + 2];
          dst[p + 3] = rgba[p + 3];
        }
      } else {
        for (let i = 0, p = 0; i < len; i += 1, p += 4) {
          dst[p] = rgba[p];
          dst[p + 1] = rgba[p + 1];
          dst[p + 2] = rgba[p + 2];
          dst[p + 3] = alphaSource[i];
        }
      }
      ctx.putImageData(imgData, 0, 0);
    },
    [height, phase, rgba, width]
  );

  useEffect(() => {
    paintSubjectCanvas(appliedMask);
  }, [appliedMask, paintSubjectCanvas]);

  // Red mask overlay (Phase 2 Refine)
  const paintRedMaskOverlay = useCallback(
    (alphaSource: Uint8ClampedArray | null) => {
      const canvas = maskOverlayCanvasRef.current;
      if (!canvas) return;
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      if (phase !== 'refine' || !showMaskOverlay || !alphaSource) {
        ctx.clearRect(0, 0, width, height);
        return;
      }
      const imgData = ctx.createImageData(width, height);
      const dst = imgData.data;
      const maxAlpha = Math.round(clamp(maskOverlayOpacity, 0.05, 0.9) * 255);
      for (let i = 0, p = 0; i < alphaSource.length; i += 1, p += 4) {
        const removed = 255 - alphaSource[i];
        if (removed > 8) {
          dst[p] = 239;
          dst[p + 1] = 68;
          dst[p + 2] = 68;
          dst[p + 3] = Math.round((removed / 255) * maxAlpha);
        }
      }
      ctx.putImageData(imgData, 0, 0);
    },
    [height, maskOverlayOpacity, phase, showMaskOverlay, width]
  );

  useEffect(() => {
    paintRedMaskOverlay(appliedMask);
  }, [appliedMask, paintRedMaskOverlay]);

  // Paint green/red GrabCut & Watershed scribbles
  const paintScribbleCanvas = useCallback(() => {
    const canvas = scribbleCanvasRef.current;
    if (!canvas) return;
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    if (phase !== 'select') {
      ctx.clearRect(0, 0, width, height);
      return;
    }
    const imgData = ctx.createImageData(width, height);
    const dst = imgData.data;
    const len = width * height;
    for (let i = 0, p = 0; i < len; i += 1, p += 4) {
      const v = scribbleBuffer[i];
      if (v === 1) {
        dst[p] = 16;
        dst[p + 1] = 185;
        dst[p + 2] = 129;
        dst[p + 3] = 215;
      } else if (v === 2) {
        dst[p] = 239;
        dst[p + 1] = 68;
        dst[p + 2] = 68;
        dst[p + 3] = 215;
      }
    }
    ctx.putImageData(imgData, 0, 0);
  }, [height, phase, scribbleBuffer, width]);

  useEffect(() => {
    paintScribbleCanvas();
  }, [paintScribbleCanvas, scribbleVersion]);

  const screenToImageCoords = useCallback(
    (clientX: number, clientY: number) => {
      const rect = viewportRef.current?.getBoundingClientRect();
      if (!rect) return { x: 0, y: 0 };
      const localX = clientX - rect.left;
      const localY = clientY - rect.top;
      const centerX = rect.width / 2 + panOffset.x;
      const centerY = rect.height / 2 + panOffset.y;
      const imgW = width * displayScale;
      const imgH = height * displayScale;
      const imgLeft = centerX - imgW / 2;
      const imgTop = centerY - imgH / 2;
      return {
        x: (localX - imgLeft) / displayScale,
        y: (localY - imgTop) / displayScale,
      };
    },
    [displayScale, height, panOffset.x, panOffset.y, width]
  );

  const stampBrushSegment = useCallback(
    (from: { x: number; y: number }, to: { x: number; y: number }) => {
      const buf = workingBufRef.current;
      const radius = brushSize / 2;
      const dist = Math.hypot(to.x - from.x, to.y - from.y);
      const step = Math.max(1, radius * 0.22);
      const steps = Math.max(1, Math.ceil(dist / step));
      const mode = strokeOpRef.current;

      for (let i = 0; i <= steps; i += 1) {
        const t = steps === 0 ? 0 : i / steps;
        const cx = from.x + (to.x - from.x) * t;
        const cy = from.y + (to.y - from.y) * t;

        if (activeTool === 'edge-brush' && edgeRefLabRef.current) {
          applyEdgeSnappingBrushDab(
            rgba,
            buf,
            width,
            height,
            cx,
            cy,
            radius,
            mode,
            brushStrength,
            brushHardness,
            edgeRefLabRef.current,
            edgeBrushTolerance
          );
        } else {
          applyStandardBrushDab(
            buf,
            width,
            height,
            cx,
            cy,
            radius,
            mode,
            brushStrength,
            brushHardness
          );
        }
      }

      if (strokeTargetRef.current === 'applied') {
        paintSubjectCanvas(buf);
        if (showMaskOverlay) paintRedMaskOverlay(buf);
      } else {
        onKeepStrokeLive(new Uint8ClampedArray(buf));
      }
    },
    [
      activeTool,
      brushHardness,
      brushSize,
      brushStrength,
      edgeBrushTolerance,
      height,
      onKeepStrokeLive,
      paintRedMaskOverlay,
      paintSubjectCanvas,
      rgba,
      showMaskOverlay,
      width,
    ]
  );

  const stampScribbleSegment = useCallback(
    (from: { x: number; y: number }, to: { x: number; y: number }) => {
      const radius = Math.max(2, scribbleBrushSize / 2);
      const rSq = radius * radius;
      const dist = Math.hypot(to.x - from.x, to.y - from.y);
      const step = Math.max(1, radius * 0.35);
      const steps = Math.max(1, Math.ceil(dist / step));
      const val = scribblePolarity === 'fg' ? 1 : 2;

      for (let i = 0; i <= steps; i += 1) {
        const t = steps === 0 ? 0 : i / steps;
        const cx = from.x + (to.x - from.x) * t;
        const cy = from.y + (to.y - from.y) * t;
        const minX = Math.max(0, Math.floor(cx - radius));
        const maxX = Math.min(width - 1, Math.ceil(cx + radius));
        const minY = Math.max(0, Math.floor(cy - radius));
        const maxY = Math.min(height - 1, Math.ceil(cy + radius));
        for (let y = minY; y <= maxY; y += 1) {
          const dy = y - cy;
          const row = y * width;
          for (let x = minX; x <= maxX; x += 1) {
            const dx = x - cx;
            if (dx * dx + dy * dy <= rSq) {
              scribbleBuffer[row + x] = val;
            }
          }
        }
      }
      paintScribbleCanvas();
      onScribblesUpdated();
    },
    [
      height,
      onScribblesUpdated,
      paintScribbleCanvas,
      scribbleBrushSize,
      scribbleBuffer,
      scribblePolarity,
      width,
    ]
  );

  const rasterizePathPoints = useCallback(
    (pts: Array<{ x: number; y: number }>): Uint8ClampedArray => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      const out = new Uint8ClampedArray(width * height);
      if (!ctx || pts.length < 3) return out;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i += 1) {
        ctx.lineTo(pts[i].x, pts[i].y);
      }
      ctx.closePath();
      ctx.fill();
      const { data } = ctx.getImageData(0, 0, width, height);
      for (let i = 0; i < out.length; i += 1) {
        out[i] = data[i * 4];
      }
      return out;
    },
    [height, width]
  );

  const rasterizeBoxShape = useCallback(
    (box: { x0: number; y0: number; x1: number; y1: number }, ellipse: boolean): Uint8ClampedArray => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      const out = new Uint8ClampedArray(width * height);
      if (!ctx) return out;

      const x = Math.min(box.x0, box.x1);
      const y = Math.min(box.y0, box.y1);
      const w = Math.abs(box.x1 - box.x0);
      const h = Math.abs(box.y1 - box.y0);
      if (w < 2 || h < 2) return out;

      ctx.fillStyle = '#ffffff';
      if (ellipse) {
        ctx.beginPath();
        ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillRect(x, y, w, h);
      }

      const { data } = ctx.getImageData(0, 0, width, height);
      for (let i = 0; i < out.length; i += 1) {
        out[i] = data[i * 4];
      }
      return out;
    },
    [height, width]
  );

  const commitPolygon = useCallback(
    (pts: Array<{ x: number; y: number }>, overrideCombine?: SelectionCombineMode) => {
      if (pts.length >= 3) {
        onShapeOrLassoComplete(rasterizePathPoints(pts), 'Polygon selection', overrideCombine);
      }
      setPolyPoints([]);
    },
    [onShapeOrLassoComplete, rasterizePathPoints]
  );

  const commitMagneticLasso = useCallback(
    (
      anchors: LivewirePoint[],
      segments: LivewirePoint[][],
      overrideCombine?: SelectionCombineMode
    ) => {
      if (anchors.length < 2) {
        setMagAnchors([]);
        setMagSegments([]);
        setMagPreview([]);
        return;
      }
      const engine = livewireRef.current;
      const closingSeg = engine ? engine.traceTo(anchors[0].x, anchors[0].y) : [anchors[0]];
      const fullPath: LivewirePoint[] = [];
      for (const seg of segments) {
        for (const p of seg) fullPath.push(p);
      }
      for (const p of closingSeg) fullPath.push(p);
      if (fullPath.length >= 3) {
        onShapeOrLassoComplete(rasterizePathPoints(fullPath), 'Magnetic lasso', overrideCombine);
      }
      setMagAnchors([]);
      setMagSegments([]);
      setMagPreview([]);
    },
    [onShapeOrLassoComplete, rasterizePathPoints]
  );

  // Enter / Esc / Backspace for active polygon, magnetic lasso, or cancelling drag operation
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (hasInProgressShape || isDrawingRef.current) {
          e.preventDefault();
          e.stopPropagation();
          isDrawingRef.current = false;
          setLassoPoints([]);
          setPolyPoints([]);
          setDragBox(null);
          setMagAnchors([]);
          setMagSegments([]);
          setMagPreview([]);
        }
        return;
      }

      if (activeTool === 'polygon-lasso' && polyPoints.length > 0 && e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        commitPolygon(polyPoints);
        return;
      }

      if (activeTool === 'magnetic-lasso' && magAnchors.length > 0) {
        if (e.key === 'Enter') {
          e.preventDefault();
          e.stopPropagation();
          commitMagneticLasso(magAnchors, magSegments);
        } else if (e.key === 'Backspace') {
          e.preventDefault();
          const nextAnchors = magAnchors.slice(0, -1);
          const nextSegs = magSegments.slice(0, -1);
          setMagAnchors(nextAnchors);
          setMagSegments(nextSegs);
          setMagPreview([]);
          if (nextAnchors.length > 0 && livewireRef.current) {
            const last = nextAnchors[nextAnchors.length - 1];
            livewireRef.current.setAnchor(last.x, last.y);
          }
        }
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    activeTool,
    commitMagneticLasso,
    commitPolygon,
    hasInProgressShape,
    magAnchors,
    magSegments,
    polyPoints,
  ]);

  const sampleRgbAt = (x: number, y: number): [number, number, number] => {
    const ix = Math.max(0, Math.min(width - 1, Math.round(x)));
    const iy = Math.max(0, Math.min(height - 1, Math.round(y)));
    const p = (iy * width + ix) * 4;
    return [rgba[p], rgba[p + 1], rgba[p + 2]];
  };

  const getModifierCombine = (e: React.PointerEvent<HTMLDivElement>): SelectionCombineMode | undefined =>
    e.shiftKey ? 'add' : e.altKey ? 'subtract' : undefined;

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (viewMode === 'compare') return;
    event.currentTarget.setPointerCapture(event.pointerId);
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

    // 2-finger pinch/pan
    if (pointersRef.current.size === 2) {
      isDrawingRef.current = false;
      const pts = Array.from(pointersRef.current.values());
      const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
      pinchStartRef.current = { dist: Math.max(dist, 1), startZoom: zoom };
      panStartRef.current = {
        x: (pts[0].x + pts[1].x) / 2,
        y: (pts[0].y + pts[1].y) / 2,
        origX: panOffset.x,
        origY: panOffset.y,
      };
      return;
    }

    if (spaceHeld || activeTool === 'pan' || event.button === 1) {
      panStartRef.current = {
        x: event.clientX,
        y: event.clientY,
        origX: panOffset.x,
        origY: panOffset.y,
      };
      return;
    }

    const pt = screenToImageCoords(event.clientX, event.clientY);
    const modCombine = getModifierCombine(event);

    if (activeTool === 'bg-eyedropper') {
      if (pt.x < 0 || pt.y < 0 || pt.x >= width || pt.y >= height) return;
      onBgEyedropperPick(sampleRgbAt(pt.x, pt.y));
      return;
    }

    if (phase === 'select') {
      if (activeTool === 'magic-wand') {
        if (pt.x < 0 || pt.y < 0 || pt.x >= width || pt.y >= height) return;
        onMagicWandClick(pt.x, pt.y, modCombine);
        return;
      }

      if (activeTool === 'color-key') {
        if (pt.x < 0 || pt.y < 0 || pt.x >= width || pt.y >= height) return;
        onColorKeyPick(sampleRgbAt(pt.x, pt.y));
        return;
      }

      if (activeTool === 'magnetic-lasso') {
        const cx = clamp(pt.x, 0, width - 1);
        const cy = clamp(pt.y, 0, height - 1);
        if (!livewireRef.current || livewireRgbaRef.current !== rgba) {
          livewireRef.current = new LivewireEngine(rgba, width, height);
          livewireRgbaRef.current = rgba;
        }
        const engine = livewireRef.current;

        if (magAnchors.length >= 3) {
          const first = magAnchors[0];
          const distScreen = Math.hypot(cx - first.x, cy - first.y) * displayScale;
          if (distScreen < 14 || event.detail >= 2) {
            commitMagneticLasso(magAnchors, magSegments, modCombine);
            return;
          }
        }

        if (magAnchors.length === 0) {
          engine.setAnchor(cx, cy);
          setMagAnchors([{ x: cx, y: cy }]);
          setMagSegments([]);
          setMagPreview([]);
        } else {
          const snappedSeg = engine.traceTo(cx, cy);
          engine.setAnchor(cx, cy);
          setMagSegments((prev) => [...prev, snappedSeg]);
          setMagAnchors((prev) => [...prev, { x: cx, y: cy }]);
          setMagPreview([]);
        }
        return;
      }

      if (activeTool === 'polygon-lasso') {
        if (event.detail >= 2 && polyPoints.length >= 2) {
          commitPolygon(polyPoints, modCombine);
          return;
        }
        if (polyPoints.length >= 3) {
          const first = polyPoints[0];
          const distScreen = Math.hypot(pt.x - first.x, pt.y - first.y) * displayScale;
          if (distScreen < 12) {
            commitPolygon(polyPoints, modCombine);
            return;
          }
        }
        setPolyPoints((prev) => [...prev, { x: pt.x, y: pt.y }]);
        return;
      }

      if (activeTool === 'lasso') {
        isDrawingRef.current = true;
        setLassoPoints([{ x: pt.x, y: pt.y }]);
        return;
      }

      if (activeTool === 'rect' || activeTool === 'ellipse' || activeTool === 'grabcut-rect') {
        isDrawingRef.current = true;
        setDragBox({ x0: pt.x, y0: pt.y, x1: pt.x, y1: pt.y });
        return;
      }

      if (activeTool === 'scribble') {
        if (event.button !== 0) return;
        isDrawingRef.current = true;
        lastImgPtRef.current = { x: pt.x, y: pt.y };
        stampScribbleSegment({ x: pt.x, y: pt.y }, { x: pt.x, y: pt.y });
        return;
      }
    }

    // Brush tools: select-brush / restore / erase / edge-brush
    if (event.button !== 0) return;
    isDrawingRef.current = true;

    if (phase === 'select') {
      strokeTargetRef.current = 'keep';
      workingBufRef.current = keepSelection
        ? new Uint8ClampedArray(keepSelection)
        : new Uint8ClampedArray(width * height);
      if (activeTool === 'edge-brush') {
        const effectiveMode = event.altKey ? 'erase' : edgeBrushMode;
        strokeOpRef.current = effectiveMode;
        const [r, g, b] = sampleRgbAt(pt.x, pt.y);
        edgeRefLabRef.current = rgbToLab(r, g, b);
      } else {
        const effectiveOp =
          event.altKey || selectBrushMode === 'subtract' ? 'erase' : 'restore';
        strokeOpRef.current = effectiveOp;
        edgeRefLabRef.current = null;
      }
    } else {
      strokeTargetRef.current = 'applied';
      workingBufRef.current = appliedMask
        ? new Uint8ClampedArray(appliedMask)
        : new Uint8ClampedArray(width * height).fill(255);
      if (activeTool === 'edge-brush') {
        strokeOpRef.current = event.altKey ? 'erase' : edgeBrushMode;
        const [r, g, b] = sampleRgbAt(pt.x, pt.y);
        edgeRefLabRef.current = rgbToLab(r, g, b);
      } else if (activeTool === 'erase') {
        strokeOpRef.current = 'erase';
        edgeRefLabRef.current = null;
      } else {
        strokeOpRef.current = refineBrushMode;
        edgeRefLabRef.current = null;
      }
    }

    lastImgPtRef.current = { x: pt.x, y: pt.y };
    smoothPtRef.current = { x: pt.x, y: pt.y };
    stampBrushSegment({ x: pt.x, y: pt.y }, { x: pt.x, y: pt.y });
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const rect = viewportRef.current?.getBoundingClientRect();
    if (rect) {
      setCursorScreenPos({ x: event.clientX - rect.left, y: event.clientY - rect.top });
    }

    if (pointersRef.current.has(event.pointerId)) {
      pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    }

    if (pointersRef.current.size === 2 && pinchStartRef.current && panStartRef.current) {
      const pts = Array.from(pointersRef.current.values());
      const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
      const nextZoom = clamp(
        Number(((dist / pinchStartRef.current.dist) * pinchStartRef.current.startZoom).toFixed(2)),
        MIN_ZOOM,
        MAX_ZOOM
      );
      onZoomChange(nextZoom);
      const midX = (pts[0].x + pts[1].x) / 2;
      const midY = (pts[0].y + pts[1].y) / 2;
      onPanOffsetChange({
        x: panStartRef.current.origX + (midX - panStartRef.current.x),
        y: panStartRef.current.origY + (midY - panStartRef.current.y),
      });
      return;
    }

    if (panStartRef.current && pointersRef.current.size === 1) {
      onPanOffsetChange({
        x: panStartRef.current.origX + (event.clientX - panStartRef.current.x),
        y: panStartRef.current.origY + (event.clientY - panStartRef.current.y),
      });
      return;
    }

    const rawPt = screenToImageCoords(event.clientX, event.clientY);

    if (
      phase === 'select' &&
      activeTool === 'magnetic-lasso' &&
      magAnchors.length > 0 &&
      livewireRef.current
    ) {
      const cx = clamp(rawPt.x, 0, width - 1);
      const cy = clamp(rawPt.y, 0, height - 1);
      if (magRafRef.current) cancelAnimationFrame(magRafRef.current);
      magRafRef.current = requestAnimationFrame(() => {
        if (livewireRef.current) {
          setMagPreview(livewireRef.current.traceTo(cx, cy));
        }
      });
      return;
    }

    if (!isDrawingRef.current) return;

    if (activeTool === 'lasso') {
      setLassoPoints((prev) => [...prev, { x: rawPt.x, y: rawPt.y }]);
      return;
    }

    if (activeTool === 'rect' || activeTool === 'ellipse' || activeTool === 'grabcut-rect') {
      setDragBox((prev) => (prev ? { ...prev, x1: rawPt.x, y1: rawPt.y } : null));
      return;
    }

    if (activeTool === 'scribble') {
      const from = lastImgPtRef.current ?? { x: rawPt.x, y: rawPt.y };
      stampScribbleSegment(from, { x: rawPt.x, y: rawPt.y });
      lastImgPtRef.current = { x: rawPt.x, y: rawPt.y };
      return;
    }

    let targetPt = { x: rawPt.x, y: rawPt.y };
    if (brushSmoothing && smoothPtRef.current) {
      targetPt = {
        x: smoothPtRef.current.x * 0.45 + rawPt.x * 0.55,
        y: smoothPtRef.current.y * 0.45 + rawPt.y * 0.55,
      };
      smoothPtRef.current = targetPt;
    }

    const from = lastImgPtRef.current ?? targetPt;
    stampBrushSegment(from, targetPt);
    lastImgPtRef.current = targetPt;
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    pointersRef.current.delete(event.pointerId);

    if (panStartRef.current) {
      if (pointersRef.current.size < 2) pinchStartRef.current = null;
      if (pointersRef.current.size === 0) panStartRef.current = null;
    }

    if (!isDrawingRef.current) return;
    isDrawingRef.current = false;

    const modCombine = getModifierCombine(event);

    if (activeTool === 'lasso') {
      if (lassoPoints.length >= 3) {
        onShapeOrLassoComplete(rasterizePathPoints(lassoPoints), 'Lasso selection', modCombine);
      }
      setLassoPoints([]);
      return;
    }

    if (activeTool === 'grabcut-rect') {
      if (dragBox) {
        const x = Math.max(0, Math.round(Math.min(dragBox.x0, dragBox.x1)));
        const y = Math.max(0, Math.round(Math.min(dragBox.y0, dragBox.y1)));
        const x2 = Math.min(width, Math.round(Math.max(dragBox.x0, dragBox.x1)));
        const y2 = Math.min(height, Math.round(Math.max(dragBox.y0, dragBox.y1)));
        if (x2 - x >= 8 && y2 - y >= 8) {
          onGrabCutRectComplete({ x, y, w: x2 - x, h: y2 - y }, modCombine);
        }
      }
      setDragBox(null);
      return;
    }

    if (activeTool === 'rect' || activeTool === 'ellipse') {
      if (dragBox) {
        onShapeOrLassoComplete(
          rasterizeBoxShape(dragBox, activeTool === 'ellipse'),
          activeTool === 'ellipse' ? 'Ellipse selection' : 'Rectangle selection',
          modCombine
        );
      }
      setDragBox(null);
      return;
    }

    if (activeTool === 'scribble') {
      lastImgPtRef.current = null;
      return;
    }

    lastImgPtRef.current = null;
    smoothPtRef.current = null;
    edgeRefLabRef.current = null;

    if (strokeTargetRef.current === 'keep') {
      onKeepStrokeCommit(
        new Uint8ClampedArray(workingBufRef.current),
        strokeOpRef.current === 'restore' ? 'Select brush' : 'Deselect brush'
      );
    } else {
      onAppliedStrokeCommit(
        new Uint8ClampedArray(workingBufRef.current),
        activeTool === 'edge-brush'
          ? `Edge brush (${strokeOpRef.current})`
          : strokeOpRef.current === 'restore'
            ? 'Restore brush'
            : 'Erase brush'
      );
    }
  };

  const handleWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    const factor = event.deltaY < 0 ? 1.12 : 0.89;
    onZoomChange(clamp(Number((zoom * factor).toFixed(2)), MIN_ZOOM, MAX_ZOOM));
  };

  // Compare view URL in Refine phase
  const [compareAfterUrl, setCompareAfterUrl] = useState<string | null>(null);
  useEffect(() => {
    if (phase !== 'refine' || viewMode !== 'compare' || !appliedMask) return;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const imgData = ctx.createImageData(width, height);
    const dst = imgData.data;
    for (let i = 0, p = 0; i < width * height; i += 1, p += 4) {
      dst[p] = rgba[p];
      dst[p + 1] = rgba[p + 1];
      dst[p + 2] = rgba[p + 2];
      dst[p + 3] = appliedMask[i];
    }
    ctx.putImageData(imgData, 0, 0);
    let active = true;
    let url: string | null = null;
    canvas.toBlob((blob) => {
      if (!active || !blob) return;
      url = URL.createObjectURL(blob);
      setCompareAfterUrl(url);
    }, 'image/png');
    return () => {
      active = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [appliedMask, height, phase, rgba, viewMode, width]);

  if (phase === 'refine' && viewMode === 'compare') {
    return (
      <div className="flex flex-1 items-center justify-center overflow-hidden bg-bg p-4">
        <div className="w-full max-w-4xl">
          <CompareSlider
            beforeSrc={originalUrl}
            afterSrc={compareAfterUrl ?? originalUrl}
            beforeAlt="Original image"
            afterAlt="Cutout result"
            afterBackground={background}
            aspectClassName="aspect-[4/3] sm:aspect-[16/10]"
          />
        </div>
      </div>
    );
  }

  const isBrushCursor =
    activeTool === 'select-brush' ||
    activeTool === 'restore' ||
    activeTool === 'erase' ||
    activeTool === 'edge-brush' ||
    activeTool === 'scribble';
  const activeCursorPx = activeTool === 'scribble' ? scribbleBrushSize : brushSize;
  const cursorDiameter = Math.max(4, activeCursorPx * displayScale);
  const hardRatio = clamp(brushHardness / 100, 0, 1);

  const bgStyle: React.CSSProperties =
    phase === 'select'
      ? {}
      : background.type === 'color'
        ? { backgroundColor: background.value }
        : background.type === 'gradient'
          ? {
              backgroundImage: `linear-gradient(${background.angle}deg, ${background.from}, ${background.to})`,
            }
          : background.type === 'image'
            ? {
                backgroundImage: `url(${background.dataUrl})`,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
              }
            : {};

  const shadowCss =
    phase === 'refine' && effects.shadowEnabled
      ? `drop-shadow(0px ${Math.round(effects.shadowOffsetY * displayScale)}px ${Math.round(
          effects.shadowBlur * displayScale
        )}px rgba(${parseInt(effects.shadowColor.slice(1, 3) || '00', 16)}, ${parseInt(
          effects.shadowColor.slice(3, 5) || '00',
          16
        )}, ${parseInt(effects.shadowColor.slice(5, 7) || '00', 16)}, ${effects.shadowOpacity}))`
      : undefined;

  const committedMagPoints = magSegments.flat();
  const isPanCursor = spaceHeld || activeTool === 'pan';

  return (
    <div
      ref={viewportRef}
      onWheel={handleWheel}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onPointerLeave={() => setCursorScreenPos(null)}
      className={`relative flex-1 min-h-0 min-w-0 overflow-hidden bg-bg select-none touch-none ${
        isPanCursor ? 'cursor-grab active:cursor-grabbing' : isBrushCursor ? 'cursor-none' : 'cursor-crosshair'
      }`}
    >
      <div
        className={`absolute top-1/2 left-1/2 overflow-hidden shadow-soft ${
          phase === 'refine' && background.type === 'transparent' ? 'checkerboard' : ''
        }`}
        style={{
          width: `${width * displayScale}px`,
          height: `${height * displayScale}px`,
          transform: `translate3d(calc(-50% + ${panOffset.x}px), calc(-50% + ${panOffset.y}px), 0)`,
          ...bgStyle,
        }}
      >
        {phase === 'refine' && background.type === 'blur-original' && (
          <img
            src={originalUrl}
            alt=""
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 h-full w-full scale-110 object-cover"
            style={{ filter: `blur(${background.blurPx}px)` }}
          />
        )}

        {phase === 'refine' && showMaskOverlay && background.type === 'transparent' && (
          <img
            src={originalUrl}
            alt=""
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 h-full w-full object-contain opacity-30"
          />
        )}

        <canvas
          ref={subjectCanvasRef}
          className="pointer-events-none absolute inset-0 h-full w-full"
          style={{
            filter: shadowCss,
            clipPath:
              phase === 'refine' && viewMode === 'split'
                ? `inset(0 0 0 ${splitPos}%)`
                : undefined,
          }}
        />

        {phase === 'refine' && viewMode === 'split' && (
          <img
            src={originalUrl}
            alt="Original half"
            draggable={false}
            className="pointer-events-none absolute inset-0 h-full w-full object-contain"
            style={{ clipPath: `inset(0 ${100 - splitPos}% 0 0)` }}
          />
        )}

        {phase === 'select' && (
          <SelectionOverlay
            width={width}
            height={height}
            selection={effectiveKeepSelection}
            showOverlay={showSelectionOverlay}
          />
        )}

        <canvas
          ref={maskOverlayCanvasRef}
          className="pointer-events-none absolute inset-0 h-full w-full"
        />

        <canvas
          ref={scribbleCanvasRef}
          className="pointer-events-none absolute inset-0 h-full w-full"
        />

        {phase === 'select' &&
          (lassoPoints.length > 1 ||
            polyPoints.length > 0 ||
            dragBox ||
            magAnchors.length > 0) && (
            <svg
              viewBox={`0 0 ${width} ${height}`}
              className="pointer-events-none absolute inset-0 h-full w-full"
            >
              {lassoPoints.length > 1 && (
                <polyline
                  points={lassoPoints.map((p) => `${p.x},${p.y}`).join(' ')}
                  fill="rgba(16,185,129,0.18)"
                  stroke="#10b981"
                  strokeWidth={Math.max(1.5, 2 / displayScale)}
                  strokeDasharray={`${4 / displayScale} ${3 / displayScale}`}
                />
              )}
              {polyPoints.length > 0 && (
                <>
                  <polyline
                    points={polyPoints.map((p) => `${p.x},${p.y}`).join(' ')}
                    fill="rgba(16,185,129,0.18)"
                    stroke="#10b981"
                    strokeWidth={Math.max(1.5, 2 / displayScale)}
                  />
                  {polyPoints.map((p, idx) => (
                    <circle
                      key={`${p.x}-${p.y}-${idx}`}
                      cx={p.x}
                      cy={p.y}
                      r={Math.max(3, 5 / displayScale)}
                      fill={idx === 0 ? '#10b981' : '#3b82f6'}
                      stroke="#ffffff"
                      strokeWidth={Math.max(1, 1.5 / displayScale)}
                    />
                  ))}
                </>
              )}
              {dragBox && (activeTool === 'rect' || activeTool === 'grabcut-rect') && (
                <rect
                  x={Math.min(dragBox.x0, dragBox.x1)}
                  y={Math.min(dragBox.y0, dragBox.y1)}
                  width={Math.abs(dragBox.x1 - dragBox.x0)}
                  height={Math.abs(dragBox.y1 - dragBox.y0)}
                  fill={
                    activeTool === 'grabcut-rect'
                      ? 'rgba(59,130,246,0.14)'
                      : 'rgba(16,185,129,0.16)'
                  }
                  stroke={activeTool === 'grabcut-rect' ? '#3b82f6' : '#10b981'}
                  strokeWidth={Math.max(1.5, 2.2 / displayScale)}
                  strokeDasharray={`${5 / displayScale} ${3 / displayScale}`}
                />
              )}
              {dragBox && activeTool === 'ellipse' && (
                <ellipse
                  cx={(dragBox.x0 + dragBox.x1) / 2}
                  cy={(dragBox.y0 + dragBox.y1) / 2}
                  rx={Math.abs(dragBox.x1 - dragBox.x0) / 2}
                  ry={Math.abs(dragBox.y1 - dragBox.y0) / 2}
                  fill="rgba(16,185,129,0.16)"
                  stroke="#10b981"
                  strokeWidth={Math.max(1.5, 2 / displayScale)}
                  strokeDasharray={`${5 / displayScale} ${3 / displayScale}`}
                />
              )}
              {magAnchors.length > 0 && (
                <>
                  {committedMagPoints.length > 1 && (
                    <polyline
                      points={committedMagPoints.map((p) => `${p.x},${p.y}`).join(' ')}
                      fill="none"
                      stroke="#3b82f6"
                      strokeWidth={Math.max(1.5, 2.2 / displayScale)}
                    />
                  )}
                  {magPreview.length > 1 && (
                    <polyline
                      points={magPreview.map((p) => `${p.x},${p.y}`).join(' ')}
                      fill="none"
                      stroke="#10b981"
                      strokeWidth={Math.max(1.5, 2.2 / displayScale)}
                      strokeDasharray={`${4 / displayScale} ${3 / displayScale}`}
                    />
                  )}
                  {magAnchors.map((pt, idx) => (
                    <circle
                      key={`mag-${pt.x}-${pt.y}-${idx}`}
                      cx={pt.x}
                      cy={pt.y}
                      r={Math.max(3, 5.5 / displayScale)}
                      fill={idx === 0 ? '#10b981' : '#ffffff'}
                      stroke="#3b82f6"
                      strokeWidth={Math.max(1, 1.5 / displayScale)}
                    />
                  ))}
                </>
              )}
            </svg>
          )}
      </div>

      {/* Zoom-accurate circle brush cursor */}
      {isBrushCursor && !isPanCursor && cursorScreenPos && (
        <div
          aria-hidden="true"
          className={`pointer-events-none absolute rounded-full border shadow-[0_0_0_1px_rgba(0,0,0,0.7)] ${
            activeTool === 'scribble'
              ? scribblePolarity === 'fg'
                ? 'border-emerald-400'
                : 'border-red-400'
              : 'border-white'
          }`}
          style={{
            width: `${cursorDiameter}px`,
            height: `${cursorDiameter}px`,
            left: `${cursorScreenPos.x - cursorDiameter / 2}px`,
            top: `${cursorScreenPos.y - cursorDiameter / 2}px`,
          }}
        >
          {activeTool !== 'scribble' && hardRatio > 0.05 && hardRatio < 0.98 && (
            <div
              className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-dashed border-white/60"
              style={{
                width: `${Math.max(2, cursorDiameter * hardRatio)}px`,
                height: `${Math.max(2, cursorDiameter * hardRatio)}px`,
              }}
            />
          )}
        </div>
      )}

      {phase === 'refine' && viewMode === 'split' && (
        <div className="absolute bottom-3 left-1/2 z-20 flex -translate-x-1/2 items-center gap-2 rounded-lg border border-border bg-panel/90 px-3 py-1.5 text-xs backdrop-blur-sm">
          <span className="text-muted">Split</span>
          <input
            type="range"
            min={0}
            max={100}
            value={splitPos}
            onChange={(e) => setSplitPos(Number(e.target.value))}
            aria-label="Split view divider position"
            className="range-control w-28 cursor-pointer"
          />
        </div>
      )}

      {import.meta.env.DEV &&
        DevAutoDebugOverlay &&
        showAutoDebug &&
        autoDebugData &&
        autoCandidates && (
          <Suspense fallback={null}>
            <DevAutoDebugOverlay
              debugData={autoDebugData}
              candidates={autoCandidates}
              activeCandidateIndex={activeCandidateIndex ?? 0}
              width={width}
              height={height}
              zoom={zoom}
              panOffset={panOffset}
              baseFitScale={baseFitScale}
            />
          </Suspense>
        )}
    </div>
  );
}
