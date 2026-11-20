import type { ReactNode } from 'react';
import type {
  AutoRemoveSettings,
  BackgroundOption,
  OutputEffectSettings,
  RefineSettings,
  ScribblePolarity,
  SelectionCombineMode,
  ToolId,
} from '../../config';
import type { AutoCandidateStatus } from '../../hooks/useBackgroundRemoval';
import type { CompareSnapshotRecord } from '../../lib/projectDb';
import type { StudioPhase, StudioViewMode } from '../../store/studioStore';
import { BackgroundPicker } from '../BackgroundPicker';
import { EyedropperIcon, EyeIcon, InvertIcon } from '../icons';

/* ---------- Blueprint Dark tokens ---------- */
const MONO = 'font-mono uppercase tracking-[0.1em]';
const BORDER = 'border border-[#2c2f3a]';
const LBL = `${MONO} text-[10px] text-[#8a8e9c]`;
const SEC = `${BORDER} space-y-3 rounded-lg bg-[#101117] p-3`;
const RANGE = 'range-control block w-full cursor-pointer';
const CHECK = 'h-4 w-4 shrink-0 cursor-pointer rounded border-[#4a4d5a] accent-white';
const HINT = 'text-[11px] leading-snug text-[#8a8e9c] sm:text-xs';
const BTN = `${MONO} inline-flex min-h-10 min-w-0 items-center justify-center gap-2 rounded-md px-3 text-[10px] font-bold leading-tight transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-40 sm:text-[11px]`;
const BTN_OUT = `${BTN} ${BORDER} bg-[#1a1c24] text-white hover:bg-[#23252d]`;
const BTN_SOLID = `${BTN} border border-white bg-white text-[#0c0d12] hover:bg-[#c9ccd6]`;
const BTN_GHOST = `${BTN} ${BORDER} bg-[#0c0d12] text-[#8a8e9c] hover:text-white`;
const BTN_BLUE = `${BTN} border border-[#2f6bff] bg-[#2f6bff]/20 text-white hover:bg-[#2f6bff]/35`;
const SUM = `flex min-h-10 cursor-pointer select-none items-center justify-between gap-2 px-3 ${LBL} hover:text-white`;

type Tone = 'green' | 'red';

function segCls(active: boolean, tone?: Tone): string {
  const base = `${MONO} min-h-9 min-w-0 break-words rounded px-1.5 text-center text-[10px] font-bold leading-tight transition-colors duration-150`;
  if (!active) return `${base} border border-transparent text-[#8a8e9c] hover:text-white`;
  if (tone === 'green') return `${base} border border-[#0fa36b] bg-[#0fa36b] text-white`;
  if (tone === 'red') return `${base} border border-[#c23b3b] bg-[#c23b3b] text-white`;
  return `${base} border border-white bg-white text-[#0c0d12]`;
}

interface SegItem<T extends string> {
  id: T;
  label: string;
  tone?: Tone;
}

