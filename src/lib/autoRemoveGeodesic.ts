/**
 * Geodesic background model + interior background recovery.
 * Drop-in helpers for runAutoRemovePipeline (see integration notes).
 */

function otsuThreshold(values: Float32Array, maxV: number, bins = 64): number {
  const hist = new Float64Array(bins);
  const scale = (bins - 1) / maxV;
  for (let i = 0; i < values.length; i += 1) {
    const v = values[i] > maxV ? maxV : values[i];
    hist[Math.round(v * scale)] += 1;
  }
  const total = values.length;
  let sumAll = 0;
  for (let i = 0; i < bins; i += 1) sumAll += i * hist[i];
  let wB = 0;
  let sumB = 0;
  let best = 0;
  let bestT = 0;
  for (let t = 0; t < bins; t += 1) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sumAll - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) {
      best = between;
      bestT = t;
    }
  }
  return bestT / scale;
}

/**
 * Minimum-cost path from background seeds. Walking through background-coloured,
 * low-gradient pixels is free; crossing the subject (high colour distance or a strong
 * edge) accumulates cost. Concave subjects and enclosed bg regions are separated
 * correctly, which a convex-hull prior cannot do.
 */
export function geodesicBackgroundCost(
  distMap: Float32Array,
  normG: Float32Array,
  existingAlpha: Uint8ClampedArray,
  seeds: Uint8Array,
  w: number,
  h: number,
  tFg: number,
  edgeBarrier: number,
  gradWeight = 2.0
): Float32Array {
  const len = w * h;
  const cost = new Float32Array(len).fill(Infinity);
  const hk: number[] = [];
  const hi: number[] = [];

  const push = (k: number, i: number) => {
    let c = hk.length;
    hk.push(k);
    hi.push(i);
    while (c > 0) {
      const p = (c - 1) >> 1;
      if (hk[p] <= k) break;
      hk[c] = hk[p];
      hi[c] = hi[p];
      c = p;
    }
    hk[c] = k;
    hi[c] = i;
  };
  const pop = (): [number, number] => {
    const rk = hk[0];
    const ri = hi[0];
    const lk = hk.pop()!;
    const li = hi.pop()!;
    const n = hk.length;
    if (n > 0) {
      let c = 0;
      for (;;) {
        let ch = 2 * c + 1;
        if (ch >= n) break;
        if (ch + 1 < n && hk[ch + 1] < hk[ch]) ch += 1;
        if (hk[ch] >= lk) break;
        hk[c] = hk[ch];
        hi[c] = hi[ch];
        c = ch;
      }
      hk[c] = lk;
      hi[c] = li;
    }
    return [rk, ri];
  };

  for (let i = 0; i < len; i += 1) {
    if (seeds[i]) {
      cost[i] = 0;
      push(0, i);
    }
  }

  const gradSpan = Math.max(1e-3, 1 - edgeBarrier);
  const dx = [-1, 1, 0, 0, -1, 1, -1, 1];
  const dy = [0, 0, -1, 1, -1, -1, 1, 1];

  while (hk.length > 0) {
    const [k, idx] = pop();
    if (k > cost[idx]) continue;
    const x = idx % w;
    const y = (idx - x) / w;
    for (let d = 0; d < 8; d += 1) {
      const nx = x + dx[d];
      const ny = y + dy[d];
      if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
      const n = ny * w + nx;
      let local = 0;
      if (existingAlpha[n] > 16) {
        const colorTerm = Math.max(0, Math.min(1.5, distMap[n] / tFg) - 0.4);
        const gradTerm = (gradWeight * Math.max(0, normG[n] - edgeBarrier)) / gradSpan;
        local = colorTerm + gradTerm;
      }
      const nc = k + (d >= 4 ? 1.414 : 1) * local;
      if (nc < cost[n]) {
        cost[n] = nc;
        push(nc, n);
      }
    }
  }
  return cost;
}

/** Foreground = pixels whose geodesic cost from the background exceeds an Otsu-adaptive cut. */
export function maskFromGeodesicCost(
  cost: Float32Array,
  sureFg: Uint8Array,
  toleranceScale: number
): Uint8ClampedArray {
  const maxV = 6;
  const t = Math.min(2.5, Math.max(0.4, otsuThreshold(cost, maxV))) * toleranceScale;
  const out = new Uint8ClampedArray(cost.length);
  for (let i = 0; i < cost.length; i += 1) {
    if (sureFg[i] || cost[i] > t) out[i] = 255;
  }
  return out;
}

/**
 * Clears enclosed regions that are background-coloured, flat, large enough and fully
 * ringed by foreground (gaps between arms, handle loops, ring interiors).
 * Only call when holes are meant to be kept open (preserveHoles or !fillHoles).
 */
export function removeInteriorBackground(
  mask: Uint8ClampedArray,
  distMap: Float32Array,
  normG: Float32Array,
  w: number,
  h: number,
  tLow: number,
  edgeBarrier: number,
  minAreaFrac = 0.003
): Uint8ClampedArray {
  const len = w * h;
  const out = new Uint8ClampedArray(mask);
  const cand = new Uint8Array(len);
  for (let i = 0; i < len; i += 1) {
    if (mask[i] >= 128 && distMap[i] <= tLow * 1.3 && normG[i] <= edgeBarrier) cand[i] = 1;
  }
  const minArea = Math.max(40, Math.floor(len * minAreaFrac));
  const seen = new Uint8Array(len);
  const queue = new Int32Array(len);
  const hiD = tLow * 1.3;

  for (let s = 0; s < len; s += 1) {
    if (!cand[s] || seen[s]) continue;
    let head = 0;
    let tail = 0;
    seen[s] = 1;
    queue[tail++] = s;
    let ringTotal = 0;
    let ringBg = 0;
    let ringHigh = 0;
    while (head < tail) {
      const idx = queue[head++];
      const x = idx % w;
      const y = (idx - x) / w;
      const nbrs = [
        x > 0 ? idx - 1 : -1,
        x + 1 < w ? idx + 1 : -1,
        y > 0 ? idx - w : -1,
        y + 1 < h ? idx + w : -1,
      ];
      for (const n of nbrs) {
        if (n < 0) {
          ringTotal += 1;
          ringBg += 1; // touches frame -> not enclosed
          continue;
        }
        if (cand[n]) {
          if (!seen[n]) {
            seen[n] = 1;
            queue[tail++] = n;
          }
        } else {
          ringTotal += 1;
          if (mask[n] < 128) ringBg += 1;
          else if (distMap[n] > hiD) ringHigh += 1;
        }
      }
    }
    if (
      tail >= minArea &&
      ringTotal > 0 &&
      ringBg / ringTotal <= 0.02 &&
      ringHigh / ringTotal >= 0.7
    ) {
      for (let k = 0; k < tail; k += 1) out[queue[k]] = 0;
    }
  }
  return out;
}
