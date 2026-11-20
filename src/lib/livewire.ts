/**
 * Classical Intelligent Scissors (Livewire) using Scharr edge gradient costs and Dijkstra shortest paths.
 * Runs deterministically on a downsampled proxy grid (<= 560 px long side) for real-time cursor snapping.
 */

export interface LivewirePoint {
  x: number;
  y: number;
}

const LIVEWIRE_MAX_SIDE = 560;

export class LivewireEngine {
  readonly srcW: number;
  readonly srcH: number;
  readonly gw: number;
  readonly gh: number;
  private readonly scaleX: number;
  private readonly scaleY: number;
  private readonly cost: Float32Array;
  private dist: Float32Array;
  private parent: Int32Array;
  private anchorGx = -1;
  private anchorGy = -1;

  constructor(rgba: Uint8ClampedArray, width: number, height: number) {
    this.srcW = width;
    this.srcH = height;
    const longest = Math.max(width, height);
    const ratio = longest > LIVEWIRE_MAX_SIDE ? LIVEWIRE_MAX_SIDE / longest : 1;
    this.gw = Math.max(16, Math.round(width * ratio));
    this.gh = Math.max(16, Math.round(height * ratio));
    this.scaleX = this.gw / width;
    this.scaleY = this.gh / height;

    const total = this.gw * this.gh;
    this.cost = new Float32Array(total);
    this.dist = new Float32Array(total);
    this.parent = new Int32Array(total);

    // Sample RGB/luminance at grid resolution
    const lum = new Float32Array(total);
    const rr = new Float32Array(total);
    const gg = new Float32Array(total);
    const bb = new Float32Array(total);

    for (let y = 0; y < this.gh; y += 1) {
      const sy = Math.min(height - 1, Math.floor((y + 0.5) / this.scaleY));
      for (let x = 0; x < this.gw; x += 1) {
        const sx = Math.min(width - 1, Math.floor((x + 0.5) / this.scaleX));
        const sp = (sy * width + sx) * 4;
        const r = rgba[sp];
        const g = rgba[sp + 1];
        const b = rgba[sp + 2];
        const idx = y * this.gw + x;
        rr[idx] = r;
        gg[idx] = g;
        bb[idx] = b;
        lum[idx] = 0.299 * r + 0.587 * g + 0.114 * b;
      }
    }

    // Scharr gradient magnitude across RGB + luminance
    const grad = new Float32Array(total);
    let maxGrad = 1;
    const gw = this.gw;
    const gh = this.gh;

    const scharrAt = (arr: Float32Array, x: number, y: number) => {
      const xm = x > 0 ? x - 1 : 0;
      const xp = x + 1 < gw ? x + 1 : gw - 1;
      const ym = y > 0 ? y - 1 : 0;
      const yp = y + 1 < gh ? y + 1 : gh - 1;

      const gx =
        3 * (arr[ym * gw + xp] - arr[ym * gw + xm]) +
        10 * (arr[y * gw + xp] - arr[y * gw + xm]) +
        3 * (arr[yp * gw + xp] - arr[yp * gw + xm]);

      const gy =
        3 * (arr[yp * gw + xm] - arr[ym * gw + xm]) +
        10 * (arr[yp * gw + x] - arr[ym * gw + x]) +
        3 * (arr[yp * gw + xp] - arr[ym * gw + xp]);

      return Math.hypot(gx, gy);
    };

    for (let y = 0; y < gh; y += 1) {
      for (let x = 0; x < gw; x += 1) {
        const idx = y * gw + x;
        const gMax = Math.max(
          scharrAt(lum, x, y),
          scharrAt(rr, x, y) * 0.75,
          scharrAt(gg, x, y) * 0.75,
          scharrAt(bb, x, y) * 0.75
        );
        grad[idx] = gMax;
        if (gMax > maxGrad) maxGrad = gMax;
      }
    }

    // Invert gradient into traversal cost: strong edges have near-zero cost, flat areas high cost
    for (let i = 0; i < total; i += 1) {
      const norm = grad[i] / maxGrad;
      const inv = 1 - Math.min(1, norm * 1.45);
      this.cost[i] = 0.04 + inv * inv * 12;
    }
  }

  private toGridX(x: number): number {
    return Math.max(0, Math.min(this.gw - 1, Math.round(x * this.scaleX)));
  }

  private toGridY(y: number): number {
    return Math.max(0, Math.min(this.gh - 1, Math.round(y * this.scaleY)));
  }

