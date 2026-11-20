import type { RefineSettings, SelectionCombineMode } from '../config';

export function cloneToArrayBuffer(arr: Uint8ClampedArray): ArrayBuffer {
  const copy = new Uint8ClampedArray(arr.length);
  copy.set(arr);
  return copy.buffer;
}

const SRGB_TO_LINEAR = new Float32Array(256);
for (let i = 0; i < 256; i += 1) {
  const s = i / 255;
  SRGB_TO_LINEAR[i] = s > 0.04045 ? Math.pow((s + 0.055) / 1.055, 2.4) : s / 12.92;
}

/**
 * Convert sRGB (0..255) to CIELAB (D65 illuminant).
 */
export function rgbToLab(r: number, g: number, b: number): [number, number, number] {
  const sr = SRGB_TO_LINEAR[r & 255];
  const sg = SRGB_TO_LINEAR[g & 255];
  const sb = SRGB_TO_LINEAR[b & 255];

  const x = (sr * 0.4124564 + sg * 0.3575761 + sb * 0.1804375) / 0.95047;
  const y = sr * 0.2126729 + sg * 0.7151522 + sb * 0.072175;
  const z = (sr * 0.0193339 + sg * 0.119192 + sb * 0.9503041) / 1.08883;

  const fx = x > 0.008856 ? Math.cbrt(x) : 7.787 * x + 16 / 116;
  const fy = y > 0.008856 ? Math.cbrt(y) : 7.787 * y + 16 / 116;
  const fz = z > 0.008856 ? Math.cbrt(z) : 7.787 * z + 16 / 116;

  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

export function deltaELabSq(
  l1: number,
  a1: number,
  b1: number,
  l2: number,
  a2: number,
  b2: number
): number {
  const dl = l1 - l2;
  const da = a1 - a2;
  const db = b1 - b2;
  return dl * dl + da * da + db * db;
}

/**
 * O(N) integral-image box filter for single-channel float data.
 */
export function boxFilterIntegral(
  src: Float32Array,
  width: number,
  height: number,
  radius: number
): Float32Array {
  const len = width * height;
  if (radius <= 0) return new Float32Array(src);
  const w1 = width + 1;
  const integral = new Float64Array((height + 1) * w1);

  for (let y = 0; y < height; y += 1) {
    const sRow = y * width;
    const iRow = (y + 1) * w1;
    const pRow = y * w1;
    let rowSum = 0;
    for (let x = 0; x < width; x += 1) {
      rowSum += src[sRow + x];
      integral[iRow + x + 1] = integral[pRow + x + 1] + rowSum;
    }
  }

  const out = new Float32Array(len);
  for (let y = 0; y < height; y += 1) {
    const y0 = Math.max(0, y - radius);
    const y1 = Math.min(height - 1, y + radius) + 1;
    const r0 = y0 * w1;
    const r1 = y1 * w1;
    const outRow = y * width;
    const hCount = y1 - y0;
    for (let x = 0; x < width; x += 1) {
      const x0 = Math.max(0, x - radius);
      const x1 = Math.min(width - 1, x + radius) + 1;
      const sum = integral[r1 + x1] - integral[r0 + x1] - integral[r1 + x0] + integral[r0 + x0];
      out[outRow + x] = sum / (hCount * (x1 - x0));
    }
  }
  return out;
}

/**
 * O(N) RGB-guided filter (approximated via luminance + diagonal RGB variance average)
 * preserving crisp subject edges while smoothing mask noise.
 */
export function guidedFilterMask(
  rgba: Uint8ClampedArray,
  pNormalized: Float32Array,
  width: number,
  height: number,
  radius = 8,
  eps = 1e-3
): Float32Array {
  const len = width * height;
  const guide = new Float32Array(len);
  const ii = new Float32Array(len);
  const ip = new Float32Array(len);

  for (let i = 0, p = 0; i < len; i += 1, p += 4) {
    const g = (0.299 * rgba[p] + 0.587 * rgba[p + 1] + 0.114 * rgba[p + 2]) / 255;
    guide[i] = g;
    ii[i] = g * g;
    ip[i] = g * pNormalized[i];
  }

  const meanI = boxFilterIntegral(guide, width, height, radius);
  const meanP = boxFilterIntegral(pNormalized, width, height, radius);
  const meanII = boxFilterIntegral(ii, width, height, radius);
  const meanIP = boxFilterIntegral(ip, width, height, radius);

  const aArr = new Float32Array(len);
  const bArr = new Float32Array(len);
  for (let i = 0; i < len; i += 1) {
    const varI = Math.max(0, meanII[i] - meanI[i] * meanI[i]);
    const covIP = meanIP[i] - meanI[i] * meanP[i];
    const a = covIP / (varI + eps);
    aArr[i] = a;
    bArr[i] = meanP[i] - a * meanI[i];
  }

  const meanA = boxFilterIntegral(aArr, width, height, radius);
  const meanB = boxFilterIntegral(bArr, width, height, radius);

  const q = new Float32Array(len);
  for (let i = 0; i < len; i += 1) {
    const val = meanA[i] * guide[i] + meanB[i];
    q[i] = val < 0 ? 0 : val > 1 ? 1 : val;
  }
  return q;
}

/**
 * Joint/guided upsampling from working resolution mask to full export resolution
 * guided by the full-resolution RGB image.
 */
export function guidedUpsampleMask(
  srcMask: Uint8ClampedArray | Uint8Array,
  srcW: number,
  srcH: number,
  fullRgba: Uint8ClampedArray,
  dstW: number,
  dstH: number
): Uint8ClampedArray {
  const bilinear = upscaleMaskBilinear(srcMask, srcW, srcH, dstW, dstH);
  if (srcW >= dstW && srcH >= dstH) {
    return bilinear;
  }

  const len = dstW * dstH;
  const pNorm = new Float32Array(len);
  for (let i = 0; i < len; i += 1) {
    pNorm[i] = bilinear[i] / 255;
  }

  const scale = Math.max(dstW / Math.max(1, srcW), dstH / Math.max(1, srcH));
  const radius = Math.max(3, Math.min(12, Math.round(scale * 3.5)));
  const q = guidedFilterMask(fullRgba, pNorm, dstW, dstH, radius, 1e-3);

  const out = new Uint8ClampedArray(len);
  for (let i = 0; i < len; i += 1) {
    const bVal = bilinear[i];
    if (bVal >= 252) {
      out[i] = 255;
    } else if (bVal <= 3) {
      out[i] = 0;
    } else {
      // Crisp smoothstep contrast in the upsampled edge band
      const stretched = Math.max(0, Math.min(1, (q[i] - 0.5) * 1.15 + 0.5));
      out[i] = Math.round(stretched * 255);
    }
  }
  return out;
}

/**
 * Keep the largest connected foreground component (plus any major non-tiny object >= 18% of largest)
 * while removing stray background specks.
 */
export function keepPrimarySubjectComponents(
  mask: Uint8ClampedArray,
  width: number,
  height: number
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(mask);
  const total = width * height;
  const visited = new Uint8Array(total);
  const queue = new Int32Array(total);
  const components: Int32Array[] = [];
  let maxLen = 0;

  for (let i = 0; i < total; i += 1) {
    if (out[i] >= 128 && !visited[i]) {
      let head = 0;
      let tail = 0;
      visited[i] = 1;
      queue[tail++] = i;
      while (head < tail) {
        const idx = queue[head++];
        const x = idx % width;
        const y = (idx - x) / width;
        if (x > 0 && !visited[idx - 1] && out[idx - 1] >= 128) {
          visited[idx - 1] = 1;
          queue[tail++] = idx - 1;
        }
        if (x + 1 < width && !visited[idx + 1] && out[idx + 1] >= 128) {
          visited[idx + 1] = 1;
          queue[tail++] = idx + 1;
        }
        if (y > 0 && !visited[idx - width] && out[idx - width] >= 128) {
          visited[idx - width] = 1;
          queue[tail++] = idx - width;
        }
        if (y + 1 < height && !visited[idx + width] && out[idx + width] >= 128) {
          visited[idx + width] = 1;
          queue[tail++] = idx + width;
        }
      }
      if (tail > maxLen) maxLen = tail;
      components.push(queue.slice(0, tail));
    }
  }

  if (components.length <= 1) return out;

  const keepThreshold = Math.max(64, Math.floor(maxLen * 0.2));
  for (const comp of components) {
    if (comp.length < maxLen && comp.length < keepThreshold) {
      for (let k = 0; k < comp.length; k += 1) {
        out[comp[k]] = 0;
      }
    }
  }

  return out;
}

export function upscaleMaskBilinear(
  srcMask: Uint8ClampedArray | Uint8Array,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number
): Uint8ClampedArray {
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
      out[dstRow + x] = Math.round(top + (bot - top) * dy);
    }
  }

  return out;
}

