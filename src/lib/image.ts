import {
  ACCEPTED_MIME_TYPES,
  ASPECT_PRESETS,
  AspectPresetId,
  BackgroundOption,
  DOWNSCALE_TARGET_PX,
  ExportFormat,
  MAX_FILE_BYTES,
  MAX_FILE_MB,
  MAX_SIDE_PX,
  MOBILE_FALLBACK_PX,
  OutputEffectSettings,
  RefineSettings,
  WORKING_MAX_SIDE_PX,
} from '../config';
import { applyRefinePipeline, guidedUpsampleMask, upscaleMaskBilinear } from './maskAlgorithms';

export interface PreparedImage {
  file: File;
  processingBlob: Blob;
  previewBlob: Blob;
  width: number;
  height: number;
  originalWidth: number;
  originalHeight: number;
  workingWidth: number;
  workingHeight: number;
  workingRgba: Uint8ClampedArray;
  wasDownscaled: boolean;
  notices: string[];
}

export interface ExportOptions {
  format: ExportFormat;
  quality: number; // 0.1 - 1
  background: BackgroundOption;
  cropToSubject: boolean;
  cropPaddingPx: number;
  aspectPreset: AspectPresetId;
  maxExportSidePx: number | null;
  effects: OutputEffectSettings;
  refine: RefineSettings;
  spillMode?: 'green' | 'blue' | null;
}

export function sanitizeFileName(rawName: string): string {
  const baseName = rawName
    .replace(/^.*[\\/]/, '')
    .replace(/\.[^.]+$/, '')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[._-]+|[._-]+$/g, '')
    .slice(0, 120);

  return baseName || 'image';
}

export function buildDownloadFileName(
  originalName: string,
  format: ExportFormat = 'image/png',
  suffix = 'no-bg'
): string {
  const ext = format === 'image/jpeg' ? 'jpg' : format === 'image/webp' ? 'webp' : 'png';
  return `${sanitizeFileName(originalName)}-${suffix}.${ext}`;
}

function inferMimeType(file: File): string | null {
  if (file.type && (ACCEPTED_MIME_TYPES as readonly string[]).includes(file.type.toLowerCase())) {
    return file.type.toLowerCase();
  }
  if (file.type && file.type.toLowerCase() === 'image/jpg') {
    return 'image/jpeg';
  }
  if (!file.type) {
    const ext = file.name.split('.').pop()?.toLowerCase();
    if (ext === 'png') return 'image/png';
    if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
    if (ext === 'webp') return 'image/webp';
  }
  return null;
}

function isAnimatedWebP(buffer: ArrayBuffer): boolean {
  if (buffer.byteLength < 16) return false;
  const view = new Uint8Array(buffer);
  const riff = String.fromCharCode(view[0], view[1], view[2], view[3]);
  const webp = String.fromCharCode(view[8], view[9], view[10], view[11]);
  if (riff !== 'RIFF' || webp !== 'WEBP') return false;

  const limit = Math.min(view.length - 8, 4096);
  let offset = 12;
  while (offset + 8 <= limit) {
    const chunkId = String.fromCharCode(
      view[offset],
      view[offset + 1],
      view[offset + 2],
      view[offset + 3]
    );
    const chunkSize =
      view[offset + 4] |
      (view[offset + 5] << 8) |
      (view[offset + 6] << 16) |
      (view[offset + 7] << 24);

    if (chunkId === 'ANIM') return true;
    if (chunkId === 'VP8X' && offset + 8 < view.length) {
      const flags = view[offset + 8];
      if ((flags & 0x02) !== 0) return true;
    }
    const paddedSize = chunkSize + (chunkSize % 2);
    if (paddedSize <= 0) break;
    offset += 8 + paddedSize;
  }
  return false;
}

