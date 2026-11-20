import type { AutoRemoveSettings } from '../config';
import {
  type AutoDebugSnapshot,
  type CandidateScoreBreakdown,
  type ComplexSegmenter,
  runAutoRemovePipeline,
} from '../lib/autoRemoveEngine';
import { cloneToArrayBuffer, upscaleMaskBilinear } from '../lib/maskAlgorithms';

export interface BgWorkerRequestMessage {
  requestId: number;
  rgbaBuffer: ArrayBuffer;
  width: number;
  height: number;
  settings: AutoRemoveSettings;
  includeDebug?: boolean;
}

export interface BgWorkerCandidatePayload {
  id: string;
  label: string;
  score: number;
  usedGrabCut: boolean;
  breakdown: CandidateScoreBreakdown;
  maskBuffer: ArrayBuffer;
}

export type BgWorkerResponseMessage =
  | {
      type: 'progress';
      requestId: number;
      progress: number;
      detail: string;
    }
  | {
      type: 'done';
      requestId: number;
      maskBuffer: ArrayBuffer;
      width: number;
      height: number;
      candidates: BgWorkerCandidatePayload[];
      score: number;
      confidence: 'normal' | 'low';
      modeUsed: 'plain' | 'complex';
      spillMode: 'green' | 'blue' | null;
      subjectTouchesEdgeDetected: boolean;
      usedCenterFallback: boolean;
      debug?: AutoDebugSnapshot;
    }
  | {
      type: 'error';
      requestId: number;
      message: string;
    };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let cachedCvPromise: Promise<any> | null = null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function ensureLocalOpenCv(): Promise<any> {
  if (!cachedCvPromise) {
    cachedCvPromise = (async () => {
      const res = await fetch('/opencv/opencv.js');
      if (!res.ok) {
        throw new Error(`Failed to fetch local OpenCV bundle (${res.status})`);
      }
      const code = await res.text();
      // Execute locally bundled UMD script in worker global scope (no CDN, no importScripts in ES module worker)
      (0, eval)(code);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const g = globalThis as any;
      if (!g.cv) {
        throw new Error('OpenCV bundle did not expose global cv');
      }
      return await Promise.resolve(g.cv);
    })().catch((err) => {
      cachedCvPromise = null;
      throw err;
    });
  }
  return cachedCvPromise;
}

const CV_MAX_SIDE = 560;

function scaleRgbaNearestOrBilinear(
  rgba: Uint8ClampedArray,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number
): Uint8ClampedArray {
  if (srcW === dstW && srcH === dstH) return new Uint8ClampedArray(rgba);
  const out = new Uint8ClampedArray(dstW * dstH * 4);
  const sxR = srcW / dstW;
  const syR = srcH / dstH;
  for (let y = 0; y < dstH; y += 1) {
    const sy = Math.min(srcH - 1, Math.floor((y + 0.5) * syR));
    for (let x = 0; x < dstW; x += 1) {
      const sx = Math.min(srcW - 1, Math.floor((x + 0.5) * sxR));
      const sp = (sy * srcW + sx) * 4;
      const dp = (y * dstW + x) * 4;
      out[dp] = rgba[sp];
      out[dp + 1] = rgba[sp + 1];
      out[dp + 2] = rgba[sp + 2];
      out[dp + 3] = 255;
    }
  }
  return out;
}

function scaleTrimap(
  trimap: Uint8Array,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number
): Uint8Array {
  if (srcW === dstW && srcH === dstH) return new Uint8Array(trimap);
  const out = new Uint8Array(dstW * dstH);
  const sxR = srcW / dstW;
  const syR = srcH / dstH;
  for (let y = 0; y < dstH; y += 1) {
    const sy = Math.min(srcH - 1, Math.floor((y + 0.5) * syR));
    for (let x = 0; x < dstW; x += 1) {
      const sx = Math.min(srcW - 1, Math.floor((x + 0.5) * sxR));
      out[y * dstW + x] = trimap[sy * srcW + sx];
    }
  }
  return out;
}

function scaleMarkers(
  markers: Int32Array,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number
): Int32Array {
  if (srcW === dstW && srcH === dstH) return new Int32Array(markers);
  const out = new Int32Array(dstW * dstH);
  const sxR = srcW / dstW;
  const syR = srcH / dstH;
  for (let y = 0; y < srcH; y += 1) {
    const dy = Math.min(dstH - 1, Math.floor(y / syR));
    const sRow = y * srcW;
    const dRow = dy * dstW;
    for (let x = 0; x < srcW; x += 1) {
      const m = markers[sRow + x];
      if (m !== 0) {
        const dx = Math.min(dstW - 1, Math.floor(x / sxR));
        out[dRow + dx] = m;
      }
    }
  }
  return out;
}

