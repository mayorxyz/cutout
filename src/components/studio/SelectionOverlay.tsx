import { useEffect, useRef } from 'react';

interface SelectionOverlayProps {
  width: number;
  height: number;
  selection: Uint8ClampedArray | null;
  showOverlay: boolean;
}

/**
 * Renders the Select-phase overlay:
 * - Optional green tint on selected (kept) areas + dark dim scrim on non-selected areas
 * - Crisp animated marching ants strictly along the boundary of the selection mask
 */
export function SelectionOverlay({
  width,
  height,
  selection,
  showOverlay,
}: SelectionOverlayProps) {
  const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const antsCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const edgePixelsRef = useRef<Int32Array>(new Int32Array(0));

  useEffect(() => {
    const overlayCanvas = overlayCanvasRef.current;
    const antsCanvas = antsCanvasRef.current;
    if (!overlayCanvas || !antsCanvas) return;

    if (overlayCanvas.width !== width || overlayCanvas.height !== height) {
      overlayCanvas.width = width;
      overlayCanvas.height = height;
    }
    if (antsCanvas.width !== width || antsCanvas.height !== height) {
      antsCanvas.width = width;
      antsCanvas.height = height;
    }

    const oCtx = overlayCanvas.getContext('2d');
    const aCtx = antsCanvas.getContext('2d');
    if (!oCtx || !aCtx) return;

    if (!selection) {
      oCtx.clearRect(0, 0, width, height);
      aCtx.clearRect(0, 0, width, height);
      edgePixelsRef.current = new Int32Array(0);
      return;
    }

    // Check if selection has any pixels > 0
    let anySelected = false;
    for (let i = 0; i < selection.length; i += 1) {
      if (selection[i] > 0) {
        anySelected = true;
        break;
      }
    }

    if (!anySelected) {
      oCtx.clearRect(0, 0, width, height);
      aCtx.clearRect(0, 0, width, height);
      edgePixelsRef.current = new Int32Array(0);
      return;
    }

    // 1. Optional green tint on kept area + subtle dark scrim on outside area
    if (showOverlay) {
      const overlayImg = oCtx.createImageData(width, height);
      const dst = overlayImg.data;
      for (let i = 0, p = 0; i < selection.length; i += 1, p += 4) {
        const s = selection[i];
        if (s > 0) {
          dst[p] = 16;
          dst[p + 1] = 185;
          dst[p + 2] = 129;
          dst[p + 3] = Math.round((s / 255) * 62);
        } else {
          dst[p] = 8;
          dst[p + 1] = 12;
          dst[p + 2] = 18;
          dst[p + 3] = 120;
        }
      }
      oCtx.putImageData(overlayImg, 0, 0);
    } else {
      oCtx.clearRect(0, 0, width, height);
    }

    // 2. Collect boundary pixels where selected (>= 128) touches non-selected (< 128)
    const indices: number[] = [];
    for (let y = 0; y < height; y += 1) {
      const row = y * width;
      for (let x = 0; x < width; x += 1) {
        const idx = row + x;
        if (selection[idx] < 128) continue;
        const isEdge =
          x === 0 ||
          x === width - 1 ||
          y === 0 ||
          y === height - 1 ||
          selection[idx - 1] < 128 ||
          selection[idx + 1] < 128 ||
          selection[idx - width] < 128 ||
          selection[idx + width] < 128;
        if (isEdge) {
          indices.push(idx);
        }
      }
    }

    edgePixelsRef.current = new Int32Array(indices);
    if (indices.length === 0) {
      aCtx.clearRect(0, 0, width, height);
      return;
    }

    const imgData = aCtx.createImageData(width, height);
    const data = imgData.data;

    const paintPhase = (phase: number) => {
      const edge = edgePixelsRef.current;
      for (let k = 0; k < edge.length; k += 1) {
        const idx = edge[k];
        const x = idx % width;
        const y = (idx - x) / width;
        const isWhite = (x + y + phase) % 10 < 5;
        const p = idx * 4;
        data[p] = isWhite ? 255 : 15;
        data[p + 1] = isWhite ? 255 : 23;
        data[p + 2] = isWhite ? 255 : 42;
        data[p + 3] = 240;
      }
      aCtx.putImageData(imgData, 0, 0);
    };

    paintPhase(0);

    const reducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reducedMotion) return;

    let phase = 0;
    const interval = window.setInterval(() => {
      phase = (phase + 1) % 10;
      paintPhase(phase);
    }, 130);

    return () => {
      window.clearInterval(interval);
    };
  }, [height, selection, showOverlay, width]);

  return (
    <>
      <canvas
        ref={overlayCanvasRef}
        className="pointer-events-none absolute inset-0 h-full w-full"
      />
      <canvas
        ref={antsCanvasRef}
        className="pointer-events-none absolute inset-0 h-full w-full"
      />
    </>
  );
}