function getJpegExifOrientation(buffer: ArrayBuffer): number {
  const view = new DataView(buffer);
  if (view.byteLength < 4 || view.getUint16(0, false) !== 0xffd8) {
    return 1;
  }

  let offset = 2;
  while (offset + 4 <= view.byteLength) {
    const marker = view.getUint16(offset, false);
    offset += 2;

    if (marker === 0xffe1) {
      if (offset + 8 > view.byteLength) return 1;
      const length = view.getUint16(offset, false);
      if (view.getUint32(offset + 2, false) !== 0x45786966) {
        offset += length;
        continue;
      }
      const tiffOffset = offset + 8;
      if (tiffOffset + 8 > view.byteLength) return 1;
      const littleEndian = view.getUint16(tiffOffset, false) === 0x4949;
      const firstIfdOffset = view.getUint32(tiffOffset + 4, littleEndian);
      const ifdStart = tiffOffset + firstIfdOffset;
      if (ifdStart + 2 > view.byteLength) return 1;
      const entries = view.getUint16(ifdStart, littleEndian);
      for (let i = 0; i < entries; i += 1) {
        const entryOffset = ifdStart + 2 + i * 12;
        if (entryOffset + 12 > view.byteLength) break;
        if (view.getUint16(entryOffset, littleEndian) === 0x0112) {
          return view.getUint16(entryOffset + 8, littleEndian);
        }
      }
      return 1;
    }

    if ((marker & 0xff00) !== 0xff00) break;
    if (offset + 2 > view.byteLength) break;
    offset += view.getUint16(offset, false);
  }

  return 1;
}

function isBitmapFullyTransparent(bitmap: ImageBitmap): boolean {
  const sampleW = Math.min(bitmap.width, 128);
  const sampleH = Math.min(bitmap.height, 128);
  if (sampleW < 1 || sampleH < 1) return false;

  const canvas = document.createElement('canvas');
  canvas.width = sampleW;
  canvas.height = sampleH;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return false;

  ctx.drawImage(bitmap, 0, 0, sampleW, sampleH);
  const { data } = ctx.getImageData(0, 0, sampleW, sampleH);
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] > 2) return false;
  }
  return true;
}

export function extractWorkingRgbaFromBitmap(
  bitmap: ImageBitmap,
  maxSide = WORKING_MAX_SIDE_PX
): { width: number; height: number; rgba: Uint8ClampedArray } {
  const longest = Math.max(bitmap.width, bitmap.height);
  const scale = longest > maxSide ? maxSide / longest : 1;
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    throw new Error('Could not acquire a 2D canvas context.');
  }
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, width, height);
  const imageData = ctx.getImageData(0, 0, width, height);
  return { width, height, rgba: imageData.data };
}

async function renderBitmapToBlob(
  bitmap: ImageBitmap,
  targetWidth: number,
  targetHeight: number,
  mimeType: string
): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Could not acquire a 2D canvas context on this device.');
  }

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, targetWidth, targetHeight);

  const outputMime = mimeType === 'image/jpeg' ? 'image/jpeg' : 'image/png';
  const quality = outputMime === 'image/jpeg' ? 0.95 : undefined;

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error('Failed to encode resized image.'));
          return;
        }
        resolve(blob);
      },
      outputMime,
      quality
    );
  });
}

export async function decodeWithOrientation(file: Blob): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    return await createImageBitmap(file);
  }
}

