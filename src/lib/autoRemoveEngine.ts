import type { AutoRemoveMode, AutoRemoveSettings } from '../config';
import {
  applyMorphology,
  fillHoles,
  guidedFilterMask,
  guidedUpsampleMask,
  rgbToLab,
} from './maskAlgorithms';
import {
  geodesicBackgroundCost,
  maskFromGeodesicCost,
  removeInteriorBackground,
} from './autoRemoveGeodesic';
import { personMask, makeDeadline } from './personSegmenter';

export interface BorderSegmentDebug {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  side: 'top' | 'bottom' | 'left' | 'right';
  meanL: number;
  meanA: number;
  meanB: number;
  isOutlier: boolean;
}

export interface PaletteClusterDebug {
  l: number;
  a: number;
  b: number;
  rgb: [number, number, number];
  coverage: number;
  stdL: number;
  stdA: number;
  stdB: number;
}

export interface CandidateScoreBreakdown {
  boundaryAlignment: number;
  areaPlausibility: number;
  borderContactScore: number;
  topologyScore: number;
  smoothnessScore: number;
  colorSeparation: number;
  total: number;
  fgFraction: number;
}

export interface AutoCandidateResult {
  id: string;
  label: string;
  mask: Uint8ClampedArray;
  score: number;
  breakdown: CandidateScoreBreakdown;
  usedGrabCut: boolean;
}

export interface AutoDebugSnapshot {
  procWidth: number;
  procHeight: number;
  borderSegments: BorderSegmentDebug[];
  paletteClusters: PaletteClusterDebug[];
  useSurfaceModel: boolean;
  modeUsed: 'plain' | 'complex';
  sureBgOverlay: Uint8ClampedArray; // 0 or 255 at proc resolution
  sureFgOverlay: Uint8ClampedArray; // 0 or 255 at proc resolution
  unknownOverlay: Uint8ClampedArray; // 0 or 255 at proc resolution
  candidatesSummary: Array<{
    id: string;
    label: string;
    score: number;
    fgFraction: number;
    breakdown: CandidateScoreBreakdown;
  }>;
}

export interface AutoRemoveEngineResult {
  mask: Uint8ClampedArray;
  candidates: AutoCandidateResult[];
  bestIndex: number;
  score: number;
  confidence: 'normal' | 'low';
  modeUsed: 'plain' | 'complex';
  spillMode: 'green' | 'blue' | null;
  subjectTouchesEdgeDetected: boolean;
  usedCenterFallback: boolean;
  debug?: AutoDebugSnapshot;
}

export interface ComplexSegmenter {
  runGrabCutWithMask: (
    rgba: Uint8ClampedArray,
    width: number,
    height: number,
    trimap: Uint8Array,
    iterations: number
  ) => Promise<Uint8ClampedArray> | Uint8ClampedArray;
  runWatershed?: (
    rgba: Uint8ClampedArray,
    width: number,
    height: number,
    markers: Int32Array
  ) => Promise<Uint8ClampedArray> | Uint8ClampedArray;
  runGrabCutRectFallback?: (
    rgba: Uint8ClampedArray,
    width: number,
    height: number,
    rect: { x: number; y: number; w: number; h: number },
    iterations: number
  ) => Promise<Uint8ClampedArray> | Uint8ClampedArray;
}

export interface AutoEngineOptions {
  onProgress?: (progress: number, detail: string) => void;
  complexSegmenter?: ComplexSegmenter;
  includeDebug?: boolean;
}

const PROC_MAX_LONG_SIDE = 512;
const PROC_MIN_LONG_SIDE = 256;
const LOW_CONFIDENCE_FLOOR = 48;

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function labToRgbApprox(l: number, a: number, b: number): [number, number, number] {
  const fy = (l + 16) / 116;
  const fx = a / 500 + fy;
  const fz = fy - b / 200;
  const invF = (t: number) => (t > 0.206893 ? t * t * t : (t - 16 / 116) / 7.787);
  const x = 0.95047 * invF(fx);
  const y = 1.0 * invF(fy);
  const z = 1.08883 * invF(fz);

  let r = x * 3.2404542 - y * 1.5371385 - z * 0.4985314;
  let g = -x * 0.969266 + y * 1.8760108 + z * 0.041556;
  let bl = x * 0.0556434 - y * 0.2040259 + z * 1.0572252;

  const gamma = (u: number) =>
    u <= 0.0031308 ? 12.92 * u : 1.055 * Math.pow(Math.max(0, u), 1 / 2.4) - 0.055;

  r = clamp(Math.round(gamma(r) * 255), 0, 255);
  g = clamp(Math.round(gamma(g) * 255), 0, 255);
  bl = clamp(Math.round(gamma(bl) * 255), 0, 255);
  return [r, g, bl];
}

function resizeRgbaBilinear(
  src: Uint8ClampedArray,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number
): Uint8ClampedArray {
  if (srcW === dstW && srcH === dstH) return new Uint8ClampedArray(src);
  const out = new Uint8ClampedArray(dstW * dstH * 4);
  const scaleX = srcW / dstW;
  const scaleY = srcH / dstH;

  for (let y = 0; y < dstH; y += 1) {
    const sy = clamp((y + 0.5) * scaleY - 0.5, 0, srcH - 1);
    const y0 = Math.floor(sy);
    const y1 = Math.min(srcH - 1, y0 + 1);
    const dy = sy - y0;
    const wRow0 = y0 * srcW;
    const wRow1 = y1 * srcW;

    for (let x = 0; x < dstW; x += 1) {
      const sx = clamp((x + 0.5) * scaleX - 0.5, 0, srcW - 1);
      const x0 = Math.floor(sx);
      const x1 = Math.min(srcW - 1, x0 + 1);
      const dx = sx - x0;

      const i00 = (wRow0 + x0) * 4;
      const i10 = (wRow0 + x1) * 4;
      const i01 = (wRow1 + x0) * 4;
      const i11 = (wRow1 + x1) * 4;
      const dp = (y * dstW + x) * 4;

      for (let c = 0; c < 4; c += 1) {
        const top = src[i00 + c] + (src[i10 + c] - src[i00 + c]) * dx;
        const bot = src[i01 + c] + (src[i11 + c] - src[i01 + c]) * dx;
        out[dp + c] = Math.round(top + (bot - top) * dy);
      }
    }
  }
  return out;
}

function medianSorted(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid] : 0.5 * (sorted[mid - 1] + sorted[mid]);
}

function quantileFloat32(arr: Float32Array, q: number): number {
  const step = Math.max(1, Math.floor(arr.length / 25000));
  const sample: number[] = [];
  for (let i = 0; i < arr.length; i += step) {
    sample.push(arr[i]);
  }
  sample.sort((a, b) => a - b);
  if (sample.length === 0) return 0;
  const idx = clamp(Math.floor(q * (sample.length - 1)), 0, sample.length - 1);
  return sample[idx];
}

/**
 * 3x3 edge-preserving bilateral denoise in CIELAB space.
 */
function bilateralDenoiseLab(
  srcL: Float32Array,
  srcA: Float32Array,
  srcB: Float32Array,
  w: number,
  h: number
): { L: Float32Array; A: Float32Array; B: Float32Array } {
  const len = w * h;
  const outL = new Float32Array(len);
  const outA = new Float32Array(len);
  const outB = new Float32Array(len);
  const inv2SigmaR2 = 1 / (2 * 11.5 * 11.5);
  const spatialW = [0.6, 0.85, 0.6, 0.85, 1.0, 0.85, 0.6, 0.85, 0.6];
  const ys = new Int32Array(3);
  const xs = new Int32Array(3);

  for (let y = 0; y < h; y += 1) {
    const y0 = Math.max(0, y - 1);
    const y2 = Math.min(h - 1, y + 1);
    ys[0] = y0;
    ys[1] = y;
    ys[2] = y2;
    const row = y * w;
    for (let x = 0; x < w; x += 1) {
      const idx = row + x;
      const cL = srcL[idx];
      const cA = srcA[idx];
      const cB = srcB[idx];
      const x0 = Math.max(0, x - 1);
      const x2 = Math.min(w - 1, x + 1);
      xs[0] = x0;
      xs[1] = x;
      xs[2] = x2;

      let wSum = 0;
      let sL = 0;
      let sA = 0;
      let sB = 0;
      let k = 0;
      for (let ky = 0; ky < 3; ky += 1) {
        const nRow = ys[ky] * w;
        for (let kx = 0; kx < 3; kx += 1) {
          const nIdx = nRow + xs[kx];
          const dl = srcL[nIdx] - cL;
          const da = srcA[nIdx] - cA;
          const db = srcB[nIdx] - cB;
          const rangeSq = 0.5 * dl * dl + da * da + db * db;
          const weight = spatialW[k] * Math.exp(-rangeSq * inv2SigmaR2);
          wSum += weight;
          sL += srcL[nIdx] * weight;
          sA += srcA[nIdx] * weight;
          sB += srcB[nIdx] * weight;
          k += 1;
        }
      }
      outL[idx] = sL / wSum;
      outA[idx] = sA / wSum;
      outB[idx] = sB / wSum;
    }
  }
  return { L: outL, A: outA, B: outB };
}

/**
 * Scharr gradient magnitude across Lab channels, returning raw gradient + [0..1] normalized.
 */