const openCvComplexSegmenter: ComplexSegmenter = {
  async runGrabCutWithMask(rgba, width, height, trimap, iterations) {
    const cv = await ensureLocalOpenCv();
    const longSide = Math.max(width, height);
    const scale = longSide > CV_MAX_SIDE ? CV_MAX_SIDE / longSide : 1;
    const cvW = Math.max(16, Math.round(width * scale));
    const cvH = Math.max(16, Math.round(height * scale));

    const scaledRgba = scaleRgbaNearestOrBilinear(rgba, width, height, cvW, cvH);
    const scaledTri = scaleTrimap(trimap, width, height, cvW, cvH);

    const srcRgba = cv.matFromArray(cvH, cvW, cv.CV_8UC4, scaledRgba);
    const srcRgb = new cv.Mat();
    const cvMask = new cv.Mat(cvH, cvW, cv.CV_8UC1, new cv.Scalar(cv.GC_PR_BGD));
    const bgModel = new cv.Mat();
    const fgModel = new cv.Mat();

    try {
      cv.cvtColor(srcRgba, srcRgb, cv.COLOR_RGBA2RGB);
      const maskBytes: Uint8Array = cvMask.data;
      let hasFg = false;
      let hasBg = false;
      for (let i = 0; i < scaledTri.length; i += 1) {
        const t = scaledTri[i];
        if (t === 0) {
          maskBytes[i] = cv.GC_BGD;
          hasBg = true;
        } else if (t === 1) {
          maskBytes[i] = cv.GC_FGD;
          hasFg = true;
        } else if (t === 3) {
          maskBytes[i] = cv.GC_PR_FGD;
          hasFg = true;
        } else {
          maskBytes[i] = cv.GC_PR_BGD;
          hasBg = true;
        }
      }
      if (!hasFg) maskBytes[Math.floor((cvH / 2) * cvW + cvW / 2)] = cv.GC_FGD;
      if (!hasBg) maskBytes[0] = cv.GC_BGD;

      cv.grabCut(
        srcRgb,
        cvMask,
        new cv.Rect(),
        bgModel,
        fgModel,
        Math.max(1, Math.min(3, iterations)),
        cv.GC_INIT_WITH_MASK
      );

      const cvAlpha = new Uint8ClampedArray(cvW * cvH);
      for (let i = 0; i < cvAlpha.length; i += 1) {
        const v = maskBytes[i];
        cvAlpha[i] = v === cv.GC_FGD || v === cv.GC_PR_FGD ? 255 : 0;
      }

      if (cvW === width && cvH === height) return cvAlpha;
      const up = upscaleMaskBilinear(cvAlpha, cvW, cvH, width, height);
      for (let i = 0; i < up.length; i += 1) up[i] = up[i] >= 128 ? 255 : 0;
      return up;
    } finally {
      srcRgba.delete();
      srcRgb.delete();
      cvMask.delete();
      bgModel.delete();
      fgModel.delete();
    }
  },

  async runWatershed(rgba, width, height, markers) {
    const cv = await ensureLocalOpenCv();
    const longSide = Math.max(width, height);
    const scale = longSide > CV_MAX_SIDE ? CV_MAX_SIDE / longSide : 1;
    const cvW = Math.max(16, Math.round(width * scale));
    const cvH = Math.max(16, Math.round(height * scale));

    const scaledRgba = scaleRgbaNearestOrBilinear(rgba, width, height, cvW, cvH);
    const scaledMarkers = scaleMarkers(markers, width, height, cvW, cvH);

    const srcRgba = cv.matFromArray(cvH, cvW, cv.CV_8UC4, scaledRgba);
    const srcRgb = new cv.Mat();
    const markersMat = new cv.Mat(cvH, cvW, cv.CV_32SC1, new cv.Scalar(0));

    try {
      cv.cvtColor(srcRgba, srcRgb, cv.COLOR_RGBA2RGB);
      const mData: Int32Array = markersMat.data32S;
      let fgCount = 0;
      let bgCount = 0;
      for (let i = 0; i < scaledMarkers.length; i += 1) {
        mData[i] = scaledMarkers[i];
        if (scaledMarkers[i] === 1) fgCount += 1;
        else if (scaledMarkers[i] === 2) bgCount += 1;
      }
      if (fgCount === 0) mData[Math.floor((cvH / 2) * cvW + cvW / 2)] = 1;
      if (bgCount === 0) mData[0] = 2;

      cv.watershed(srcRgb, markersMat);

      const cvAlpha = new Uint8ClampedArray(cvW * cvH);
      for (let i = 0; i < cvAlpha.length; i += 1) {
        cvAlpha[i] = mData[i] === 1 ? 255 : 0;
      }

      if (cvW === width && cvH === height) return cvAlpha;
      const up = upscaleMaskBilinear(cvAlpha, cvW, cvH, width, height);
      for (let i = 0; i < up.length; i += 1) up[i] = up[i] >= 128 ? 255 : 0;
      return up;
    } finally {
      srcRgba.delete();
      srcRgb.delete();
      markersMat.delete();
    }
  },

  async runGrabCutRectFallback(rgba, width, height, rect, iterations) {
    const cv = await ensureLocalOpenCv();
    const longSide = Math.max(width, height);
    const scale = longSide > CV_MAX_SIDE ? CV_MAX_SIDE / longSide : 1;
    const cvW = Math.max(16, Math.round(width * scale));
    const cvH = Math.max(16, Math.round(height * scale));

    const scaledRgba = scaleRgbaNearestOrBilinear(rgba, width, height, cvW, cvH);
    const srcRgba = cv.matFromArray(cvH, cvW, cv.CV_8UC4, scaledRgba);
    const srcRgb = new cv.Mat();
    const cvMask = new cv.Mat(cvH, cvW, cv.CV_8UC1, new cv.Scalar(cv.GC_BGD));
    const bgModel = new cv.Mat();
    const fgModel = new cv.Mat();

    try {
      cv.cvtColor(srcRgba, srcRgb, cv.COLOR_RGBA2RGB);
      const rx = Math.max(1, Math.min(cvW - 4, Math.round(rect.x * scale)));
      const ry = Math.max(1, Math.min(cvH - 4, Math.round(rect.y * scale)));
      const rw = Math.max(4, Math.min(cvW - rx - 1, Math.round(rect.w * scale)));
      const rh = Math.max(4, Math.min(cvH - ry - 1, Math.round(rect.h * scale)));

      cv.grabCut(
        srcRgb,
        cvMask,
        new cv.Rect(rx, ry, rw, rh),
        bgModel,
        fgModel,
        Math.max(1, Math.min(3, iterations)),
        cv.GC_INIT_WITH_RECT
      );

      const maskBytes: Uint8Array = cvMask.data;
      const cvAlpha = new Uint8ClampedArray(cvW * cvH);
      for (let i = 0; i < cvAlpha.length; i += 1) {
        const v = maskBytes[i];
        cvAlpha[i] = v === cv.GC_FGD || v === cv.GC_PR_FGD ? 255 : 0;
      }

      if (cvW === width && cvH === height) return cvAlpha;
      const up = upscaleMaskBilinear(cvAlpha, cvW, cvH, width, height);
      for (let i = 0; i < up.length; i += 1) up[i] = up[i] >= 128 ? 255 : 0;
      return up;
    } finally {
      srcRgba.delete();
      srcRgb.delete();
      cvMask.delete();
      bgModel.delete();
      fgModel.delete();
    }
  },
};

