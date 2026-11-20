import { Link } from 'react-router-dom';
import type { AutoCandidateStatus } from '../../hooks/useBackgroundRemoval';
import { ShortcutsHelp } from '../ShortcutsHelp';
import {
  BrandMark,
  DownloadIcon,
  RedoIcon,
  ResetIcon,
  UndoIcon,
  UploadIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from '../icons';

/* ---------- Blueprint Dark style tokens (design only) ---------- */
const MONO = 'font-mono uppercase tracking-[0.1em]';
const BTN =
  'inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-lg bg-[#101117] px-2 text-[10px] font-bold text-white transition-colors duration-150 hover:bg-[#1a1c24] disabled:cursor-not-allowed disabled:text-[#555966] disabled:hover:bg-[#101117] sm:h-9 sm:px-3 sm:text-[11px]';
const ICON = 'h-3.5 w-3.5 shrink-0';

interface StudioTopBarProps {
  fileName: string | null;
  hasImage: boolean;
  autoStatus: AutoCandidateStatus;
  autoProgress: number;
  canUndo: boolean;
  canRedo: boolean;
  canReset: boolean;
  zoom: number;
  onUndo: () => void;
  onRedo: () => void;
  onRequestReset: () => void;
  onZoomOut: () => void;
  onZoomIn: () => void;
  onZoomReset: () => void;
  onOpenFilePicker: () => void;
  onOpenExport: () => void;
  onRequestLeaveHome: (e: React.MouseEvent) => void;
  batchMode: boolean;
  onToggleBatchMode: () => void;
}

export function StudioTopBar({
  fileName,
  hasImage,
  autoStatus,
  autoProgress,
  canUndo,
  canRedo,
  canReset,
  zoom,
  onUndo,
  onRedo,
  onRequestReset,
  onZoomOut,
  onZoomIn,
  onZoomReset,
  onOpenFilePicker,
  onOpenExport,
  onRequestLeaveHome,
  batchMode,
  onToggleBatchMode,
}: StudioTopBarProps) {
  const autoLabel =
    autoStatus === 'running'
      ? `Preparing auto result... (${Math.round(autoProgress)}%)`
      : autoStatus === 'ready'
        ? 'Result ready'
        : autoStatus === 'low-confidence'
          ? 'Auto ready (low confidence)'
          : autoStatus === 'failed'
            ? 'Auto unavailable for this image'
            : '';

  const dotTone =
    autoStatus === 'ready'
      ? 'bg-[#0fa36b]'
      : autoStatus === 'failed' || autoStatus === 'low-confidence'
        ? 'bg-[#e07b00]'
        : 'bg-[#2f6bff] animate-pulse';

  return (
    <header className="flex h-11 shrink-0 items-center justify-between gap-1.5 border-b border-[#23252d] bg-[#0c0d12] px-2 sm:h-14 sm:gap-2 sm:px-4">
      {/* Left: Home brand + File name + Silent Auto Chip */}
      <div className="flex min-w-0 items-center gap-1.5 sm:gap-2">
        <Link
          to="/"
          onClick={onRequestLeaveHome}
          title="Back to home"
          aria-label="Cutout Home"
          className={`inline-flex h-8 shrink-0 items-center gap-2 rounded-lg px-1.5 text-[12px] font-extrabold whitespace-nowrap text-white transition-colors duration-150 hover:bg-[#101117] sm:h-9 sm:px-2 ${MONO}`}
        >
          <BrandMark className="h-5 w-5 shrink-0 sm:h-6 sm:w-6" />
          <span className="hidden sm:inline">Cutout</span>
        </Link>

        {fileName && !batchMode && (
          <span
            className={`hidden max-w-[160px] truncate text-[10px] text-[#7b7f8c] md:inline lg:max-w-[240px] ${MONO}`}
          >
            {fileName}
          </span>
        )}

        {hasImage && !batchMode && autoStatus !== 'idle' && (
          <div
            role="status"
            aria-live="polite"
            title={autoLabel}
            className={`inline-flex h-6 min-w-0 max-w-[86px] items-center gap-1.5 rounded-md bg-[#101117] px-2 text-[9px] font-bold whitespace-nowrap sm:h-7 sm:max-w-[260px] sm:text-[10px] ${MONO} ${
              autoStatus === 'ready'
                ? 'text-[#5fd6a3]'
                : autoStatus === 'failed' || autoStatus === 'low-confidence'
                  ? 'text-[#f0b060]'
                  : 'text-[#7b7f8c]'
            }`}
          >
            <span aria-hidden="true" className={`h-1.5 w-1.5 shrink-0 rounded-full ${dotTone}`} />
            <span className="hidden truncate sm:inline">{autoLabel}</span>
            <span className="truncate sm:hidden">
              {autoStatus === 'running'
                ? 'Auto...'
                : autoStatus === 'ready'
                  ? 'Ready'
                  : autoStatus === 'low-confidence'
                    ? 'Low conf.'
                    : 'Manual'}
            </span>
          </div>
        )}
      </div>

      {/* Right: Undo, Redo, Big Reset, Zoom, Batch/Open, Shortcuts, Download */}
      <div className="flex shrink-0 items-center gap-1 sm:gap-1.5">
        {!hasImage && (
          <button
            type="button"
            onClick={onToggleBatchMode}
            className={`inline-flex h-8 items-center rounded-lg px-3 text-[10px] font-bold whitespace-nowrap transition-colors duration-150 sm:h-9 sm:text-[11px] ${MONO} ${
              batchMode
                ? 'bg-white text-[#0c0d12]'
                : 'bg-[#101117] text-[#7b7f8c] hover:text-white'
            }`}
          >
            {batchMode ? 'Single studio' : 'Batch ZIP'}
          </button>
        )}

        {hasImage && !batchMode && (
          <>
            <button
              type="button"
              onClick={onUndo}
              disabled={!canUndo}
              title="Undo (Ctrl/Cmd+Z)"
              aria-label="Undo"
              className={`${BTN} ${MONO}`}
            >
              <UndoIcon className={ICON} />
              <span className="hidden xl:inline">Undo</span>
            </button>

            <button
              type="button"
              onClick={onRedo}
              disabled={!canRedo}
              title="Redo (Ctrl/Cmd+Shift+Z)"
              aria-label="Redo"
              className={`${BTN} ${MONO}`}
            >
              <RedoIcon className={ICON} />
              <span className="hidden xl:inline">Redo</span>
            </button>

            {/* Prominent high-contrast Reset button */}
            <button
              type="button"
              onClick={onRequestReset}
              disabled={!canReset}
              title="Reset all changes to original image"
              aria-label="Reset all changes"
              className={`inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-lg px-2 text-[10px] font-bold whitespace-nowrap transition-colors duration-150 sm:h-9 sm:px-3 sm:text-[11px] ${MONO} ${
                canReset
                  ? 'bg-white text-[#0c0d12] hover:bg-[#c9ccd6]'
                  : 'cursor-not-allowed bg-[#101117] text-[#555966]'
              }`}
            >
              <ResetIcon className={ICON} />
              <span className="hidden sm:inline">Reset</span>
            </button>

            {/* Zoom controls (desktop) */}
            <div className="hidden items-center gap-0.5 rounded-lg bg-[#101117] p-0.5 md:flex">
              <button
                type="button"
                onClick={onZoomOut}
                aria-label="Zoom out"
                title="Zoom out"
                className="inline-flex h-8 w-8 items-center justify-center rounded-md text-[#7b7f8c] transition-colors duration-150 hover:bg-[#1a1c24] hover:text-white"
              >
                <ZoomOutIcon className={ICON} />
              </button>
              <button
                type="button"
                onClick={onZoomReset}
                title="Reset zoom to Fit"
                className="min-w-12 rounded-md px-1.5 font-mono text-[11px] tabular-nums text-white transition-colors duration-150 hover:bg-[#1a1c24]"
              >
                {Math.round(zoom * 100)}%
              </button>
              <button
                type="button"
                onClick={onZoomIn}
                aria-label="Zoom in"
                title="Zoom in"
                className="inline-flex h-8 w-8 items-center justify-center rounded-md text-[#7b7f8c] transition-colors duration-150 hover:bg-[#1a1c24] hover:text-white"
              >
                <ZoomInIcon className={ICON} />
              </button>
            </div>

            <button
              type="button"
              onClick={onOpenFilePicker}
              title="Open another image"
              aria-label="Open another image"
              className={`${BTN} ${MONO} hidden sm:inline-flex`}
            >
              <UploadIcon className={ICON} />
              <span className="hidden lg:inline">Open</span>
            </button>

            <div className="hidden sm:block">
              <ShortcutsHelp />
            </div>

            <button
              type="button"
              onClick={onOpenExport}
              title="Download"
              aria-label="Download"
              className={`inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-lg bg-white px-2.5 text-[10px] font-bold whitespace-nowrap text-[#0c0d12] transition-colors duration-150 hover:bg-[#c9ccd6] sm:h-9 sm:px-4 sm:text-[11px] ${MONO}`}
            >
              <DownloadIcon className={ICON} />
              <span className="hidden min-[400px]:inline">Download</span>
            </button>
          </>
        )}
      </div>
    </header>
  );
}