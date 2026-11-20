import { performance } from 'node:perf_hooks';
import { DEFAULT_AUTO_SETTINGS, type AutoRemoveSettings } from '../src/config';
import { runAutoRemovePipeline } from '../src/lib/autoRemoveEngine';

interface BenchCase {
  name: string;
  suite: 'normal' | 'hard';
  width: number;
  height: number;
  rgba: Uint8ClampedArray;
  gtMask: Uint8ClampedArray;
  settings?: Partial<AutoRemoveSettings>;
}

// Deterministic LCG PRNG so benchmark results are 100% reproducible
function makeRng(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function clampByte(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
}

function createCanvasBuffers(w: number, h: number) {
  return {
    rgba: new Uint8ClampedArray(w * h * 4),
    gtMask: new Uint8ClampedArray(w * h),
  };
}

function setPixel(
  rgba: Uint8ClampedArray,
  idx: number,
  r: number,
  g: number,
  b: number,
  a = 255
) {
  const p = idx * 4;
  rgba[p] = clampByte(r);
  rgba[p + 1] = clampByte(g);
  rgba[p + 2] = clampByte(b);
  rgba[p + 3] = clampByte(a);
}

function distToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number
): number {
  const vx = bx - ax;
  const vy = by - ay;
  const wx = px - ax;
  const wy = py - ay;
  const lenSq = vx * vx + vy * vy;
  const t = lenSq > 0 ? Math.max(0, Math.min(1, (wx * vx + wy * vy) / lenSq)) : 0;
  return Math.hypot(px - (ax + t * vx), py - (ay + t * vy));
}

// Signed distance to a rounded subject silhouette (circle/torso + head)
function subjectSdf(x: number, y: number, w: number, h: number, offsetY = 0): number {
  const cx = w * 0.5;
  const headR = Math.min(w, h) * 0.14;
  const headCy = h * 0.34 + offsetY;
  const dHead = Math.hypot(x - cx, y - headCy) - headR;

  const torsoRx = Math.min(w, h) * 0.24;
  const torsoRy = Math.min(w, h) * 0.26;
  const torsoCy = h * 0.65 + offsetY;
  const dx = (x - cx) / torsoRx;
  const dy = (y - torsoCy) / torsoRy;
  const dTorso = (Math.hypot(dx, dy) - 1) * Math.min(torsoRx, torsoRy);

  return Math.min(dHead, dTorso);
}

function buildSolidCase(w = 512, h = 512): BenchCase {
  const { rgba, gtMask } = createCanvasBuffers(w, h);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = y * w + x;
      const sdf = subjectSdf(x, y, w, h);
      const cov = Math.max(0, Math.min(1, 0.5 - sdf));
      const bgR = 236, bgG = 240, bgB = 245;
      const fgR = 46 + ((x / w) * 40), fgG = 92 + ((y / h) * 45), fgB = 148;
      setPixel(
        rgba,
        i,
        bgR * (1 - cov) + fgR * cov,
        bgG * (1 - cov) + fgG * cov,
        bgB * (1 - cov) + fgB * cov
      );
      gtMask[i] = sdf <= 0 ? 255 : 0;
    }
  }
  return { name: 'solid', suite: 'normal', width: w, height: h, rgba, gtMask };
}

function buildGradientCase(w = 512, h = 512): BenchCase {
  const { rgba, gtMask } = createCanvasBuffers(w, h);
  for (let y = 0; y < h; y += 1) {
    const ty = y / (h - 1);
    for (let x = 0; x < w; x += 1) {
      const tx = x / (w - 1);
      const i = y * w + x;
      // Smooth studio gradient lighting across the wall
      const bgR = 178 + tx * 46 - ty * 38;
      const bgG = 192 + tx * 34 - ty * 32;
      const bgB = 212 + tx * 24 - ty * 22;

      const sdf = subjectSdf(x, y, w, h);
      const cov = Math.max(0, Math.min(1, 0.5 - sdf));
      const fgR = 190 - ty * 30;
      const fgG = 68 + tx * 28;
      const fgB = 54 + ty * 24;

      setPixel(
        rgba,
        i,
        bgR * (1 - cov) + fgR * cov,
        bgG * (1 - cov) + fgG * cov,
        bgB * (1 - cov) + fgB * cov
      );
      gtMask[i] = sdf <= 0 ? 255 : 0;
    }
  }
  return { name: 'gradient', suite: 'normal', width: w, height: h, rgba, gtMask };
}