function Seg<T extends string>({
  items,
  value,
  onChange,
  label,
}: {
  items: readonly SegItem<T>[];
  value: T;
  onChange: (v: T) => void;
  label?: string;
}) {
  const cols =
    items.length === 3 ? 'grid-cols-3' : 'grid-cols-2';
  return (
    <div role="group" aria-label={label} className={`grid ${cols} gap-1 rounded-md ${BORDER} bg-[#0c0d12] p-1`}>
      {items.map((it) => (
        <button
          key={it.id}
          type="button"
          aria-pressed={value === it.id}
          onClick={() => onChange(it.id)}
          className={segCls(value === it.id, it.tone)}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}

function Cap({ title, right }: { title: string; right?: ReactNode }) {
  return (
    <div className="flex min-h-6 items-center justify-between gap-2 border-b border-[#2c2f3a] pb-2">
      <span className={LBL}>{title}</span>
      {right}
    </div>
  );
}

function SliderRow({
  id,
  label,
  display,
  min,
  max,
  value,
  onChange,
}: {
  id: string;
  label: string;
  display: ReactNode;
  min: number;
  max: number;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={id} className={`${LBL} min-w-0 truncate`}>
          {label}
        </label>
        <span className="shrink-0 font-mono text-[11px] tabular-nums text-white">{display}</span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className={RANGE}
      />
    </div>
  );
}

function Toggle({
  label,
  checked,
  onChange,
  textClass = 'text-[#c9ccd6]',
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  textClass?: string;
}) {
  return (
    <label
      className={`flex min-h-10 cursor-pointer items-center justify-between gap-3 rounded-md ${BORDER} bg-[#0c0d12] px-3 text-xs ${textClass}`}
    >
      <span className="min-w-0">{label}</span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className={CHECK} />
    </label>
  );
}

function Hint({ children, blue }: { children: ReactNode; blue?: boolean }) {
  return <p className={blue ? 'text-[11px] leading-snug text-[#2f6bff] sm:text-xs' : HINT}>{children}</p>;
}

function Collapse({
  title,
  children,
  open,
  body = 'space-y-3 p-3 pt-1',
}: {
  title: ReactNode;
  children: ReactNode;
  open?: boolean;
  body?: string;
}) {
  return (
    <details open={open} className={`${BORDER} rounded-lg bg-[#101117]`}>
      <summary className={SUM}>
        <span className="min-w-0 truncate">{title}</span>
        <span aria-hidden="true" className="shrink-0">
          +
        </span>
      </summary>
      <div className={body}>{children}</div>
    </details>
  );
}

function BrushSliders({
  p,
  size,
  hard,
  op,
  smooth,
  onSize,
  onHard,
  onOp,
  onSmooth,
}: {
  p: string;
  size: number;
  hard: number;
  op: number;
  smooth: boolean;
  onSize: (v: number) => void;
  onHard: (v: number) => void;
  onOp: (v: number) => void;
  onSmooth: (v: boolean) => void;
}) {
  return (
    <div className="space-y-3">
      <SliderRow id={`${p}-size`} label="Brush size" display={`${size} px`} min={1} max={300} value={size} onChange={onSize} />
      <div className="grid grid-cols-2 gap-3">
        <SliderRow id={`${p}-hard`} label="Hardness" display={`${hard}%`} min={0} max={100} value={hard} onChange={onHard} />
        <SliderRow id={`${p}-op`} label="Opacity" display={`${op}%`} min={1} max={100} value={op} onChange={onOp} />
      </div>
      <Toggle label="Stroke smoothing" checked={smooth} onChange={onSmooth} />
    </div>
  );
}

const SELECT_MODES = [
  { id: 'add', label: '+ Select', tone: 'green' },
  { id: 'subtract', label: '− Deselect', tone: 'red' },
] as const;
const EDGE_MODES = [
  { id: 'restore', label: '+ Select edge', tone: 'green' },
  { id: 'erase', label: '− Deselect edge', tone: 'red' },
] as const;
const REFINE_MODES = [
  { id: 'restore', label: 'Restore', tone: 'green' },
  { id: 'erase', label: 'Erase', tone: 'red' },
] as const;
const SCRIBBLE_MODES = [
  { id: 'fg', label: 'Green = Keep', tone: 'green' },
  { id: 'bg', label: 'Red = Exclude', tone: 'red' },
] as const;
const COMBINE_MODES = [
  { id: 'replace', label: 'New' },
  { id: 'add', label: 'Add' },
  { id: 'subtract', label: 'Subtract' },
  { id: 'intersect', label: 'Intersect' },
] as const;
const AUTO_MODES = [
  { id: 'auto', label: 'Auto' },
  { id: 'plain', label: 'Plain' },
  { id: 'complex', label: 'Complex' },
] as const;
const EDGE_TOUCH = [
  { id: 'auto', label: 'Auto' },
  { id: 'yes', label: 'Yes' },
  { id: 'no', label: 'No' },
] as const;
const VIEW_MODES = [
  { id: 'edit', label: 'Result' },
  { id: 'split', label: 'Split' },
  { id: 'compare', label: 'Before/After' },
] as const;

const RGB = (c: readonly number[]) => `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
const signed = (n: number) => (n > 0 ? `+${n}` : `${n}`);

interface StudioPropertiesPanelProps {
  phase: StudioPhase;
  hasAppliedMask: boolean;
  hasSelection: boolean;
  onSelectPhaseStep: (target: StudioPhase) => void;
  onBackToSelection: () => void;

  // Tool settings
  activeTool: ToolId;
  brushSize: number;
  onBrushSizeChange: (val: number) => void;
  brushHardness: number;
  onBrushHardnessChange: (val: number) => void;
  brushStrength: number;
  onBrushStrengthChange: (val: number) => void;
  brushSmoothing: boolean;
  onBrushSmoothingChange: (val: boolean) => void;

  selectBrushMode: 'add' | 'subtract';
  onSelectBrushModeChange: (mode: 'add' | 'subtract') => void;
  refineBrushMode: 'restore' | 'erase';
  onRefineBrushModeChange: (mode: 'restore' | 'erase') => void;
  edgeBrushMode: 'restore' | 'erase';
  onEdgeBrushModeChange: (mode: 'restore' | 'erase') => void;
  edgeBrushTolerance: number;
  onEdgeBrushToleranceChange: (val: number) => void;

  // GrabCut / Scribbles
  grabCutIterations: number;
  onGrabCutIterationsChange: (val: number) => void;
  scribblePolarity: ScribblePolarity;
  onScribblePolarityChange: (pol: ScribblePolarity) => void;
  scribbleBrushSize: number;
  onScribbleBrushSizeChange: (val: number) => void;
  hasScribbles: boolean;
  onRunGrabCutScribbles: () => void;
  onRunWatershedScribbles: () => void;
  onClearScribbles: () => void;
  cvBusyText: string | null;

  // Wand & Color Key
  wandTolerance: number;
  onWandToleranceChange: (val: number) => void;
  wandContiguous: boolean;
  onWandContiguousChange: (val: boolean) => void;
  colorKeyRgb: [number, number, number] | null;
  colorKeyTolerance: number;
  onColorKeyToleranceChange: (val: number) => void;
  colorKeySoftness: number;
  onColorKeySoftnessChange: (val: number) => void;

  // Selection Modifiers
  combineMode: SelectionCombineMode;
  onCombineModeChange: (mode: SelectionCombineMode) => void;
  selectionFeather: number;
  onSelectionFeatherChange: (val: number) => void;
  selectionExpand: number;
  onSelectionExpandChange: (val: number) => void;
  showSelectionOverlay: boolean;
  onShowSelectionOverlayChange: (val: boolean) => void;
  onInvertSelection: () => void;
  onClearSelection: () => void;

  // Phase 1 Actions & Silent Auto Settings
  autoStatus: AutoCandidateStatus;
  autoProgress: number;
  pendingAutoApply: boolean;
  autoSettings: AutoRemoveSettings;
  onAutoSettingsChange: (next: AutoRemoveSettings) => void;
  onPickBgColorTool: () => void;
  onEraseBackground: () => void;
  onEraseSelection: () => void;
  onRequestAutoRemove: () => void;
  autoCandidatesCount: number;
  activeCandidateIndex: number;
  autoScore: number;
  autoConfidence: 'normal' | 'low';
  autoModeUsed: 'plain' | 'complex' | null;
  subjectTouchesEdgeDetected: boolean;
  onCycleAutoCandidate: () => void;
  showAutoDebug?: boolean;
  onToggleAutoDebug?: () => void;

  // Phase 2 Refine Controls
  viewMode: StudioViewMode;
  onViewModeChange: (mode: StudioViewMode) => void;
  showMaskOverlay: boolean;
  onShowMaskOverlayChange: (val: boolean) => void;
  maskOverlayOpacity: number;
  onMaskOverlayOpacityChange: (val: number) => void;
  background: BackgroundOption;
  onBackgroundChange: (bg: BackgroundOption) => void;
  refine: RefineSettings;
  onRefineChange: (next: RefineSettings) => void;
  onBakeRefineToMask: () => void;
  isRefining: boolean;
  effects: OutputEffectSettings;
  onEffectsChange: (next: OutputEffectSettings) => void;
  snapshots: CompareSnapshotRecord[];
  onSaveSnapshot: () => void;
  onRestoreSnapshot: (snap: CompareSnapshotRecord) => void;
}

export function StudioPropertiesPanel({
  phase,
  hasAppliedMask,
  hasSelection,
  onSelectPhaseStep,
  onBackToSelection,
  activeTool,
  brushSize,
  onBrushSizeChange,
  brushHardness,
  onBrushHardnessChange,
  brushStrength,
  onBrushStrengthChange,
  brushSmoothing,
  onBrushSmoothingChange,
  selectBrushMode,
  onSelectBrushModeChange,
  refineBrushMode,
  onRefineBrushModeChange,
  edgeBrushMode,
  onEdgeBrushModeChange,
  edgeBrushTolerance,
  onEdgeBrushToleranceChange,
  grabCutIterations,
  onGrabCutIterationsChange,
  scribblePolarity,
  onScribblePolarityChange,
  scribbleBrushSize,
  onScribbleBrushSizeChange,
  hasScribbles,
  onRunGrabCutScribbles,
  onRunWatershedScribbles,
  onClearScribbles,
  cvBusyText,
  wandTolerance,
  onWandToleranceChange,
  wandContiguous,
  onWandContiguousChange,
  colorKeyRgb,
  colorKeyTolerance,
  onColorKeyToleranceChange,
  colorKeySoftness,
  onColorKeySoftnessChange,
  combineMode,
  onCombineModeChange,
  selectionFeather,
  onSelectionFeatherChange,
  selectionExpand,
  onSelectionExpandChange,
  showSelectionOverlay,
  onShowSelectionOverlayChange,
  onInvertSelection,
  onClearSelection,
  autoStatus,
  autoProgress,
  pendingAutoApply,
  autoSettings,
  onAutoSettingsChange,
  onPickBgColorTool,
  onEraseBackground,
  onEraseSelection,
  onRequestAutoRemove,
  autoCandidatesCount,
  activeCandidateIndex,
  autoScore,
  autoConfidence,
  autoModeUsed,
  subjectTouchesEdgeDetected,
  onCycleAutoCandidate,
  showAutoDebug,
  onToggleAutoDebug,
  viewMode,
  onViewModeChange,
  showMaskOverlay,
  onShowMaskOverlayChange,
  maskOverlayOpacity,
  onMaskOverlayOpacityChange,
  background,
  onBackgroundChange,
  refine,
  onRefineChange,
  onBakeRefineToMask,
  isRefining,
  effects,
  onEffectsChange,
  snapshots,
  onSaveSnapshot,
  onRestoreSnapshot,
}: StudioPropertiesPanelProps) {
  const isBrushTool =
    activeTool === 'select-brush' ||
    activeTool === 'restore' ||
    activeTool === 'erase' ||
    activeTool === 'edge-brush';

  const hasActiveRefine =
    refine.featherPx > 0 ||
    refine.shiftPx !== 0 ||
    refine.smoothRadius > 0 ||
    refine.decontaminate ||
    refine.hairMatting;

  const refineMode = activeTool === 'edge-brush' ? edgeBrushMode : refineBrushMode;
  const setRefineMode = (m: 'restore' | 'erase') =>
    activeTool === 'edge-brush' ? onEdgeBrushModeChange(m) : onRefineBrushModeChange(m);

  const brushProps = (p: string) => ({
    p,
    size: brushSize,
    hard: brushHardness,
    op: brushStrength,
    smooth: brushSmoothing,
    onSize: onBrushSizeChange,
    onHard: onBrushHardnessChange,
    onOp: onBrushStrengthChange,
    onSmooth: onBrushSmoothingChange,
  });

  const edgeTol = (id: string) => (
    <SliderRow
      id={id}
      label="Lab color tolerance"
      display={edgeBrushTolerance}
      min={5}
      max={65}
      value={edgeBrushTolerance}
      onChange={onEdgeBrushToleranceChange}
    />
  );

  const cycleBtn = (extra?: ReactNode) =>
    autoCandidatesCount > 1 && (
      <button type="button" onClick={onCycleAutoCandidate} className={`${BTN_OUT} w-full`}>
        Try another result ({activeCandidateIndex + 1}/{autoCandidatesCount}){extra}
      </button>
    );

  const tab = (id: StudioPhase, label: string, disabled: boolean, title?: string) => {
    const on = phase === id;
    return (
      <button
        type="button"
        role="tab"
        aria-selected={on}
        disabled={disabled}
        title={title}
        onClick={() => onSelectPhaseStep(id)}
        className={`${MONO} min-h-10 rounded-md border text-[11px] font-bold transition-colors duration-150 ${
          on
            ? 'border-white bg-white text-[#0c0d12]'
            : disabled
              ? 'cursor-not-allowed border-transparent text-[#555966] opacity-50'
              : 'border-transparent text-[#8a8e9c] hover:text-white'
        }`}
      >
        {label}
      </button>
    );
  };

  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-md flex-col bg-[#0c0d12] text-xs text-[#c9ccd6] sm:max-w-none">
      {/* Phase stepper */}
      <div className="shrink-0 p-3 pb-0">
        <div
          role="tablist"
          aria-label="Workflow steps"
          className={`grid grid-cols-2 gap-1 rounded-lg ${BORDER} bg-[#101117] p-1`}
        >
          {tab('select', 'Select', false)}
          {tab('refine', 'Refine', !hasAppliedMask, hasAppliedMask ? 'Refine cutout' : 'Apply an erase action first')}
        </div>
      </div>

      {/* Scrollable body */}
      <div className="studio-scroll flex-1 space-y-3 overflow-y-auto overscroll-contain p-3">
        {phase === 'select' ? (
          <>
            {/* Active tool */}
            <section className={SEC}>
              <Cap title="Active tool settings" />

              {activeTool === 'pan' && (
                <Hint>
                  Drag to pan. Hold{' '}
                  <kbd className={`rounded ${BORDER} bg-[#1a1c24] px-1 font-mono text-[10px] text-white`}>Space</kbd>{' '}
                  anytime to pan temporarily.
                </Hint>
              )}

              {activeTool === 'select-brush' && (
                <Seg items={SELECT_MODES} value={selectBrushMode} onChange={onSelectBrushModeChange} label="Select mode" />
              )}

              {activeTool === 'edge-brush' && (
                <>
                  <Seg items={EDGE_MODES} value={edgeBrushMode} onChange={onEdgeBrushModeChange} label="Edge mode" />
                  {edgeTol('sp-edge-tol')}
                </>
              )}

              {isBrushTool && <BrushSliders {...brushProps('sp-brush')} />}

              {activeTool === 'magic-wand' && (
                <>
                  <SliderRow
                    id="sp-wand-tol"
                    label="Wand tolerance (Delta E)"
                    display={wandTolerance}
                    min={1}
                    max={85}
                    value={wandTolerance}
                    onChange={onWandToleranceChange}
                  />
                  <Toggle label="Contiguous pixels only" checked={wandContiguous} onChange={onWandContiguousChange} />
                  <Hint>Click a region to add it to Keep Selection. Shift adds, Alt subtracts.</Hint>
                </>
              )}

              {activeTool === 'color-key' && (
                <>
                  <div className={`flex min-h-10 items-center justify-between gap-2 rounded-md ${BORDER} bg-[#0c0d12] px-3`}>
                    <span className={LBL}>Key color</span>
                    {colorKeyRgb ? (
                      <span className="inline-flex items-center gap-1.5 font-mono text-[11px] text-white">
                        <span
                          className="h-3.5 w-3.5 shrink-0 rounded-sm border border-[#4a4d5a]"
                          style={{ backgroundColor: RGB(colorKeyRgb) }}
                        />
                        rgb({colorKeyRgb.join(',')})
                      </span>
                    ) : (
                      <span className={HINT}>Click image to pick</span>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <SliderRow
                      id="sp-ck-tol"
                      label="Tolerance"
                      display={colorKeyTolerance}
                      min={2}
                      max={80}
                      value={colorKeyTolerance}
                      onChange={onColorKeyToleranceChange}
                    />
                    <SliderRow
                      id="sp-ck-soft"
                      label="Softness"
                      display={colorKeySoftness}
                      min={0}
                      max={40}
                      value={colorKeySoftness}
                      onChange={onColorKeySoftnessChange}
                    />
                  </div>
                </>
              )}

              {(activeTool === 'grabcut-rect' || activeTool === 'scribble') && (
                <>
                  <SliderRow
                    id="sp-gc-iter"
                    label="GrabCut iterations"
                    display={grabCutIterations}
                    min={2}
                    max={6}
                    value={grabCutIterations}
                    onChange={onGrabCutIterationsChange}
                  />

                  {activeTool === 'grabcut-rect' && (
                    <Hint>Drag a box around the subject to populate Keep Selection via local OpenCV GrabCut.</Hint>
                  )}

                  {activeTool === 'scribble' && (
                    <>
                      <Seg
                        items={SCRIBBLE_MODES}
                        value={scribblePolarity}
                        onChange={onScribblePolarityChange}
                        label="Scribble polarity"
                      />
                      <SliderRow
                        id="sp-scribble-sz"
                        label="Scribble width"
                        display={`${scribbleBrushSize} px`}
                        min={4}
                        max={60}
                        value={scribbleBrushSize}
                        onChange={onScribbleBrushSizeChange}
                      />
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          disabled={!hasScribbles || Boolean(cvBusyText)}
                          onClick={onRunGrabCutScribbles}
                          className={BTN_SOLID}
                        >
                          Run GrabCut
                        </button>
                        <button
                          type="button"
                          disabled={!hasScribbles || Boolean(cvBusyText)}
                          onClick={onRunWatershedScribbles}
                          className={BTN_OUT}
                        >
                          Watershed
                        </button>
                      </div>
                      {hasScribbles && (
                        <button type="button" onClick={onClearScribbles} className={`${BTN_GHOST} w-full`}>
                          Clear scribbles
                        </button>
                      )}
                    </>
                  )}
                  {cvBusyText && (
                    <p className={`${MONO} text-center text-[10px] font-bold text-[#2f6bff]`}>{cvBusyText}</p>
                  )}
                </>
              )}

              {activeTool === 'magnetic-lasso' && (
                <Hint>
                  Click points along the edge; Livewire snaps to contrast boundaries. Click the green start dot or press
                  Enter to close; Backspace removes last anchor.
                </Hint>
              )}
              {activeTool === 'lasso' && <Hint>Draw a freehand loop to combine with your Keep Selection.</Hint>}
              {activeTool === 'polygon-lasso' && (
                <Hint>Click straight-line vertices. Double-click or press Enter to close.</Hint>
              )}
              {(activeTool === 'rect' || activeTool === 'ellipse') && (
                <Hint>Drag across the canvas to create a selection shape.</Hint>
              )}
              {activeTool === 'bg-eyedropper' && (
                <Hint blue>Click any background pixel on the image to sample it for Auto Remove.</Hint>
              )}
            </section>

            {/* Selection options */}
            <section className={SEC}>
              <Cap
                title="Selection options"
                right={
                  <label className={`flex min-h-6 cursor-pointer items-center gap-1.5 ${LBL}`}>
                    <input
                      type="checkbox"
                      checked={showSelectionOverlay}
                      onChange={(e) => onShowSelectionOverlayChange(e.target.checked)}
                      className={CHECK}
                    />
                    <span>Overlay</span>
                  </label>
                }
              />

              <Seg items={COMBINE_MODES} value={combineMode} onChange={onCombineModeChange} label="Combine mode" />

              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={onInvertSelection} className={BTN_OUT}>
                  <InvertIcon className="h-3.5 w-3.5 shrink-0" />
                  <span>Invert</span>
                </button>
                <button type="button" disabled={!hasSelection} onClick={onClearSelection} className={BTN_OUT}>
                  Clear selection
                </button>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <SliderRow
                  id="sp-sel-feather"
                  label="Feather"
                  display={`${selectionFeather} px`}
                  min={0}
                  max={50}
                  value={selectionFeather}
                  onChange={onSelectionFeatherChange}
                />
                <SliderRow
                  id="sp-sel-expand"
                  label="Expand / Contract"
                  display={`${signed(selectionExpand)} px`}
                  min={-20}
                  max={20}
                  value={selectionExpand}
                  onChange={onSelectionExpandChange}
                />
              </div>
            </section>

            {/* Auto remove settings (debounced background re-run) */}
            <Collapse
              open
              title={
                <>
                  Auto remove settings
                  {autoModeUsed && <span className="ml-1.5 text-[#6a6e7c]">({autoModeUsed})</span>}
                </>
              }
            >
              <div className="space-y-1.5">
                <span className={LBL}>Mode</span>
                <Seg
                  items={AUTO_MODES}
                  value={autoSettings.mode}
                  onChange={(id) => onAutoSettingsChange({ ...autoSettings, mode: id })}
                  label="Auto mode"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <SliderRow
                  id="sp-auto-tol"
                  label="Tolerance"
                  display={autoSettings.tolerance}
                  min={0}
                  max={100}
                  value={autoSettings.tolerance}
                  onChange={(v) => onAutoSettingsChange({ ...autoSettings, tolerance: v })}
                />
                <SliderRow
                  id="sp-auto-soft"
                  label="Edge softness"
                  display={autoSettings.edgeSoftness}
                  min={0}
                  max={100}
                  value={autoSettings.edgeSoftness}
                  onChange={(v) => onAutoSettingsChange({ ...autoSettings, edgeSoftness: v })}
                />
              </div>

              <div className="grid grid-cols-1 gap-2 min-[400px]:grid-cols-2">
                <Toggle
                  label="Keep largest only"
                  checked={autoSettings.keepLargestObject}
                  onChange={(v) => onAutoSettingsChange({ ...autoSettings, keepLargestObject: v })}
                />
                <Toggle
                  label="Fill holes"
                  checked={autoSettings.fillHoles}
                  onChange={(v) =>
                    onAutoSettingsChange({
                      ...autoSettings,
                      fillHoles: v,
                      preserveHoles: v ? autoSettings.preserveHoles : false,
                    })
                  }
                />
                <Toggle
                  label="Preserve holes"
                  checked={autoSettings.preserveHoles}
                  onChange={(v) => onAutoSettingsChange({ ...autoSettings, preserveHoles: v })}
                />
                <Toggle
                  label="Keep soft shadow"
                  checked={autoSettings.keepSoftShadow}
                  onChange={(v) => onAutoSettingsChange({ ...autoSettings, keepSoftShadow: v })}
                />
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className={LBL}>Subject touches edge</span>
                  {autoSettings.subjectTouchesEdge === 'auto' && (
                    <span className={LBL}>({subjectTouchesEdgeDetected ? 'Detected' : 'None'})</span>
                  )}
                </div>
                <Seg
                  items={EDGE_TOUCH}
                  value={autoSettings.subjectTouchesEdge}
                  onChange={(id) => onAutoSettingsChange({ ...autoSettings, subjectTouchesEdge: id })}
                  label="Subject touches edge"
                />
              </div>

              {/* Manual background eyedropper */}
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <button type="button" onClick={onPickBgColorTool} className={`${BTN_OUT} flex-1`}>
                    <EyedropperIcon className="h-3.5 w-3.5 shrink-0" />
                    <span>Pick bg color</span>
                  </button>
                  {autoSettings.pickedBgColors.length > 0 && (
                    <button
                      type="button"
                      onClick={() => onAutoSettingsChange({ ...autoSettings, pickedBgColors: [] })}
                      className={`${BTN_GHOST} shrink-0`}
                    >
                      Clear
                    </button>
                  )}
                </div>
                {autoSettings.pickedBgColors.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    {autoSettings.pickedBgColors.map((rgb, idx) => (
                      <button
                        key={`${rgb.join(',')}-${idx}`}
                        type="button"
                        title="Remove sampled color"
                        onClick={() =>
                          onAutoSettingsChange({
                            ...autoSettings,
                            pickedBgColors: autoSettings.pickedBgColors.filter((_, i) => i !== idx),
                          })
                        }
                        className={`inline-flex min-h-8 items-center gap-1.5 rounded-md px-2 ${BORDER} bg-[#1a1c24] px-1.5 font-mono text-[10px] text-white transition-colors duration-150 hover:border-[#c23b3b]`}
                      >
                        <span
                          className="h-3 w-3 shrink-0 rounded-sm border border-white/30"
                          style={{ backgroundColor: RGB(rgb) }}
                        />
                        <span>×</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {cycleBtn(
                <>
                  {' · '}
                  <span className="text-[#8a8e9c]">{autoScore.toFixed(0)}pts</span>
                </>,
              )}

              {import.meta.env.DEV && onToggleAutoDebug && (
                <Toggle
                  label="Dev debug overlay"
                  checked={Boolean(showAutoDebug)}
                  onChange={() => onToggleAutoDebug()}
                  textClass="text-[#e07b00]"
                />
              )}
            </Collapse>
          </>
        ) : (
          /* PHASE 2: REFINE */
          <>
            <section className={SEC}>
              <button type="button" onClick={onBackToSelection} className={`${BTN_OUT} w-full`}>
                ← Back to selection
              </button>
              {cycleBtn()}
              {autoConfidence === 'low' && (
                <p className="rounded-md border border-[#e07b00]/50 bg-[#e07b00]/10 px-3 py-2 text-xs leading-snug text-[#f0b060]">
                  Auto result may be inaccurate. Use Box + GrabCut or the selection tools.
                </p>
              )}
            </section>

            <section className={SEC}>
              <Cap title="View" />
              <Seg items={VIEW_MODES} value={viewMode} onChange={onViewModeChange} label="View mode" />
              <div className="flex flex-wrap items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => onShowMaskOverlayChange(!showMaskOverlay)}
                  aria-pressed={showMaskOverlay}
                  className={`${BTN} ${BORDER} ${
                    showMaskOverlay
                      ? 'border-[#c23b3b] bg-[#c23b3b]/20 text-[#ff9a9a]'
                      : 'bg-[#1a1c24] text-[#8a8e9c] hover:text-white'
                  }`}
                >
                  <EyeIcon className="h-3.5 w-3.5" />
                  <span>Red mask overlay</span>
                </button>
                {showMaskOverlay && (
                  <input
                    type="range"
                    min={10}
                    max={85}
                    value={Math.round(maskOverlayOpacity * 100)}
                    onChange={(e) => onMaskOverlayOpacityChange(Number(e.target.value) / 100)}
                    aria-label="Mask overlay opacity"
                    className="range-control min-w-[6rem] flex-1 cursor-pointer"
                  />
                )}
              </div>
            </section>

            {activeTool !== 'pan' && (
              <section className={SEC}>
                <Cap title="Brush" />
                <Seg items={REFINE_MODES} value={refineMode} onChange={setRefineMode} label="Brush mode" />
                {activeTool === 'edge-brush' && edgeTol('rf-edge-tol')}
                <BrushSliders {...brushProps('rf-brush')} />
              </section>
            )}

            <section className={SEC}>
              <Cap title="Background preview" />
              <BackgroundPicker value={background} onChange={onBackgroundChange} />
            </section>

            <section className={SEC}>
              <Cap
                title="Edge refinement"
                right={isRefining ? <span className={`${LBL} text-[#2f6bff]`}>Updating...</span> : undefined}
              />
              <SliderRow
                id="rf-feather"
                label="Feather"
                display={`${refine.featherPx} px`}
                min={0}
                max={25}
                value={refine.featherPx}
                onChange={(v) => onRefineChange({ ...refine, featherPx: v })}
              />
              <div className="grid grid-cols-2 gap-3">
                <SliderRow
                  id="rf-shift"
                  label="Edge shift"
                  display={`${signed(refine.shiftPx)} px`}
                  min={-15}
                  max={15}
                  value={refine.shiftPx}
                  onChange={(v) => onRefineChange({ ...refine, shiftPx: v })}
                />
                <SliderRow
                  id="rf-smooth"
                  label="Edge smooth"
                  display={`${refine.smoothRadius} px`}
                  min={0}
                  max={6}
                  value={refine.smoothRadius}
                  onChange={(v) => onRefineChange({ ...refine, smoothRadius: v })}
                />
              </div>
              <Toggle
                label="Color decontamination"
                checked={refine.decontaminate}
                onChange={(v) => onRefineChange({ ...refine, decontaminate: v })}
              />
              <Toggle
                label="Refine hair and fur"
                checked={refine.hairMatting}
                onChange={(v) => onRefineChange({ ...refine, hairMatting: v })}
              />
              {hasActiveRefine && (
                <div className="flex gap-2">
                  <button type="button" onClick={onBakeRefineToMask} className={`${BTN_SOLID} flex-1`}>
                    Apply to mask
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      onRefineChange({
                        featherPx: 0,
                        shiftPx: 0,
                        smoothRadius: 0,
                        decontaminate: false,
                        hairMatting: false,
                      })
                    }
                    className={BTN_GHOST}
                  >
                    Reset
                  </button>
                </div>
              )}
            </section>

            <Collapse title="Shadow &amp; sticker outline">
              <Toggle
                label="Drop shadow"
                checked={effects.shadowEnabled}
                onChange={(v) => onEffectsChange({ ...effects, shadowEnabled: v })}
                textClass="text-white"
              />
              {effects.shadowEnabled && (
                <SliderRow
                  id="fx-blur"
                  label="Blur"
                  display={`${effects.shadowBlur} px`}
                  min={0}
                  max={60}
                  value={effects.shadowBlur}
                  onChange={(v) => onEffectsChange({ ...effects, shadowBlur: v })}
                />
              )}

              <Toggle
                label="Sticker outline"
                checked={effects.outlineEnabled}
                onChange={(v) => onEffectsChange({ ...effects, outlineEnabled: v })}
                textClass="text-white"
              />
              {effects.outlineEnabled && (
                <div className="flex items-center gap-2">
                  <input
                    type="range"
                    min={2}
                    max={32}
                    value={effects.outlineWidth}
                    onChange={(e) => onEffectsChange({ ...effects, outlineWidth: Number(e.target.value) })}
                    aria-label="Outline width"
                    className="range-control min-w-0 flex-1 cursor-pointer"
                  />
                  <input
                    type="color"
                    value={effects.outlineColor}
                    onChange={(e) => onEffectsChange({ ...effects, outlineColor: e.target.value })}
                    aria-label="Outline color"
                    className={`h-8 w-10 shrink-0 cursor-pointer rounded-md ${BORDER} bg-[#0c0d12]`}
                  />
                </div>
              )}
            </Collapse>

            <Collapse title={`Saved snapshots (${snapshots.length})`}>
              <button type="button" onClick={onSaveSnapshot} className={`${BTN_OUT} w-full`}>
                Save version snapshot
              </button>
              {snapshots.map((snap) => (
                <div key={snap.id} className={`flex items-center gap-3 rounded-md ${BORDER} bg-[#1a1c24] p-2`}>
                  <img
                    src={snap.thumbnailDataUrl}
                    alt={snap.label}
                    className={`checkerboard h-9 w-9 shrink-0 rounded ${BORDER} object-contain`}
                  />
                  <span className="min-w-0 flex-1 truncate text-xs text-white">{snap.label}</span>
                  <button type="button" onClick={() => onRestoreSnapshot(snap)} className={`${BTN_GHOST} shrink-0`}>
                    Restore
                  </button>
                </div>
              ))}
            </Collapse>
          </>
        )}
      </div>

      {/* Phase 1 footer */}
      {phase === 'select' && (
        <div className="studio-action-footer mx-auto w-full max-w-2xl shrink-0 rounded-t-xl border-x border-t border-[#2c2f3a] bg-[#101117] p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          {!hasSelection && (
            <p className={`${HINT} mb-3 text-center`}>Select a subject with any tool above, or apply Auto remove below.</p>
          )}
          <div className="studio-action-grid grid grid-cols-2 gap-2">
            <button type="button" disabled={!hasSelection} onClick={onEraseBackground} className={BTN_SOLID}>
              Erase background
            </button>
            <button type="button" disabled={!hasSelection} onClick={onEraseSelection} className={BTN_OUT}>
              Erase selection
            </button>
            <button type="button" onClick={onRequestAutoRemove} className={`${BTN_BLUE} col-span-2`}>
              {pendingAutoApply && autoStatus === 'running'
                ? `Applying (${Math.round(autoProgress)}%)...`
                : 'Auto remove background'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}