  private toSrcX(gx: number): number {
    return Math.max(0, Math.min(this.srcW - 1, (gx + 0.5) / this.scaleX));
  }

  private toSrcY(gy: number): number {
    return Math.max(0, Math.min(this.srcH - 1, (gy + 0.5) / this.scaleY));
  }

  /**
   * Computes shortest-path tree from anchor (x, y) across the edge-cost graph using Dijkstra.
   */
  setAnchor(srcX: number, srcY: number): void {
    const ax = this.toGridX(srcX);
    const ay = this.toGridY(srcY);
    if (ax === this.anchorGx && ay === this.anchorGy) return;

    this.anchorGx = ax;
    this.anchorGy = ay;

    const gw = this.gw;
    const gh = this.gh;
    const total = gw * gh;
    const dist = this.dist;
    const parent = this.parent;
    const cost = this.cost;

    dist.fill(Infinity);
    parent.fill(-1);

    const startIdx = ay * gw + ax;
    dist[startIdx] = 0;

    // Binary min-heap of [nodeIndex] ordered by dist[nodeIndex]
    const heap = new Int32Array(total + 4);
    const visited = new Uint8Array(total);
    let heapSize = 0;

    const push = (node: number) => {
      let i = heapSize;
      heapSize += 1;
      heap[i] = node;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (dist[heap[p]] <= dist[heap[i]]) break;
        const tmp = heap[p];
        heap[p] = heap[i];
        heap[i] = tmp;
        i = p;
      }
    };

    const pop = (): number => {
      const top = heap[0];
      heapSize -= 1;
      if (heapSize > 0) {
        heap[0] = heap[heapSize];
        let i = 0;
        while (true) {
          const l = (i << 1) + 1;
          const r = l + 1;
          let smallest = i;
          if (l < heapSize && dist[heap[l]] < dist[heap[smallest]]) smallest = l;
          if (r < heapSize && dist[heap[r]] < dist[heap[smallest]]) smallest = r;
          if (smallest === i) break;
          const tmp = heap[i];
          heap[i] = heap[smallest];
          heap[smallest] = tmp;
          i = smallest;
        }
      }
      return top;
    };

    push(startIdx);

    const dx = [-1, 1, 0, 0, -1, 1, -1, 1];
    const dy = [0, 0, -1, 1, -1, -1, 1, 1];
    const stepMult = [1, 1, 1, 1, Math.SQRT2, Math.SQRT2, Math.SQRT2, Math.SQRT2];

    while (heapSize > 0) {
      const u = pop();
      if (visited[u]) continue;
      visited[u] = 1;

      const ux = u % gw;
      const uy = (u - ux) / gw;
      const du = dist[u];

      for (let k = 0; k < 8; k += 1) {
        const vx = ux + dx[k];
        const vy = uy + dy[k];
        if (vx < 0 || vx >= gw || vy < 0 || vy >= gh) continue;
        const v = vy * gw + vx;
        if (visited[v]) continue;

        const alt = du + cost[v] * stepMult[k];
        if (alt < dist[v]) {
          dist[v] = alt;
          parent[v] = u;
          push(v);
        }
      }
    }
  }

  /**
   * Traces the edge-snapped path from current anchor to target (srcX, srcY).
   */
  traceTo(srcX: number, srcY: number): LivewirePoint[] {
    if (this.anchorGx < 0 || this.anchorGy < 0) {
      return [{ x: srcX, y: srcY }];
    }
    const tx = this.toGridX(srcX);
    const ty = this.toGridY(srcY);
    const startIdx = this.anchorGy * this.gw + this.anchorGx;
    let curr = ty * this.gw + tx;

    const rev: LivewirePoint[] = [];
    let guard = 0;
    const maxSteps = this.gw * this.gh;

    while (curr >= 0 && guard < maxSteps) {
      const cx = curr % this.gw;
      const cy = (curr - cx) / this.gw;
      rev.push({ x: this.toSrcX(cx), y: this.toSrcY(cy) });
      if (curr === startIdx) break;
      curr = this.parent[curr];
      guard += 1;
    }

    if (rev.length === 0) {
      return [
        { x: this.toSrcX(this.anchorGx), y: this.toSrcY(this.anchorGy) },
        { x: srcX, y: srcY },
      ];
    }

    rev.reverse();
    // Ensure final endpoint matches cursor accurately
    rev[rev.length - 1] = { x: srcX, y: srcY };
    return rev;
  }
}