export async function validateAndPrepareImage(file: File): Promise<PreparedImage> {
  const mime = inferMimeType(file);
  if (!mime) {
    throw new Error('Unsupported format. Please upload a PNG, JPEG, or WebP image.');
  }

  if (file.size === 0) {
    throw new Error('This file is empty. Please choose a valid image.');
  }

  if (file.size > MAX_FILE_BYTES) {
    throw new Error(`File exceeds the ${MAX_FILE_MB} MB limit. Please choose a smaller image.`);
  }

  const notices: string[] = [];
  let headerSlice: ArrayBuffer | null = null;
  try {
    headerSlice = await file.slice(0, 65536).arrayBuffer();
  } catch {
    headerSlice = null;
  }

  const animatedWebP = mime === 'image/webp' && headerSlice ? isAnimatedWebP(headerSlice) : false;
  if (animatedWebP) {
    notices.push('Animated WebP detected — extracted the first frame for background removal.');
  }

  const exifOrientation = mime === 'image/jpeg' && headerSlice ? getJpegExifOrientation(headerSlice) : 1;

  let bitmap: ImageBitmap;
  try {
    bitmap = await decodeWithOrientation(file);
  } catch (err) {
    console.error('Image decode error:', err);
    throw new Error('Could not decode this image. It may be corrupted or unsupported.');
  }

  try {
    const originalWidth = bitmap.width;
    const originalHeight = bitmap.height;

    if (originalWidth < 1 || originalHeight < 1) {
      throw new Error('Image has invalid dimensions.');
    }

    if ((mime === 'image/png' || mime === 'image/webp') && isBitmapFullyTransparent(bitmap)) {
      notices.push('This image appears completely transparent already.');
    }

    const longestSide = Math.max(originalWidth, originalHeight);
    let targetWidth = originalWidth;
    let targetHeight = originalHeight;
    let wasDownscaled = false;

    if (longestSide > MAX_SIDE_PX) {
      const scale = DOWNSCALE_TARGET_PX / longestSide;
      targetWidth = Math.max(1, Math.round(originalWidth * scale));
      targetHeight = Math.max(1, Math.round(originalHeight * scale));
      wasDownscaled = true;
      notices.push(
        `Image exceeded ${MAX_SIDE_PX.toLocaleString()} px and was resized to ${targetWidth} × ${targetHeight} px.`
      );
    }

    const working = extractWorkingRgbaFromBitmap(bitmap, WORKING_MAX_SIDE_PX);

    const needsCanvasRewrite = wasDownscaled || animatedWebP || exifOrientation > 1;
    if (!needsCanvasRewrite) {
      const workingBlob = await renderBitmapToBlob(bitmap, working.width, working.height, 'image/png');
      return {
        file,
        processingBlob: workingBlob,
        previewBlob: file,
        width: originalWidth,
        height: originalHeight,
        originalWidth,
        originalHeight,
        workingWidth: working.width,
        workingHeight: working.height,
        workingRgba: working.rgba,
        wasDownscaled: false,
        notices,
      };
    }

    try {
      const normalizedBlob = await renderBitmapToBlob(bitmap, targetWidth, targetHeight, mime);
      const processingBlob =
        Math.max(targetWidth, targetHeight) > WORKING_MAX_SIDE_PX
          ? await renderBitmapToBlob(bitmap, working.width, working.height, 'image/png')
          : normalizedBlob;
      return {
        file,
        processingBlob,
        previewBlob: normalizedBlob,
        width: targetWidth,
        height: targetHeight,
        originalWidth,
        originalHeight,
        workingWidth: working.width,
        workingHeight: working.height,
        workingRgba: working.rgba,
        wasDownscaled,
        notices,
      };
    } catch (canvasErr) {
      console.warn('Primary canvas resize failed, retrying with mobile fallback size:', canvasErr);
      const fallbackScale = Math.min(1, MOBILE_FALLBACK_PX / longestSide);
      const fallbackW = Math.max(1, Math.round(originalWidth * fallbackScale));
      const fallbackH = Math.max(1, Math.round(originalHeight * fallbackScale));
      const fallbackBlob = await renderBitmapToBlob(bitmap, fallbackW, fallbackH, mime);
      notices.push(
        `Device canvas memory limits reached — resized to ${fallbackW} × ${fallbackH} px.`
      );
      return {
        file,
        processingBlob: fallbackBlob,
        previewBlob: fallbackBlob,
        width: fallbackW,
        height: fallbackH,
        originalWidth,
        originalHeight,
        workingWidth: working.width,
        workingHeight: working.height,
        workingRgba: working.rgba,
        wasDownscaled: true,
        notices,
      };
    }
  } finally {
    bitmap.close();
  }
}

export async function extractAlphaMaskFromBlob(
  blob: Blob,
  targetWidth: number,
  targetHeight: number
): Promise<Uint8ClampedArray> {
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('Could not create canvas to decode alpha mask.');
    ctx.drawImage(bitmap, 0, 0);
    const { data } = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
    const rawMask = new Uint8ClampedArray(bitmap.width * bitmap.height);
    for (let i = 0; i < rawMask.length; i += 1) {
      rawMask[i] = data[i * 4 + 3];
    }
    return upscaleMaskBilinear(rawMask, bitmap.width, bitmap.height, targetWidth, targetHeight);
  } finally {
    bitmap.close();
  }
}

export function computeMaskBoundingBox(
  mask: Uint8ClampedArray,
  width: number,
  height: number,
  threshold = 8
): { x: number; y: number; w: number; h: number } | null {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    for (let x = 0; x < width; x += 1) {
      if (mask[row + x] > threshold) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX < minX || maxY < minY) return null;
  return {
    x: minX,
    y: minY,
    w: maxX - minX + 1,
    h: maxY - minY + 1,
  };
}