function buildVignetteCase(w = 512, h = 512): BenchCase {
  const { rgba, gtMask } = createCanvasBuffers(w, h);
  const cx = w * 0.5;
  const cy = h * 0.5;
  const maxR = Math.hypot(cx, cy);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = y * w + x;
      const rNorm = Math.hypot(x - cx, y - cy) / maxR;
      const shade = 1 - 0.36 * rNorm * rNorm;
      const bgR = 228 * shade;
      const bgG = 224 * shade;
      const bgB = 218 * shade;

      const sdf = subjectSdf(x, y, w, h);
      const cov = Math.max(0, Math.min(1, 0.5 - sdf));
      const fgR = 38 + 30 * (1 - y / h);
      const fgG = 115 + 25 * (x / w);
      const fgB = 96;

      setPixel(
        rgba,
        i,
        bgR * (1 - cov) + fgR * cov,
        bgG * (1 - cov) + fgG * cov,
        bgB * (1 - cov) + fgB * cov
      );
      gtMask[i] = sdf <= 0 ? 255 : 0;
    }
  }
  return { name: 'vignette', suite: 'normal', width: w, height: h, rgba, gtMask };
}

function buildNoisyCase(w = 512, h = 512): BenchCase {
  const { rgba, gtMask } = createCanvasBuffers(w, h);
  const rng = makeRng(42019);
  // Precompute 8x8 deterministic JPEG-like block bias
  const bw = Math.ceil(w / 8);
  const bh = Math.ceil(h / 8);
  const blockBias = new Float32Array(bw * bh);
  for (let k = 0; k < blockBias.length; k += 1) {
    blockBias[k] = (rng() - 0.5) * 14;
  }

  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = y * w + x;
      const bVal = blockBias[Math.floor(y / 8) * bw + Math.floor(x / 8)];
      const grain = (rng() - 0.5) * 18;
      const bgR = 205 + bVal + grain;
      const bgG = 212 + bVal + grain * 0.9;
      const bgB = 220 + bVal + grain * 0.8;

      const sdf = subjectSdf(x, y, w, h);
      const cov = Math.max(0, Math.min(1, 0.5 - sdf));
      const fgR = 64 + grain * 0.6 + (y / h) * 30;
      const fgG = 48 + grain * 0.5;
      const fgB = 132 + grain * 0.6;

      setPixel(
        rgba,
        i,
        bgR * (1 - cov) + fgR * cov,
        bgG * (1 - cov) + fgG * cov,
        bgB * (1 - cov) + fgB * cov
      );
      gtMask[i] = sdf <= 0 ? 255 : 0;
    }
  }
  return { name: 'noisy', suite: 'normal', width: w, height: h, rgba, gtMask };
}

function buildGreenscreenCase(w = 512, h = 512): BenchCase {
  const { rgba, gtMask } = createCanvasBuffers(w, h);
  for (let y = 0; y < h; y += 1) {
    const ty = y / h;
    for (let x = 0; x < w; x += 1) {
      const tx = x / w;
      const i = y * w + x;
      const bgR = 32 + tx * 12;
      const bgG = 198 - ty * 18;
      const bgB = 64 + tx * 10;

      const sdf = subjectSdf(x, y, w, h);
      const cov = Math.max(0, Math.min(1, 0.5 - sdf));
      const fgR = 210 - ty * 35;
      const fgG = 152 - ty * 20;
      const fgB = 138;

      setPixel(
        rgba,
        i,
        bgR * (1 - cov) + fgR * cov,
        bgG * (1 - cov) + fgG * cov,
        bgB * (1 - cov) + fgB * cov
      );
      gtMask[i] = sdf <= 0 ? 255 : 0;
    }
  }
  return { name: 'greenscreen', suite: 'normal', width: w, height: h, rgba, gtMask };
}

function buildTwoColorBgCase(w = 512, h = 512): BenchCase {
  const { rgba, gtMask } = createCanvasBuffers(w, h);
  // Two-tone studio background (wall + table split horizontally with mild shadow)
  for (let y = 0; y < h; y += 1) {
    const isTable = y >= Math.round(h * 0.62);
    for (let x = 0; x < w; x += 1) {
      const i = y * w + x;
      const bgR = isTable ? 168 : 228;
      const bgG = isTable ? 142 : 233;
      const bgB = isTable ? 114 : 240;

      const sdf = subjectSdf(x, y, w, h);
      const cov = Math.max(0, Math.min(1, 0.5 - sdf));
      const fgR = 34;
      const fgG = 58 + (y / h) * 32;
      const fgB = 112;

      setPixel(
        rgba,
        i,
        bgR * (1 - cov) + fgR * cov,
        bgG * (1 - cov) + fgG * cov,
        bgB * (1 - cov) + fgB * cov
      );
      gtMask[i] = sdf <= 0 ? 255 : 0;
    }
  }
  return { name: 'two-color', suite: 'hard', width: w, height: h, rgba, gtMask };
}