function computeScharrGradient(
  L: Float32Array,
  A: Float32Array,
  B: Float32Array,
  w: number,
  h: number
): { rawG: Float32Array; normG: Float32Array; maxG: number } {
  const len = w * h;
  const rawG = new Float32Array(len);
  let maxG = 1e-6;

  const scharr = (
    ch: Float32Array,
    r0: number,
    r1: number,
    r2: number,
    xm: number,
    x: number,
    xp: number
  ) => {
    const c00 = ch[r0 + xm], c01 = ch[r0 + x], c02 = ch[r0 + xp];
    const c10 = ch[r1 + xm], c12 = ch[r1 + xp];
    const c20 = ch[r2 + xm], c21 = ch[r2 + x], c22 = ch[r2 + xp];
    const gx = (3 * (c02 - c00) + 10 * (c12 - c10) + 3 * (c22 - c20)) / 32;
    const gy = (3 * (c20 - c00) + 10 * (c21 - c01) + 3 * (c22 - c02)) / 32;
    return gx * gx + gy * gy;
  };

  for (let y = 0; y < h; y += 1) {
    const ym = y > 0 ? y - 1 : 0;
    const yp = y + 1 < h ? y + 1 : h - 1;
    const r0 = ym * w;
    const r1 = y * w;
    const r2 = yp * w;

    for (let x = 0; x < w; x += 1) {
      const xm = x > 0 ? x - 1 : 0;
      const xp = x + 1 < w ? x + 1 : w - 1;

      const gSq =
        scharr(L, r0, r1, r2, xm, x, xp) +
        1.45 * (scharr(A, r0, r1, r2, xm, x, xp) + scharr(B, r0, r1, r2, xm, x, xp));
      const g = Math.sqrt(gSq);
      rawG[r1 + x] = g;
      if (g > maxG) maxG = g;
    }
  }

  const normG = new Float32Array(len);
  const invMax = 1 / Math.max(maxG, 1e-6);
  for (let i = 0; i < len; i += 1) {
    normG[i] = Math.min(1, rawG[i] * invMax);
  }
  return { rawG, normG, maxG };
}

interface BgCluster {
  l: number;
  a: number;
  b: number;
  stdL: number;
  stdA: number;
  stdB: number;
  count: number;
  coverage: number;
}

/**
 * Solve symmetric positive definite linear system Ax = b via Gaussian elimination with partial pivoting.
 */
function solveLinear6(mat: number[][], rhs: number[]): number[] | null {
  const n = 6;
  const A = mat.map((r, i) => [...r, rhs[i]]);
  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let r = col + 1; r < n; r += 1) {
      if (Math.abs(A[r][col]) > Math.abs(A[pivot][col])) pivot = r;
    }
    if (Math.abs(A[pivot][col]) < 1e-9) return null;
    if (pivot !== col) {
      const tmp = A[col];
      A[col] = A[pivot];
      A[pivot] = tmp;
    }
    const div = A[col][col];
    for (let c = col; c <= n; c += 1) A[col][c] /= div;
    for (let r = 0; r < n; r += 1) {
      if (r === col) continue;
      const factor = A[r][col];
      for (let c = col; c <= n; c += 1) A[r][c] -= factor * A[col][c];
    }
  }
  return A.map((r) => r[n]);
}

function fitQuadraticSurface(
  points: Array<{ u: number; v: number; val: number }>
): number[] | null {
  if (points.length < 8) return null;
  const M: number[][] = Array.from({ length: 6 }, () => new Array(6).fill(0));
  const rhs: number[] = new Array(6).fill(0);

  for (let p = 0; p < points.length; p += 1) {
    const { u, v, val } = points[p];
    const phi = [1, u, v, u * u, u * v, v * v];
    for (let i = 0; i < 6; i += 1) {
      rhs[i] += phi[i] * val;
      for (let j = 0; j < 6; j += 1) {
        M[i][j] += phi[i] * phi[j];
      }
    }
  }
  // Tiny ridge regularization for numeric stability
  for (let i = 1; i < 6; i += 1) M[i][i] += 1e-3;
  return solveLinear6(M, rhs);
}

function evalPoly2(coeff: number[], u: number, v: number): number {
  return (
    coeff[0] +
    coeff[1] * u +
    coeff[2] * v +
    coeff[3] * u * u +
    coeff[4] * u * v +
    coeff[5] * v * v
  );
}

/**
 * Deterministic k-means with farthest-point initialization on clean border pixels (k = 1..4).
 */
function deterministicKMeansElbow(
  samples: Array<[number, number, number]>,
  medL: number,
  medA: number,
  medB: number
): { clusters: BgCluster[]; effRmsStd: number } {
  if (samples.length === 0) {
    return {
      clusters: [{ l: medL, a: medA, b: medB, stdL: 3, stdA: 2.5, stdB: 2.5, count: 1, coverage: 1 }],
      effRmsStd: 3,
    };
  }

  // Sort samples deterministically? Already ordered deterministically by scanline!
  // Seed #0: sample closest to median
  let seed0 = 0;
  let bestD = Infinity;
  for (let i = 0; i < samples.length; i += 1) {
    const dl = samples[i][0] - medL;
    const da = samples[i][1] - medA;
    const db = samples[i][2] - medB;
    const d = dl * dl + da * da + db * db;
    if (d < bestD) {
      bestD = d;
      seed0 = i;
    }
  }

  const runK = (k: number) => {
    const centers: Array<[number, number, number]> = [[...samples[seed0]]];
    const minDistToChosen = new Float64Array(samples.length);
    for (let i = 0; i < samples.length; i += 1) {
      const dl = samples[i][0] - centers[0][0];
      const da = samples[i][1] - centers[0][1];
      const db = samples[i][2] - centers[0][2];
      minDistToChosen[i] = dl * dl + da * da + db * db;
    }

    for (let c = 1; c < k; c += 1) {
      let farIdx = 0;
      let farDist = -1;
      for (let i = 0; i < samples.length; i += 1) {
        if (minDistToChosen[i] > farDist) {
          farDist = minDistToChosen[i];
          farIdx = i;
        }
      }
      centers.push([...samples[farIdx]]);
      for (let i = 0; i < samples.length; i += 1) {
        const dl = samples[i][0] - centers[c][0];
        const da = samples[i][1] - centers[c][1];
        const db = samples[i][2] - centers[c][2];
        const d = dl * dl + da * da + db * db;
        if (d < minDistToChosen[i]) minDistToChosen[i] = d;
      }
    }

    const assign = new Uint8Array(samples.length);
    const counts = new Int32Array(k);
    const sumL = new Float64Array(k);
    const sumA = new Float64Array(k);
    const sumB = new Float64Array(k);
    let sse = 0;

    for (let iter = 0; iter < 8; iter += 1) {
      counts.fill(0);
      sumL.fill(0);
      sumA.fill(0);
      sumB.fill(0);
      sse = 0;

      for (let i = 0; i < samples.length; i += 1) {
        const [sl, sa, sb] = samples[i];
        let bestC = 0;
        let bestDist = Infinity;
        for (let c = 0; c < k; c += 1) {
          const dl = sl - centers[c][0];
          const da = sa - centers[c][1];
          const db = sb - centers[c][2];
          const d = dl * dl + da * da + db * db;
          if (d < bestDist) {
            bestDist = d;
            bestC = c;
          }
        }
        assign[i] = bestC;
        sse += bestDist;
        counts[bestC] += 1;
        sumL[bestC] += sl;
        sumA[bestC] += sa;
        sumB[bestC] += sb;
      }

      for (let c = 0; c < k; c += 1) {
        if (counts[c] > 0) {
          centers[c] = [sumL[c] / counts[c], sumA[c] / counts[c], sumB[c] / counts[c]];
        }
      }
    }

    return { centers, assign, counts, sse };
  };

  const runs = [runK(1)];
  const sse1 = Math.max(runs[0].sse, 1e-6);
  let chosen = runs[0];

  if (sse1 / samples.length > 8) {
    for (let k = 2; k <= 4; k += 1) {
      const nextRun = runK(k);
      runs.push(nextRun);
      const prevRun = runs[k - 2];
      const relGain = (prevRun.sse - nextRun.sse) / sse1;
      chosen = nextRun;
      if (relGain < 0.12) {
        // Elbow reached at k-1 if marginal improvement was tiny
        if (relGain < 0.06) chosen = prevRun;
        break;
      }
    }
  }

  // Build clusters & compute per-channel standard deviations
  const kUsed = chosen.centers.length;
  const varL = new Float64Array(kUsed);
  const varA = new Float64Array(kUsed);
  const varB = new Float64Array(kUsed);

  for (let i = 0; i < samples.length; i += 1) {
    const c = chosen.assign[i];
    const dl = samples[i][0] - chosen.centers[c][0];
    const da = samples[i][1] - chosen.centers[c][1];
    const db = samples[i][2] - chosen.centers[c][2];
    varL[c] += dl * dl;
    varA[c] += da * da;
    varB[c] += db * db;
  }

  const minCount = Math.max(1, samples.length * 0.04);
  const clusters: BgCluster[] = [];
  for (let c = 0; c < kUsed; c += 1) {
    const cnt = chosen.counts[c];
    if (cnt < minCount) continue;
    clusters.push({
      l: chosen.centers[c][0],
      a: chosen.centers[c][1],
      b: chosen.centers[c][2],
      stdL: Math.sqrt(varL[c] / cnt),
      stdA: Math.sqrt(varA[c] / cnt),
      stdB: Math.sqrt(varB[c] / cnt),
      count: cnt,
      coverage: cnt / samples.length,
    });
  }

  if (clusters.length === 0) {
    clusters.push({
      l: runs[0].centers[0][0],
      a: runs[0].centers[0][1],
      b: runs[0].centers[0][2],
      stdL: Math.sqrt(runs[0].sse / samples.length),
      stdA: 2.5,
      stdB: 2.5,
      count: samples.length,
      coverage: 1,
    });
  }

  clusters.sort((x, y) => y.count - x.count);
  const effRmsStd = Math.sqrt(chosen.sse / samples.length);
  return { clusters, effRmsStd };
}

interface HullPolygonPoint {
  x: number;
  y: number;
}

