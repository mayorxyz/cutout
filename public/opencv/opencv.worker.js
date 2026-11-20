/* eslint-disable no-undef */
/**
 * Lazy-loaded OpenCV.js Web Worker for classical GrabCut and Watershed segmentation.
 * Uses only locally bundled /opencv/opencv.js — zero network/CDN model requests.
 */

let cvPromise = null;
let cvReady = null;

// Cached CV-resolution GrabCut session so scribble refinement builds incrementally on rect/mask
let session = null;

const CV_MAX_SIDE = 820;

async function ensureOpenCv(requestId) {
  if (cvReady) return cvReady;
  self.postMessage({
    type: 'progress',
    requestId,
    progress: 12,
    detail: 'Loading local OpenCV engine...',
  });

  if (!cvPromise) {
    importScripts('/opencv/opencv.js');
    cvPromise = Promise.resolve(self.cv).then((mod) => mod);
  }

  cvReady = await cvPromise;
  self.postMessage({
    type: 'progress',
    requestId,
    progress: 35,
    detail: 'OpenCV ready — preparing image...',
  });
  return cvReady;
}

function clearSession() {
  if (!session) return;
  try {
    session.srcRgb?.delete();
    session.cvMask?.delete();
    session.bgModel?.delete();
    session.fgModel?.delete();
  } catch {
    // ignore cleanup error
  }
  session = null;
}

function upscaleBinaryOrSoftMaskBilinear(srcMask, srcW, srcH, dstW, dstH) {
  if (srcW === dstW && srcH === dstH) {
    return new Uint8ClampedArray(srcMask);
  }
  const out = new Uint8ClampedArray(dstW * dstH);
  const scaleX = srcW / dstW;
  const scaleY = srcH / dstH;
  for (let y = 0; y < dstH; y += 1) {
    const sy = Math.max(0, Math.min(srcH - 1, (y + 0.5) * scaleY - 0.5));
    const y0 = Math.floor(sy);
    const y1 = Math.min(srcH - 1, y0 + 1);
    const dy = sy - y0;
    const row0 = y0 * srcW;
    const row1 = y1 * srcW;
    const dstRow = y * dstW;
    for (let x = 0; x < dstW; x += 1) {
      const sx = Math.max(0, Math.min(srcW - 1, (x + 0.5) * scaleX - 0.5));
      const x0 = Math.floor(sx);
      const x1 = Math.min(srcW - 1, x0 + 1);
      const dx = sx - x0;
      const v00 = srcMask[row0 + x0];
      const v10 = srcMask[row0 + x1];
      const v01 = srcMask[row1 + x0];
      const v11 = srcMask[row1 + x1];
      const top = v00 + (v10 - v00) * dx;
      const bot = v01 + (v11 - v01) * dx;
      out[dstRow + x] = Math.round(top + (bot - top) * dy) >= 128 ? 255 : 0;
    }
  }
  return out;
}