function drawBackgroundOnContext(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  background: BackgroundOption,
  originalSource?: CanvasImageSource | null,
  bgImage?: HTMLImageElement | ImageBitmap | null
): void {
  if (background.type === 'transparent') return;

  if (background.type === 'color') {
    ctx.fillStyle = background.value;
    ctx.fillRect(0, 0, width, height);
    return;
  }

  if (background.type === 'gradient') {
    const rad = ((background.angle - 90) * Math.PI) / 180;
    const cx = width / 2;
    const cy = height / 2;
    const len = Math.hypot(width, height) / 2;
    const grad = ctx.createLinearGradient(
      cx - Math.cos(rad) * len,
      cy - Math.sin(rad) * len,
      cx + Math.cos(rad) * len,
      cy + Math.sin(rad) * len
    );
    grad.addColorStop(0, background.from);
    grad.addColorStop(1, background.to);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, height);
    return;
  }

  if (background.type === 'blur-original' && originalSource) {
    ctx.save();
    ctx.filter = `blur(${Math.max(0, background.blurPx)}px)`;
    const pad = Math.ceil(background.blurPx * 2);
    ctx.drawImage(originalSource, -pad, -pad, width + pad * 2, height + pad * 2);
    ctx.restore();
    return;
  }

  if (background.type === 'image' && bgImage) {
    const imgW = 'naturalWidth' in bgImage ? bgImage.naturalWidth : bgImage.width;
    const imgH = 'naturalHeight' in bgImage ? bgImage.naturalHeight : bgImage.height;
    const coverScale = Math.max(width / imgW, height / imgH);
    const drawW = imgW * coverScale;
    const drawH = imgH * coverScale;
    ctx.drawImage(bgImage, (width - drawW) / 2, (height - drawH) / 2, drawW, drawH);
  }
}

async function loadBgImageBitmap(dataUrl: string): Promise<ImageBitmap | null> {
  try {
    const res = await fetch(dataUrl);
    const blob = await res.blob();
    return await createImageBitmap(blob);
  } catch {
    return null;
  }
}

function buildSubjectCanvas(
  rgba: Uint8ClampedArray,
  mask: Uint8ClampedArray,
  width: number,
  height: number
): HTMLCanvasElement {
  const subjectCanvas = document.createElement('canvas');
  subjectCanvas.width = width;
  subjectCanvas.height = height;
  const ctx = subjectCanvas.getContext('2d');
  if (!ctx) throw new Error('Could not acquire canvas context.');
  const imgData = new ImageData(width, height);
  const dst = imgData.data;
  for (let i = 0, p = 0; i < mask.length; i += 1, p += 4) {
    dst[p] = rgba[p];
    dst[p + 1] = rgba[p + 1];
    dst[p + 2] = rgba[p + 2];
    dst[p + 3] = mask[i];
  }
  ctx.putImageData(imgData, 0, 0);
  return subjectCanvas;
}

function drawSubjectWithEffects(
  targetCtx: CanvasRenderingContext2D,
  subjectCanvas: HTMLCanvasElement,
  dx: number,
  dy: number,
  dw: number,
  dh: number,
  effects: OutputEffectSettings
): void {
  // Optional sticker outline using radial multi-angle silhouette stamps
  if (effects.outlineEnabled && effects.outlineWidth > 0) {
    const silhouette = document.createElement('canvas');
    silhouette.width = subjectCanvas.width;
    silhouette.height = subjectCanvas.height;
    const sCtx = silhouette.getContext('2d');
    if (sCtx) {
      sCtx.drawImage(subjectCanvas, 0, 0);
      sCtx.globalCompositeOperation = 'source-in';
      sCtx.fillStyle = effects.outlineColor;
      sCtx.fillRect(0, 0, silhouette.width, silhouette.height);

      const steps = 16;
      const r = effects.outlineWidth;
      targetCtx.save();
      for (let i = 0; i < steps; i += 1) {
        const angle = (i / steps) * Math.PI * 2;
        targetCtx.drawImage(
          silhouette,
          dx + Math.cos(angle) * r,
          dy + Math.sin(angle) * r,
          dw,
          dh
        );
      }
      targetCtx.restore();
    }
  }

  targetCtx.save();
  if (effects.shadowEnabled) {
    const hex = effects.shadowColor.replace('#', '');
    const r = parseInt(hex.slice(0, 2) || '00', 16);
    const g = parseInt(hex.slice(2, 4) || '00', 16);
    const b = parseInt(hex.slice(4, 6) || '00', 16);
    targetCtx.shadowColor = `rgba(${r}, ${g}, ${b}, ${effects.shadowOpacity})`;
    targetCtx.shadowBlur = effects.shadowBlur;
    targetCtx.shadowOffsetX = 0;
    targetCtx.shadowOffsetY = effects.shadowOffsetY;
  }
  targetCtx.drawImage(subjectCanvas, dx, dy, dw, dh);
  targetCtx.restore();
}