function boxBlur1D(
  src: Float32Array,
  dst: Float32Array,
  width: number,
  height: number,
  radius: number,
  horizontal: boolean
): void {
  const windowSize = radius * 2 + 1;
  if (horizontal) {
    for (let y = 0; y < height; y += 1) {
      const row = y * width;
      let sum = 0;
      for (let k = -radius; k <= radius; k += 1) {
        const cx = Math.max(0, Math.min(width - 1, k));
        sum += src[row + cx];
      }
      for (let x = 0; x < width; x += 1) {
        dst[row + x] = sum / windowSize;
        const leftIdx = Math.max(0, x - radius);
        const rightIdx = Math.min(width - 1, x + radius + 1);
        sum += src[row + rightIdx] - src[row + leftIdx];
      }
    }
  } else {
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      for (let k = -radius; k <= radius; k += 1) {
        const cy = Math.max(0, Math.min(height - 1, k));
        sum += src[cy * width + x];
      }
      for (let y = 0; y < height; y += 1) {
        dst[y * width + x] = sum / windowSize;
        const topIdx = Math.max(0, y - radius);
        const botIdx = Math.min(height - 1, y + radius + 1);
        sum += src[botIdx * width + x] - src[topIdx * width + x];
      }
    }
  }
}

export function blurMaskFloat(
  mask: Uint8ClampedArray | Float32Array,
  width: number,
  height: number,
  radiusPx: number
): Float32Array {
  const len = width * height;
  const a = new Float32Array(len);
  for (let i = 0; i < len; i += 1) a[i] = mask[i];
  const r = Math.max(0, Math.round(radiusPx));
  if (r === 0) return a;

  const b = new Float32Array(len);
  const subR = Math.max(1, Math.round(r / 2));
  for (let pass = 0; pass < 2; pass += 1) {
    boxBlur1D(a, b, width, height, subR, true);
    boxBlur1D(b, a, width, height, subR, false);
  }
  return a;
}

