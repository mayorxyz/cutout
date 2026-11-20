import { useState } from 'react';
import {
  ASPECT_PRESETS,
  type AspectPresetId,
  type BackgroundOption,
  type ExportFormat,
} from '../config';
import { CloseIcon, CopyIcon, DownloadIcon } from './icons';

interface ExportModalProps {
  open: boolean;
  onClose: () => void;
  originalWidth: number;
  originalHeight: number;
  background: BackgroundOption;
  onSelectPresetBackground: (bg: BackgroundOption) => void;
  onExportDownload: (opts: {
    format: ExportFormat;
    quality: number;
    cropToSubject: boolean;
    cropPaddingPx: number;
    aspectPreset: AspectPresetId;
    maxExportSidePx: number | null;
  }) => Promise<void>;
  onExportCopy: (opts: {
    cropToSubject: boolean;
    cropPaddingPx: number;
    aspectPreset: AspectPresetId;
    maxExportSidePx: number | null;
  }) => Promise<void>;
  onExportGrayscaleMask: () => Promise<void>;
  isExporting: boolean;
}

export function ExportModal({
  open,
  onClose,
  originalWidth,
  originalHeight,
  background,
  onSelectPresetBackground,
  onExportDownload,
  onExportCopy,
  onExportGrayscaleMask,
  isExporting,
}: ExportModalProps) {
  const [format, setFormat] = useState<ExportFormat>('image/png');
  const [quality, setQuality] = useState(92);
  const [cropToSubject, setCropToSubject] = useState(false);
  const [cropPaddingPx, setCropPaddingPx] = useState(24);
  const [aspectPreset, setAspectPreset] = useState<AspectPresetId>('original');
  const [maxSideChoice, setMaxSideChoice] = useState<'original' | '2048' | '1080' | 'custom'>(
    'original'
  );
  const [customMaxSide, setCustomMaxSide] = useState(1600);

  if (!open) return null;

  const maxExportSidePx =
    maxSideChoice === 'original'
      ? null
      : maxSideChoice === '2048'
        ? 2048
        : maxSideChoice === '1080'
          ? 1080
          : Math.max(64, customMaxSide);

  const handlePresetPick = (id: AspectPresetId) => {
    setAspectPreset(id);
    if (id === 'passport' && background.type === 'transparent') {
      onSelectPresetBackground({ type: 'color', value: '#ffffff', label: 'White' });
    } else if (id === 'product' && background.type === 'transparent') {
      onSelectPresetBackground({ type: 'color', value: '#ffffff', label: 'White' });
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Export cutout image"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4"
    >
      <div className="card-surface max-h-[90dvh] w-full max-w-lg overflow-y-auto p-6">
        <div className="flex items-center justify-between gap-4 border-b border-border pb-4">
          <div>
            <h2 className="text-lg font-semibold text-ink">Export cutout</h2>
            <p className="text-xs text-muted tabular-nums">
              Source resolution: {originalWidth} × {originalHeight} px
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close export modal"
            className="rounded-lg border border-border bg-surface p-2 text-muted hover:text-ink"
          >
            <CloseIcon className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-5 space-y-5 text-sm">
          {/* Format */}
          <div>
            <span className="block text-xs font-semibold text-ink">Format</span>
            <div className="mt-2 grid grid-cols-3 gap-2">
              {(
                [
                  { id: 'image/png', label: 'PNG (Alpha)' },
                  { id: 'image/jpeg', label: 'JPG' },
                  { id: 'image/webp', label: 'WebP' },
                ] as const
              ).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setFormat(item.id)}
                  aria-pressed={format === item.id}
                  className={`rounded-lg border py-2 text-xs font-medium transition-colors ${
                    format === item.id
                      ? 'border-accent bg-accent/15 text-ink'
                      : 'border-border bg-bg text-muted hover:text-ink'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
            {format === 'image/jpeg' && background.type === 'transparent' && (
              <p className="mt-1.5 text-xs text-amber-300">
                JPG does not support transparency — transparent areas will export as white.
              </p>
            )}
          </div>

          {format !== 'image/png' && (
            <div>
              <div className="flex justify-between text-xs text-muted">
                <label htmlFor="export-quality">Quality</label>
                <span className="font-mono tabular-nums text-ink">{quality}%</span>
              </div>
              <input
                id="export-quality"
                type="range"
                min={20}
                max={100}
                value={quality}
                onChange={(e) => setQuality(Number(e.target.value))}
                className="range-control mt-1 w-full cursor-pointer"
              />
            </div>
          )}

          {/* Presets */}
          <div>
            <label htmlFor="export-preset" className="block text-xs font-semibold text-ink">
              Canvas preset &amp; aspect ratio
            </label>
            <select
              id="export-preset"
              value={aspectPreset}
              onChange={(e) => handlePresetPick(e.target.value as AspectPresetId)}
              className="mt-1.5 w-full rounded-lg border border-border bg-bg px-3 py-2 text-xs text-ink"
            >
              {ASPECT_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.category}: {p.label}
                </option>
              ))}
            </select>
          </div>

          {/* Crop to subject */}
          <div className="space-y-2.5 rounded-lg border border-border bg-bg p-3.5">
            <label className="flex cursor-pointer items-center justify-between text-xs font-medium text-ink">
              <span>Crop to subject bounds</span>
              <input
                type="checkbox"
                checked={cropToSubject}
                onChange={(e) => setCropToSubject(e.target.checked)}
                className="h-4 w-4 rounded border-border accent-accent"
              />
            </label>

            {cropToSubject && (
              <div>
                <div className="flex justify-between text-xs text-muted">
                  <label htmlFor="crop-padding">Padding around subject</label>
                  <span className="font-mono tabular-nums text-ink">{cropPaddingPx} px</span>
                </div>
                <input
                  id="crop-padding"
                  type="range"
                  min={0}
                  max={160}
                  value={cropPaddingPx}
                  onChange={(e) => setCropPaddingPx(Number(e.target.value))}
                  className="range-control mt-1 w-full cursor-pointer"
                />
              </div>
            )}
          </div>

          {/* Size */}
          <div>
            <span className="block text-xs font-semibold text-ink">Output max dimension</span>
            <div className="mt-2 grid grid-cols-4 gap-2">
              {(
                [
                  { id: 'original', label: 'Original' },
                  { id: '2048', label: '2048 px' },
                  { id: '1080', label: '1080 px' },
                  { id: 'custom', label: 'Custom' },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setMaxSideChoice(opt.id)}
                  aria-pressed={maxSideChoice === opt.id}
                  className={`rounded-lg border py-1.5 text-xs font-medium ${
                    maxSideChoice === opt.id
                      ? 'border-accent bg-accent/15 text-ink'
                      : 'border-border bg-bg text-muted hover:text-ink'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            {maxSideChoice === 'custom' && (
              <div className="mt-2 flex items-center gap-2 text-xs">
                <label htmlFor="custom-max-px" className="text-muted">
                  Longest side (px):
                </label>
                <input
                  id="custom-max-px"
                  type="number"
                  min={64}
                  max={8000}
                  value={customMaxSide}
                  onChange={(e) => setCustomMaxSide(Number(e.target.value))}
                  className="w-28 rounded-lg border border-border bg-bg px-2.5 py-1 font-mono text-ink"
                />
              </div>
            )}
          </div>
        </div>

        <div className="mt-6 flex flex-col gap-2.5 border-t border-border pt-4">
          <div className="flex flex-wrap gap-2.5">
            <button
              type="button"
              disabled={isExporting}
              onClick={() =>
                void onExportDownload({
                  format,
                  quality: quality / 100,
                  cropToSubject,
                  cropPaddingPx,
                  aspectPreset,
                  maxExportSidePx,
                })
              }
              className="btn-primary inline-flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold disabled:opacity-50"
            >
              <DownloadIcon className="h-4 w-4" />
              <span>{isExporting ? 'Rendering...' : 'Download file'}</span>
            </button>

            <button
              type="button"
              disabled={isExporting}
              onClick={() =>
                void onExportCopy({
                  cropToSubject,
                  cropPaddingPx,
                  aspectPreset,
                  maxExportSidePx,
                })
              }
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-border bg-surface px-4 py-2.5 text-sm font-medium text-ink hover:bg-panel disabled:opacity-50"
            >
              <CopyIcon className="h-4 w-4" />
              <span>Copy PNG</span>
            </button>
          </div>

          <button
            type="button"
            disabled={isExporting}
            onClick={() => void onExportGrayscaleMask()}
            className="w-full rounded-lg border border-border bg-bg py-2 text-xs font-medium text-muted hover:bg-surface hover:text-ink disabled:opacity-50"
          >
            Export mask alone (grayscale PNG)
          </button>
        </div>
      </div>
    </div>
  );
}