export async function exportFullResolutionCutout(
  originalBlob: Blob,
  workingMask: Uint8ClampedArray,
  workingWidth: number,
  workingHeight: number,
  options: ExportOptions
): Promise<Blob> {
  const originalBitmap = await decodeWithOrientation(originalBlob);
  let bgBitmap: ImageBitmap | null = null;
  if (options.background.type === 'image') {
    bgBitmap = await loadBgImageBitmap(options.background.dataUrl);
  }

  try {
    let targetW = originalBitmap.width;
    let targetH = originalBitmap.height;

    if (options.maxExportSidePx && Math.max(targetW, targetH) > options.maxExportSidePx) {
      const scale = options.maxExportSidePx / Math.max(targetW, targetH);
      targetW = Math.max(1, Math.round(targetW * scale));
      targetH = Math.max(1, Math.round(targetH * scale));
    }

    const baseCanvas = document.createElement('canvas');
    baseCanvas.width = targetW;
    baseCanvas.height = targetH;
    const baseCtx = baseCanvas.getContext('2d', { willReadFrequently: true });
    if (!baseCtx) throw new Error('Canvas allocation failed at export size.');

    baseCtx.imageSmoothingEnabled = true;
    baseCtx.imageSmoothingQuality = 'high';
    baseCtx.drawImage(originalBitmap, 0, 0, targetW, targetH);
    const origData = baseCtx.getImageData(0, 0, targetW, targetH);

    // Joint/guided upsampling using full-resolution image as guide
    const fullMask = guidedUpsampleMask(
      workingMask,
      workingWidth,
      workingHeight,
      origData.data,
      targetW,
      targetH
    );

    // Apply edge refinement at export resolution (scaled feather/shift proportional to size)
    const sizeScale = Math.max(targetW, targetH) / Math.max(workingWidth, workingHeight);
    const scaledRefine: RefineSettings = {
      ...options.refine,
      featherPx: Math.round(options.refine.featherPx * sizeScale),
      shiftPx: Math.round(options.refine.shiftPx * sizeScale),
      smoothRadius: Math.round(options.refine.smoothRadius * sizeScale),
    };
    const refined = applyRefinePipeline(
      origData.data,
      fullMask,
      targetW,
      targetH,
      scaledRefine,
      options.spillMode ?? null
    );
    const subjectCanvas = buildSubjectCanvas(refined.rgba, refined.mask, targetW, targetH);

    // Determine crop bounds
    const preset = ASPECT_PRESETS.find((p) => p.id === options.aspectPreset) ?? ASPECT_PRESETS[0];
    const shouldCropToSubject =
      options.cropToSubject ||
      preset.id === 'passport' ||
      preset.id === 'product' ||
      preset.id === 'profile-circle' ||
      preset.id === 'sticker';

    const bounds = shouldCropToSubject
      ? computeMaskBoundingBox(refined.mask, targetW, targetH, 8)
      : null;

    const srcX = bounds ? Math.max(0, bounds.x - options.cropPaddingPx) : 0;
    const srcY = bounds ? Math.max(0, bounds.y - options.cropPaddingPx) : 0;
    const srcW = bounds
      ? Math.min(targetW - srcX, bounds.w + options.cropPaddingPx * 2)
      : targetW;
    const srcH = bounds
      ? Math.min(targetH - srcY, bounds.h + options.cropPaddingPx * 2)
      : targetH;

    // Determine output canvas dimensions & aspect ratio framing
    let outW = srcW;
    let outH = srcH;
    if (preset.defaultSize) {
      outW = preset.defaultSize[0];
      outH = preset.defaultSize[1];
    } else if (preset.ratio) {
      const targetRatio = preset.ratio[0] / preset.ratio[1];
      const currentRatio = srcW / srcH;
      if (currentRatio > targetRatio) {
        outW = srcW;
        outH = Math.round(srcW / targetRatio);
      } else {
        outH = srcH;
        outW = Math.round(srcH * targetRatio);
      }
    }

    const outCanvas = document.createElement('canvas');
    outCanvas.width = Math.max(1, outW);
    outCanvas.height = Math.max(1, outH);
    const outCtx = outCanvas.getContext('2d');
    if (!outCtx) throw new Error('Could not create export canvas.');

    // Optional circle clip for Profile Picture preset
    if (preset.circleCrop) {
      outCtx.beginPath();
      outCtx.arc(outW / 2, outH / 2, Math.min(outW, outH) / 2, 0, Math.PI * 2);
      outCtx.closePath();
      outCtx.clip();
    }

    // JPEG has no alpha channel: force white if transparent was chosen
    const effectiveBg: BackgroundOption =
      options.format === 'image/jpeg' && options.background.type === 'transparent'
        ? { type: 'color', value: '#ffffff' }
        : options.background;

    drawBackgroundOnContext(outCtx, outW, outH, effectiveBg, originalBitmap, bgBitmap);

    // Fit subject slice inside output frame preserving aspect + optional preset padding
    const padRatio = preset.paddingRatio ?? 0;
    const availW = outW * (1 - padRatio * 2);
    const availH = outH * (1 - padRatio * 2);
    const fitScale = Math.min(availW / srcW, availH / srcH);
    const drawW = srcW * fitScale;
    const drawH = srcH * fitScale;
    const drawX = (outW - drawW) / 2;
    const drawY = (outH - drawH) / 2;

    // Crop subjectCanvas slice first if cropped
    const croppedSubject = document.createElement('canvas');
    croppedSubject.width = srcW;
    croppedSubject.height = srcH;
    const csCtx = croppedSubject.getContext('2d');
    if (!csCtx) throw new Error('Failed to crop subject.');
    csCtx.drawImage(subjectCanvas, srcX, srcY, srcW, srcH, 0, 0, srcW, srcH);

    drawSubjectWithEffects(outCtx, croppedSubject, drawX, drawY, drawW, drawH, options.effects);

    return await new Promise<Blob>((resolve, reject) => {
      outCanvas.toBlob(
        (blob) => {
          if (!blob) reject(new Error('Failed to encode exported image.'));
          else resolve(blob);
        },
        options.format,
        options.format === 'image/png' ? undefined : options.quality
      );
    });
  } finally {
    originalBitmap.close();
    bgBitmap?.close();
  }
}