function buildWhiteOnWhiteCase(w = 512, h = 512): BenchCase {
  const { rgba, gtMask } = createCanvasBuffers(w, h);
  // Bright white ceramic product on bright off-white backdrop + subtle internal highlight/shadow
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = y * w + x;
      const bgR = 236;
      const bgG = 237;
      const bgB = 240;

      const cx = w * 0.5;
      const cy = h * 0.5;
      const rx = w * 0.25;
      const ry = h * 0.30;
      const nx = (x - cx) / rx;
      const ny = (y - cy) / ry;
      const normD = Math.hypot(nx, ny);
      const sdf = (normD - 1) * Math.min(rx, ry);
      const cov = Math.max(0, Math.min(1, 0.5 - sdf));

      // Subject is white with subtle 3D rim shading near edge and warm-neutral tint
      const rim = Math.max(0, Math.min(1, normD));
      const fgR = 252 - rim * 24;
      const fgG = 248 - rim * 25;
      const fgB = 242 - rim * 26;

      setPixel(
        rgba,
        i,
        bgR * (1 - cov) + fgR * cov,
        bgG * (1 - cov) + fgG * cov,
        bgB * (1 - cov) + fgB * cov
      );
      gtMask[i] = sdf <= 0 ? 255 : 0;
    }
  }
  return { name: 'white-on-white', suite: 'hard', width: w, height: h, rgba, gtMask };
}

function buildBorderTouchingCase(w = 512, h = 512): BenchCase {
  const { rgba, gtMask } = createCanvasBuffers(w, h);
  // Portrait cropped cleanly along the bottom border (touches ~28% of bottom edge)
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = y * w + x;
      const bgR = 218;
      const bgG = 226;
      const bgB = 234;

      const cx = w * 0.5;
      const dHead = Math.hypot(x - cx, y - h * 0.34) - w * 0.14;
      const dxShoulder = (x - cx) / (w * 0.28);
      const dyShoulder = Math.max(0, h * 0.56 - y) / (h * 0.16);
      // Shoulders extend all the way down to y = h - 1
      const dShoulders =
        y >= h * 0.56
          ? Math.abs(x - cx) - w * 0.28
          : (Math.hypot(dxShoulder, dyShoulder) - 1) * (w * 0.16);
      const sdf = Math.min(dHead, dShoulders);
      const cov = Math.max(0, Math.min(1, 0.5 - sdf));

      const isHead = dHead < dShoulders;
      const fgR = isHead ? 196 : 44;
      const fgG = isHead ? 142 : 66;
      const fgB = isHead ? 118 : 112;

      setPixel(
        rgba,
        i,
        bgR * (1 - cov) + fgR * cov,
        bgG * (1 - cov) + fgG * cov,
        bgB * (1 - cov) + fgB * cov
      );
      gtMask[i] = sdf <= 0 ? 255 : 0;
    }
  }
  return { name: 'border-touching', suite: 'hard', width: w, height: h, rgba, gtMask };
}

function buildEnclosedHoleCase(preserveHoles: boolean, w = 512, h = 512): BenchCase {
  const { rgba, gtMask } = createCanvasBuffers(w, h);
  const cx = w * 0.5;
  const cy = h * 0.5;
  const outerR = w * 0.31;
  const innerR = w * 0.13;

  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = y * w + x;
      const r = Math.hypot(x - cx, y - cy);
      const dOuter = r - outerR;
      const dInner = innerR - r;
      const sdfRing = Math.max(dOuter, dInner);
      const cov = Math.max(0, Math.min(1, 0.5 - sdfRing));

      const bgR = 230, bgG = 235, bgB = 242;
      const fgR = 185, fgG = 72, fgB = 48;

      setPixel(
        rgba,
        i,
        bgR * (1 - cov) + fgR * cov,
        bgG * (1 - cov) + fgG * cov,
        bgB * (1 - cov) + fgB * cov
      );
      // When preserveHoles=true, GT is ring; when preserveHoles=false (fillHoles=true), GT is filled disk
      gtMask[i] = preserveHoles ? (sdfRing <= 0 ? 255 : 0) : dOuter <= 0 ? 255 : 0;
    }
  }

  return {
    name: preserveHoles ? 'enclosed-hole-preserve' : 'enclosed-hole-fill',
    suite: 'hard',
    width: w,
    height: h,
    rgba,
    gtMask,
    settings: {
      preserveHoles,
      fillHoles: !preserveHoles,
    },
  };
}

