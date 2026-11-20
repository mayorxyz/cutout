import type { RefineSettings } from '../config';
import {
  applyRefinePipeline,
  cloneToArrayBuffer,
  colorKeySelectLab,
  magicWandSelectLab,
} from '../lib/maskAlgorithms';

export type MaskOpsRequest =
  | {
      type: 'refine';
      requestId: number;
      rgbaBuffer: ArrayBuffer;
      maskBuffer: ArrayBuffer;
      width: number;
      height: number;
      settings: RefineSettings;
      spillMode?: 'green' | 'blue' | null;
    }
  | {
      type: 'magic-wand';
      requestId: number;
      rgbaBuffer: ArrayBuffer;
      width: number;
      height: number;
      seedX: number;
      seedY: number;
      tolerance: number;
      contiguous: boolean;
    }
  | {
      type: 'color-key';
      requestId: number;
      rgbaBuffer: ArrayBuffer;
      width: number;
      height: number;
      keyRgb: [number, number, number];
      tolerance: number;
      softness: number;
    };

export type MaskOpsResponse =
  | {
      type: 'refine-done';
      requestId: number;
      maskBuffer: ArrayBuffer;
      rgbaBuffer: ArrayBuffer;
    }
  | {
      type: 'magic-wand-done';
      requestId: number;
      selectionBuffer: ArrayBuffer;
    }
  | {
      type: 'color-key-done';
      requestId: number;
      selectionBuffer: ArrayBuffer;
    }
  | {
      type: 'error';
      requestId: number;
      message: string;
    };

self.onmessage = (event: MessageEvent<MaskOpsRequest>) => {
  const msg = event.data;

  try {
    if (msg.type === 'refine') {
      const rgba = new Uint8ClampedArray(msg.rgbaBuffer);
      const mask = new Uint8ClampedArray(msg.maskBuffer);
      const result = applyRefinePipeline(
        rgba,
        mask,
        msg.width,
        msg.height,
        msg.settings,
        msg.spillMode ?? null
      );
      const maskOut = cloneToArrayBuffer(result.mask);
      const rgbaOut = cloneToArrayBuffer(result.rgba);
      self.postMessage(
        {
          type: 'refine-done',
          requestId: msg.requestId,
          maskBuffer: maskOut,
          rgbaBuffer: rgbaOut,
        } satisfies MaskOpsResponse,
        { transfer: [maskOut, rgbaOut] }
      );
      return;
    }

    if (msg.type === 'magic-wand') {
      const rgba = new Uint8ClampedArray(msg.rgbaBuffer);
      const selection = magicWandSelectLab(
        rgba,
        msg.width,
        msg.height,
        msg.seedX,
        msg.seedY,
        msg.tolerance,
        msg.contiguous
      );
      const selBuf = cloneToArrayBuffer(selection);
      self.postMessage(
        {
          type: 'magic-wand-done',
          requestId: msg.requestId,
          selectionBuffer: selBuf,
        } satisfies MaskOpsResponse,
        { transfer: [selBuf] }
      );
      return;
    }

    if (msg.type === 'color-key') {
      const rgba = new Uint8ClampedArray(msg.rgbaBuffer);
      const selection = colorKeySelectLab(
        rgba,
        msg.width,
        msg.height,
        msg.keyRgb,
        msg.tolerance,
        msg.softness
      );
      const selBuf = cloneToArrayBuffer(selection);
      self.postMessage(
        {
          type: 'color-key-done',
          requestId: msg.requestId,
          selectionBuffer: selBuf,
        } satisfies MaskOpsResponse,
        { transfer: [selBuf] }
      );
    }
  } catch (err) {
    self.postMessage({
      type: 'error',
      requestId: msg.requestId,
      message: err instanceof Error ? err.message : String(err),
    } satisfies MaskOpsResponse);
  }
};