export async function exportGrayscaleMaskPng(
  mask: Uint8ClampedArray,
  width: number,
  height: number
): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not create canvas for mask export.');

  const imgData = new ImageData(width, height);
  const dst = imgData.data;
  for (let i = 0, p = 0; i < mask.length; i += 1, p += 4) {
    const v = mask[i];
    dst[p] = v;
    dst[p + 1] = v;
    dst[p + 2] = v;
    dst[p + 3] = 255;
  }
  ctx.putImageData(imgData, 0, 0);

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) reject(new Error('Failed to encode mask PNG.'));
      else resolve(blob);
    }, 'image/png');
  });
}

export async function compositeResultBlob(
  resultBlob: Blob,
  background: BackgroundOption
): Promise<Blob> {
  if (background.type === 'transparent') {
    return resultBlob;
  }

  const bitmap = await createImageBitmap(resultBlob);
  let bgBitmap: ImageBitmap | null = null;
  if (background.type === 'image') {
    bgBitmap = await loadBgImageBitmap(background.dataUrl);
  }
  try {
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Could not create canvas context to export background.');
    }

    drawBackgroundOnContext(ctx, canvas.width, canvas.height, background, null, bgBitmap);
    ctx.drawImage(bitmap, 0, 0);

    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error('Failed to render PNG output.'));
          return;
        }
        resolve(blob);
      }, 'image/png');
    });
  } finally {
    bitmap.close();
    bgBitmap?.close();
  }
}

export function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function isClipboardImageSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof ClipboardItem !== 'undefined' &&
    Boolean(navigator.clipboard?.write)
  );
}

export async function copyPngBlobToClipboard(blobPromise: Promise<Blob>): Promise<void> {
  if (!isClipboardImageSupported()) {
    throw new Error('Clipboard image copy is not supported in this browser. Use Download PNG instead.');
  }

  try {
    const item = new ClipboardItem({ 'image/png': blobPromise });
    await navigator.clipboard.write([item]);
  } catch (err) {
    console.error('Clipboard write error:', err);
    throw new Error(
      'Could not copy image to clipboard (browser permission or Safari restriction). Use Download PNG instead.'
    );
  }
}