export function applyFeather(
  mask: Uint8ClampedArray,
  width: number,
  height: number,
  featherPx: number
): Uint8ClampedArray {
  if (featherPx <= 0) return new Uint8ClampedArray(mask);
  const blurred = blurMaskFloat(mask, width, height, featherPx);
  const out = new Uint8ClampedArray(mask.length);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = Math.max(0, Math.min(255, Math.round(blurred[i])));
  }
  return out;
}

export function applyMorphology(
  mask: Uint8ClampedArray,
  width: number,
  height: number,
  shiftPx: number
): Uint8ClampedArray {
  const r = Math.round(Math.abs(shiftPx));
  if (r === 0) return new Uint8ClampedArray(mask);

  const isDilate = shiftPx > 0;
  const temp = new Uint8ClampedArray(mask.length);
  const out = new Uint8ClampedArray(mask.length);

  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    for (let x = 0; x < width; x += 1) {
      const start = Math.max(0, x - r);
      const end = Math.min(width - 1, x + r);
      let extreme = isDilate ? 0 : 255;
      for (let k = start; k <= end; k += 1) {
        const val = mask[row + k];
        if (isDilate ? val > extreme : val < extreme) extreme = val;
      }
      temp[row + x] = extreme;
    }
  }

  for (let y = 0; y < height; y += 1) {
    const start = Math.max(0, y - r);
    const end = Math.min(height - 1, y + r);
    const dstRow = y * width;
    for (let x = 0; x < width; x += 1) {
      let extreme = isDilate ? 0 : 255;
      for (let k = start; k <= end; k += 1) {
        const val = temp[k * width + x];
        if (isDilate ? val > extreme : val < extreme) extreme = val;
      }
      out[dstRow + x] = extreme;
    }
  }

  return out;
}

export function smoothEdges(
  mask: Uint8ClampedArray,
  width: number,
  height: number,
  radius = 2
): Uint8ClampedArray {
  if (radius <= 0) return new Uint8ClampedArray(mask);
  const blurred = blurMaskFloat(mask, width, height, radius);
  const out = new Uint8ClampedArray(mask.length);
  for (let i = 0; i < out.length; i += 1) {
    const v = blurred[i];
    const contrasted = (v - 128) * 1.65 + 128;
    out[i] = Math.max(0, Math.min(255, Math.round(contrasted)));
  }
  return out;
}

export function fillHoles(
  mask: Uint8ClampedArray,
  width: number,
  height: number,
  maxHoleRatio = 0.05
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(mask);
  const total = width * height;
  const visited = new Uint8Array(total);
  const queue = new Int32Array(total);
  let head = 0;
  let tail = 0;

  for (let x = 0; x < width; x += 1) {
    const top = x;
    const bot = (height - 1) * width + x;
    if (out[top] < 128 && !visited[top]) {
      visited[top] = 1;
      queue[tail++] = top;
    }
    if (out[bot] < 128 && !visited[bot]) {
      visited[bot] = 1;
      queue[tail++] = bot;
    }
  }
  for (let y = 1; y < height - 1; y += 1) {
    const left = y * width;
    const right = y * width + width - 1;
    if (out[left] < 128 && !visited[left]) {
      visited[left] = 1;
      queue[tail++] = left;
    }
    if (out[right] < 128 && !visited[right]) {
      visited[right] = 1;
      queue[tail++] = right;
    }
  }

  while (head < tail) {
    const idx = queue[head++];
    const x = idx % width;
    const y = (idx - x) / width;

    if (x > 0 && !visited[idx - 1] && out[idx - 1] < 128) {
      visited[idx - 1] = 1;
      queue[tail++] = idx - 1;
    }
    if (x + 1 < width && !visited[idx + 1] && out[idx + 1] < 128) {
      visited[idx + 1] = 1;
      queue[tail++] = idx + 1;
    }
    if (y > 0 && !visited[idx - width] && out[idx - width] < 128) {
      visited[idx - width] = 1;
      queue[tail++] = idx - width;
    }
    if (y + 1 < height && !visited[idx + width] && out[idx + width] < 128) {
      visited[idx + width] = 1;
      queue[tail++] = idx + width;
    }
  }

  const maxHolePixels = Math.max(64, Math.floor(total * maxHoleRatio));
  const compQueue = new Int32Array(total);
  for (let i = 0; i < total; i += 1) {
    if (out[i] < 128 && !visited[i]) {
      let cHead = 0;
      let cTail = 0;
      visited[i] = 1;
      compQueue[cTail++] = i;
      while (cHead < cTail) {
        const idx = compQueue[cHead++];
        const x = idx % width;
        const y = (idx - x) / width;
        if (x > 0 && !visited[idx - 1] && out[idx - 1] < 128) {
          visited[idx - 1] = 1;
          compQueue[cTail++] = idx - 1;
        }
        if (x + 1 < width && !visited[idx + 1] && out[idx + 1] < 128) {
          visited[idx + 1] = 1;
          compQueue[cTail++] = idx + 1;
        }
        if (y > 0 && !visited[idx - width] && out[idx - width] < 128) {
          visited[idx - width] = 1;
          compQueue[cTail++] = idx - width;
        }
        if (y + 1 < height && !visited[idx + width] && out[idx + width] < 128) {
          visited[idx + width] = 1;
          compQueue[cTail++] = idx + width;
        }
      }
      if (cTail <= maxHolePixels) {
        for (let k = 0; k < cTail; k += 1) {
          out[compQueue[k]] = 255;
        }
      }
    }
  }

  return out;
}

