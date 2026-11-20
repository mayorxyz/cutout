/**
 * Fast person-first segmentation (MediaPipe, ~30-80 ms, ~250 KB model).
 * npm i @mediapipe/tasks-vision
 * Use as the FIRST step of runAutoRemovePipeline; fall back to the classical
 * engine only when this returns null.
 */
import { FilesetResolver, ImageSegmenter } from '@mediapipe/tasks-vision';
import { guidedUpsampleMask } from './maskAlgorithms';

const WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm';
const MODEL =
  'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite';

let segmenterPromise: Promise<ImageSegmenter> | null = null;

function getSegmenter(): Promise<ImageSegmenter> {
  if (!segmenterPromise) {
    segmenterPromise = (async () => {
      const vision = await FilesetResolver.forVisionTasks(WASM);
      const make = (delegate: 'GPU' | 'CPU') =>
        ImageSegmenter.createFromOptions(vision, {
          baseOptions: { modelAssetPath: MODEL, delegate },
          runningMode: 'IMAGE',
          outputConfidenceMasks: true,
          outputCategoryMask: false,
        });
      try {
        return await make('GPU');
      } catch {
        return await make('CPU');
      }
    })();
    segmenterPromise.catch(() => {
      segmenterPromise = null;
    });
  }
  return segmenterPromise;
}

function makeCanvas(w: number, h: number): OffscreenCanvas | HTMLCanvasElement {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/** Returns a full-resolution 0..255 person mask, or null if the model is unusable here. */
export async function personMask(
  rgba: Uint8ClampedArray,
  w: number,
  h: number,
  timeoutMs = 8000
): Promise<Uint8ClampedArray | null> {
  try {
    const run = async () => {
      const seg = await getSegmenter();

      // Model works at 256px internally; 512 long side is plenty of input.
      const s = Math.min(1, 512 / Math.max(w, h));
      const sw = Math.max(1, Math.round(w * s));
      const sh = Math.max(1, Math.round(h * s));
      const full = makeCanvas(w, h);
      (full.getContext('2d') as CanvasRenderingContext2D).putImageData(
        new ImageData(new Uint8ClampedArray(rgba), w, h),
        0,
        0
      );
      const small = makeCanvas(sw, sh);
      (small.getContext('2d') as CanvasRenderingContext2D).drawImage(
        full as CanvasImageSource,
        0,
        0,
        sw,
        sh
      );

      const res = seg.segment(small as HTMLCanvasElement);
      const masks = res.confidenceMasks;
      if (!masks || masks.length === 0) return null;
      // multiclass model: index 0 = background, so person = 1 - background
      const bg = masks[0].getAsFloat32Array();
      const mw = masks[0].width;
      const mh = masks[0].height;
      const soft = new Uint8ClampedArray(mw * mh);
      let fg = 0;
      for (let i = 0; i < soft.length; i += 1) {
        const p = 1 - bg[i];
        const a = Math.min(1, Math.max(0, (p - 0.35) / 0.3)); // soft edge around 0.5
        soft[i] = Math.round(a * 255);
        if (a > 0.5) fg += 1;
      }
      res.close?.();

      const frac = fg / soft.length;
      if (frac < 0.03 || frac > 0.97) return null; // no person found -> classical fallback

      return mw === w && mh === h ? soft : guidedUpsampleMask(soft, mw, mh, rgba, w, h);
    };

    return await Promise.race([
      run(),
      new Promise<null>((r) => setTimeout(() => r(null), timeoutMs)),
    ]);
  } catch {
    return null;
  }
}

/** Wall-clock guard for the classical engine so it can never hang the page. */
export function makeDeadline(ms: number) {
  const end = performance.now() + ms;
  return { expired: () => performance.now() > end };
}