function buildThinStructureCase(w = 512, h = 512): BenchCase {
  const { rgba, gtMask } = createCanvasBuffers(w, h);
  const cx = w * 0.48;
  const cy = h * 0.56;
  // Main rounded body + open thin curved hook + two thin 4.5px protruding antennas
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = y * w + x;
      const bodyRx = w * 0.17;
      const bodyRy = h * 0.21;
      const dBody =
        (Math.hypot((x - cx) / bodyRx, (y - cy) / bodyRy) - 1) * Math.min(bodyRx, bodyRy);

      // Open thin hook arc on right side (~5px thickness, open at bottom so no enclosed hole)
      const hCx = cx + bodyRx + w * 0.04;
      const hCy = cy - h * 0.02;
      const hR = h * 0.1;
      const dHook =
        x >= cx + bodyRx - 3 && y <= hCy + h * 0.05
          ? Math.abs(Math.hypot(x - hCx, y - hCy) - hR) - 2.6
          : 999;

      // Two thin ~4.5px angled antennas sticking up
      const dAnt1 =
        distToSegment(x, y, cx - w * 0.05, cy - bodyRy + 3, cx - w * 0.15, h * 0.14) - 2.4;
      const dAnt2 =
        distToSegment(x, y, cx + w * 0.05, cy - bodyRy + 3, cx + w * 0.16, h * 0.15) - 2.4;

      const sdf = Math.min(dBody, dHook, dAnt1, dAnt2);
      const cov = Math.max(0, Math.min(1, 0.5 - sdf));

      const bgR = 232, bgG = 236, bgB = 240;
      const fgR = 42, fgG = 86, fgB = 135;

      setPixel(
        rgba,
        i,
        bgR * (1 - cov) + fgR * cov,
        bgG * (1 - cov) + fgG * cov,
        bgB * (1 - cov) + fgB * cov
      );
      gtMask[i] = sdf <= 0 ? 255 : 0;
    }
  }
  return { name: 'thin-structure', suite: 'hard', width: w, height: h, rgba, gtMask };
}

function extractBoundaryPixels(mask: Uint8ClampedArray, w: number, h: number): Array<[number, number]> {
  const pts: Array<[number, number]> = [];
  for (let y = 0; y < h; y += 1) {
    const r = y * w;
    for (let x = 0; x < w; x += 1) {
      const i = r + x;
      if (mask[i] < 128) continue;
      const onEdge =
        x === 0 ||
        y === 0 ||
        x === w - 1 ||
        y === h - 1 ||
        mask[i - 1] < 128 ||
        mask[i + 1] < 128 ||
        mask[i - w] < 128 ||
        mask[i + w] < 128;
      if (onEdge) pts.push([x, y]);
    }
  }
  return pts;
}

function computeMetrics(
  pred: Uint8ClampedArray,
  gt: Uint8ClampedArray,
  w: number,
  h: number
): { iou: number; boundaryF: number } {
  let inter = 0;
  let uni = 0;
  for (let i = 0; i < pred.length; i += 1) {
    const p = pred[i] >= 128;
    const g = gt[i] >= 128;
    if (p && g) inter += 1;
    if (p || g) uni += 1;
  }
  const iou = uni > 0 ? inter / uni : 1;

  // Boundary F-score within 2px tolerance radius
  const tol = 2;
  const gtDilated = new Uint8Array(w * h);
  const predDilated = new Uint8Array(w * h);

  const gtB = extractBoundaryPixels(gt, w, h);
  const predB = extractBoundaryPixels(pred, w, h);

  for (const [bx, by] of gtB) {
    for (let dy = -tol; dy <= tol; dy += 1) {
      const ny = by + dy;
      if (ny < 0 || ny >= h) continue;
      for (let dx = -tol; dx <= tol; dx += 1) {
        const nx = bx + dx;
        if (nx >= 0 && nx < w && dx * dx + dy * dy <= tol * tol) {
          gtDilated[ny * w + nx] = 1;
        }
      }
    }
  }

  for (const [bx, by] of predB) {
    for (let dy = -tol; dy <= tol; dy += 1) {
      const ny = by + dy;
      if (ny < 0 || ny >= h) continue;
      for (let dx = -tol; dx <= tol; dx += 1) {
        const nx = bx + dx;
        if (nx >= 0 && nx < w && dx * dx + dy * dy <= tol * tol) {
          predDilated[ny * w + nx] = 1;
        }
      }
    }
  }

  let tpPred = 0;
  for (const [bx, by] of predB) {
    if (gtDilated[by * w + bx]) tpPred += 1;
  }
  let tpGt = 0;
  for (const [bx, by] of gtB) {
    if (predDilated[by * w + bx]) tpGt += 1;
  }

  const prec = predB.length > 0 ? tpPred / predB.length : 1;
  const rec = gtB.length > 0 ? tpGt / gtB.length : 1;
  const boundaryF = prec + rec > 0 ? (2 * prec * rec) / (prec + rec) : 0;

  return { iou, boundaryF };
}