export function removeSpecks(
  mask: Uint8ClampedArray,
  width: number,
  height: number,
  minAreaRatio = 0.0015
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(mask);
  const total = width * height;
  const visited = new Uint8Array(total);
  const queue = new Int32Array(total);
  const minArea = Math.max(32, Math.floor(total * minAreaRatio));

  const components: Int32Array[] = [];
  let maxLen = 0;

  for (let i = 0; i < total; i += 1) {
    if (out[i] >= 128 && !visited[i]) {
      let head = 0;
      let tail = 0;
      visited[i] = 1;
      queue[tail++] = i;
      while (head < tail) {
        const idx = queue[head++];
        const x = idx % width;
        const y = (idx - x) / width;
        if (x > 0 && !visited[idx - 1] && out[idx - 1] >= 128) {
          visited[idx - 1] = 1;
          queue[tail++] = idx - 1;
        }
        if (x + 1 < width && !visited[idx + 1] && out[idx + 1] >= 128) {
          visited[idx + 1] = 1;
          queue[tail++] = idx + 1;
        }
        if (y > 0 && !visited[idx - width] && out[idx - width] >= 128) {
          visited[idx - width] = 1;
          queue[tail++] = idx - width;
        }
        if (y + 1 < height && !visited[idx + width] && out[idx + width] >= 128) {
          visited[idx + width] = 1;
          queue[tail++] = idx + width;
        }
      }
      if (tail > maxLen) maxLen = tail;
      components.push(queue.slice(0, tail));
    }
  }

  for (const comp of components) {
    if (comp.length < minArea && comp.length < maxLen) {
      for (let k = 0; k < comp.length; k += 1) {
        out[comp[k]] = 0;
      }
    }
  }

  return out;
}

/**
 * Distance-transform nearest-foreground color propagation for edge decontamination
 * (+ optional green/blue spill suppression).
 */
export function decontaminateColors(
  rgba: Uint8ClampedArray,
  mask: Uint8ClampedArray,
  width: number,
  height: number,
  _passes = 6,
  spillMode: 'green' | 'blue' | null = null
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(rgba);
  const total = width * height;
  const dist = new Float32Array(total);
  const srcR = new Uint8ClampedArray(total);
  const srcG = new Uint8ClampedArray(total);
  const srcB = new Uint8ClampedArray(total);

  const INF = 1e9;
  for (let i = 0, p = 0; i < total; i += 1, p += 4) {
    if (mask[i] >= 245) {
      dist[i] = 0;
      srcR[i] = rgba[p];
      srcG[i] = rgba[p + 1];
      srcB[i] = rgba[p + 2];
    } else {
      dist[i] = INF;
    }
  }

  // Forward pass (top-left -> bottom-right) with Chamfer distances (1.0 axial, 1.414 diag)
  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    for (let x = 0; x < width; x += 1) {
      const i = row + x;
      let d = dist[i];
      if (d === 0) continue;
      let bestIdx = -1;
      if (x > 0 && dist[i - 1] + 1 < d) {
        d = dist[i - 1] + 1;
        bestIdx = i - 1;
      }
      if (y > 0) {
        const up = i - width;
        if (dist[up] + 1 < d) {
          d = dist[up] + 1;
          bestIdx = up;
        }
        if (x > 0 && dist[up - 1] + 1.414 < d) {
          d = dist[up - 1] + 1.414;
          bestIdx = up - 1;
        }
        if (x + 1 < width && dist[up + 1] + 1.414 < d) {
          d = dist[up + 1] + 1.414;
          bestIdx = up + 1;
        }
      }
      if (bestIdx >= 0) {
        dist[i] = d;
        srcR[i] = srcR[bestIdx];
        srcG[i] = srcG[bestIdx];
        srcB[i] = srcB[bestIdx];
      }
    }
  }

  // Backward pass (bottom-right -> top-left)
  for (let y = height - 1; y >= 0; y -= 1) {
    const row = y * width;
    for (let x = width - 1; x >= 0; x -= 1) {
      const i = row + x;
      let d = dist[i];
      if (d === 0) continue;
      let bestIdx = -1;
      if (x + 1 < width && dist[i + 1] + 1 < d) {
        d = dist[i + 1] + 1;
        bestIdx = i + 1;
      }
      if (y + 1 < height) {
        const dn = i + width;
        if (dist[dn] + 1 < d) {
          d = dist[dn] + 1;
          bestIdx = dn;
        }
        if (x + 1 < width && dist[dn + 1] + 1.414 < d) {
          d = dist[dn + 1] + 1.414;
          bestIdx = dn + 1;
        }
        if (x > 0 && dist[dn - 1] + 1.414 < d) {
          d = dist[dn - 1] + 1.414;
          bestIdx = dn - 1;
        }
      }
      if (bestIdx >= 0) {
        dist[i] = d;
        srcR[i] = srcR[bestIdx];
        srcG[i] = srcG[bestIdx];
        srcB[i] = srcB[bestIdx];
      }
    }
  }

  // Replace edge pixels (0 < alpha < 255) with nearest foreground interior color + spill suppression
  for (let i = 0, p = 0; i < total; i += 1, p += 4) {
    const m = mask[i];
    if (m > 0 && m < 250 && dist[i] < INF * 0.5) {
      const blend = Math.min(1, (1 - m / 255) * 1.15);
      let nr = Math.round(out[p] * (1 - blend) + srcR[i] * blend);
      let ng = Math.round(out[p + 1] * (1 - blend) + srcG[i] * blend);
      let nb = Math.round(out[p + 2] * (1 - blend) + srcB[i] * blend);

      if (spillMode === 'green') {
        const limit = Math.max(nr, nb);
        if (ng > limit) {
          ng = Math.round(limit * 0.92 + ng * 0.08);
        }
      } else if (spillMode === 'blue') {
        const limit = Math.max(nr, ng);
        if (nb > limit) {
          nb = Math.round(limit * 0.92 + nb * 0.08);
        }
      }

      out[p] = nr;
      out[p + 1] = ng;
      out[p + 2] = nb;
    }
  }

  return out;
}