function computeConvexHull(points: HullPolygonPoint[]): HullPolygonPoint[] {
  if (points.length <= 3) return points;
  const sorted = [...points].sort((a, b) => (a.x !== b.x ? a.x - b.x : a.y - b.y));
  const cross = (o: HullPolygonPoint, a: HullPolygonPoint, b: HullPolygonPoint) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

  const lower: HullPolygonPoint[] = [];
  for (let i = 0; i < sorted.length; i += 1) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], sorted[i]) <= 0) {
      lower.pop();
    }
    lower.push(sorted[i]);
  }
  const upper: HullPolygonPoint[] = [];
  for (let i = sorted.length - 1; i >= 0; i -= 1) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], sorted[i]) <= 0) {
      upper.pop();
    }
    upper.push(sorted[i]);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

function rasterizeConvexHullMask(hull: HullPolygonPoint[], w: number, h: number): Uint8Array {
  const mask = new Uint8Array(w * h);
  if (hull.length < 3) return mask;

  let minY = h - 1;
  let maxY = 0;
  for (const p of hull) {
    if (p.y < minY) minY = Math.max(0, Math.floor(p.y));
    if (p.y > maxY) maxY = Math.min(h - 1, Math.ceil(p.y));
  }

  const intersections: number[] = [];
  for (let y = minY; y <= maxY; y += 1) {
    intersections.length = 0;
    const py = y + 0.5;
    for (let i = 0, j = hull.length - 1; i < hull.length; j = i, i += 1) {
      const a = hull[j];
      const b = hull[i];
      if ((a.y <= py && b.y > py) || (b.y <= py && a.y > py)) {
        const ix = a.x + ((py - a.y) / (b.y - a.y)) * (b.x - a.x);
        intersections.push(ix);
      }
    }
    if (intersections.length < 2) continue;
    intersections.sort((a, b) => a - b);
    for (let k = 0; k + 1 < intersections.length; k += 2) {
      const xStart = Math.max(0, Math.ceil(intersections[k]));
      const xEnd = Math.min(w - 1, Math.floor(intersections[k + 1]));
      const row = y * w;
      for (let x = xStart; x <= xEnd; x += 1) {
        mask[row + x] = 1;
      }
    }
  }
  return mask;
}

/**
 * Pure TypeScript classical seeded Watershed + local Lab affinity segmentation fallback
 * used when OpenCV complexSegmenter isn't supplied (e.g. direct unit benchmark without WASM).
 */
function pureTsSeededWatershed(
  smoothL: Float32Array,
  smoothA: Float32Array,
  smoothB: Float32Array,
  normG: Float32Array,
  trimap: Uint8Array,
  w: number,
  h: number
): Uint8ClampedArray {
  const len = w * h;
  const labels = new Uint8Array(len); // 0=unassigned, 1=FG, 2=BG
  const BINS = 256;
  const buckets: number[][] = Array.from({ length: BINS }, () => []);

  // Mean colors of FG/BG seeds for mild color-term in priority queue
  let fgSumL = 0, fgSumA = 0, fgSumB = 0, fgN = 0;
  let bgSumL = 0, bgSumA = 0, bgSumB = 0, bgN = 0;
  for (let i = 0; i < len; i += 1) {
    if (trimap[i] === 1) {
      labels[i] = 1;
      fgSumL += smoothL[i];
      fgSumA += smoothA[i];
      fgSumB += smoothB[i];
      fgN += 1;
    } else if (trimap[i] === 0) {
      labels[i] = 2;
      bgSumL += smoothL[i];
      bgSumA += smoothA[i];
      bgSumB += smoothB[i];
      bgN += 1;
    }
  }
  const fgMean = fgN > 0 ? [fgSumL / fgN, fgSumA / fgN, fgSumB / fgN] : [50, 0, 0];
  const bgMean = bgN > 0 ? [bgSumL / bgN, bgSumA / bgN, bgSumB / bgN] : [50, 0, 0];

  const pushed = new Uint8Array(len);
  const dirs = [-1, 1, -w, w];

  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = y * w + x;
      if (labels[i] === 0) continue;
      for (let d = 0; d < 4; d += 1) {
        if ((d === 0 && x === 0) || (d === 1 && x + 1 >= w) || (d === 2 && y === 0) || (d === 3 && y + 1 >= h)) {
          continue;
        }
        const n = i + dirs[d];
        if (labels[n] === 0 && !pushed[n]) {
          pushed[n] = 1;
          const bin = clamp(Math.round(normG[n] * 255), 0, BINS - 1);
          buckets[bin].push(n);
        }
      }
    }
  }

  let cursor = 0;
  while (cursor < BINS) {
    const q = buckets[cursor];
    if (q.length === 0) {
      cursor += 1;
      continue;
    }
    const idx = q.pop()!;
    if (labels[idx] !== 0) continue;

    const x = idx % w;
    const y = (idx - x) / w;
    // Choose label among labeled 4-neighbors closest in Lab color (and tie-break by probable trimap)
    let bestLbl = 0;
    let bestScore = Infinity;

    for (let d = 0; d < 4; d += 1) {
      if ((d === 0 && x === 0) || (d === 1 && x + 1 >= w) || (d === 2 && y === 0) || (d === 3 && y + 1 >= h)) {
        continue;
      }
      const n = idx + dirs[d];
      const lbl = labels[n];
      if (lbl === 0) continue;
      const dl = smoothL[idx] - smoothL[n];
      const da = smoothA[idx] - smoothA[n];
      const db = smoothB[idx] - smoothB[n];
      const localColorDist = 0.35 * dl * dl + da * da + db * db;
      const refMean = lbl === 1 ? fgMean : bgMean;
      const gdl = smoothL[idx] - refMean[0];
      const gda = smoothA[idx] - refMean[1];
      const gdb = smoothB[idx] - refMean[2];
      const globalBias = (0.3 * gdl * gdl + gda * gda + gdb * gdb) * 0.2;
      const score = localColorDist + globalBias;
      if (score < bestScore) {
        bestScore = score;
        bestLbl = lbl;
      }
    }

    if (bestLbl === 0) {
      bestLbl = trimap[idx] === 3 || trimap[idx] === 1 ? 1 : 2;
    }
    labels[idx] = bestLbl;

    for (let d = 0; d < 4; d += 1) {
      if ((d === 0 && x === 0) || (d === 1 && x + 1 >= w) || (d === 2 && y === 0) || (d === 3 && y + 1 >= h)) {
        continue;
      }
      const n = idx + dirs[d];
      if (labels[n] === 0 && !pushed[n]) {
        pushed[n] = 1;
        const bin = clamp(Math.round(normG[n] * 255), 0, BINS - 1);
        buckets[bin].push(n);
        if (bin < cursor) cursor = bin;
      }
    }
  }

  const out = new Uint8ClampedArray(len);
  for (let i = 0; i < len; i += 1) {
    out[i] = labels[i] === 1 || (labels[i] === 0 && trimap[i] === 3) ? 255 : 0;
  }
  return out;
}

/**
 * Step 5 cleanup:
 * - Keep largest component + (>=15% of largest or overlapping central 40%) unless keepLargestObject=true
 * - Fill enclosed holes (unless preserveHoles=true)
 * - Morphological close 3px (r=1) then conditional open 2px (skip on thin structures confirmed by guided filter)
 */
function cleanupMaskStep5(
  binaryMask: Uint8ClampedArray,
  rgba: Uint8ClampedArray,
  w: number,
  h: number,
  settings: AutoRemoveSettings
): Uint8ClampedArray {
  const total = w * h;
  let mask: Uint8ClampedArray = new Uint8ClampedArray(binaryMask);

  // 1. Connected component filtering
  const visited = new Uint8Array(total);
  const queue = new Int32Array(total);
  const components: Array<{ pixels: Int32Array; touchesCenter: boolean }> = [];
  let maxLen = 0;
  let maxIdx = -1;

  const cMinX = Math.floor(w * 0.3);
  const cMaxX = Math.ceil(w * 0.7);
  const cMinY = Math.floor(h * 0.3);
  const cMaxY = Math.ceil(h * 0.7);
  const minCenterCompArea = Math.max(48, Math.floor(total * 0.002));

  for (let i = 0; i < total; i += 1) {
    if (mask[i] >= 128 && !visited[i]) {
      let head = 0;
      let tail = 0;
      let touchesCenter = false;
      visited[i] = 1;
      queue[tail++] = i;

      while (head < tail) {
        const idx = queue[head++];
        const x = idx % w;
        const y = (idx - x) / w;
        if (!touchesCenter && x >= cMinX && x <= cMaxX && y >= cMinY && y <= cMaxY) {
          touchesCenter = true;
        }
        if (x > 0 && !visited[idx - 1] && mask[idx - 1] >= 128) {
          visited[idx - 1] = 1;
          queue[tail++] = idx - 1;
        }
        if (x + 1 < w && !visited[idx + 1] && mask[idx + 1] >= 128) {
          visited[idx + 1] = 1;
          queue[tail++] = idx + 1;
        }
        if (y > 0 && !visited[idx - w] && mask[idx - w] >= 128) {
          visited[idx - w] = 1;
          queue[tail++] = idx - w;
        }
        if (y + 1 < h && !visited[idx + w] && mask[idx + w] >= 128) {
          visited[idx + w] = 1;
          queue[tail++] = idx + w;
        }
      }

      if (tail > maxLen) {
        maxLen = tail;
        maxIdx = components.length;
      }
      components.push({ pixels: queue.slice(0, tail), touchesCenter });
    }
  }

  if (components.length > 1 && maxIdx >= 0) {
    const keepThreshold = Math.max(64, Math.floor(maxLen * 0.15));
    for (let c = 0; c < components.length; c += 1) {
      if (c === maxIdx) continue;
      const comp = components[c];
      const keepSecondary =
        !settings.keepLargestObject &&
        (comp.pixels.length >= keepThreshold ||
          (comp.touchesCenter && comp.pixels.length >= minCenterCompArea));
      if (!keepSecondary) {
        for (let k = 0; k < comp.pixels.length; k += 1) {
          mask[comp.pixels[k]] = 0;
        }
      }
    }
  }

  // 2. Fill enclosed holes unless Preserve Holes is explicitly on
  if (settings.fillHoles && !settings.preserveHoles) {
    mask = fillHoles(mask, w, h, 0.45);
  }

  // 3. Morphological close (3px diameter -> r=1)
  const closed = applyMorphology(applyMorphology(mask, w, h, 1), w, h, -1);

  // Thin-structure-aware open (r=1): only remove pixels that open eliminates IF guided-filter response is weak (< 0.42)
  const opened = applyMorphology(applyMorphology(closed, w, h, -1), w, h, 1);
  let openChangedCount = 0;
  for (let i = 0; i < total; i += 1) {
    if (closed[i] !== opened[i]) openChangedCount += 1;
  }

  if (openChangedCount > 0) {
    const pNorm = new Float32Array(total);
    for (let i = 0; i < total; i += 1) pNorm[i] = closed[i] / 255;
    const guideCheck = guidedFilterMask(rgba, pNorm, w, h, 3, 2e-3);
    for (let i = 0; i < total; i += 1) {
      // Preserve thin structure pixels where guided filter aligns with RGB structure
      if (closed[i] >= 128 && opened[i] < 128 && guideCheck[i] >= 0.34) {
        opened[i] = closed[i];
      }
    }
  }

  return opened;
}

