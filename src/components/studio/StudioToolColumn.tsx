import type { ToolId } from '../../config';
import type { StudioPhase } from '../../store/studioStore';
import {
  BrushIcon,
  CircleSelectIcon,
  CropBoxIcon,
  EraserIcon,
  EyedropperIcon,
  HandIcon,
  LassoIcon,
  MagnetIcon,
  PolygonIcon,
  RectIcon,
  ScribbleIcon,
  TargetIcon,
  WandIcon,
} from '../icons';

/* ---------- Blueprint Dark style tokens (design only) ---------- */
const MONO = 'font-mono uppercase tracking-[0.1em]';
const BTN_SOLID = `rounded-lg bg-white text-[#0c0d12] transition-colors duration-150 hover:bg-[#c9ccd6] disabled:cursor-not-allowed disabled:opacity-40 ${MONO} font-bold`;
const BTN_SOFT = `rounded-lg bg-[#1a1c24] text-white transition-colors duration-150 hover:bg-[#23252d] ${MONO} font-bold`;

interface StudioToolColumnProps {
  phase: StudioPhase;
  activeTool: ToolId;
  onSelectTool: (tool: ToolId) => void;
  onBackToSelection: () => void;
  hasSelection: boolean;
  onEraseBackground: () => void;
  onOpenMobileProperties: () => void;
}

interface ToolItem {
  id: ToolId;
  label: string;
  shortLabel: string;
  shortcut?: string;
  icon: React.ComponentType<{ className?: string }>;
}

const SELECT_TOOLS: ToolItem[] = [
  { id: 'pan', label: 'Pan / Hand', shortLabel: 'Pan', shortcut: 'V', icon: HandIcon },
  { id: 'select-brush', label: 'Select / Deselect brush', shortLabel: 'Brush', shortcut: 'B', icon: BrushIcon },
  { id: 'edge-brush', label: 'Edge-snapping brush', shortLabel: 'Edge', icon: WandIcon },
  { id: 'magic-wand', label: 'Magic Wand (CIELAB)', shortLabel: 'Wand', shortcut: 'W', icon: TargetIcon },
  { id: 'color-key', label: 'Color Key selection', shortLabel: 'Key', icon: EyedropperIcon },
  { id: 'grabcut-rect', label: 'GrabCut Box (OpenCV)', shortLabel: 'GrabCut', icon: CropBoxIcon },
  { id: 'scribble', label: 'FG/BG Scribbles (GrabCut / Watershed)', shortLabel: 'Scribble', icon: ScribbleIcon },
  { id: 'magnetic-lasso', label: 'Magnetic Lasso (Livewire)', shortLabel: 'Magnet', icon: MagnetIcon },
  { id: 'lasso', label: 'Freehand Lasso', shortLabel: 'Lasso', shortcut: 'L', icon: LassoIcon },
  { id: 'polygon-lasso', label: 'Polygon Lasso', shortLabel: 'Polygon', shortcut: 'P', icon: PolygonIcon },
  { id: 'rect', label: 'Rectangle Select', shortLabel: 'Rect', shortcut: 'M', icon: RectIcon },
  { id: 'ellipse', label: 'Ellipse Select', shortLabel: 'Ellipse', shortcut: 'E', icon: CircleSelectIcon },
];

const REFINE_TOOLS: ToolItem[] = [
  { id: 'pan', label: 'Pan / Hand', shortLabel: 'Pan', shortcut: 'V', icon: HandIcon },
  { id: 'restore', label: 'Restore brush', shortLabel: 'Restore', shortcut: 'B', icon: BrushIcon },
  { id: 'erase', label: 'Erase brush', shortLabel: 'Erase', shortcut: 'X', icon: EraserIcon },
  { id: 'edge-brush', label: 'Edge-snapping brush', shortLabel: 'Edge', icon: WandIcon },
];

export function StudioToolColumn({
  phase,
  activeTool,
  onSelectTool,
  onBackToSelection,
  hasSelection,
  onEraseBackground,
  onOpenMobileProperties,
}: StudioToolColumnProps) {
  const tools = phase === 'select' ? SELECT_TOOLS : REFINE_TOOLS;

  return (
    <>
      {/* Desktop Left Tool Column */}
      <aside
        aria-label="Studio tools"
        className="studio-scroll hidden w-[148px] shrink-0 flex-col justify-between overflow-y-auto bg-[#0c0d12] p-2 lg:flex"
      >
        <div className="space-y-1.5 rounded-xl bg-[#101117] p-2">
          <p className={`px-1.5 pb-1 text-[10px] text-[#7b7f8c] ${MONO}`}>
            {phase === 'select' ? 'Selection tools' : 'Mask brushes'}
          </p>
          <div role="radiogroup" aria-label="Editing tools" className="grid grid-cols-1 gap-0.5">
            {tools.map((tool) => {
              const Icon = tool.icon;
              const active = activeTool === tool.id;
              return (
                <button
                  key={tool.id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  title={tool.shortcut ? `${tool.label} (${tool.shortcut})` : tool.label}
                  onClick={() => onSelectTool(tool.id)}
                  className={`flex min-h-9 items-center justify-between gap-2 rounded-lg px-2.5 text-[11px] font-bold whitespace-nowrap transition-colors duration-150 ${MONO} ${
                    active
                      ? 'bg-white text-[#0c0d12]'
                      : 'text-[#7b7f8c] hover:bg-[#1a1c24] hover:text-white'
                  }`}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <Icon className="h-4 w-4 shrink-0" />
                    <span className="truncate">{tool.shortLabel}</span>
                  </span>
                  {tool.shortcut && (
                    <kbd
                      className={`font-mono text-[10px] ${active ? 'text-[#0c0d12]/60' : 'text-[#555966]'}`}
                    >
                      {tool.shortcut}
                    </kbd>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {phase === 'refine' && (
          <div className="mt-2">
            <button
              type="button"
              onClick={onBackToSelection}
              className={`${BTN_SOFT} min-h-9 w-full px-2.5 text-[10px] whitespace-nowrap`}
            >
              ← Selection
            </button>
          </div>
        )}
      </aside>

      {/* Mobile Bottom Tool Sheet */}
      <div className="shrink-0 rounded-t-2xl bg-[#101117] px-2 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] lg:hidden">
        <div
          className="studio-scroll flex items-center gap-1 overflow-x-auto pb-1.5"
          role="radiogroup"
          aria-label="Mobile studio tools"
        >
          {tools.map((tool) => {
            const Icon = tool.icon;
            const active = activeTool === tool.id;
            return (
              <button
                key={tool.id}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => onSelectTool(tool.id)}
                className={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-[10px] font-bold whitespace-nowrap transition-colors duration-150 ${MONO} ${
                  active ? 'bg-white text-[#0c0d12]' : 'bg-[#0c0d12] text-[#7b7f8c]'
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                <span>{tool.shortLabel}</span>
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-1.5 pt-0.5">
          {phase === 'select' ? (
            <button
              type="button"
              disabled={!hasSelection}
              onClick={onEraseBackground}
              className={`${BTN_SOLID} h-9 flex-1 text-[10px] whitespace-nowrap`}
            >
              Erase background
            </button>
          ) : (
            <button
              type="button"
              onClick={onBackToSelection}
              className={`${BTN_SOFT} h-9 flex-1 text-[10px] whitespace-nowrap`}
            >
              ← Back to selection
            </button>
          )}
          <button
            type="button"
            onClick={onOpenMobileProperties}
            className={`${BTN_SOFT} h-9 px-3.5 text-[10px] whitespace-nowrap`}
          >
            Properties
          </button>
        </div>
      </div>
    </>
  );
}