/**
 * Classical trimap + local Foreground/Background color-line matting blended with guided filtering
 * to cleanly extract fine hair strands and fur along uncertain boundaries.
 */
export function refineHairAndFur(
  rgba: Uint8ClampedArray,
  mask: Uint8ClampedArray,
  width: number,
  height: number,
  radius = 6
): Uint8ClampedArray {
  const len = width * height;
  const eroded = applyMorphology(mask, width, height, -5);
  const dilated = applyMorphology(mask, width, height, 7);

  // Propagate nearest definite foreground and background RGB samples into the uncertain trimap band
  const fgR = new Float32Array(len);
  const fgG = new Float32Array(len);
  const fgB = new Float32Array(len);
  const bgR = new Float32Array(len);
  const bgG = new Float32Array(len);
  const bgB = new Float32Array(len);
  const fgKnown = new Uint8Array(len);
  const bgKnown = new Uint8Array(len);

  for (let i = 0, p = 0; i < len; i += 1, p += 4) {
    if (eroded[i] >= 240) {
      fgKnown[i] = 1;
      fgR[i] = rgba[p];
      fgG[i] = rgba[p + 1];
      fgB[i] = rgba[p + 2];
    }
    if (dilated[i] <= 15) {
      bgKnown[i] = 1;
      bgR[i] = rgba[p];
      bgG[i] = rgba[p + 1];
      bgB[i] = rgba[p + 2];
    }
  }

  const offsets = [-1, 1, -width, width, -width - 1, -width + 1, width - 1, width + 1];
  const propagateColor = (
    cR: Float32Array,
    cG: Float32Array,
    cB: Float32Array,
    known: Uint8Array,
    passes: number
  ) => {
    const nextK = new Uint8Array(known);
    for (let pass = 0; pass < passes; pass += 1) {
      let any = false;
      for (let y = 1; y < height - 1; y += 1) {
        const row = y * width;
        for (let x = 1; x < width - 1; x += 1) {
          const idx = row + x;
          if (known[idx] || (eroded[idx] >= 240 && dilated[idx] <= 15)) continue;
          let sr = 0;
          let sg = 0;
          let sb = 0;
          let cnt = 0;
          for (let k = 0; k < 8; k += 1) {
            const n = idx + offsets[k];
            if (known[n]) {
              sr += cR[n];
              sg += cG[n];
              sb += cB[n];
              cnt += 1;
            }
          }
          if (cnt > 0) {
            cR[idx] = sr / cnt;
            cG[idx] = sg / cnt;
            cB[idx] = sb / cnt;
            nextK[idx] = 1;
            any = true;
          }
        }
      }
      known.set(nextK);
      if (!any) break;
    }
  };

  propagateColor(fgR, fgG, fgB, fgKnown, 12);
  propagateColor(bgR, bgG, bgB, bgKnown, 12);

  // Guided filter on luminance + mask
  const guide = new Float32Array(len);
  const pArr = new Float32Array(len);
  const ii = new Float32Array(len);
  const ip = new Float32Array(len);

  for (let idx = 0; idx < len; idx += 1) {
    const o = idx * 4;
    const g = (0.299 * rgba[o] + 0.587 * rgba[o + 1] + 0.114 * rgba[o + 2]) / 255;
    let m = mask[idx] / 255;
    if (eroded[idx] < 240 && dilated[idx] > 15 && fgKnown[idx] && bgKnown[idx]) {
      const dfR = fgR[idx] - bgR[idx];
      const dfG = fgG[idx] - bgG[idx];
      const dfB = fgB[idx] - bgB[idx];
      const denom = dfR * dfR + dfG * dfG + dfB * dfB;
      if (denom > 140) {
        const num =
          (rgba[o] - bgR[idx]) * dfR +
          (rgba[o + 1] - bgG[idx]) * dfG +
          (rgba[o + 2] - bgB[idx]) * dfB;
        const colorLineAlpha = Math.max(0, Math.min(1, num / denom));
        m = colorLineAlpha * 0.65 + m * 0.35;
      }
    }
    guide[idx] = g;
    pArr[idx] = m;
    ii[idx] = g * g;
    ip[idx] = g * m;
  }

  const meanI = blurMaskFloat(guide, width, height, radius);
  const meanP = blurMaskFloat(pArr, width, height, radius);
  const meanII = blurMaskFloat(ii, width, height, radius);
  const meanIP = blurMaskFloat(ip, width, height, radius);

  const eps = 0.0022;
  const aArr = new Float32Array(len);
  const bArr = new Float32Array(len);

  for (let idx = 0; idx < len; idx += 1) {
    const varI = Math.max(0, meanII[idx] - meanI[idx] * meanI[idx]);
    const covIP = meanIP[idx] - meanI[idx] * meanP[idx];
    const a = covIP / (varI + eps);
    const b = meanP[idx] - a * meanI[idx];
    aArr[idx] = a;
    bArr[idx] = b;
  }

  const meanA = blurMaskFloat(aArr, width, height, radius);
  const meanB = blurMaskFloat(bArr, width, height, radius);

  const out = new Uint8ClampedArray(mask);
  for (let idx = 0; idx < len; idx += 1) {
    if (eroded[idx] >= 245) {
      out[idx] = 255;
    } else if (dilated[idx] <= 10) {
      out[idx] = 0;
    } else {
      const q = meanA[idx] * guide[idx] + meanB[idx];
      const blended = q * 0.55 + pArr[idx] * 0.45;
      const stretched = (blended - 0.5) * 1.18 + 0.5;
      out[idx] = Math.max(0, Math.min(255, Math.round(stretched * 255)));
    }
  }

  return out;
}