async function main() {
  const cases: BenchCase[] = [
    buildSolidCase(),
    buildGradientCase(),
    buildVignetteCase(),
    buildNoisyCase(),
    buildGreenscreenCase(),
    buildTwoColorBgCase(),
    buildWhiteOnWhiteCase(),
    buildBorderTouchingCase(),
    buildEnclosedHoleCase(false),
    buildEnclosedHoleCase(true),
    buildThinStructureCase(),
  ];

  const rows: Array<{
    name: string;
    suite: 'normal' | 'hard';
    iou: number;
    boundaryF: number;
    score: number;
    mode: string;
    ms: number;
  }> = [];

  for (const c of cases) {
    const settings: AutoRemoveSettings = {
      ...DEFAULT_AUTO_SETTINGS,
      ...c.settings,
    };
    const t0 = performance.now();
    const res = await runAutoRemovePipeline(c.rgba, c.width, c.height, settings);
    const ms = performance.now() - t0;
    const { iou, boundaryF } = computeMetrics(res.mask, c.gtMask, c.width, c.height);
    rows.push({
      name: c.name,
      suite: c.suite,
      iou,
      boundaryF,
      score: res.score,
      mode: res.modeUsed,
      ms,
    });
  }

  console.log('\nCutout Classical Auto-Remove Benchmark\n');
  console.log(
    'Case'.padEnd(24) +
      'Suite'.padEnd(9) +
      'Mode'.padEnd(9) +
      'IoU'.padEnd(9) +
      'Bnd-F'.padEnd(9) +
      'Score'.padEnd(8) +
      'Time'
  );
  console.log('-'.repeat(76));
  for (const r of rows) {
    console.log(
      r.name.padEnd(24) +
        r.suite.padEnd(9) +
        r.mode.padEnd(9) +
        r.iou.toFixed(4).padEnd(9) +
        r.boundaryF.toFixed(4).padEnd(9) +
        r.score.toFixed(1).padEnd(8) +
        `${r.ms.toFixed(1)} ms`
    );
  }

  const normalRows = rows.filter((r) => r.suite === 'normal');
  const hardRows = rows.filter((r) => r.suite === 'hard');
  const meanNormalIoU = normalRows.reduce((s, r) => s + r.iou, 0) / normalRows.length;
  const meanHardIoU = hardRows.reduce((s, r) => s + r.iou, 0) / hardRows.length;
  const meanNormalF = normalRows.reduce((s, r) => s + r.boundaryF, 0) / normalRows.length;
  const meanHardF = hardRows.reduce((s, r) => s + r.boundaryF, 0) / hardRows.length;

  console.log('-'.repeat(76));
  console.log(
    `Normal mean IoU: ${meanNormalIoU.toFixed(4)} (target >= 0.9300) | Boundary F: ${meanNormalF.toFixed(4)}`
  );
  console.log(
    `Hard   mean IoU: ${meanHardIoU.toFixed(4)} (target >= 0.8500) | Boundary F: ${meanHardF.toFixed(4)}`
  );

  let failed = false;
  if (meanNormalIoU < 0.93) {
    console.error(`FAIL: Normal mean IoU ${meanNormalIoU.toFixed(4)} < 0.93`);
    failed = true;
  }
  if (meanHardIoU < 0.85) {
    console.error(`FAIL: Hard mean IoU ${meanHardIoU.toFixed(4)} < 0.85`);
    failed = true;
  }
  if (failed) {
    process.exit(1);
  }
  console.log('PASS: All benchmark thresholds met.\n');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
