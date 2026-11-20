import type { ToolId } from '../../config';
import type { AutoSaveStatus, StudioPhase } from '../../store/studioStore';

interface StudioStatusBarProps {
  phase: StudioPhase;
  activeTool: ToolId;
  toolSizeLabel: string;
  zoom: number;
  width: number;
  height: number;
  autoSaveStatus: AutoSaveStatus;
}

const TOOL_NAMES: Record<ToolId, string> = {
  pan: 'Pan / Hand',
  'select-brush': 'Select Brush',
  restore: 'Restore Brush',
  erase: 'Erase Brush',
  'edge-brush': 'Edge-Snapping Brush',
  'grabcut-rect': 'GrabCut Box',
  scribble: 'FG/BG Scribbles',
  'magnetic-lasso': 'Magnetic Lasso',
  'magic-wand': 'Magic Wand',
  'color-key': 'Color Key',
  'bg-eyedropper': 'Background Eyedropper',
  lasso: 'Freehand Lasso',
  'polygon-lasso': 'Polygon Lasso',
  rect: 'Rectangle Select',
  ellipse: 'Ellipse Select',
};

export function StudioStatusBar({
  phase,
  activeTool,
  toolSizeLabel,
  zoom,
  width,
  height,
  autoSaveStatus,
}: StudioStatusBarProps) {
  const saveLabel =
    autoSaveStatus === 'saving'
      ? 'Saving...'
      : autoSaveStatus === 'saved'
        ? 'Saved locally'
        : 'Local session';

  return (
    <footer className="flex h-7 shrink-0 items-center justify-between gap-3 border-t border-border bg-panel px-3 text-[11px] text-muted">
      <div className="flex min-w-0 items-center gap-2.5 truncate">
        <span className="font-medium text-ink whitespace-nowrap">
          {phase === 'select' ? '1. Select' : '2. Refine'}
        </span>
        <span aria-hidden="true">·</span>
        <span className="truncate text-ink">{TOOL_NAMES[activeTool]}</span>
        <span aria-hidden="true" className="hidden sm:inline">·</span>
        <span className="hidden font-mono tabular-nums sm:inline">{toolSizeLabel}</span>
      </div>

      <div className="flex shrink-0 items-center gap-2.5 font-mono tabular-nums">
        <span>{Math.round(zoom * 100)}%</span>
        <span aria-hidden="true" className="hidden sm:inline">·</span>
        <span className="hidden sm:inline">
          {width} × {height} px
        </span>
        <span aria-hidden="true">·</span>
        <span className="font-sans text-muted">{saveLabel}</span>
      </div>
    </footer>
  );
}