export function applyRefinePipeline(
  rgba: Uint8ClampedArray,
  baseMask: Uint8ClampedArray,
  width: number,
  height: number,
  settings: RefineSettings,
  spillMode: 'green' | 'blue' | null = null
): { mask: Uint8ClampedArray; rgba: Uint8ClampedArray } {
  let nextMask: Uint8ClampedArray = new Uint8ClampedArray(baseMask);

  if (settings.hairMatting) {
    nextMask = refineHairAndFur(rgba, nextMask, width, height);
  }
  if (settings.shiftPx !== 0) {
    nextMask = applyMorphology(nextMask, width, height, settings.shiftPx);
  }
  if (settings.smoothRadius > 0) {
    nextMask = smoothEdges(nextMask, width, height, settings.smoothRadius);
  }
  if (settings.featherPx > 0) {
    nextMask = applyFeather(nextMask, width, height, settings.featherPx);
  }

  const nextRgba = settings.decontaminate
    ? decontaminateColors(rgba, nextMask, width, height, 6, spillMode)
    : rgba;

  return { mask: nextMask, rgba: nextRgba };
}

/**
 * Edge-snapping brush: performs a local flood inside the brush radius limited to pixels whose
 * CIELAB color is within `tolerance` Delta E of the reference pixel sampled on the first dab.
 */