self.onmessage = async (event: MessageEvent<BgWorkerRequestMessage>) => {
  const { requestId, rgbaBuffer, width, height, settings, includeDebug } = event.data;

  try {
    const rgba = new Uint8ClampedArray(rgbaBuffer);

    const result = await runAutoRemovePipeline(rgba, width, height, settings, {
      complexSegmenter: openCvComplexSegmenter,
      includeDebug: Boolean(includeDebug),
      onProgress: (progress, detail) => {
        self.postMessage({
          type: 'progress',
          requestId,
          progress,
          detail,
        } satisfies BgWorkerResponseMessage);
      },
    });

    const transferList: ArrayBuffer[] = [];
    const mainMaskBuf = cloneToArrayBuffer(result.mask);
    transferList.push(mainMaskBuf);

    const candidatePayloads: BgWorkerCandidatePayload[] = result.candidates.map((cand) => {
      const buf = cloneToArrayBuffer(cand.mask);
      transferList.push(buf);
      return {
        id: cand.id,
        label: cand.label,
        score: cand.score,
        usedGrabCut: cand.usedGrabCut,
        breakdown: cand.breakdown,
        maskBuffer: buf,
      };
    });

    if (result.debug) {
      transferList.push(
        result.debug.sureBgOverlay.buffer as ArrayBuffer,
        result.debug.sureFgOverlay.buffer as ArrayBuffer,
        result.debug.unknownOverlay.buffer as ArrayBuffer
      );
    }

    self.postMessage(
      {
        type: 'done',
        requestId,
        maskBuffer: mainMaskBuf,
        width,
        height,
        candidates: candidatePayloads,
        score: result.score,
        confidence: result.confidence,
        modeUsed: result.modeUsed,
        spillMode: result.spillMode,
        subjectTouchesEdgeDetected: result.subjectTouchesEdgeDetected,
        usedCenterFallback: result.usedCenterFallback,
        debug: result.debug,
      } satisfies BgWorkerResponseMessage,
      { transfer: transferList }
    );
  } catch (err) {
    self.postMessage({
      type: 'error',
      requestId,
      message: err instanceof Error ? err.message : String(err),
    } satisfies BgWorkerResponseMessage);
  }
};