/**
 * Step 6: Boundary band guided filtering + smoothstep contrast + optional soft shadow preservation.
 */
function refineEdgesStep6(
  cleanMask: Uint8ClampedArray,
  rgba: Uint8ClampedArray,
  smoothL: Float32Array,
  smoothA: Float32Array,
  smoothB: Float32Array,
  distMap: Float32Array,
  expectedL: Float32Array,
  expectedA: Float32Array,
  expectedB: Float32Array,
  existingAlpha: Uint8ClampedArray,
  w: number,
  h: number,
  settings: AutoRemoveSettings
): Uint8ClampedArray {
  const len = w * h;
  const eroded = applyMorphology(cleanMask, w, h, -3);
  const dilated = applyMorphology(cleanMask, w, h, 3);

  const pNorm = new Float32Array(len);
  for (let i = 0; i < len; i += 1) pNorm[i] = cleanMask[i] / 255;

  const softRatio = clamp(settings.edgeSoftness, 0, 100) / 100;
  const radius = Math.max(4, Math.round(5 + softRatio * 6)); // default 40 -> ~7-8 px
  const q = guidedFilterMask(rgba, pNorm, w, h, radius, 1e-3);

  // Smoothstep window around 0.5: higher softness = slightly wider feather (~0.7-1.4px transition)
  const halfWidth = 0.08 + softRatio * 0.28; // at 40 -> 0.192 -> sharp yet antialiased
  const loEdge = Math.max(0.01, 0.5 - halfWidth);
  const hiEdge = Math.min(0.99, 0.5 + halfWidth);
  const span = Math.max(0.02, hiEdge - loEdge);

  const out = new Uint8ClampedArray(len);
  for (let i = 0; i < len; i += 1) {
    if (existingAlpha[i] <= 16) {
      out[i] = 0;
      continue;
    }
    if (eroded[i] >= 250) {
      out[i] = 255;
      continue;
    }
    if (dilated[i] <= 5) {
      out[i] = 0;
      continue;
    }
    const v = q[i];
    if (v <= loEdge) {
      out[i] = 0;
    } else if (v >= hiEdge) {
      out[i] = 255;
    } else {
      const t = (v - loEdge) / span;
      out[i] = Math.round(t * t * (3 - 2 * t) * 255);
    }
  }

  // Optional soft shadow preservation adjacent to subject
  if (settings.keepSoftShadow) {
    const shadowRadius = Math.min(10, Math.round(Math.min(w, h) * 0.015));
    const shadowBand = applyMorphology(cleanMask, w, h, shadowRadius);
    for (let i = 0; i < len; i += 1) {
      if (out[i] === 0 && shadowBand[i] >= 128 && existingAlpha[i] > 16) {
        const dL = smoothL[i] - expectedL[i];
        const da = smoothA[i] - expectedA[i];
        const db = smoothB[i] - expectedB[i];
        const chromaDiff = Math.hypot(da, db);
        // Darkened region (-dL >= 4.5) with matching background hue/chroma -> soft shadow
        if (dL < -4.5 && chromaDiff < 9.5 && distMap[i] > 0.35) {
          const shadowAlpha = clamp((-dL - 4.5) / 30, 0.08, 0.55);
          out[i] = Math.round(shadowAlpha * 255);
        }
      }
    }
  }

  return out;
}

/**
 * Step 7: Score candidate across 6 classical quality metrics.
 */
function scoreCandidate(
  mask: Uint8ClampedArray,
  smoothL: Float32Array,
  smoothA: Float32Array,
  smoothB: Float32Array,
  normG: Float32Array,
  w: number,
  h: number,
  subjectTouchesEdge: boolean,
  fillHolesEnabled: boolean
): CandidateScoreBreakdown {
  const total = w * h;
  let fgCount = 0;
  let fgL = 0, fgA = 0, fgB = 0;
  let bgL = 0, bgA = 0, bgB = 0, bgCount = 0;

  let boundaryCount = 0;
  let boundaryGradSum = 0;
  let boundaryNonSmooth = 0;
  let borderFgCount = 0;
  let borderTotal = 0;

  for (let y = 0; y < h; y += 1) {
    const row = y * w;
    const onBorderY = y < 2 || y >= h - 2;
    for (let x = 0; x < w; x += 1) {
      const i = row + x;
      const isFg = mask[i] >= 128;
      if (isFg) {
        fgCount += 1;
        fgL += smoothL[i];
        fgA += smoothA[i];
        fgB += smoothB[i];
      } else {
        bgCount += 1;
        bgL += smoothL[i];
        bgA += smoothA[i];
        bgB += smoothB[i];
      }

      if (onBorderY || x < 2 || x >= w - 2) {
        borderTotal += 1;
        if (isFg) borderFgCount += 1;
      }

      if (x > 0 && x + 1 < w && y > 0 && y + 1 < h) {
        const nL = mask[i - 1] >= 128 ? 1 : 0;
        const nR = mask[i + 1] >= 128 ? 1 : 0;
        const nU = mask[i - w] >= 128 ? 1 : 0;
        const nD = mask[i + w] >= 128 ? 1 : 0;
        const sumN = nL + nR + nU + nD;
        if (isFg && sumN < 4) {
          boundaryCount += 1;
          boundaryGradSum += normG[i];
          if (sumN <= 1) boundaryNonSmooth += 1; // protruding spur / jagged tooth
        }
      }
    }
  }

  const fgFraction = fgCount / Math.max(1, total);

  // 1. Area plausibility (0..25)
  let areaPlausibility = 25;
  if (fgFraction < 0.03 || fgFraction > 0.97) {
    areaPlausibility = 0;
  } else if (fgFraction < 0.08) {
    areaPlausibility = 10 + ((fgFraction - 0.03) / 0.05) * 15;
  } else if (fgFraction > 0.85) {
    areaPlausibility = 8 + ((0.97 - fgFraction) / 0.12) * 17;
  }

  // 2. Boundary alignment with image gradient G (0..25)
  const meanBoundaryG = boundaryCount > 0 ? boundaryGradSum / boundaryCount : 0;
  const boundaryAlignment = clamp(meanBoundaryG * 135, 0, 25);

  // 3. Border contact score (0..15)
  const borderFgFrac = borderTotal > 0 ? borderFgCount / borderTotal : 0;
  let borderContactScore = 15;
  if (!subjectTouchesEdge) {
    borderContactScore = clamp(15 * (1 - borderFgFrac * 2.5), 0, 15);
  } else {
    // When subject touches edge, moderate border contact (<=45%) is expected; >75% suggests under-removal
    borderContactScore = borderFgFrac <= 0.48 ? 15 : clamp(15 * (1 - (borderFgFrac - 0.48) * 2), 2, 15);
  }

  // 4. Topology: residual fragments & holes (0..12)
  // Sample quickly using 4-connected count of isolated speckles/holes
  let isolatedCount = 0;
  for (let y = 1; y < h - 1; y += 2) {
    const r = y * w;
    for (let x = 1; x < w - 1; x += 2) {
      const i = r + x;
      const m = mask[i] >= 128;
      const sameN =
        (mask[i - 1] >= 128) === m &&
        (mask[i + 1] >= 128) === m &&
        (mask[i - w] >= 128) === m &&
        (mask[i + w] >= 128) === m;
      if (!sameN) {
        const diffCount =
          ((mask[i - 1] >= 128) !== m ? 1 : 0) +
          ((mask[i + 1] >= 128) !== m ? 1 : 0) +
          ((mask[i - w] >= 128) !== m ? 1 : 0) +
          ((mask[i + w] >= 128) !== m ? 1 : 0);
        if (diffCount >= 3) isolatedCount += 1;
      }
    }
  }
  const noiseDensity = isolatedCount / Math.max(1, total * 0.25);
  const topologyScore = clamp(12 - noiseDensity * (fillHolesEnabled ? 350 : 250), 0, 12);

  // 5. Boundary smoothness (0..10)
  const jaggedFrac = boundaryCount > 0 ? boundaryNonSmooth / boundaryCount : 0;
  const smoothnessScore = clamp(10 * (1 - jaggedFrac * 2.8), 0, 10);

  // 6. Color separation between foreground & background region means (0..13)
  let colorSeparation = 0;
  if (fgCount > 0 && bgCount > 0) {
    const mFgL = fgL / fgCount;
    const mFgA = fgA / fgCount;
    const mFgB = fgB / fgCount;
    const mBgL = bgL / bgCount;
    const mBgA = bgA / bgCount;
    const mBgB = bgB / bgCount;
    const sep = Math.hypot((mFgL - mBgL) * 0.65, mFgA - mBgA, mFgB - mBgB);
    colorSeparation = clamp((sep / 38) * 13, 0, 13);
  }

  const totalScore =
    areaPlausibility +
    boundaryAlignment +
    borderContactScore +
    topologyScore +
    smoothnessScore +
    colorSeparation;

  return {
    boundaryAlignment,
    areaPlausibility,
    borderContactScore,
    topologyScore,
    smoothnessScore,
    colorSeparation,
    total: Math.round(totalScore * 10) / 10,
    fgFraction,
  };
}