export function applyEdgeSnappingBrushDab(
  rgba: Uint8ClampedArray,
  mask: Uint8ClampedArray,
  width: number,
  height: number,
  cx: number,
  cy: number,
  radius: number,
  mode: 'restore' | 'erase',
  strength: number,
  hardness: number,
  refLab: [number, number, number],
  tolerance: number
): void {
  const minX = Math.max(0, Math.floor(cx - radius));
  const maxX = Math.min(width - 1, Math.ceil(cx + radius));
  const minY = Math.max(0, Math.floor(cy - radius));
  const maxY = Math.min(height - 1, Math.ceil(cy + radius));

  const boxW = maxX - minX + 1;
  const boxH = maxY - minY + 1;
  if (boxW <= 0 || boxH <= 0) return;

  const rSq = Math.max(1, radius * radius);
  const maxLabSq = tolerance * tolerance;
  const hardRatio = Math.max(0, Math.min(0.98, hardness / 100));
  const opacity = Math.max(0.01, Math.min(1, strength / 100));

  // Find starting seeds inside inner third of dab that match refLab (so dragging across edges stays locked)
  const visited = new Uint8Array(boxW * boxH);
  const queue = new Int32Array(boxW * boxH);
  let head = 0;
  let tail = 0;

  const seedRadSq = Math.max(4, (radius * 0.35) * (radius * 0.35));
  for (let y = minY; y <= maxY; y += 1) {
    const dy = y - cy;
    for (let x = minX; x <= maxX; x += 1) {
      const dx = x - cx;
      if (dx * dx + dy * dy > seedRadSq) continue;
      const p = (y * width + x) * 4;
      const [l, a, b] = rgbToLab(rgba[p], rgba[p + 1], rgba[p + 2]);
      if (deltaELabSq(l, a, b, refLab[0], refLab[1], refLab[2]) <= maxLabSq) {
        const localIdx = (y - minY) * boxW + (x - minX);
        if (!visited[localIdx]) {
          visited[localIdx] = 1;
          queue[tail++] = localIdx;
        }
      }
    }
  }

  // Fallback to center pixel if no inner pixels matched strictly
  if (tail === 0) {
    const ix = Math.max(minX, Math.min(maxX, Math.round(cx)));
    const iy = Math.max(minY, Math.min(maxY, Math.round(cy)));
    const p = (iy * width + ix) * 4;
    const [l, a, b] = rgbToLab(rgba[p], rgba[p + 1], rgba[p + 2]);
    if (deltaELabSq(l, a, b, refLab[0], refLab[1], refLab[2]) <= maxLabSq * 1.4) {
      const localIdx = (iy - minY) * boxW + (ix - minX);
      visited[localIdx] = 1;
      queue[tail++] = localIdx;
    }
  }

  while (head < tail) {
    const localIdx = queue[head++];
    const lx = localIdx % boxW;
    const ly = (localIdx - lx) / boxW;
    const gx = minX + lx;
    const gy = minY + ly;

    const dx = gx - cx;
    const dy = gy - cy;
    const distSq = dx * dx + dy * dy;
    const normDist = Math.sqrt(distSq) / Math.max(radius, 0.5);
    const falloff =
      normDist <= hardRatio
        ? 1
        : Math.max(0, 1 - (normDist - hardRatio) / Math.max(0.02, 1 - hardRatio));

    const w = falloff * opacity;
    const imgIdx = gy * width + gx;
    if (mode === 'restore') {
      mask[imgIdx] = Math.min(255, Math.round(mask[imgIdx] + (255 - mask[imgIdx]) * w));
    } else {
      mask[imgIdx] = Math.max(0, Math.round(mask[imgIdx] * (1 - w)));
    }

    const dirs = [
      lx > 0 ? localIdx - 1 : -1,
      lx + 1 < boxW ? localIdx + 1 : -1,
      ly > 0 ? localIdx - boxW : -1,
      ly + 1 < boxH ? localIdx + boxW : -1,
    ];

    for (let k = 0; k < 4; k += 1) {
      const nLocal = dirs[k];
      if (nLocal < 0 || visited[nLocal]) continue;
      const nlx = nLocal % boxW;
      const nly = (nLocal - nlx) / boxW;
      const ngx = minX + nlx;
      const ngy = minY + nly;
      const ndx = ngx - cx;
      const ndy = ngy - cy;
      if (ndx * ndx + ndy * ndy > rSq) continue;

      const p = (ngy * width + ngx) * 4;
      const [l, a, b] = rgbToLab(rgba[p], rgba[p + 1], rgba[p + 2]);
      if (deltaELabSq(l, a, b, refLab[0], refLab[1], refLab[2]) <= maxLabSq) {
        visited[nLocal] = 1;
        queue[tail++] = nLocal;
      }
    }
  }
}

export function applyStandardBrushDab(
  mask: Uint8ClampedArray,
  width: number,
  height: number,
  cx: number,
  cy: number,
  radius: number,
  mode: 'restore' | 'erase',
  strength: number,
  hardness: number
): void {
  const minX = Math.max(0, Math.floor(cx - radius));
  const maxX = Math.min(width - 1, Math.ceil(cx + radius));
  const minY = Math.max(0, Math.floor(cy - radius));
  const maxY = Math.min(height - 1, Math.ceil(cy + radius));

  const rSq = Math.max(0.25, radius * radius);
  const hardRatio = Math.max(0, Math.min(0.99, hardness / 100));
  const opacity = Math.max(0.01, Math.min(1, strength / 100));

  for (let y = minY; y <= maxY; y += 1) {
    const dy = y - cy;
    const row = y * width;
    for (let x = minX; x <= maxX; x += 1) {
      const dx = x - cx;
      const distSq = dx * dx + dy * dy;
      if (distSq > rSq) continue;

      const normDist = Math.sqrt(distSq) / Math.max(radius, 0.5);
      const falloff =
        normDist <= hardRatio
          ? 1
          : Math.max(0, 1 - (normDist - hardRatio) / Math.max(0.01, 1 - hardRatio));

      const w = falloff * opacity;
      const idx = row + x;
      if (mode === 'restore') {
        const next = mask[idx] + (255 - mask[idx]) * w;
        mask[idx] = Math.min(255, Math.round(next));
      } else {
        const next = mask[idx] * (1 - w);
        mask[idx] = Math.max(0, Math.round(next));
      }
    }
  }
}

/**
 * Magic Wand in CIELAB color space (Delta E tolerance), supporting contiguous flood fill or global match.
 */
