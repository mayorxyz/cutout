import { zipSync } from 'fflate';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { AutoRemoveSettings } from '../config';
import { formatBytes, formatDimensions } from '../lib/format';
import {
  buildDownloadFileName,
  exportFullResolutionCutout,
  triggerBlobDownload,
  validateAndPrepareImage,
} from '../lib/image';
import { cloneToArrayBuffer } from '../lib/maskAlgorithms';
import type { BgWorkerRequestMessage, BgWorkerResponseMessage } from '../workers/bgRemoval.worker';
import { DownloadIcon, UploadIcon } from './icons';

export interface BatchItem {
  id: string;
  file: File;
  status: 'queued' | 'processing' | 'done' | 'error';
  progress: number;
  error?: string;
  previewUrl?: string;
  originalBlob?: Blob;
  workingWidth?: number;
  workingHeight?: number;
  workingRgba?: Uint8ClampedArray;
  mask?: Uint8ClampedArray;
  outputPngBlob?: Blob;
  originalWidth?: number;
  originalHeight?: number;
}

interface BatchPanelProps {
  autoSettings: AutoRemoveSettings;
  onEditItemInStudio: (item: BatchItem) => void;
}

export function BatchPanel({ autoSettings, onEditItemInStudio }: BatchPanelProps) {
  const [items, setItems] = useState<BatchItem[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const cancelFlagRef = useRef(false);
  const itemsRef = useRef<BatchItem[]>([]);
  itemsRef.current = items;

  useEffect(() => {
    return () => {
      cancelFlagRef.current = true;
      itemsRef.current.forEach((it) => {
        if (it.previewUrl) URL.revokeObjectURL(it.previewUrl);
      });
    };
  }, []);

  const addFiles = (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    const next: BatchItem[] = Array.from(fileList).map((file, idx) => ({
      id: `${Date.now()}-${idx}-${file.name}`,
      file,
      status: 'queued',
      progress: 0,
    }));
    setItems((prev) => [...prev, ...next]);
  };

  const runWorkerOnFile = useCallback(
    (
      rgba: Uint8ClampedArray,
      width: number,
      height: number,
      onProgress: (pct: number) => void
    ): Promise<Uint8ClampedArray> => {
      return new Promise((resolve, reject) => {
        const worker = new Worker(new URL('../workers/bgRemoval.worker.ts', import.meta.url), {
          type: 'module',
        });
        const reqId = Date.now();
        worker.onmessage = (e: MessageEvent<BgWorkerResponseMessage>) => {
          if (e.data.requestId !== reqId) return;
          if (e.data.type === 'progress') {
            onProgress(Math.min(95, e.data.progress));
          } else if (e.data.type === 'done') {
            worker.terminate();
            resolve(new Uint8ClampedArray(e.data.maskBuffer));
          } else if (e.data.type === 'error') {
            worker.terminate();
            reject(new Error(e.data.message));
          }
        };
        worker.onerror = (err) => {
          worker.terminate();
          reject(new Error(err.message || 'Batch worker error'));
        };
        const rgbaBuf = cloneToArrayBuffer(rgba);
        worker.postMessage(
          {
            requestId: reqId,
            rgbaBuffer: rgbaBuf,
            width,
            height,
            settings: autoSettings,
          } satisfies BgWorkerRequestMessage,
          { transfer: [rgbaBuf] }
        );
      });
    },
    [autoSettings]
  );

  const startQueue = async () => {
    if (isRunning) return;
    cancelFlagRef.current = false;
    setIsRunning(true);

    const snapshot = [...itemsRef.current];
    for (const item of snapshot) {
      if (cancelFlagRef.current) break;
      if (item.status === 'done') continue;

      setItems((prev) =>
        prev.map((it) => (it.id === item.id ? { ...it, status: 'processing', progress: 10 } : it))
      );

      try {
        const prepared = await validateAndPrepareImage(item.file);
        const mask = await runWorkerOnFile(
          prepared.workingRgba,
          prepared.workingWidth,
          prepared.workingHeight,
          (pct) => {
            setItems((prev) =>
              prev.map((it) => (it.id === item.id ? { ...it, progress: pct } : it))
            );
          }
        );

        const pngBlob = await exportFullResolutionCutout(
          prepared.previewBlob,
          mask,
          prepared.workingWidth,
          prepared.workingHeight,
          {
            format: 'image/png',
            quality: 1,
            background: { type: 'transparent' },
            cropToSubject: false,
            cropPaddingPx: 0,
            aspectPreset: 'original',
            maxExportSidePx: null,
            effects: {
              shadowEnabled: false,
              shadowBlur: 18,
              shadowOffsetY: 8,
              shadowOpacity: 0.35,
              shadowColor: '#000000',
              outlineEnabled: false,
              outlineWidth: 8,
              outlineColor: '#ffffff',
            },
            refine: {
              featherPx: 0,
              shiftPx: 0,
              smoothRadius: 0,
              decontaminate: false,
              hairMatting: false,
            },
          }
        );

        const previewUrl = URL.createObjectURL(pngBlob);
        setItems((prev) =>
          prev.map((it) =>
            it.id === item.id
              ? {
                  ...it,
                  status: 'done',
                  progress: 100,
                  previewUrl,
                  originalBlob: prepared.previewBlob,
                  workingWidth: prepared.workingWidth,
                  workingHeight: prepared.workingHeight,
                  workingRgba: prepared.workingRgba,
                  mask,
                  outputPngBlob: pngBlob,
                  originalWidth: prepared.width,
                  originalHeight: prepared.height,
                }
              : it
          )
        );
      } catch (err) {
        setItems((prev) =>
          prev.map((it) =>
            it.id === item.id
              ? {
                  ...it,
                  status: 'error',
                  error: err instanceof Error ? err.message : 'Failed to process',
                }
              : it
          )
        );
      }
    }

    setIsRunning(false);
  };

  const downloadZip = async () => {
    const doneItems = items.filter((it) => it.status === 'done' && it.outputPngBlob);
    if (doneItems.length === 0) return;

    const filesMap: Record<string, Uint8Array> = {};
    const usedNames = new Map<string, number>();

    for (const item of doneItems) {
      let name = buildDownloadFileName(item.file.name, 'image/png');
      const count = usedNames.get(name) ?? 0;
      usedNames.set(name, count + 1);
      if (count > 0) {
        name = name.replace(/\.png$/, `-${count + 1}.png`);
      }
      const bytes = new Uint8Array(await item.outputPngBlob!.arrayBuffer());
      filesMap[name] = bytes;
    }

    const zipped = zipSync(filesMap, { level: 1 });
    const zipBytes = new Uint8Array(zipped.byteLength);
    zipBytes.set(zipped);
    triggerBlobDownload(new Blob([zipBytes], { type: 'application/zip' }), 'cutout-batch.zip');
  };

  const completedCount = items.filter((i) => i.status === 'done').length;

  return (
    <div className="space-y-6">
      <div className="card-surface flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-base font-semibold text-ink">Batch plain-background removal</h2>
          <p className="mt-1 text-xs text-muted">
            Uses local CIELAB border sampling &amp; classical segmentation (Tolerance{' '}
            {autoSettings.tolerance}, Edge softness {autoSettings.edgeSoftness}). Pack results
            offline with fflate ZIP.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <input
            ref={inputRef}
            type="file"
            multiple
            accept="image/png,image/jpeg,image/webp"
            onChange={(e) => {
              addFiles(e.target.files);
              e.target.value = '';
            }}
            className="sr-only"
          />
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="inline-flex items-center gap-2 rounded-lg border border-border bg-surface px-4 py-2 text-xs font-medium text-ink hover:bg-panel"
          >
            <UploadIcon className="h-4 w-4" />
            <span>Add images</span>
          </button>

          {items.some((i) => i.status === 'queued') && (
            <button
              type="button"
              disabled={isRunning}
              onClick={() => void startQueue()}
              className="btn-primary rounded-lg px-4 py-2 text-xs font-semibold disabled:opacity-50"
            >
              {isRunning
                ? 'Processing queue...'
                : `Process ${items.filter((i) => i.status === 'queued').length} queued`}
            </button>
          )}

          {completedCount > 0 && (
            <button
              type="button"
              onClick={() => void downloadZip()}
              className="btn-primary inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-semibold"
            >
              <DownloadIcon className="h-4 w-4" />
              <span>Download ZIP ({completedCount})</span>
            </button>
          )}
        </div>
      </div>

      {items.length === 0 ? (
        <div
          onClick={() => inputRef.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              inputRef.current?.click();
            }
          }}
          className="card-surface flex min-h-[240px] cursor-pointer flex-col items-center justify-center border-2 border-dashed border-border p-8 text-center hover:border-accent/60"
        >
          <UploadIcon className="h-8 w-8 text-accent" />
          <p className="mt-3 text-sm font-medium text-ink">
            Select multiple PNG, JPEG, or WebP files
          </p>
          <p className="mt-1 text-xs text-muted">
            Every file is processed locally in your browser without uploads or AI and packed into a ZIP.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => (
            <div key={item.id} className="card-surface flex flex-col overflow-hidden p-3 space-y-3">
              <div className="checkerboard relative aspect-[4/3] w-full overflow-hidden rounded-lg border border-border">
                {item.previewUrl ? (
                  <img
                    src={item.previewUrl}
                    alt={item.file.name}
                    className="h-full w-full object-contain"
                  />
                ) : (
                  <div className="flex h-full items-center justify-center text-xs text-muted">
                    {item.status === 'processing'
                      ? `Processing (${item.progress}%)...`
                      : item.status === 'error'
                        ? 'Failed'
                        : 'Queued'}
                  </div>
                )}
              </div>

              <div className="min-w-0 flex-1 space-y-1">
                <p className="truncate text-xs font-semibold text-ink">{item.file.name}</p>
                <p className="text-[11px] text-muted tabular-nums">
                  {formatBytes(item.file.size)}
                  {item.originalWidth && item.originalHeight
                    ? ` · ${formatDimensions(item.originalWidth, item.originalHeight)}`
                    : ''}
                </p>
                {item.error && <p className="text-[11px] text-red-400">{item.error}</p>}
              </div>

              {item.status === 'done' && (
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => onEditItemInStudio(item)}
                    className="flex-1 rounded-lg border border-border bg-surface py-1.5 text-xs font-medium text-ink hover:bg-panel"
                  >
                    Edit mask
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      item.outputPngBlob &&
                      triggerBlobDownload(
                        item.outputPngBlob,
                        buildDownloadFileName(item.file.name, 'image/png')
                      )
                    }
                    className="rounded-lg border border-border bg-bg px-3 py-1.5 text-xs font-medium text-ink hover:bg-surface"
                  >
                    PNG
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