/**
 * Classical 7-step Automatic Background Removal Engine (zero AI/ML).
 */
export async function runAutoRemovePipeline(
  rgbaInput: Uint8ClampedArray,
  origW: number,
  origH: number,
  settings: AutoRemoveSettings,
  options: AutoEngineOptions = {}
): Promise<AutoRemoveEngineResult> {
  const report = (pct: number, detail: string) => {
    options.onProgress?.(pct, detail);
  };
  const tick = () => new Promise<void>((r) => setTimeout(r, 0));

  report(8, 'Preparing working resolution and CIELAB channels...');
  await tick();

  // Person-first path: small MediaPipe model. Non-person images fall through to the
  // classical engine below.
  if (settings.mode !== 'plain') {
    report(12, 'Detecting subject...');
    await tick();
    const pm = await personMask(rgbaInput, origW, origH);
    if (pm) {
      let fg = 0;
      for (let i = 0; i < pm.length; i += 1) if (pm[i] >= 128) fg += 1;
      const frac = fg / pm.length;
      const zero = {
        boundaryAlignment: 0,
        areaPlausibility: 0,
        borderContactScore: 0,
        topologyScore: 0,
        smoothnessScore: 0,
        colorSeparation: 0,
        total: 90,
        fgFraction: frac,
      };
      report(100, 'Done');
      return {
        mask: pm,
        candidates: [
          {
            id: 'person-model',
            label: 'Subject detection',
            mask: pm,
            score: 90,
            breakdown: zero,
            usedGrabCut: false,
          },
        ],
        bestIndex: 0,
        score: 90,
        confidence: 'normal',
        modeUsed: 'complex',
        spillMode: null,
        subjectTouchesEdgeDetected: true,
        usedCenterFallback: false,
      };
    }
  }

  // Working resolution: long side capped at 512px, minimum 256px
  const origLong = Math.max(origW, origH);
  let pW = origW;
  let pH = origH;
  if (origLong > PROC_MAX_LONG_SIDE) {
    const s = PROC_MAX_LONG_SIDE / origLong;
    pW = Math.max(1, Math.round(origW * s));
    pH = Math.max(1, Math.round(origH * s));
  } else if (origLong < PROC_MIN_LONG_SIDE && origLong > 0) {
    const s = PROC_MIN_LONG_SIDE / origLong;
    pW = Math.max(1, Math.round(origW * s));
    pH = Math.max(1, Math.round(origH * s));
  }

  const procRgba = resizeRgbaBilinear(rgbaInput, origW, origH, pW, pH);
  const len = pW * pH;

  // Step 0: Extract alpha & CIELAB + bilateral denoise + Scharr gradient G
  const existingAlpha = new Uint8ClampedArray(len);
  const rawL = new Float32Array(len);
  const rawA = new Float32Array(len);
  const rawB = new Float32Array(len);
  let preTransparentCount = 0;

  for (let i = 0, p = 0; i < len; i += 1, p += 4) {
    const a = procRgba[p + 3];
    existingAlpha[i] = a;
    if (a <= 16) preTransparentCount += 1;
    const [l, ca, cb] = rgbToLab(procRgba[p], procRgba[p + 1], procRgba[p + 2]);
    rawL[i] = l;
    rawA[i] = ca;
    rawB[i] = cb;
  }

  if (preTransparentCount >= len * 0.995) {
    const empty = new Uint8ClampedArray(origW * origH);
    return {
      mask: empty,
      candidates: [
        {
          id: 'transparent',
          label: 'Transparent input',
          mask: empty,
          score: 0,
          usedGrabCut: false,
          breakdown: {
            boundaryAlignment: 0,
            areaPlausibility: 0,
            borderContactScore: 0,
            topologyScore: 0,
            smoothnessScore: 0,
            colorSeparation: 0,
            total: 0,
            fgFraction: 0,
          },
        },
      ],
      bestIndex: 0,
      score: 0,
      confidence: 'low',
      modeUsed: 'plain',
      spillMode: null,
      subjectTouchesEdgeDetected: false,
      usedCenterFallback: false,
    };
  }

  const { L: smoothL, A: smoothA, B: smoothB } = bilateralDenoiseLab(rawL, rawA, rawB, pW, pH);
  const { rawG, normG, maxG } = computeScharrGradient(smoothL, smoothA, smoothB, pW, pH);
  const g85 = quantileFloat32(normG, 0.85);
  const edgeFloorNorm = 2.0 / Math.max(maxG, 1e-6);
  const edgeBarrier = Math.max(g85, edgeFloorNorm);

  report(22, 'Analyzing border segments and clustering background palette...');
  await tick();

  // Step 1: Border band & outlier rejection
  const borderBand = Math.max(4, Math.round(0.03 * Math.min(pW, pH)));
  const segTargetTop = Math.max(4, Math.round(pW * 0.05));
  const segTargetSide = Math.max(4, Math.round(pH * 0.05));

  interface SegmentInternal extends BorderSegmentDebug {
    indices: number[];
    meanG: number;
    distToMed: number;
  }

  const segments: SegmentInternal[] = [];
  const collectSideSegments = (
    side: 'top' | 'bottom' | 'left' | 'right',
    xStart: number,
    xEnd: number,
    yStart: number,
    yEnd: number,
    alongX: boolean,
    stepSize: number
  ) => {
    const spanLen = alongX ? xEnd - xStart : yEnd - yStart;
    if (spanLen <= 0) return;
    const numSegs = Math.max(1, Math.round(spanLen / stepSize));
    for (let s = 0; s < numSegs; s += 1) {
      const a0 = alongX
        ? xStart + Math.floor((s * spanLen) / numSegs)
        : yStart + Math.floor((s * spanLen) / numSegs);
      const a1 = alongX
        ? xStart + Math.floor(((s + 1) * spanLen) / numSegs)
        : yStart + Math.floor(((s + 1) * spanLen) / numSegs);

      const sx0 = alongX ? a0 : xStart;
      const sx1 = alongX ? a1 : xEnd;
      const sy0 = alongX ? yStart : a0;
      const sy1 = alongX ? yEnd : a1;

      let sumL = 0, sumA = 0, sumB = 0, sumGrad = 0, cnt = 0;
      const indices: number[] = [];
      for (let y = sy0; y < sy1; y += 1) {
        const row = y * pW;
        for (let x = sx0; x < sx1; x += 1) {
          const idx = row + x;
          if (existingAlpha[idx] <= 20) continue;
          indices.push(idx);
          sumL += smoothL[idx];
          sumA += smoothA[idx];
          sumB += smoothB[idx];
          sumGrad += rawG[idx];
          cnt += 1;
        }
      }
      if (cnt > 0) {
        segments.push({
          x0: sx0,
          y0: sy0,
          x1: sx1,
          y1: sy1,
          side,
          meanL: sumL / cnt,
          meanA: sumA / cnt,
          meanB: sumB / cnt,
          meanG: sumGrad / cnt,
          distToMed: 0,
          isOutlier: false,
          indices,
        });
      }
    }
  };

  collectSideSegments('top', 0, pW, 0, borderBand, true, segTargetTop);
  collectSideSegments('bottom', 0, pW, pH - borderBand, pH, true, segTargetTop);
  collectSideSegments('left', 0, borderBand, borderBand, pH - borderBand, false, segTargetSide);
  collectSideSegments('right', pW - borderBand, pW, borderBand, pH - borderBand, false, segTargetSide);

  const medL = medianSorted(segments.map((s) => s.meanL));
  const medA = medianSorted(segments.map((s) => s.meanA));
  const medB = medianSorted(segments.map((s) => s.meanB));
  const medSegGrad = medianSorted(segments.map((s) => s.meanG));

  for (const s of segments) {
    s.distToMed = Math.hypot((s.meanL - medL) * 0.75, s.meanA - medA, s.meanB - medB);
  }
  const medSegSpread = Math.max(3.0, medianSorted(segments.map((s) => s.distToMed)));
  const distLimit = Math.max(7.5, 2.5 * medSegSpread);
  const gradLimit = Math.max(4.5, 2.8 * Math.max(medSegGrad, 1.4));

  let outlierCount = 0;
  for (const s of segments) {
    if (s.distToMed > distLimit || s.meanG > gradLimit) {
      s.isOutlier = true;
      outlierCount += 1;
    }
  }

  // Two-color / split backdrop recovery:
  // If low-gradient outliers form a coherent color region spanning >= 20% of border
  // segments across >= 2 border sides (e.g. studio wall + table split), keep them as background.
  const lowGradOutliers = segments.filter((s) => s.isOutlier && s.meanG <= gradLimit);
  if (lowGradOutliers.length >= Math.max(6, Math.ceil(segments.length * 0.2))) {
    const visitedOut = new Uint8Array(lowGradOutliers.length);
    for (let i = 0; i < lowGradOutliers.length; i += 1) {
      if (visitedOut[i]) continue;
      const seed = lowGradOutliers[i];
      const group: SegmentInternal[] = [seed];
      visitedOut[i] = 1;
      for (let j = i + 1; j < lowGradOutliers.length; j += 1) {
        if (visitedOut[j]) continue;
        const cand = lowGradOutliers[j];
        const d = Math.hypot(
          (cand.meanL - seed.meanL) * 0.75,
          cand.meanA - seed.meanA,
          cand.meanB - seed.meanB
        );
        if (d <= 12) {
          visitedOut[j] = 1;
          group.push(cand);
        }
      }
      const sides = new Set(group.map((g) => g.side));
      if (group.length >= Math.max(6, Math.ceil(segments.length * 0.2)) && sides.size >= 2) {
        for (const g of group) {
          g.isOutlier = false;
        }
      }
    }
    outlierCount = segments.filter((s) => s.isOutlier).length;
  }

  // Ensure at least 25% of segments remain clean
  let cleanSegments = segments.filter((s) => !s.isOutlier);
  if (cleanSegments.length < Math.max(1, Math.ceil(segments.length * 0.25))) {
    const byDist = [...segments].sort((a, b) => a.distToMed - b.distToMed);
    const keepN = Math.max(1, Math.ceil(segments.length * 0.35));
    for (let i = 0; i < byDist.length; i += 1) {
      byDist[i].isOutlier = i >= keepN;
    }
    cleanSegments = segments.filter((s) => !s.isOutlier);
    outlierCount = segments.length - cleanSegments.length;
  }

  const autoTouchedEdge = outlierCount >= Math.max(2, Math.round(segments.length * 0.05));
  const subjectTouchesEdge =
    settings.subjectTouchesEdge === 'yes'
      ? true
      : settings.subjectTouchesEdge === 'no'
        ? false
        : autoTouchedEdge;

  // Subsample clean border pixels for deterministic k-means (up to ~3600 samples)
  const allCleanBorderIndices: number[] = [];
  for (const s of cleanSegments) {
    for (let k = 0; k < s.indices.length; k += 1) {
      allCleanBorderIndices.push(s.indices[k]);
    }
  }
  const sampleStep = Math.max(1, Math.floor(allCleanBorderIndices.length / 3600));
  const borderSamples: Array<[number, number, number]> = [];
  for (let i = 0; i < allCleanBorderIndices.length; i += sampleStep) {
    const idx = allCleanBorderIndices[i];
    borderSamples.push([smoothL[idx], smoothA[idx], smoothB[idx]]);
  }

  let { clusters, effRmsStd } = deterministicKMeansElbow(borderSamples, medL, medA, medB);

  // Incorporate user-picked manual background colors (if provided)
  if (settings.pickedBgColors && settings.pickedBgColors.length > 0) {
    const manualClusters: BgCluster[] = settings.pickedBgColors.map((rgb) => {
      const [pl, pa, pb] = rgbToLab(rgb[0], rgb[1], rgb[2]);
      return {
        l: pl,
        a: pa,
        b: pb,
        stdL: 4.5,
        stdA: 3.5,
        stdB: 3.5,
        count: 1000,
        coverage: 1 / settings.pickedBgColors.length,
      };
    });
    // Include dominant clean border cluster if close or keep manual colors primary
    clusters = manualClusters;
    effRmsStd = 5.5;
  }

  // Check if sides differ in mean color (gradient/vignette check)
  const sideMeans = (['top', 'bottom', 'left', 'right'] as const)
    .map((side) => {
      const list = cleanSegments.filter((s) => s.side === side);
      if (list.length === 0) return null;
      const n = list.length;
      return [
        list.reduce((acc, s) => acc + s.meanL, 0) / n,
        list.reduce((acc, s) => acc + s.meanA, 0) / n,
        list.reduce((acc, s) => acc + s.meanB, 0) / n,
      ];
    })
    .filter((x): x is number[] => x !== null);

  let maxSideDiff = 0;
  for (let i = 0; i < sideMeans.length; i += 1) {
    for (let j = i + 1; j < sideMeans.length; j += 1) {
      const d = Math.hypot(
        sideMeans[i][0] - sideMeans[j][0],
        sideMeans[i][1] - sideMeans[j][1],
        sideMeans[i][2] - sideMeans[j][2]
      );
      if (d > maxSideDiff) maxSideDiff = d;
    }
  }

  // Fit 2nd-order surface per Lab channel when top cluster stdL > 6 or border sides differ
  let useSurfaceModel = false;
  let coeffL: number[] | null = null;
  let coeffA: number[] | null = null;
  let coeffB: number[] | null = null;
  let surfRmsErr = effRmsStd;

  if (
    (clusters[0].stdL > 2.6 || effRmsStd > 3.2 || maxSideDiff > 4.5 || clusters.length >= 2) &&
    (!settings.pickedBgColors || settings.pickedBgColors.length === 0)
  ) {
    const ptsL = cleanSegments.map((s) => ({
      u: ((s.x0 + s.x1) / 2 / pW) * 2 - 1,
      v: ((s.y0 + s.y1) / 2 / pH) * 2 - 1,
      val: s.meanL,
    }));
    const ptsA = cleanSegments.map((s, idx) => ({ ...ptsL[idx], val: s.meanA }));
    const ptsB = cleanSegments.map((s, idx) => ({ ...ptsL[idx], val: s.meanB }));

    const cL = fitQuadraticSurface(ptsL);
    const cA = fitQuadraticSurface(ptsA);
    const cB = fitQuadraticSurface(ptsB);

    if (cL && cA && cB) {
      let surfSq = 0;
      let clusterSq = 0;
      for (let i = 0; i < cleanSegments.length; i += 1) {
        const s = cleanSegments[i];
        const u = ptsL[i].u;
        const v = ptsL[i].v;
        const eL = s.meanL - evalPoly2(cL, u, v);
        const eA = s.meanA - evalPoly2(cA, u, v);
        const eB = s.meanB - evalPoly2(cB, u, v);
        surfSq += eL * eL + eA * eA + eB * eB;

        let bestC = Infinity;
        for (const cl of clusters) {
          const cd = (s.meanL - cl.l) ** 2 + (s.meanA - cl.a) ** 2 + (s.meanB - cl.b) ** 2;
          if (cd < bestC) bestC = cd;
        }
        clusterSq += bestC;
      }
      const meanSurfErr = Math.sqrt(surfSq / cleanSegments.length);
      const meanClusterErr = Math.sqrt(clusterSq / cleanSegments.length);
      if (meanSurfErr < Math.max(8.5, meanClusterErr * 0.82) && meanSurfErr < 13) {
        useSurfaceModel = true;
        coeffL = cL;
        coeffA = cA;
        coeffB = cB;
        surfRmsErr = meanSurfErr;
      }
    }
  }

  // Detect greenscreen / bluescreen chroma key mode
  let spillMode: 'green' | 'blue' | null = null;
  const topC = clusters[0];
  const topChroma = Math.hypot(topC.a, topC.b);
  if (topC.coverage >= 0.45 && topChroma > 30) {
    if (topC.a < -18 && Math.abs(topC.a) >= Math.abs(topC.b) * 0.7) {
      spillMode = 'green';
    } else if (topC.b < -24 && topC.a > -18 && topC.a < 28) {
      spillMode = 'blue';
    }
  }

  // Decide Plain vs Complex mode
  const top2Coverage =
    (clusters[0]?.coverage ?? 0) + (clusters.length > 1 ? clusters[1].coverage : 0);
  const twoDistinctClusters =
    clusters.length >= 2 &&
    clusters[1].coverage >= 0.16 &&
    Math.hypot(clusters[0].l - clusters[1].l, clusters[0].a - clusters[1].a, clusters[0].b - clusters[1].b) >
      15;

  const autoComplex =
    twoDistinctClusters ||
    top2Coverage < 0.85 ||
    (!useSurfaceModel && effRmsStd >= 13.5) ||
    (useSurfaceModel && surfRmsErr >= 10.5) ||
    outlierCount / Math.max(1, segments.length) > 0.4;

  const modeUsed: 'plain' | 'complex' =
    settings.mode === 'plain' ? 'plain' : settings.mode === 'complex' ? 'complex' : autoComplex ? 'complex' : 'plain';

  report(36, `Building lighting-tolerant distance map (${modeUsed} mode)...`);
  await tick();

  // Step 2: Distance map D(x) & expected background Lab map (for soft shadow check)
  const distMap = new Float32Array(len);
  const expectedL = new Float32Array(len);
  const expectedA = new Float32Array(len);
  const expectedB = new Float32Array(len);

  const surfSpread = clamp(surfRmsErr, 2.0, 14.0);
  const clusterSpreads = clusters.map((c) =>
    clamp(Math.sqrt((0.5 * c.stdL) ** 2 + c.stdA ** 2 + c.stdB ** 2), 1.6, 15.0)
  );
  const topHue = Math.atan2(topC.b, topC.a);

  let maxDist = 0;
  for (let y = 0; y < pH; y += 1) {
    const vCoord = (y / Math.max(1, pH - 1)) * 2 - 1;
    const row = y * pW;
    for (let x = 0; x < pW; x += 1) {
      const i = row + x;
      if (existingAlpha[i] <= 16) {
        distMap[i] = 0;
        continue;
      }
      const l = smoothL[i];
      const a = smoothA[i];
      const b = smoothB[i];

      let bestD = Infinity;
      let eL = topC.l;
      let eA = topC.a;
      let eB = topC.b;

      if (useSurfaceModel && coeffL && coeffA && coeffB) {
        const uCoord = (x / Math.max(1, pW - 1)) * 2 - 1;
        eL = evalPoly2(coeffL, uCoord, vCoord);
        eA = evalPoly2(coeffA, uCoord, vCoord);
        eB = evalPoly2(coeffB, uCoord, vCoord);
        const rawDist = Math.sqrt((0.5 * (l - eL)) ** 2 + (a - eA) ** 2 + (b - eB) ** 2);
        bestD = rawDist / surfSpread;
      } else {
        for (let c = 0; c < clusters.length; c += 1) {
          const cl = clusters[c];
          const dl = l - cl.l;
          const da = a - cl.a;
          const db = b - cl.b;
          let rawDist = Math.sqrt(0.25 * dl * dl + da * da + db * db);

          // Greenscreen / bluescreen hue distance assist
          if (spillMode && c === 0) {
            const pChroma = Math.hypot(a, b);
            if (pChroma > 16) {
              const pHue = Math.atan2(b, a);
              const hueDelta = Math.abs(Math.atan2(Math.sin(pHue - topHue), Math.cos(pHue - topHue)));
              if (hueDelta < 0.48) {
                rawDist *= 0.65;
              } else {
                rawDist += hueDelta * 18;
              }
            }
          }

          const d = rawDist / clusterSpreads[c];
          if (d < bestD) {
            bestD = d;
            eL = cl.l;
            eA = cl.a;
            eB = cl.b;
          }
        }
      }

      distMap[i] = bestD;
      expectedL[i] = eL;
      expectedA[i] = eA;
      expectedB[i] = eB;
      if (bestD > maxDist) maxDist = bestD;
    }
  }

  // Helper to mark border pixels inside outlier segments so they never seed bg flood
  const outlierMask = new Uint8Array(len);
  for (const s of segments) {
    if (s.isOutlier) {
      for (let k = 0; k < s.indices.length; k += 1) outlierMask[s.indices[k]] = 1;
    }
  }

  // Build candidate generator for a given tolerance multiplier & grabcut usage
  const tolUserScale = 0.45 + (clamp(settings.tolerance, 0, 100) / 100) * 1.1; // default 50 -> 1.0
  const halfW = pW / 2;
  const halfH = pH / 2;

  const buildSeedsAndTrimap = (scaleMult: number) => {
    const effScale = tolUserScale * scaleMult;
    const tLow = 1.25 * effScale;
    const tHigh = 2.45 * effScale;
    const tFg = Math.min(3.15 * effScale, Math.max(1.35, maxDist * 0.6));
    const tMid = 0.45 * (tLow + tFg);

    // Hysteresis border flood fill (8-connected)
    const sureBg = new Uint8Array(len);
    const queue = new Int32Array(len);
    let head = 0;
    let tail = 0;

    // Seed from existing alpha & clean frame border pixels with D <= tLow (or fallback tHigh)
    const trySeed = (idx: number, threshold: number) => {
      if (sureBg[idx]) return;
      if (existingAlpha[idx] <= 16 || (!outlierMask[idx] && distMap[idx] <= threshold)) {
        sureBg[idx] = 1;
        queue[tail++] = idx;
      }
    };

    for (let x = 0; x < pW; x += 1) {
      trySeed(x, tLow);
      trySeed((pH - 1) * pW + x, tLow);
    }
    for (let y = 1; y < pH - 1; y += 1) {
      trySeed(y * pW, tLow);
      trySeed(y * pW + pW - 1, tLow);
    }

    if (tail === 0) {
      for (let x = 0; x < pW; x += 1) {
        trySeed(x, tHigh);
        trySeed((pH - 1) * pW + x, tHigh);
      }
      for (let y = 1; y < pH - 1; y += 1) {
        trySeed(y * pW, tHigh);
        trySeed(y * pW + pW - 1, tHigh);
      }
    }

    const dx8 = [-1, 1, 0, 0, -1, 1, -1, 1];
    const dy8 = [0, 0, -1, 1, -1, -1, 1, 1];

    while (head < tail) {
      const idx = queue[head++];
      const x = idx % pW;
      const y = (idx - x) / pW;

      for (let k = 0; k < 8; k += 1) {
        const nx = x + dx8[k];
        const ny = y + dy8[k];
        if (nx < 0 || nx >= pW || ny < 0 || ny >= pH) continue;
        const nIdx = ny * pW + nx;
        if (sureBg[nIdx]) continue;
        if (existingAlpha[nIdx] <= 16) {
          sureBg[nIdx] = 1;
          queue[tail++] = nIdx;
          continue;
        }
        const d = distMap[nIdx];
        if (d <= tHigh && (normG[nIdx] <= edgeBarrier || d <= 0.45 * tLow)) {
          sureBg[nIdx] = 1;
          queue[tail++] = nIdx;
        }
      }
    }

    // Candidate high-D foreground components
    const highFg = new Uint8ClampedArray(len);
    for (let i = 0; i < len; i += 1) {
      if (!sureBg[i] && distMap[i] > tFg) highFg[i] = 255;
    }

    // Keep major high-FG components & extract hull points
    const fgVisited = new Uint8Array(len);
    const fgQueue = new Int32Array(len);
    const fgComps: Int32Array[] = [];
    let maxFgArea = 0;
    const cMinX = Math.floor(pW * 0.28);
    const cMaxX = Math.ceil(pW * 0.72);
    const cMinY = Math.floor(pH * 0.28);
    const cMaxY = Math.ceil(pH * 0.72);
    const compCenterFlags: boolean[] = [];

    for (let i = 0; i < len; i += 1) {
      if (highFg[i] && !fgVisited[i]) {
        let hPtr = 0;
        let tPtr = 0;
        let touchesCenter = false;
        fgVisited[i] = 1;
        fgQueue[tPtr++] = i;
        while (hPtr < tPtr) {
          const idx = fgQueue[hPtr++];
          const x = idx % pW;
          const y = (idx - x) / pW;
          if (!touchesCenter && x >= cMinX && x <= cMaxX && y >= cMinY && y <= cMaxY) touchesCenter = true;
          if (x > 0 && !fgVisited[idx - 1] && highFg[idx - 1]) {
            fgVisited[idx - 1] = 1;
            fgQueue[tPtr++] = idx - 1;
          }
          if (x + 1 < pW && !fgVisited[idx + 1] && highFg[idx + 1]) {
            fgVisited[idx + 1] = 1;
            fgQueue[tPtr++] = idx + 1;
          }
          if (y > 0 && !fgVisited[idx - pW] && highFg[idx - pW]) {
            fgVisited[idx - pW] = 1;
            fgQueue[tPtr++] = idx - pW;
          }
          if (y + 1 < pH && !fgVisited[idx + pW] && highFg[idx + pW]) {
            fgVisited[idx + pW] = 1;
            fgQueue[tPtr++] = idx + pW;
          }
        }
        if (tPtr > maxFgArea) maxFgArea = tPtr;
        fgComps.push(fgQueue.slice(0, tPtr));
        compCenterFlags.push(touchesCenter);
      }
    }

    const hullPts: HullPolygonPoint[] = [];
    const majorHighFg = new Uint8ClampedArray(len);
    const minCompKeep = Math.max(32, Math.floor(maxFgArea * 0.1));
    for (let c = 0; c < fgComps.length; c += 1) {
      const comp = fgComps[c];
      if (comp.length >= minCompKeep || (compCenterFlags[c] && comp.length >= 36)) {
        for (let k = 0; k < comp.length; k += 1) {
          const idx = comp[k];
          majorHighFg[idx] = 255;
          if (k % 6 === 0) {
            const x = idx % pW;
            const y = (idx - x) / pW;
            hullPts.push({ x, y });
          }
        }
      }
    }

    const erodeR = clamp(Math.round(Math.min(pW, pH) * 0.005), 3, 5);
    const erodedFg = applyMorphology(majorHighFg, pW, pH, -erodeR);

    let sureFgCount = 0;
    const sureFg = new Uint8Array(len);
    for (let i = 0; i < len; i += 1) {
      if (erodedFg[i] >= 128) {
        sureFg[i] = 1;
        sureFgCount += 1;
      }
    }
    // Thin-subject protection: if erosion wiped out thin subjects, keep interior ridge of majorHighFg
    if (sureFgCount < 12) {
      for (let i = 0; i < len; i += 1) {
        if (majorHighFg[i] >= 128) {
          sureFg[i] = 1;
          sureFgCount += 1;
        }
      }
    }

    const hull = computeConvexHull(hullPts);
    const insideHull = rasterizeConvexHullMask(hull, pW, pH);

    // Trimap: 0=BGD, 1=FGD, 2=PR_BGD, 3=PR_FGD
    const trimap = new Uint8Array(len);
    for (let y = 0; y < pH; y += 1) {
      const row = y * pW;
      const dyNorm = (y - halfH) / Math.max(1, halfH);
      for (let x = 0; x < pW; x += 1) {
        const i = row + x;
        if (sureBg[i]) {
          trimap[i] = existingAlpha[i] <= 16 || distMap[i] <= tLow ? 0 : 2;
        } else if (sureFg[i]) {
          trimap[i] = 1;
        } else {
          // Weak center + convex hull prior boosts foreground probability inside subject hull
          const dxNorm = (x - halfW) / Math.max(1, halfW);
          const centerDist = Math.min(1.4, Math.hypot(dxNorm, dyNorm));
          const boost = insideHull[i] ? Math.max(1.0, 1.32 - 0.18 * centerDist) : 1.0;
          const dAdj = distMap[i] * boost;
          if (settings.preserveHoles && dAdj <= tLow * 0.85) {
            trimap[i] = 2;
          } else if (dAdj >= tMid || (!settings.preserveHoles && !sureBg[i] && insideHull[i])) {
            trimap[i] = 3;
          } else {
            trimap[i] = insideHull[i] ? 3 : 2;
          }
        }
      }
    }

    return { trimap, sureBg, sureFg, tFg, tLow };
  };

  report(52, 'Generating and scoring candidate masks...');
  await tick();

  // Candidate specs: up to 4 candidates
  const candidateConfigs: Array<{
    id: string;
    label: string;
    scaleMult: number;
    useGrabCut: boolean;
    useGeo?: boolean;
  }> =
    modeUsed === 'plain'
      ? [
          { id: 'plain-med', label: 'Balanced (medium)', scaleMult: 1.0, useGrabCut: false },
          { id: 'plain-low', label: 'Tight edges (low tol)', scaleMult: 0.78, useGrabCut: false },
          { id: 'plain-high', label: 'Keep more subject (high tol)', scaleMult: 1.28, useGrabCut: false },
          { id: 'geo', label: 'Geodesic edge-aware', scaleMult: 1.0, useGrabCut: false, useGeo: true },
        ]
      : [
          { id: 'geo', label: 'Geodesic edge-aware', scaleMult: 1.0, useGrabCut: false, useGeo: true },
          { id: 'gc-med', label: 'Complex GrabCut (balanced)', scaleMult: 1.0, useGrabCut: true },
          { id: 'direct-high', label: 'Border-flood (high tol)', scaleMult: 1.25, useGrabCut: false },
        ];

  const evaluated: AutoCandidateResult[] = [];
  let primarySureBg = new Uint8Array(len);
  let primarySureFg = new Uint8Array(len);
  let primaryTrimap = new Uint8Array(len);

  const deadline = makeDeadline(6000);

  for (let cIdx = 0; cIdx < candidateConfigs.length; cIdx += 1) {
    if (cIdx > 0 && deadline.expired() && evaluated.length) break;
    const cfg = candidateConfigs[cIdx];
    const { trimap, sureBg, sureFg, tFg, tLow } = buildSeedsAndTrimap(cfg.scaleMult);
    if (cIdx === 0) {
      primarySureBg = sureBg;
      primarySureFg = sureFg;
      primaryTrimap = trimap;
    }

    let rawSegMask: Uint8ClampedArray;
    if (cfg.useGeo) {
      const cost = geodesicBackgroundCost(
        distMap,
        normG,
        existingAlpha,
        sureBg,
        pW,
        pH,
        tFg,
        edgeBarrier
      );
      rawSegMask = maskFromGeodesicCost(cost, sureFg, tolUserScale);
    } else if (cfg.useGrabCut) {
      if (options.complexSegmenter) {
        report(
          58 + cIdx * 10,
          `Running GrabCut segmentation (candidate ${cIdx + 1}/${candidateConfigs.length})...`
        );
        rawSegMask = await options.complexSegmenter.runGrabCutWithMask(
          procRgba,
          pW,
          pH,
          trimap,
          4
        );
      } else {
        rawSegMask = pureTsSeededWatershed(smoothL, smoothA, smoothB, normG, trimap, pW, pH);
      }
    } else {
      rawSegMask = new Uint8ClampedArray(len);
      for (let i = 0; i < len; i += 1) {
        // Keep interior non-border-connected pixels cleanly (unless preserveHoles marked PR_BGD)
        if (trimap[i] === 1 || trimap[i] === 3) {
          rawSegMask[i] = 255;
        } else if (!sureBg[i] && !settings.preserveHoles && distMap[i] > 0.35) {
          rawSegMask[i] = 255;
        }
      }
    }

    if (settings.preserveHoles || !settings.fillHoles) {
      rawSegMask = removeInteriorBackground(rawSegMask, distMap, normG, pW, pH, tLow, edgeBarrier);
    }

    await tick();

    const cleaned = cleanupMaskStep5(rawSegMask, procRgba, pW, pH, settings);
    const breakdown = scoreCandidate(
      cleaned,
      smoothL,
      smoothA,
      smoothB,
      normG,
      pW,
      pH,
      subjectTouchesEdge,
      settings.fillHoles && !settings.preserveHoles
    );

    evaluated.push({
      id: cfg.id,
      label: cfg.label,
      mask: cleaned,
      score: breakdown.total,
      breakdown,
      usedGrabCut: cfg.useGrabCut,
    });

    if (evaluated.some((c) => c.score >= 72)) break;
  }

  evaluated.sort((a, b) => b.score - a.score);
  let bestIsRefined = false;

  // If Complex GrabCut candidates collapsed badly, try Watershed fallback
  let usedCenterFallback = false;
  if (
    evaluated[0].score < LOW_CONFIDENCE_FLOOR &&
    modeUsed === 'complex' &&
    options.complexSegmenter?.runWatershed
  ) {
    report(84, 'Trying Watershed fallback on gradient markers...');
  await tick();
    const markers = new Int32Array(len);
    for (let i = 0; i < len; i += 1) {
      if (primaryTrimap[i] === 1) markers[i] = 1;
      else if (primaryTrimap[i] === 0) markers[i] = 2;
    }
    const wsMask = await options.complexSegmenter.runWatershed(procRgba, pW, pH, markers);
    const wsClean = cleanupMaskStep5(wsMask, procRgba, pW, pH, settings);
    const wsRefined = refineEdgesStep6(
      wsClean,
      procRgba,
      smoothL,
      smoothA,
      smoothB,
      distMap,
      expectedL,
      expectedA,
      expectedB,
      existingAlpha,
      pW,
      pH,
      settings
    );
    const wsBreakdown = scoreCandidate(
      wsRefined,
      smoothL,
      smoothA,
      smoothB,
      normG,
      pW,
      pH,
      subjectTouchesEdge,
      settings.fillHoles && !settings.preserveHoles
    );
    if (wsBreakdown.total > evaluated[0].score) {
      evaluated.unshift({
        id: 'watershed-fallback',
        label: 'Watershed markers fallback',
        mask: wsRefined,
        score: wsBreakdown.total,
        breakdown: wsBreakdown,
        usedGrabCut: false,
      });
      bestIsRefined = true;
      if (evaluated.length > 4) evaluated.pop();
    }
  }

  // Never silently output foreground < 3% or > 97%: fallback to 6%-margin center rect GrabCut
  const bestFrac = evaluated[0].breakdown.fgFraction;
  if ((bestFrac < 0.03 || bestFrac > 0.97) && options.complexSegmenter?.runGrabCutRectFallback) {
    report(88, 'Fallback: running center-frame GrabCut (6% margin)...');
  await tick();
    usedCenterFallback = true;
    const mx = Math.max(2, Math.round(pW * 0.06));
    const my = Math.max(2, Math.round(pH * 0.06));
    const rectMask = await options.complexSegmenter.runGrabCutRectFallback(
      procRgba,
      pW,
      pH,
      { x: mx, y: my, w: Math.max(8, pW - mx * 2), h: Math.max(8, pH - my * 2) },
      4
    );
    const rcClean = cleanupMaskStep5(rectMask, procRgba, pW, pH, settings);
    const rcRefined = refineEdgesStep6(
      rcClean,
      procRgba,
      smoothL,
      smoothA,
      smoothB,
      distMap,
      expectedL,
      expectedA,
      expectedB,
      existingAlpha,
      pW,
      pH,
      settings
    );
    const rcBreakdown = scoreCandidate(
      rcRefined,
      smoothL,
      smoothA,
      smoothB,
      normG,
      pW,
      pH,
      subjectTouchesEdge,
      settings.fillHoles && !settings.preserveHoles
    );
    evaluated.unshift({
      id: 'center-rect-fallback',
      label: 'Center-box GrabCut fallback',
      mask: rcRefined,
      score: rcBreakdown.total,
      breakdown: rcBreakdown,
      usedGrabCut: true,
    });
    bestIsRefined = true;
    if (evaluated.length > 4) evaluated.pop();
  }

  // Refine only the winning candidate; alternates are refined lazily when selected.
  if (!bestIsRefined) {
    evaluated[0].mask = refineEdgesStep6(
      evaluated[0].mask,
      procRgba,
      smoothL,
      smoothA,
      smoothB,
      distMap,
      expectedL,
      expectedA,
      expectedB,
      existingAlpha,
      pW,
      pH,
      settings
    );
    bestIsRefined = true;
  }

  report(95, 'Upsampling mask to working resolution...');
  await tick();

  // Map top 3 candidate masks back to caller's (origW, origH) using guided upsampling
  const upscaledCandidates: AutoCandidateResult[] = evaluated.slice(0, 4).map((cand) => ({
    ...cand,
    mask:
      pW === origW && pH === origH
        ? cand.mask
        : guidedUpsampleMask(cand.mask, pW, pH, rgbaInput, origW, origH),
  }));

  const best = upscaledCandidates[0];
  const confidence: 'normal' | 'low' =
    best.score < LOW_CONFIDENCE_FLOOR ||
    best.breakdown.fgFraction < 0.03 ||
    best.breakdown.fgFraction > 0.97
      ? 'low'
      : 'normal';

  let debug: AutoDebugSnapshot | undefined;
  if (options.includeDebug) {
    const sureBgOverlay = new Uint8ClampedArray(len);
    const sureFgOverlay = new Uint8ClampedArray(len);
    const unknownOverlay = new Uint8ClampedArray(len);
    for (let i = 0; i < len; i += 1) {
      if (primarySureBg[i]) sureBgOverlay[i] = 255;
      else if (primarySureFg[i]) sureFgOverlay[i] = 255;
      else unknownOverlay[i] = 255;
    }

    debug = {
      procWidth: pW,
      procHeight: pH,
      borderSegments: segments.map((s) => ({
        x0: s.x0,
        y0: s.y0,
        x1: s.x1,
        y1: s.y1,
        side: s.side,
        meanL: s.meanL,
        meanA: s.meanA,
        meanB: s.meanB,
        isOutlier: s.isOutlier,
      })),
      paletteClusters: clusters.map((c) => ({
        l: c.l,
        a: c.a,
        b: c.b,
        rgb: labToRgbApprox(c.l, c.a, c.b),
        coverage: c.coverage,
        stdL: c.stdL,
        stdA: c.stdA,
        stdB: c.stdB,
      })),
      useSurfaceModel,
      modeUsed,
      sureBgOverlay,
      sureFgOverlay,
      unknownOverlay,
      candidatesSummary: upscaledCandidates.map((c) => ({
        id: c.id,
        label: c.label,
        score: c.score,
        fgFraction: c.breakdown.fgFraction,
        breakdown: c.breakdown,
      })),
    };
  }

  return {
    mask: best.mask,
    candidates: upscaledCandidates,
    bestIndex: 0,
    score: best.score,
    confidence,
    modeUsed,
    spillMode,
    subjectTouchesEdgeDetected: autoTouchedEdge,
    usedCenterFallback,
    debug,
  };
}