export function magicWandSelectLab(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  seedX: number,
  seedY: number,
  toleranceDeltaE: number,
  contiguous: boolean
): Uint8ClampedArray {
  const total = width * height;
  const selection = new Uint8ClampedArray(total);
  const sx = Math.max(0, Math.min(width - 1, Math.round(seedX)));
  const sy = Math.max(0, Math.min(height - 1, Math.round(seedY)));
  const seedIdx = sy * width + sx;
  const sp = seedIdx * 4;
  const [sl, sa, sb] = rgbToLab(rgba[sp], rgba[sp + 1], rgba[sp + 2]);
  const maxDistSq = toleranceDeltaE * toleranceDeltaE;

  if (!contiguous) {
    for (let i = 0; i < total; i += 1) {
      const p = i * 4;
      const [l, a, b] = rgbToLab(rgba[p], rgba[p + 1], rgba[p + 2]);
      if (deltaELabSq(l, a, b, sl, sa, sb) <= maxDistSq) {
        selection[i] = 255;
      }
    }
    return selection;
  }

  const visited = new Uint8Array(total);
  const queue = new Int32Array(total);
  let head = 0;
  let tail = 0;

  visited[seedIdx] = 1;
  selection[seedIdx] = 255;
  queue[tail++] = seedIdx;

  while (head < tail) {
    const idx = queue[head++];
    const x = idx % width;
    const y = (idx - x) / width;

    const neighbors = [
      x > 0 ? idx - 1 : -1,
      x + 1 < width ? idx + 1 : -1,
      y > 0 ? idx - width : -1,
      y + 1 < height ? idx + width : -1,
    ];

    for (let k = 0; k < 4; k += 1) {
      const n = neighbors[k];
      if (n < 0 || visited[n]) continue;
      visited[n] = 1;
      const p = n * 4;
      const [l, a, b] = rgbToLab(rgba[p], rgba[p + 1], rgba[p + 2]);
      if (deltaELabSq(l, a, b, sl, sa, sb) <= maxDistSq) {
        selection[n] = 255;
        queue[tail++] = n;
      }
    }
  }

  return selection;
}

/**
 * Global CIELAB Color Key selection with smooth softness ramp.
 */
export function colorKeySelectLab(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  keyRgb: [number, number, number],
  toleranceDeltaE: number,
  softnessDeltaE: number
): Uint8ClampedArray {
  const total = width * height;
  const selection = new Uint8ClampedArray(total);
  const [kl, ka, kb] = rgbToLab(keyRgb[0], keyRgb[1], keyRgb[2]);

  const tol = Math.max(1, toleranceDeltaE);
  const soft = Math.max(0, softnessDeltaE);
  const low = Math.max(0, tol - soft * 0.25);
  const high = tol + soft * 0.75;
  const span = Math.max(0.001, high - low);

  for (let i = 0, p = 0; i < total; i += 1, p += 4) {
    const [l, a, b] = rgbToLab(rgba[p], rgba[p + 1], rgba[p + 2]);
    const dist = Math.sqrt(deltaELabSq(l, a, b, kl, ka, kb));
    if (dist <= low) {
      selection[i] = 255;
    } else if (dist < high) {
      const t = 1 - (dist - low) / span;
      selection[i] = Math.round(t * t * (3 - 2 * t) * 255);
    }
  }

  return selection;
}

export function combineSelections(
  current: Uint8ClampedArray | null,
  incoming: Uint8ClampedArray,
  mode: SelectionCombineMode
): Uint8ClampedArray {
  if (!current || mode === 'replace') {
    return new Uint8ClampedArray(incoming);
  }
  const out = new Uint8ClampedArray(current.length);
  for (let i = 0; i < out.length; i += 1) {
    if (mode === 'add') {
      out[i] = Math.max(current[i], incoming[i]);
    } else if (mode === 'subtract') {
      out[i] = Math.max(0, current[i] - incoming[i]);
    } else {
      out[i] = Math.min(current[i], incoming[i]);
    }
  }
  return out;
}

export function applySelectionToMask(
  mask: Uint8ClampedArray,
  selection: Uint8ClampedArray,
  action: 'keep' | 'remove'
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(mask);
  for (let i = 0; i < out.length; i += 1) {
    const s = selection[i] / 255;
    if (s <= 0) continue;
    if (action === 'keep') {
      out[i] = Math.round(out[i] + (255 - out[i]) * s);
    } else {
      out[i] = Math.round(out[i] * (1 - s));
    }
  }
  return out;
}

export function compressMaskRLE(mask: Uint8ClampedArray): Uint8Array {
  const chunks: number[] = [];
  let i = 0;
  const len = mask.length;

  while (i < len) {
    const val = mask[i];
    let run = 1;
    while (i + run < len && mask[i + run] === val && run < 65535) {
      run += 1;
    }
    chunks.push((run >> 8) & 0xff, run & 0xff, val);
    i += run;
  }

  return new Uint8Array(chunks);
}

export function decompressMaskRLE(compressed: Uint8Array, expectedLength: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(expectedLength);
  let outIdx = 0;
  for (let i = 0; i + 2 < compressed.length && outIdx < expectedLength; i += 3) {
    const run = (compressed[i] << 8) | compressed[i + 1];
    const val = compressed[i + 2];
    const end = Math.min(expectedLength, outIdx + run);
    out.fill(val, outIdx, end);
    outIdx = end;
  }
  return out;
}