function downsampleRgba(rgba, srcW, srcH, dstW, dstH) {
  if (srcW === dstW && srcH === dstH) return new Uint8ClampedArray(rgba);
  const out = new Uint8ClampedArray(dstW * dstH * 4);
  const sxRatio = srcW / dstW;
  const syRatio = srcH / dstH;
  for (let y = 0; y < dstH; y += 1) {
    const sy = Math.min(srcH - 1, Math.floor((y + 0.5) * syRatio));
    for (let x = 0; x < dstW; x += 1) {
      const sx = Math.min(srcW - 1, Math.floor((x + 0.5) * sxRatio));
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

function downsampleScribbles(scribbles, srcW, srcH, dstW, dstH) {
  if (srcW === dstW && srcH === dstH) return new Uint8Array(scribbles);
  const out = new Uint8Array(dstW * dstH);
  const sxRatio = srcW / dstW;
  const syRatio = srcH / dstH;
  for (let y = 0; y < srcH; y += 1) {
    const dy = Math.min(dstH - 1, Math.floor(y / syRatio));
    const sRow = y * srcW;
    const dRow = dy * dstW;
    for (let x = 0; x < srcW; x += 1) {
      const val = scribbles[sRow + x];
      if (val !== 0) {
        const dx = Math.min(dstW - 1, Math.floor(x / sxRatio));
        out[dRow + dx] = val;
      }
    }
  }
  return out;
}

function downsampleMask(mask, srcW, srcH, dstW, dstH) {
  if (srcW === dstW && srcH === dstH) return new Uint8ClampedArray(mask);
  const out = new Uint8ClampedArray(dstW * dstH);
  const sxRatio = srcW / dstW;
  const syRatio = srcH / dstH;
  for (let y = 0; y < dstH; y += 1) {
    const sy = Math.min(srcH - 1, Math.floor((y + 0.5) * syRatio));
    for (let x = 0; x < dstW; x += 1) {
      const sx = Math.min(srcW - 1, Math.floor((x + 0.5) * sxRatio));
      out[y * dstW + x] = mask[sy * srcW + sx];
    }
  }
  return out;
}

function extractGrabCutAlpha(cv, cvMask, cvW, cvH) {
  const raw = cvMask.data;
  const out = new Uint8ClampedArray(cvW * cvH);
  for (let i = 0; i < out.length; i += 1) {
    const v = raw[i];
    out[i] = v === cv.GC_FGD || v === cv.GC_PR_FGD ? 255 : 0;
  }
  return out;
}

function prepareSessionForImage(cv, rgba, width, height, imageKey) {
  const longest = Math.max(width, height);
  const scale = longest > CV_MAX_SIDE ? CV_MAX_SIDE / longest : 1;
  const cvW = Math.max(16, Math.round(width * scale));
  const cvH = Math.max(16, Math.round(height * scale));

  if (session && session.imageKey === imageKey && session.cvW === cvW && session.cvH === cvH) {
    return session;
  }

  clearSession();

  const scaledRgba = downsampleRgba(rgba, width, height, cvW, cvH);
  const srcRgba = cv.matFromArray(cvH, cvW, cv.CV_8UC4, scaledRgba);
  const srcRgb = new cv.Mat();
  cv.cvtColor(srcRgba, srcRgb, cv.COLOR_RGBA2RGB);
  srcRgba.delete();

  const cvMask = new cv.Mat(cvH, cvW, cv.CV_8UC1, new cv.Scalar(cv.GC_BGD));
  const bgModel = new cv.Mat();
  const fgModel = new cv.Mat();

  session = {
    imageKey,
    srcW: width,
    srcH: height,
    cvW,
    cvH,
    scale,
    srcRgb,
    cvMask,
    bgModel,
    fgModel,
    initialized: false,
  };
  return session;
}

self.onmessage = async (event) => {
  const msg = event.data;

  if (msg.type === 'clear') {
    clearSession();
    return;
  }

  try {
    const cv = await ensureOpenCv(msg.requestId);
    const rgba = new Uint8ClampedArray(msg.rgbaBuffer);
    const sess = prepareSessionForImage(cv, rgba, msg.width, msg.height, msg.imageKey);

    if (msg.type === 'grabcut-rect') {
      const rx = Math.max(1, Math.min(sess.cvW - 4, Math.round(msg.rect.x * sess.scale)));
      const ry = Math.max(1, Math.min(sess.cvH - 4, Math.round(msg.rect.y * sess.scale)));
      const rw = Math.max(4, Math.min(sess.cvW - rx - 1, Math.round(msg.rect.w * sess.scale)));
      const rh = Math.max(4, Math.min(sess.cvH - ry - 1, Math.round(msg.rect.h * sess.scale)));

      sess.cvMask.setTo(new cv.Scalar(cv.GC_BGD));
      sess.bgModel.delete();
      sess.fgModel.delete();
      sess.bgModel = new cv.Mat();
      sess.fgModel = new cv.Mat();

      const cvRect = new cv.Rect(rx, ry, rw, rh);
      const totalIters = Math.max(1, Math.min(8, msg.iterations || 4));

      self.postMessage({
        type: 'progress',
        requestId: msg.requestId,
        progress: 45,
        detail: `Initializing GrabCut (${totalIters} iterations)...`,
      });

      cv.grabCut(sess.srcRgb, sess.cvMask, cvRect, sess.bgModel, sess.fgModel, 1, cv.GC_INIT_WITH_RECT);
      for (let it = 2; it <= totalIters; it += 1) {
        const pct = 45 + Math.round(((it - 1) / totalIters) * 48);
        self.postMessage({
          type: 'progress',
          requestId: msg.requestId,
          progress: pct,
          detail: `Running GrabCut iteration ${it}/${totalIters}...`,
        });
        cv.grabCut(sess.srcRgb, sess.cvMask, new cv.Rect(), sess.bgModel, sess.fgModel, 1, cv.GC_EVAL);
      }

      sess.initialized = true;
      const cvAlpha = extractGrabCutAlpha(cv, sess.cvMask, sess.cvW, sess.cvH);
      const fullAlpha = upscaleBinaryOrSoftMaskBilinear(
        cvAlpha,
        sess.cvW,
        sess.cvH,
        msg.width,
        msg.height
      );

      const copy = new Uint8ClampedArray(fullAlpha.length);
      copy.set(fullAlpha);
      self.postMessage(
        {
          type: 'done',
          requestId: msg.requestId,
          maskBuffer: copy.buffer,
          algorithm: 'grabcut',
        },
        [copy.buffer]
      );
      return;
    }

    if (msg.type === 'grabcut-scribbles') {
      const scribbles = new Uint8Array(msg.scribblesBuffer);
      const cvScribbles = downsampleScribbles(scribbles, msg.width, msg.height, sess.cvW, sess.cvH);

      // If user hasn't run GrabCut rect yet, seed probable FG/BG from current baseMask or border
      if (!sess.initialized) {
        const maskBytes = sess.cvMask.data;
        if (msg.baseMaskBuffer) {
          const base = downsampleMask(
            new Uint8ClampedArray(msg.baseMaskBuffer),
            msg.width,
            msg.height,
            sess.cvW,
            sess.cvH
          );
          for (let i = 0; i < maskBytes.length; i += 1) {
            maskBytes[i] = base[i] >= 128 ? cv.GC_PR_FGD : cv.GC_PR_BGD;
          }
        } else {
          for (let y = 0; y < sess.cvH; y += 1) {
            const borderY = y < 4 || y >= sess.cvH - 4;
            for (let x = 0; x < sess.cvW; x += 1) {
              const borderX = x < 4 || x >= sess.cvW - 4;
              maskBytes[y * sess.cvW + x] = borderX || borderY ? cv.GC_BGD : cv.GC_PR_FGD;
            }
          }
        }
        sess.bgModel.delete();
        sess.fgModel.delete();
        sess.bgModel = new cv.Mat();
        sess.fgModel = new cv.Mat();
      }

      const maskBytes = sess.cvMask.data;
      let fgCount = 0;
      let bgCount = 0;
      for (let i = 0; i < cvScribbles.length; i += 1) {
        if (cvScribbles[i] === 1) {
          maskBytes[i] = cv.GC_FGD;
          fgCount += 1;
        } else if (cvScribbles[i] === 2) {
          maskBytes[i] = cv.GC_BGD;
          bgCount += 1;
        }
      }

      // Guard OpenCV invariant: at least one FG/PR_FGD and one BGD/PR_BGD pixel required
      let hasFg = fgCount > 0;
      let hasBg = bgCount > 0;
      if (!hasFg || !hasBg) {
        for (let i = 0; i < maskBytes.length; i += 1) {
          if (maskBytes[i] === cv.GC_FGD || maskBytes[i] === cv.GC_PR_FGD) hasFg = true;
          if (maskBytes[i] === cv.GC_BGD || maskBytes[i] === cv.GC_PR_BGD) hasBg = true;
          if (hasFg && hasBg) break;
        }
      }
      if (!hasFg) maskBytes[Math.floor((sess.cvH / 2) * sess.cvW + sess.cvW / 2)] = cv.GC_PR_FGD;
      if (!hasBg) maskBytes[0] = cv.GC_BGD;

      const totalIters = Math.max(1, Math.min(8, msg.iterations || 3));
      self.postMessage({
        type: 'progress',
        requestId: msg.requestId,
        progress: 55,
        detail: `Refining GrabCut with scribbles (${totalIters} iterations)...`,
      });

      cv.grabCut(
        sess.srcRgb,
        sess.cvMask,
        new cv.Rect(),
        sess.bgModel,
        sess.fgModel,
        totalIters,
        cv.GC_INIT_WITH_MASK
      );
      sess.initialized = true;

      const cvAlpha = extractGrabCutAlpha(cv, sess.cvMask, sess.cvW, sess.cvH);
      const fullAlpha = upscaleBinaryOrSoftMaskBilinear(
        cvAlpha,
        sess.cvW,
        sess.cvH,
        msg.width,
        msg.height
      );
      const copy = new Uint8ClampedArray(fullAlpha.length);
      copy.set(fullAlpha);
      self.postMessage(
        {
          type: 'done',
          requestId: msg.requestId,
          maskBuffer: copy.buffer,
          algorithm: 'grabcut',
        },
        [copy.buffer]
      );
      return;
    }

    if (msg.type === 'watershed-scribbles') {
      const scribbles = new Uint8Array(msg.scribblesBuffer);
      const cvScribbles = downsampleScribbles(scribbles, msg.width, msg.height, sess.cvW, sess.cvH);

      self.postMessage({
        type: 'progress',
        requestId: msg.requestId,
        progress: 60,
        detail: 'Running marker-based Watershed...',
      });

      const markers = new cv.Mat(sess.cvH, sess.cvW, cv.CV_32SC1, new cv.Scalar(0));
      const mData = markers.data32S;
      let fgCount = 0;
      let bgCount = 0;

      for (let i = 0; i < cvScribbles.length; i += 1) {
        if (cvScribbles[i] === 1) {
          mData[i] = 1; // Foreground marker
          fgCount += 1;
        } else if (cvScribbles[i] === 2) {
          mData[i] = 2; // Background marker
          bgCount += 1;
        }
      }

      if (fgCount === 0) {
        throw new Error('Draw at least one green foreground scribble before running Watershed.');
      }
      if (bgCount === 0) {
        // Seed outer 2px border as background if user only drew foreground strokes
        for (let x = 0; x < sess.cvW; x += 1) {
          mData[x] = 2;
          mData[(sess.cvH - 1) * sess.cvW + x] = 2;
        }
        for (let y = 0; y < sess.cvH; y += 1) {
          mData[y * sess.cvW] = 2;
          mData[y * sess.cvW + (sess.cvW - 1)] = 2;
        }
      }

      cv.watershed(sess.srcRgb, markers);

      const cvAlpha = new Uint8ClampedArray(sess.cvW * sess.cvH);
      for (let i = 0; i < cvAlpha.length; i += 1) {
        cvAlpha[i] = mData[i] === 1 ? 255 : 0;
      }
      markers.delete();

      const fullAlpha = upscaleBinaryOrSoftMaskBilinear(
        cvAlpha,
        sess.cvW,
        sess.cvH,
        msg.width,
        msg.height
      );
      const copy = new Uint8ClampedArray(fullAlpha.length);
      copy.set(fullAlpha);
      self.postMessage(
        {
          type: 'done',
          requestId: msg.requestId,
          maskBuffer: copy.buffer,
          algorithm: 'watershed',
        },
        [copy.buffer]
      );
    }
  } catch (err) {
    self.postMessage({
      type: 'error',
      requestId: msg.requestId,
      message: err instanceof Error ? err.message : String(err),
    });
  }
};
