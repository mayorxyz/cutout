import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  DEFAULT_AUTO_SETTINGS,
  MAX_HISTORY_BYTES,
  MAX_HISTORY_STEPS,
  STORAGE_KEY_AUTO,
  STORAGE_KEY_BG,
  type AspectPresetId,
  type AutoRemoveSettings,
  type BackgroundOption,
  type ExportFormat,
  type OutputEffectSettings,
  type RefineSettings,
  type ScribblePolarity,
  type SelectionCombineMode,
  type ToolId,
} from '../config';
import { useBackgroundRemoval } from '../hooks/useBackgroundRemoval';
import { useLocalStorage } from '../hooks/useLocalStorage';
import {
  buildDownloadFileName,
  copyPngBlobToClipboard,
  decodeWithOrientation,
  exportFullResolutionCutout,
  exportGrayscaleMaskPng,
  extractWorkingRgbaFromBitmap,
  isClipboardImageSupported,
  triggerBlobDownload,
} from '../lib/image';
import {
  applyFeather,
  applyMorphology,
  applyRefinePipeline,
  cloneToArrayBuffer,
  colorKeySelectLab,
  combineSelections,
  compressMaskRLE,
  decompressMaskRLE,
  magicWandSelectLab,
} from '../lib/maskAlgorithms';
import {
  clearCurrentProject,
  loadCompareSnapshots,
  loadCurrentProject,
  saveCompareSnapshot,
  saveCurrentProject,
  type CompareSnapshotRecord,
  type SavedProjectRecord,
} from '../lib/projectDb';
import type { MaskOpsRequest, MaskOpsResponse } from '../workers/maskOps.worker';

export type StudioPhase = 'select' | 'refine';
export type StudioViewMode = 'edit' | 'split' | 'compare';
export type AutoSaveStatus = 'idle' | 'saving' | 'saved';

interface StudioHistoryEntry {
  label: string;
  phase: StudioPhase;
  keepCompressed: Uint8Array;
  appliedCompressed: Uint8Array | null;
  refine: RefineSettings;
  background: BackgroundOption;
  byteLength: number;
}

interface OpenCvWorkerResponse {
  type: 'progress' | 'done' | 'error';
  requestId: number;
  progress?: number;
  detail?: string;
  maskBuffer?: ArrayBuffer;
  algorithm?: 'grabcut' | 'watershed';
  message?: string;
}

export const DEFAULT_STUDIO_REFINE: RefineSettings = {
  featherPx: 0,
  shiftPx: 0,
  smoothRadius: 0,
  decontaminate: false,
  hairMatting: false,
};

export const DEFAULT_STUDIO_EFFECTS: OutputEffectSettings = {
  shadowEnabled: false,
  shadowBlur: 18,
  shadowOffsetY: 8,
  shadowOpacity: 0.35,
  shadowColor: '#000000',
  outlineEnabled: false,
  outlineWidth: 8,
  outlineColor: '#ffffff',
};

function hasAnyPositivePixels(buf: Uint8ClampedArray | null): boolean {
  if (!buf) return false;
  for (let i = 0; i < buf.length; i += 1) {
    if (buf[i] > 0) return true;
  }
  return false;
}

export function useStudioStore() {
  const bgRemoval = useBackgroundRemoval();
  const { image, autoStatus, autoProgress, autoMaskCandidate, isDecoding, decodingFileName, decodeError } = bgRemoval;

  const [rawAutoSettings, setAutoSettings] = useLocalStorage<AutoRemoveSettings>(
    STORAGE_KEY_AUTO,
    DEFAULT_AUTO_SETTINGS
  );
  const autoSettings = useMemo<AutoRemoveSettings>(
    () => ({
      ...DEFAULT_AUTO_SETTINGS,
      ...rawAutoSettings,
      pickedBgColors: Array.isArray(rawAutoSettings.pickedBgColors)
        ? rawAutoSettings.pickedBgColors
        : [],
    }),
    [rawAutoSettings]
  );
  const [background, setBackground] = useLocalStorage<BackgroundOption>(STORAGE_KEY_BG, {
    type: 'transparent',
  });

  // Primary workflow state
  const [phase, setPhase] = useState<StudioPhase>('select');
  const [keepSelection, setKeepSelection] = useState<Uint8ClampedArray | null>(null);
  const [appliedMask, setAppliedMask] = useState<Uint8ClampedArray | null>(null);
  const [displayMask, setDisplayMask] = useState<Uint8ClampedArray | null>(null);
  const [displayRgba, setDisplayRgba] = useState<Uint8ClampedArray | null>(null);
  const [isRefining, setIsRefining] = useState(false);

  // Unified undo/redo history spanning both Select and Refine phases + Reset
  const historyEntriesRef = useRef<StudioHistoryEntry[]>([]);
  const historyIndexRef = useRef(-1);
  const maskLengthRef = useRef(0);
  const [historyMeta, setHistoryMeta] = useState({ index: -1, length: 0 });

  // Pending "Auto remove background" click when candidate is still running
  const [pendingAutoApply, setPendingAutoApply] = useState(false);
  const [showAutoDebug, setShowAutoDebug] = useState(false);

  // Active tool & tool settings
  const [activeTool, setActiveTool] = useState<ToolId>('select-brush');
  const [brushSize, setBrushSize] = useState(36);
  const [brushHardness, setBrushHardness] = useState(75);
  const [brushStrength, setBrushStrength] = useState(100);
  const [brushSmoothing, setBrushSmoothing] = useState(true);
  const [selectBrushMode, setSelectBrushMode] = useState<'add' | 'subtract'>('add');
  const [refineBrushMode, setRefineBrushMode] = useState<'restore' | 'erase'>('restore');
  const [edgeBrushMode, setEdgeBrushMode] = useState<'restore' | 'erase'>('restore');
  const [edgeBrushTolerance, setEdgeBrushTolerance] = useState(22);

  // GrabCut / Watershed controls
  const [grabCutIterations, setGrabCutIterations] = useState(4);
  const [scribblePolarity, setScribblePolarity] = useState<ScribblePolarity>('fg');
  const [scribbleBrushSize, setScribbleBrushSize] = useState(18);
  const scribbleBufferRef = useRef<Uint8Array>(new Uint8Array(0));
  const [scribbleVersion, setScribbleVersion] = useState(0);
  const [hasScribbles, setHasScribbles] = useState(false);
  const [cvBusyText, setCvBusyText] = useState<string | null>(null);

  // Magic Wand, Color Key & Selection modifiers
  const [wandTolerance, setWandTolerance] = useState(24);
  const [wandContiguous, setWandContiguous] = useState(true);
  const [colorKeyRgb, setColorKeyRgb] = useState<[number, number, number] | null>(null);
  const [colorKeyTolerance, setColorKeyTolerance] = useState(24);
  const [colorKeySoftness, setColorKeySoftness] = useState(10);
  const preColorKeySelRef = useRef<Uint8ClampedArray | null>(null);

  const [combineMode, setCombineMode] = useState<SelectionCombineMode>('replace');
  const [selectionFeather, setSelectionFeather] = useState(0);
  const [selectionExpand, setSelectionExpand] = useState(0);
  const [showSelectionOverlay, setShowSelectionOverlay] = useState(true);

  // View controls
  const [viewMode, setViewMode] = useState<StudioViewMode>('edit');
  const [showMaskOverlay, setShowMaskOverlay] = useState(false);
  const [maskOverlayOpacity, setMaskOverlayOpacity] = useState(0.45);
  const [zoom, setZoom] = useState(1);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });

  // Refine & Export
  const [refine, setRefine] = useState<RefineSettings>(DEFAULT_STUDIO_REFINE);
  const [effects, setEffects] = useState<OutputEffectSettings>(DEFAULT_STUDIO_EFFECTS);
  const [snapshots, setSnapshots] = useState<CompareSnapshotRecord[]>([]);
  const [savedProject, setSavedProject] = useState<SavedProjectRecord | null>(null);
  const [autoSaveStatus, setAutoSaveStatus] = useState<AutoSaveStatus>('idle');
  const [isExporting, setIsExporting] = useState(false);
  const [toast, setToast] = useState<{ id: number; type: 'success' | 'error'; text: string } | null>(
    null
  );

  // Refs for workers & async coordination
  const openCvWorkerRef = useRef<Worker | null>(null);
  const cvReqIdRef = useRef(0);
  const refineWorkerRef = useRef<Worker | null>(null);
  const refineReqIdRef = useRef(0);
  const maskOpsWorkerRef = useRef<Worker | null>(null);
  const wandReqIdRef = useRef(0);
  const colorKeyReqIdRef = useRef(0);
  const autoDebounceRef = useRef<number | null>(null);
  const loadedUrlRef = useRef<string | null>(null);
  const skipHistoryRef = useRef(false);
  const toastCounterRef = useRef(0);

  const showToast = useCallback((type: 'success' | 'error', text: string) => {
    toastCounterRef.current += 1;
    const id = toastCounterRef.current;
    setToast({ id, type, text });
    window.setTimeout(() => {
      setToast((curr) => (curr?.id === id ? null : curr));
    }, 3800);
  }, []);

  const syncHistoryMeta = useCallback(() => {
    setHistoryMeta({
      index: historyIndexRef.current,
      length: historyEntriesRef.current.length,
    });
  }, []);

  const initUnifiedHistory = useCallback(
    (
      initialPhase: StudioPhase,
      initialKeep: Uint8ClampedArray,
      initialApplied: Uint8ClampedArray | null,
      initialRefine: RefineSettings,
      initialBg: BackgroundOption,
      label = 'Original image'
    ) => {
      maskLengthRef.current = initialKeep.length;
      const keepCompressed = compressMaskRLE(initialKeep);
      const appliedCompressed = initialApplied ? compressMaskRLE(initialApplied) : null;
      const byteLength =
        keepCompressed.byteLength + (appliedCompressed ? appliedCompressed.byteLength : 0);
      historyEntriesRef.current = [
        {
          label,
          phase: initialPhase,
          keepCompressed,
          appliedCompressed,
          refine: { ...initialRefine },
          background: { ...initialBg },
          byteLength,
        },
      ];
      historyIndexRef.current = 0;
      syncHistoryMeta();
    },
    [syncHistoryMeta]
  );

  const pushUnifiedHistory = useCallback(
    (
      nextPhase: StudioPhase,
      nextKeep: Uint8ClampedArray,
      nextApplied: Uint8ClampedArray | null,
      label: string,
      nextRefine: RefineSettings = refine,
      nextBg: BackgroundOption = background
    ) => {
      maskLengthRef.current = nextKeep.length;
      const keepCompressed = compressMaskRLE(nextKeep);
      const appliedCompressed = nextApplied ? compressMaskRLE(nextApplied) : null;
      const byteLength =
        keepCompressed.byteLength + (appliedCompressed ? appliedCompressed.byteLength : 0);

      const sliced = historyEntriesRef.current.slice(0, historyIndexRef.current + 1);
      sliced.push({
        label,
        phase: nextPhase,
        keepCompressed,
        appliedCompressed,
        refine: { ...nextRefine },
        background: { ...nextBg },
        byteLength,
      });

      while (sliced.length > MAX_HISTORY_STEPS) {
        sliced.shift();
      }
      let totalBytes = sliced.reduce((acc, item) => acc + item.byteLength, 0);
      while (sliced.length > 2 && totalBytes > MAX_HISTORY_BYTES) {
        const removed = sliced.shift();
        totalBytes -= removed ? removed.byteLength : 0;
      }

      historyEntriesRef.current = sliced;
      historyIndexRef.current = sliced.length - 1;
      syncHistoryMeta();
    },
    [background, refine, syncHistoryMeta]
  );

  // Load saved IndexedDB project + snapshots on mount
  useEffect(() => {
    void loadCurrentProject().then((proj) => {
      if (proj) setSavedProject(proj);
    });
    void loadCompareSnapshots().then((snaps) => {
      setSnapshots(snaps);
    });
  }, []);

  // Terminate workers on unmount
  useEffect(() => {
    return () => {
      if (autoDebounceRef.current) window.clearTimeout(autoDebounceRef.current);
      openCvWorkerRef.current?.terminate();
      refineWorkerRef.current?.terminate();
      maskOpsWorkerRef.current?.terminate();
    };
  }, []);

  // Effective keepSelection with Feather + Expand/Contract applied non-destructively
  const effectiveKeepSelection = useMemo(() => {
    if (!keepSelection || !image) return null;
    if (selectionExpand === 0 && selectionFeather === 0) {
      return keepSelection;
    }
    let next: Uint8ClampedArray<ArrayBufferLike> = keepSelection;
    if (selectionExpand !== 0) {
      next = applyMorphology(next, image.workingWidth, image.workingHeight, selectionExpand);
    }
    if (selectionFeather > 0) {
      next = applyFeather(next, image.workingWidth, image.workingHeight, selectionFeather);
    }
    return new Uint8ClampedArray(next);
  }, [image, keepSelection, selectionExpand, selectionFeather]);

  const hasSelection = useMemo(
    () => hasAnyPositivePixels(effectiveKeepSelection),
    [effectiveKeepSelection]
  );

  // Initialize studio buffers whenever a new image arrives
  useEffect(() => {
    if (!image) {
      loadedUrlRef.current = null;
      return;
    }
    if (loadedUrlRef.current === image.originalUrl) return;
    loadedUrlRef.current = image.originalUrl;

    if (skipHistoryRef.current) {
      skipHistoryRef.current = false;
      return;
    }

    const len = image.workingWidth * image.workingHeight;
    const emptySel = new Uint8ClampedArray(len);
    setPhase('select');
    setActiveTool('select-brush');
    setKeepSelection(emptySel);
    setAppliedMask(null);
    setDisplayMask(null);
    setDisplayRgba(image.workingRgba);
    setRefine(DEFAULT_STUDIO_REFINE);
    setEffects(DEFAULT_STUDIO_EFFECTS);
    setViewMode('edit');
    setZoom(1);
    setPanOffset({ x: 0, y: 0 });
    setSelectionExpand(0);
    setSelectionFeather(0);
    setColorKeyRgb(null);
    preColorKeySelRef.current = null;
    scribbleBufferRef.current = new Uint8Array(len);
    setScribbleVersion((v) => v + 1);
    setHasScribbles(false);
    setCvBusyText(null);
    setPendingAutoApply(false);
    openCvWorkerRef.current?.postMessage({ type: 'clear' });
    initUnifiedHistory('select', emptySel, null, DEFAULT_STUDIO_REFINE, background, 'Original image');
  }, [background, image, initUnifiedHistory]);

  // Apply Edge Refinement off-thread whenever appliedMask or refine changes in refine phase
  useEffect(() => {
    if (!image) return;
    if (!appliedMask) {
      setDisplayMask(null);
      setDisplayRgba(image.workingRgba);
      setIsRefining(false);
      return;
    }

    const noRefine =
      refine.featherPx === 0 &&
      refine.shiftPx === 0 &&
      refine.smoothRadius === 0 &&
      !refine.decontaminate &&
      !refine.hairMatting;

    if (noRefine) {
      setDisplayMask(appliedMask);
      setDisplayRgba(image.workingRgba);
      setIsRefining(false);
      return;
    }

    const reqId = ++refineReqIdRef.current;
    setIsRefining(true);

    const timer = window.setTimeout(() => {
      if (typeof Worker === 'undefined') {
        const res = applyRefinePipeline(
          image.workingRgba,
          appliedMask,
          image.workingWidth,
          image.workingHeight,
          refine,
          bgRemoval.spillMode
        );
        if (refineReqIdRef.current === reqId) {
          setDisplayMask(res.mask);
          setDisplayRgba(res.rgba);
          setIsRefining(false);
        }
        return;
      }

      if (!refineWorkerRef.current) {
        refineWorkerRef.current = new Worker(
          new URL('../workers/maskOps.worker.ts', import.meta.url),
          { type: 'module' }
        );
      }

      const worker = refineWorkerRef.current;
      worker.onmessage = (event: MessageEvent<MaskOpsResponse>) => {
        if (event.data.requestId !== reqId || refineReqIdRef.current !== reqId) return;
        if (event.data.type === 'refine-done') {
          setDisplayMask(new Uint8ClampedArray(event.data.maskBuffer));
          setDisplayRgba(new Uint8ClampedArray(event.data.rgbaBuffer));
          setIsRefining(false);
        } else if (event.data.type === 'error') {
          setIsRefining(false);
        }
      };

      const rgbaBuf = cloneToArrayBuffer(image.workingRgba);
      const maskBuf = cloneToArrayBuffer(appliedMask);
      worker.postMessage(
        {
          type: 'refine',
          requestId: reqId,
          rgbaBuffer: rgbaBuf,
          maskBuffer: maskBuf,
          width: image.workingWidth,
          height: image.workingHeight,
          settings: refine,
          spillMode: bgRemoval.spillMode,
        } satisfies MaskOpsRequest,
        { transfer: [rgbaBuf, maskBuf] }
      );
    }, 60);

    return () => window.clearTimeout(timer);
  }, [appliedMask, bgRemoval.spillMode, image, refine]);

  // Apply candidate immediately when it becomes ready if user clicked Auto remove while running
  const applyAutoMaskCandidateNow = useCallback(
    (candidate: Uint8ClampedArray, confidence: 'normal' | 'low' = bgRemoval.autoConfidence) => {
      if (!image) return;
      const nextApplied = new Uint8ClampedArray(candidate);
      const emptyKeep = keepSelection ?? new Uint8ClampedArray(image.workingWidth * image.workingHeight);
      // Seed keepSelection if user hadn't drawn one yet so "Back to selection" shows the cutout selection
      const nextKeep = hasAnyPositivePixels(emptyKeep)
        ? emptyKeep
        : new Uint8ClampedArray(candidate);
      // Enable edge color decontamination automatically on auto removal so edges have zero halos
      const nextRefine: RefineSettings = { ...refine, decontaminate: true };
      setKeepSelection(nextKeep);
      setAppliedMask(nextApplied);
      setRefine(nextRefine);
      setPhase('refine');
      if (
        activeTool !== 'pan' &&
        activeTool !== 'restore' &&
        activeTool !== 'erase' &&
        activeTool !== 'edge-brush'
      ) {
        setActiveTool('restore');
        setRefineBrushMode('restore');
      }
      pushUnifiedHistory('refine', nextKeep, nextApplied, 'Auto remove background', nextRefine);
      if (confidence === 'low') {
        showToast('error', 'Low-confidence auto result — inspect or refine with GrabCut/brushes.');
      } else {
        showToast('success', 'Auto background removal applied.');
      }
    },
    [activeTool, bgRemoval.autoConfidence, image, keepSelection, pushUnifiedHistory, refine, showToast]
  );

  useEffect(() => {
    if (
      pendingAutoApply &&
      (autoStatus === 'ready' || autoStatus === 'low-confidence') &&
      autoMaskCandidate
    ) {
      setPendingAutoApply(false);
      applyAutoMaskCandidateNow(autoMaskCandidate, bgRemoval.autoConfidence);
    } else if (pendingAutoApply && autoStatus === 'failed') {
      setPendingAutoApply(false);
      showToast('error', 'Auto remove could not run on this image. Use selection tools instead.');
    }
  }, [
    applyAutoMaskCandidateNow,
    autoMaskCandidate,
    autoStatus,
    bgRemoval.autoConfidence,
    pendingAutoApply,
    showToast,
  ]);

  // Auto-save active project to IndexedDB
  useEffect(() => {
    if (!image || !keepSelection) return;
    setAutoSaveStatus('saving');
    const timer = window.setTimeout(() => {
      void saveCurrentProject({
        fileName: image.originalFile.name,
        mimeType: image.originalFile.type || 'image/png',
        originalBlob: image.originalBlob,
        workingWidth: image.workingWidth,
        workingHeight: image.workingHeight,
        originalWidth: image.dimensions.width,
        originalHeight: image.dimensions.height,
        phase,
        keepSelectionBytes: new Uint8Array(keepSelection),
        maskBytes: appliedMask ? new Uint8Array(appliedMask) : null,
        background,
      }).then((ok) => {
        setAutoSaveStatus(ok ? 'saved' : 'idle');
      });
    }, 700);
    return () => window.clearTimeout(timer);
  }, [appliedMask, background, image, keepSelection, phase]);

  // Actions
  const uploadFile = useCallback(
    async (file: File) => {
      setSavedProject(null);
      setAutoSaveStatus('idle');
      await bgRemoval.loadImageWithSilentAuto(file, autoSettings, import.meta.env.DEV && showAutoDebug);
    },
    [autoSettings, bgRemoval, showAutoDebug]
  );

  const updateAutoSettings = useCallback(
    (next: AutoRemoveSettings) => {
      setAutoSettings(next);
      if (!image) return;
      if (autoDebounceRef.current) window.clearTimeout(autoDebounceRef.current);
      autoDebounceRef.current = window.setTimeout(() => {
        bgRemoval.recomputeCandidate(next, import.meta.env.DEV && showAutoDebug);
      }, 300);
    },
    [bgRemoval, image, setAutoSettings, showAutoDebug]
  );

  const handleToggleAutoDebug = useCallback(() => {
    if (!import.meta.env.DEV) return;
    setShowAutoDebug((prev) => {
      const next = !prev;
      if (next && image && !bgRemoval.debugData) {
        bgRemoval.recomputeCandidate(autoSettings, true);
      }
      return next;
    });
  }, [autoSettings, bgRemoval, image]);

  const handleBgEyedropperPick = useCallback(
    (rgb: [number, number, number]) => {
      const existing = autoSettings.pickedBgColors ?? [];
      const isDuplicate = existing.some(
        ([r, g, b]) => Math.abs(r - rgb[0]) + Math.abs(g - rgb[1]) + Math.abs(b - rgb[2]) < 12
      );
      const nextColors = isDuplicate ? existing : [...existing.slice(-5), rgb];
      const next: AutoRemoveSettings = { ...autoSettings, pickedBgColors: nextColors };
      setAutoSettings(next);
      setActiveTool(phase === 'select' ? 'select-brush' : 'restore');
      if (autoDebounceRef.current) window.clearTimeout(autoDebounceRef.current);
      bgRemoval.recomputeCandidate(next, import.meta.env.DEV && showAutoDebug);
      showToast('success', 'Sampled background color — refreshing auto preview.');
    },
    [autoSettings, bgRemoval, phase, setAutoSettings, showAutoDebug, showToast]
  );

  // Selection updates
  const commitSelectionChange = useCallback(
    (nextKeep: Uint8ClampedArray, label: string) => {
      setKeepSelection(nextKeep);
      pushUnifiedHistory(phase, nextKeep, appliedMask, label);
    },
    [appliedMask, phase, pushUnifiedHistory]
  );

  const commitAppliedMaskChange = useCallback(
    (nextApplied: Uint8ClampedArray, label: string) => {
      if (!keepSelection) return;
      setAppliedMask(nextApplied);
      pushUnifiedHistory(phase, keepSelection, nextApplied, label);
    },
    [keepSelection, phase, pushUnifiedHistory]
  );

  const applySelectionDelta = useCallback(
    (incoming: Uint8ClampedArray, label: string, overrideCombine?: SelectionCombineMode) => {
      if (!keepSelection) return;
      const mode = overrideCombine ?? combineMode;
      const merged = combineSelections(keepSelection, incoming, mode);
      commitSelectionChange(merged, label);
    },
    [combineMode, commitSelectionChange, keepSelection]
  );

  const handleInvertSelection = useCallback(() => {
    if (!keepSelection) return;
    const inverted = new Uint8ClampedArray(keepSelection.length);
    for (let i = 0; i < keepSelection.length; i += 1) {
      inverted[i] = 255 - keepSelection[i];
    }
    commitSelectionChange(inverted, 'Invert selection');
  }, [commitSelectionChange, keepSelection]);

  const handleClearSelection = useCallback(() => {
    if (!keepSelection) return;
    const cleared = new Uint8ClampedArray(keepSelection.length);
    setSelectionExpand(0);
    setSelectionFeather(0);
    setColorKeyRgb(null);
    preColorKeySelRef.current = null;
    commitSelectionChange(cleared, 'Clear selection');
  }, [commitSelectionChange, keepSelection]);

  // Phase transitions
  const handleEraseBackground = useCallback(() => {
    if (!effectiveKeepSelection || !hasSelection) return;
    const nextApplied = new Uint8ClampedArray(effectiveKeepSelection);
    setAppliedMask(nextApplied);
    setPhase('refine');
    if (
      activeTool !== 'pan' &&
      activeTool !== 'restore' &&
      activeTool !== 'erase' &&
      activeTool !== 'edge-brush'
    ) {
      setActiveTool('restore');
      setRefineBrushMode('restore');
    }
    pushUnifiedHistory(
      'refine',
      keepSelection ?? nextApplied,
      nextApplied,
      'Erase background'
    );
  }, [activeTool, effectiveKeepSelection, hasSelection, keepSelection, pushUnifiedHistory]);

  const handleEraseSelection = useCallback(() => {
    if (!effectiveKeepSelection || !hasSelection) return;
    const nextApplied = new Uint8ClampedArray(effectiveKeepSelection.length);
    for (let i = 0; i < effectiveKeepSelection.length; i += 1) {
      nextApplied[i] = 255 - effectiveKeepSelection[i];
    }
    setAppliedMask(nextApplied);
    setPhase('refine');
    if (
      activeTool !== 'pan' &&
      activeTool !== 'restore' &&
      activeTool !== 'erase' &&
      activeTool !== 'edge-brush'
    ) {
      setActiveTool('restore');
      setRefineBrushMode('restore');
    }
    pushUnifiedHistory(
      'refine',
      keepSelection ?? new Uint8ClampedArray(effectiveKeepSelection.length),
      nextApplied,
      'Erase selection'
    );
  }, [activeTool, effectiveKeepSelection, hasSelection, keepSelection, pushUnifiedHistory]);

  const handleAutoRemoveAction = useCallback(() => {
    if (!image) return;
    if ((autoStatus === 'ready' || autoStatus === 'low-confidence') && autoMaskCandidate) {
      applyAutoMaskCandidateNow(autoMaskCandidate, bgRemoval.autoConfidence);
      return;
    }
    if (autoStatus === 'running') {
      setPendingAutoApply(true);
      return;
    }
    // Retry once if failed/idle
    setPendingAutoApply(true);
    bgRemoval.recomputeCandidate(autoSettings, import.meta.env.DEV && showAutoDebug);
  }, [
    applyAutoMaskCandidateNow,
    autoMaskCandidate,
    autoSettings,
    autoStatus,
    bgRemoval,
    image,
    showAutoDebug,
  ]);

  const handleCycleAutoCandidate = useCallback(() => {
    if (!image || bgRemoval.candidates.length <= 1) return;
    const nextIdx = (bgRemoval.activeCandidateIndex + 1) % bgRemoval.candidates.length;
    const nextCand = bgRemoval.candidates[nextIdx];
    bgRemoval.cycleCandidate();
    if (!nextCand) return;
    if (phase === 'refine' || appliedMask !== null) {
      const nextApplied = new Uint8ClampedArray(nextCand.mask);
      const nextKeep = keepSelection ?? new Uint8ClampedArray(nextCand.mask);
      setAppliedMask(nextApplied);
      pushUnifiedHistory('refine', nextKeep, nextApplied, `Candidate ${nextIdx + 1}: ${nextCand.label}`);
      showToast('success', `Switched to candidate ${nextIdx + 1}/${bgRemoval.candidates.length}: ${nextCand.label}`);
    } else {
      showToast('success', `Selected candidate ${nextIdx + 1}/${bgRemoval.candidates.length}: ${nextCand.label}`);
    }
  }, [appliedMask, bgRemoval, image, keepSelection, phase, pushUnifiedHistory, showToast]);

  const handleBackToSelection = useCallback(() => {
    setPhase('select');
    if (activeTool === 'restore' || activeTool === 'erase') {
      setActiveTool('select-brush');
    }
    setViewMode('edit');
  }, [activeTool]);

  const handleSelectPhaseStep = useCallback(
    (target: StudioPhase) => {
      if (target === phase) return;
      if (target === 'select') {
        handleBackToSelection();
      } else if (appliedMask) {
        setPhase('refine');
        if (
          activeTool !== 'pan' &&
          activeTool !== 'restore' &&
          activeTool !== 'erase' &&
          activeTool !== 'edge-brush'
        ) {
          setActiveTool('restore');
          setRefineBrushMode('restore');
        }
      }
    },
    [activeTool, appliedMask, handleBackToSelection, phase]
  );

  // Magic Wand
  const handleMagicWandClick = useCallback(
    (x: number, y: number, overrideCombine?: SelectionCombineMode) => {
      if (!image) return;

      if (typeof Worker === 'undefined') {
        const sel = magicWandSelectLab(
          image.workingRgba,
          image.workingWidth,
          image.workingHeight,
          x,
          y,
          wandTolerance,
          wandContiguous
        );
        applySelectionDelta(sel, 'Magic Wand', overrideCombine);
        return;
      }

      if (!maskOpsWorkerRef.current) {
        maskOpsWorkerRef.current = new Worker(
          new URL('../workers/maskOps.worker.ts', import.meta.url),
          { type: 'module' }
        );
      }

      const worker = maskOpsWorkerRef.current;
      const reqId = ++wandReqIdRef.current + 200000;
      const handleMsg = (e: MessageEvent<MaskOpsResponse>) => {
        if (e.data.requestId !== reqId) return;
        worker.removeEventListener('message', handleMsg);
        if (e.data.type === 'magic-wand-done') {
          applySelectionDelta(
            new Uint8ClampedArray(e.data.selectionBuffer),
            'Magic Wand',
            overrideCombine
          );
        }
      };
      worker.addEventListener('message', handleMsg);

      const rgbaBuf = cloneToArrayBuffer(image.workingRgba);
      worker.postMessage(
        {
          type: 'magic-wand',
          requestId: reqId,
          rgbaBuffer: rgbaBuf,
          width: image.workingWidth,
          height: image.workingHeight,
          seedX: x,
          seedY: y,
          tolerance: wandTolerance,
          contiguous: wandContiguous,
        } satisfies MaskOpsRequest,
        { transfer: [rgbaBuf] }
      );
    },
    [applySelectionDelta, image, wandContiguous, wandTolerance]
  );

  // Color Key as a live selection tool in Phase 1
  const runColorKeyToSelection = useCallback(
    (rgb: [number, number, number], tol: number, soft: number, commitHistory: boolean) => {
      if (!image || !keepSelection) return;
      const base = preColorKeySelRef.current ?? keepSelection;
      const reqId = ++colorKeyReqIdRef.current + 300000;

      const finish = (keySel: Uint8ClampedArray) => {
        const merged = combineSelections(base, keySel, combineMode);
        setKeepSelection(merged);
        if (commitHistory) {
          pushUnifiedHistory(phase, merged, appliedMask, 'Color Key select');
        }
      };

      if (typeof Worker === 'undefined') {
        const sel = colorKeySelectLab(
          image.workingRgba,
          image.workingWidth,
          image.workingHeight,
          rgb,
          tol,
          soft
        );
        finish(sel);
        return;
      }

      if (!maskOpsWorkerRef.current) {
        maskOpsWorkerRef.current = new Worker(
          new URL('../workers/maskOps.worker.ts', import.meta.url),
          { type: 'module' }
        );
      }

      const worker = maskOpsWorkerRef.current;
      const onMsg = (e: MessageEvent<MaskOpsResponse>) => {
        if (e.data.requestId !== reqId) return;
        worker.removeEventListener('message', onMsg);
        if (e.data.type === 'color-key-done') {
          finish(new Uint8ClampedArray(e.data.selectionBuffer));
        }
      };
      worker.addEventListener('message', onMsg);

      const rgbaBuf = cloneToArrayBuffer(image.workingRgba);
      worker.postMessage(
        {
          type: 'color-key',
          requestId: reqId,
          rgbaBuffer: rgbaBuf,
          width: image.workingWidth,
          height: image.workingHeight,
          keyRgb: rgb,
          tolerance: tol,
          softness: soft,
        } satisfies MaskOpsRequest,
        { transfer: [rgbaBuf] }
      );
    },
    [appliedMask, combineMode, image, keepSelection, phase, pushUnifiedHistory]
  );

  const handleColorKeyPick = useCallback(
    (rgb: [number, number, number]) => {
      preColorKeySelRef.current = keepSelection ? new Uint8ClampedArray(keepSelection) : null;
      setColorKeyRgb(rgb);
      runColorKeyToSelection(rgb, colorKeyTolerance, colorKeySoftness, true);
    },
    [colorKeySoftness, colorKeyTolerance, keepSelection, runColorKeyToSelection]
  );

  const handleColorKeyToleranceChange = useCallback(
    (tol: number) => {
      setColorKeyTolerance(tol);
      if (colorKeyRgb) {
        runColorKeyToSelection(colorKeyRgb, tol, colorKeySoftness, false);
      }
    },
    [colorKeyRgb, colorKeySoftness, runColorKeyToSelection]
  );

  const handleColorKeySoftnessChange = useCallback(
    (soft: number) => {
      setColorKeySoftness(soft);
      if (colorKeyRgb) {
        runColorKeyToSelection(colorKeyRgb, colorKeyTolerance, soft, false);
      }
    },
    [colorKeyRgb, colorKeyTolerance, runColorKeyToSelection]
  );

  // Lazy OpenCV GrabCut & Watershed -> updates keepSelection!
  const getOpenCvWorker = useCallback(() => {
    if (!openCvWorkerRef.current) {
      openCvWorkerRef.current = new Worker('/opencv/opencv.worker.js');
    }
    return openCvWorkerRef.current;
  }, []);

  const runOpenCvToSelection = useCallback(
    (
      payload: Record<string, unknown>,
      transfer: Transferable[],
      actionLabel: string,
      overrideCombine?: SelectionCombineMode
    ) => {
      if (!image) return;
      if (typeof Worker === 'undefined') {
        showToast('error', 'GrabCut and Watershed require Web Worker support.');
        return;
      }

      const worker = getOpenCvWorker();
      const reqId = ++cvReqIdRef.current;
      const imageKey = `${image.originalFile.name}-${image.workingWidth}x${image.workingHeight}`;
      setCvBusyText('Starting local OpenCV...');

      worker.onmessage = (event: MessageEvent<OpenCvWorkerResponse>) => {
        const msg = event.data;
        if (msg.requestId !== reqId || cvReqIdRef.current !== reqId) return;

        if (msg.type === 'progress') {
          setCvBusyText(msg.detail ?? 'Running OpenCV...');
        } else if (msg.type === 'done' && msg.maskBuffer) {
          setCvBusyText(null);
          const sel = new Uint8ClampedArray(msg.maskBuffer);
          applySelectionDelta(sel, actionLabel, overrideCombine);
          showToast('success', `${actionLabel} added to selection.`);
        } else if (msg.type === 'error') {
          setCvBusyText(null);
          showToast('error', msg.message || 'OpenCV segmentation error.');
        }
      };

      worker.onerror = (err) => {
        setCvBusyText(null);
        showToast('error', err.message || 'Failed to load local OpenCV worker.');
      };

      const rgbaBuf = cloneToArrayBuffer(image.workingRgba);
      worker.postMessage(
        {
          ...payload,
          requestId: reqId,
          imageKey,
          width: image.workingWidth,
          height: image.workingHeight,
          rgbaBuffer: rgbaBuf,
        },
        [rgbaBuf, ...transfer]
      );
    },
    [applySelectionDelta, getOpenCvWorker, image, showToast]
  );

  const handleGrabCutRectComplete = useCallback(
    (rect: { x: number; y: number; w: number; h: number }, overrideCombine?: SelectionCombineMode) => {
      runOpenCvToSelection(
        { type: 'grabcut-rect', rect, iterations: grabCutIterations },
        [],
        'GrabCut box',
        overrideCombine
      );
    },
    [grabCutIterations, runOpenCvToSelection]
  );

  const handleRunGrabCutScribbles = useCallback(() => {
    if (!hasScribbles || !image) return;
    const scribbleCopy = new Uint8Array(scribbleBufferRef.current.length);
    scribbleCopy.set(scribbleBufferRef.current);
    const seedMask = keepSelection ?? new Uint8ClampedArray(image.workingWidth * image.workingHeight);
    const baseBuf = cloneToArrayBuffer(seedMask);
    runOpenCvToSelection(
      {
        type: 'grabcut-scribbles',
        iterations: Math.min(5, grabCutIterations),
        scribblesBuffer: scribbleCopy.buffer,
        baseMaskBuffer: baseBuf,
      },
      [scribbleCopy.buffer, baseBuf],
      'GrabCut scribbles'
    );
  }, [grabCutIterations, hasScribbles, image, keepSelection, runOpenCvToSelection]);

  const handleRunWatershedScribbles = useCallback(() => {
    if (!hasScribbles) return;
    const scribbleCopy = new Uint8Array(scribbleBufferRef.current.length);
    scribbleCopy.set(scribbleBufferRef.current);
    runOpenCvToSelection(
      { type: 'watershed-scribbles', scribblesBuffer: scribbleCopy.buffer },
      [scribbleCopy.buffer],
      'Watershed scribbles'
    );
  }, [hasScribbles, runOpenCvToSelection]);

  const handleClearScribbles = useCallback(() => {
    scribbleBufferRef.current.fill(0);
    setScribbleVersion((v) => v + 1);
    setHasScribbles(false);
  }, []);

  // Unified Undo / Redo across BOTH phases and Reset
  const restoreEntry = useCallback((entry: StudioHistoryEntry) => {
    const len = maskLengthRef.current;
    setPhase(entry.phase);
    setKeepSelection(decompressMaskRLE(entry.keepCompressed, len));
    setAppliedMask(
      entry.appliedCompressed ? decompressMaskRLE(entry.appliedCompressed, len) : null
    );
    setRefine(entry.refine);
    setBackground(entry.background);
  }, [setBackground]);

  const handleUndo = useCallback(() => {
    if (historyIndexRef.current <= 0) return;
    historyIndexRef.current -= 1;
    const entry = historyEntriesRef.current[historyIndexRef.current];
    restoreEntry(entry);
    syncHistoryMeta();
    showToast('success', `Undid: ${historyEntriesRef.current[historyIndexRef.current + 1]?.label ?? 'edit'}`);
  }, [restoreEntry, showToast, syncHistoryMeta]);

  const handleRedo = useCallback(() => {
    if (historyIndexRef.current >= historyEntriesRef.current.length - 1) return;
    historyIndexRef.current += 1;
    const entry = historyEntriesRef.current[historyIndexRef.current];
    restoreEntry(entry);
    syncHistoryMeta();
    showToast('success', `Redid: ${entry.label}`);
  }, [restoreEntry, showToast, syncHistoryMeta]);

  // Bake edge refine into appliedMask
  const handleBakeRefine = useCallback(() => {
    if (!displayMask || !keepSelection) return;
    const baked = new Uint8ClampedArray(displayMask);
    setAppliedMask(baked);
    setRefine(DEFAULT_STUDIO_REFINE);
    pushUnifiedHistory('refine', keepSelection, baked, 'Apply edge refinement', DEFAULT_STUDIO_REFINE);
    showToast('success', 'Edge refinement applied to mask.');
  }, [displayMask, keepSelection, pushUnifiedHistory, showToast]);

  // Reset all changes (keeps loaded image & cached autoMaskCandidate; pushes 1 undoable entry!)
  const hasRefineEdits =
    refine.featherPx !== 0 ||
    refine.shiftPx !== 0 ||
    refine.smoothRadius !== 0 ||
    refine.decontaminate ||
    refine.hairMatting;

  const canReset = useMemo(() => {
    if (!image) return false;
    return (
      phase === 'refine' ||
      appliedMask !== null ||
      hasAnyPositivePixels(keepSelection) ||
      hasRefineEdits ||
      background.type !== 'transparent' ||
      hasScribbles ||
      selectionExpand !== 0 ||
      selectionFeather !== 0
    );
  }, [
    appliedMask,
    background.type,
    hasRefineEdits,
    hasScribbles,
    image,
    keepSelection,
    phase,
    selectionExpand,
    selectionFeather,
  ]);

  const handleResetAllChanges = useCallback(() => {
    if (!image) return;
    const len = image.workingWidth * image.workingHeight;
    const clearedKeep = new Uint8ClampedArray(len);
    const transparentBg: BackgroundOption = { type: 'transparent' };

    setPhase('select');
    setKeepSelection(clearedKeep);
    setAppliedMask(null);
    setDisplayMask(null);
    setRefine(DEFAULT_STUDIO_REFINE);
    setEffects(DEFAULT_STUDIO_EFFECTS);
    setBackground(transparentBg);
    setSelectionExpand(0);
    setSelectionFeather(0);
    setColorKeyRgb(null);
    preColorKeySelRef.current = null;
    setViewMode('edit');
    setShowMaskOverlay(false);
    setShowSelectionOverlay(true);
    setZoom(1);
    setPanOffset({ x: 0, y: 0 });
    setBrushSize(36);
    setBrushHardness(75);
    setBrushStrength(100);
    setBrushSmoothing(true);
    setWandTolerance(24);
    setWandContiguous(true);
    setColorKeyTolerance(24);
    setColorKeySoftness(10);
    setGrabCutIterations(4);
    setCombineMode('replace');
    setActiveTool('select-brush');
    scribbleBufferRef.current.fill(0);
    setScribbleVersion((v) => v + 1);
    setHasScribbles(false);
    openCvWorkerRef.current?.postMessage({ type: 'clear' });

    pushUnifiedHistory(
      'select',
      clearedKeep,
      null,
      'Reset all changes',
      DEFAULT_STUDIO_REFINE,
      transparentBg
    );
    showToast('success', 'Reset to original image. Undo anytime to restore.');
  }, [image, pushUnifiedHistory, setBackground, showToast]);

  const handleCloseProject = useCallback(() => {
    bgRemoval.reset();
    loadedUrlRef.current = null;
    setPhase('select');
    setKeepSelection(null);
    setAppliedMask(null);
    setDisplayMask(null);
    setDisplayRgba(null);
    historyEntriesRef.current = [];
    historyIndexRef.current = -1;
    syncHistoryMeta();
    void clearCurrentProject();
    setSnapshots([]);
    setAutoSaveStatus('idle');
  }, [bgRemoval, syncHistoryMeta]);

  // Snapshots & Resume
  const handleSaveSnapshot = useCallback(async () => {
    if (!image) return;
    const maskToSave = appliedMask ?? keepSelection;
    if (!maskToSave) return;

    const thumbCanvas = document.createElement('canvas');
    const scale = Math.min(1, 96 / Math.max(image.workingWidth, image.workingHeight));
    const tw = Math.max(1, Math.round(image.workingWidth * scale));
    const th = Math.max(1, Math.round(image.workingHeight * scale));
    thumbCanvas.width = tw;
    thumbCanvas.height = th;

    const fullCanvas = document.createElement('canvas');
    fullCanvas.width = image.workingWidth;
    fullCanvas.height = image.workingHeight;
    const fCtx = fullCanvas.getContext('2d');
    if (fCtx) {
      const imgData = fCtx.createImageData(image.workingWidth, image.workingHeight);
      for (let i = 0, p = 0; i < maskToSave.length; i += 1, p += 4) {
        imgData.data[p] = image.workingRgba[p];
        imgData.data[p + 1] = image.workingRgba[p + 1];
        imgData.data[p + 2] = image.workingRgba[p + 2];
        imgData.data[p + 3] = maskToSave[i];
      }
      fCtx.putImageData(imgData, 0, 0);
      thumbCanvas.getContext('2d')?.drawImage(fullCanvas, 0, 0, tw, th);
    }

    const record: CompareSnapshotRecord = {
      id: `snap-${Date.now()}`,
      label: `Version ${snapshots.length + 1}`,
      createdAt: Date.now(),
      width: image.workingWidth,
      height: image.workingHeight,
      maskCompressed: compressMaskRLE(maskToSave),
      thumbnailDataUrl: thumbCanvas.toDataURL('image/png'),
    };
    await saveCompareSnapshot(record);
    setSnapshots((prev) => [record, ...prev]);
    showToast('success', `Saved ${record.label}`);
  }, [appliedMask, image, keepSelection, showToast, snapshots.length]);

  const handleRestoreSnapshot = useCallback(
    (snap: CompareSnapshotRecord) => {
      if (!image || !keepSelection) return;
      if (snap.width !== image.workingWidth || snap.height !== image.workingHeight) {
        showToast('error', 'Snapshot dimensions do not match the active image.');
        return;
      }
      const restored = decompressMaskRLE(snap.maskCompressed, snap.width * snap.height);
      setAppliedMask(restored);
      setPhase('refine');
      pushUnifiedHistory('refine', keepSelection, restored, `Restore ${snap.label}`);
      showToast('success', `Restored ${snap.label}`);
    },
    [image, keepSelection, pushUnifiedHistory, showToast]
  );

  const handleResumeSavedProject = useCallback(async () => {
    if (!savedProject) return;
    try {
      const bitmap = await decodeWithOrientation(savedProject.originalBlob);
      try {
        const working = extractWorkingRgbaFromBitmap(bitmap);
        const file = new File([savedProject.originalBlob], savedProject.fileName, {
          type: savedProject.mimeType,
        });
        const len = working.width * working.height;
        const keep = savedProject.keepSelectionBytes
          ? new Uint8ClampedArray(savedProject.keepSelectionBytes)
          : new Uint8ClampedArray(len);
        const applied = savedProject.maskBytes ? new Uint8ClampedArray(savedProject.maskBytes) : null;
        const restoredPhase: StudioPhase = savedProject.phase === 'refine' && applied ? 'refine' : 'select';

        skipHistoryRef.current = true;
        loadedUrlRef.current = null;
        bgRemoval.hydrateImage(
          {
            file,
            originalBlob: savedProject.originalBlob,
            workingWidth: working.width,
            workingHeight: working.height,
            originalWidth: savedProject.originalWidth,
            originalHeight: savedProject.originalHeight,
            workingRgba: working.rgba,
            notice: 'Resumed your last edited session from local browser storage.',
          },
          autoSettings
        );
        setBackground(savedProject.background);
        setPhase(restoredPhase);
        setActiveTool(restoredPhase === 'refine' ? 'restore' : 'select-brush');
        setKeepSelection(keep);
        setAppliedMask(applied);
        setDisplayMask(applied);
        setDisplayRgba(working.rgba);
        setRefine(DEFAULT_STUDIO_REFINE);
        scribbleBufferRef.current = new Uint8Array(len);
        setScribbleVersion((v) => v + 1);
        setHasScribbles(false);
        initUnifiedHistory(
          restoredPhase,
          keep,
          applied,
          DEFAULT_STUDIO_REFINE,
          savedProject.background,
          'Resumed session'
        );
        setSavedProject(null);
      } finally {
        bitmap.close();
      }
    } catch (err) {
      console.error('Resume failed:', err);
      showToast('error', 'Could not restore saved session.');
    }
  }, [autoSettings, bgRemoval, initUnifiedHistory, savedProject, setBackground, showToast]);

  // Export (full resolution!)
  const exportMaskSource = useMemo(() => {
    if (!image) return null;
    if (appliedMask) return appliedMask;
    if (effectiveKeepSelection && hasSelection) return effectiveKeepSelection;
    return new Uint8ClampedArray(image.workingWidth * image.workingHeight).fill(255);
  }, [appliedMask, effectiveKeepSelection, hasSelection, image]);

  const handleExportDownload = useCallback(
    async (opts: {
      format: ExportFormat;
      quality: number;
      cropToSubject: boolean;
      cropPaddingPx: number;
      aspectPreset: AspectPresetId;
      maxExportSidePx: number | null;
    }): Promise<boolean> => {
      if (!image || !exportMaskSource || isExporting) return false;
      setIsExporting(true);
      try {
        const blob = await exportFullResolutionCutout(
          image.originalBlob,
          exportMaskSource,
          image.workingWidth,
          image.workingHeight,
          {
            ...opts,
            background,
            effects,
            refine,
            spillMode: bgRemoval.spillMode,
          }
        );
        const filename = buildDownloadFileName(image.originalFile.name, opts.format);
        triggerBlobDownload(blob, filename);
        showToast('success', `Downloaded ${filename}`);
        return true;
      } catch (err) {
        console.error('Export failed:', err);
        showToast('error', 'Could not render export. Try a smaller max export size.');
        return false;
      } finally {
        setIsExporting(false);
      }
    },
    [background, bgRemoval.spillMode, effects, exportMaskSource, image, isExporting, refine, showToast]
  );

  const handleExportCopy = useCallback(
    async (opts?: {
      cropToSubject: boolean;
      cropPaddingPx: number;
      aspectPreset: AspectPresetId;
      maxExportSidePx: number | null;
    }) => {
      if (!image || !exportMaskSource || isExporting) return;
      if (!isClipboardImageSupported()) {
        showToast('error', 'Clipboard copy is not supported in this browser. Use Download.');
        return;
      }
      setIsExporting(true);
      try {
        const blobPromise = exportFullResolutionCutout(
          image.originalBlob,
          exportMaskSource,
          image.workingWidth,
          image.workingHeight,
          {
            format: 'image/png',
            quality: 1,
            background,
            cropToSubject: opts?.cropToSubject ?? false,
            cropPaddingPx: opts?.cropPaddingPx ?? 0,
            aspectPreset: opts?.aspectPreset ?? 'original',
            maxExportSidePx: opts?.maxExportSidePx ?? null,
            effects,
            refine,
            spillMode: bgRemoval.spillMode,
          }
        );
        await copyPngBlobToClipboard(blobPromise);
        showToast('success', 'Copied PNG image to clipboard.');
      } catch (err) {
        showToast(
          'error',
          err instanceof Error ? err.message : 'Could not copy image to clipboard.'
        );
      } finally {
        setIsExporting(false);
      }
    },
    [background, bgRemoval.spillMode, effects, exportMaskSource, image, isExporting, refine, showToast]
  );

  const handleExportGrayscaleMask = useCallback(async () => {
    if (!image || !exportMaskSource) return;
    setIsExporting(true);
    try {
      const maskToExport = displayMask ?? exportMaskSource;
      const maskBlob = await exportGrayscaleMaskPng(
        maskToExport,
        image.workingWidth,
        image.workingHeight
      );
      const filename = buildDownloadFileName(image.originalFile.name, 'image/png', 'mask');
      triggerBlobDownload(maskBlob, filename);
      showToast('success', `Downloaded ${filename}`);
    } catch {
      showToast('error', 'Could not export grayscale mask.');
    } finally {
      setIsExporting(false);
    }
  }, [displayMask, exportMaskSource, image, showToast]);

  return {
    // Loaded image + silent candidate
    image,
    isDecoding,
    decodingFileName,
    decodeError,
    autoStatus,
    autoProgress,
    autoProgressDetail: bgRemoval.autoProgressDetail,
    autoMaskCandidate,
    autoCandidates: bgRemoval.candidates,
    activeCandidateIndex: bgRemoval.activeCandidateIndex,
    autoScore: bgRemoval.autoScore,
    autoConfidence: bgRemoval.autoConfidence,
    autoModeUsed: bgRemoval.autoModeUsed,
    spillMode: bgRemoval.spillMode,
    subjectTouchesEdgeDetected: bgRemoval.subjectTouchesEdgeDetected,
    autoDebugData: import.meta.env.DEV ? bgRemoval.debugData : null,
    showAutoDebug: import.meta.env.DEV ? showAutoDebug : false,
    onToggleAutoDebug: handleToggleAutoDebug,
    autoSettings,
    updateAutoSettings,
    pendingAutoApply,

    // Workflow phase & masks
    phase,
    keepSelection,
    effectiveKeepSelection,
    hasSelection,
    appliedMask,
    displayMask,
    displayRgba,
    isRefining,
    background,
    setBackground,

    // Active tool & parameters
    activeTool,
    setActiveTool,
    brushSize,
    setBrushSize,
    brushHardness,
    setBrushHardness,
    brushStrength,
    setBrushStrength,
    brushSmoothing,
    setBrushSmoothing,
    selectBrushMode,
    setSelectBrushMode,
    refineBrushMode,
    setRefineBrushMode,
    edgeBrushMode,
    setEdgeBrushMode,
    edgeBrushTolerance,
    setEdgeBrushTolerance,

    // OpenCV & Scribbles
    grabCutIterations,
    setGrabCutIterations,
    scribblePolarity,
    setScribblePolarity,
    scribbleBrushSize,
    setScribbleBrushSize,
    scribbleBuffer: scribbleBufferRef.current,
    scribbleVersion,
    hasScribbles,
    markScribblesUpdated: () => setHasScribbles(true),
    cvBusyText,

    // Wand / Color key / Selection modifiers
    wandTolerance,
    setWandTolerance,
    wandContiguous,
    setWandContiguous,
    colorKeyRgb,
    colorKeyTolerance,
    handleColorKeyToleranceChange,
    colorKeySoftness,
    handleColorKeySoftnessChange,
    combineMode,
    setCombineMode,
    selectionFeather,
    setSelectionFeather,
    selectionExpand,
    setSelectionExpand,
    showSelectionOverlay,
    setShowSelectionOverlay,

    // View & effects
    viewMode,
    setViewMode,
    showMaskOverlay,
    setShowMaskOverlay,
    maskOverlayOpacity,
    setMaskOverlayOpacity,
    zoom,
    setZoom,
    panOffset,
    setPanOffset,
    refine,
    setRefine,
    effects,
    setEffects,

    // History & Reset & DB
    canUndo: historyMeta.index > 0,
    canRedo: historyMeta.index >= 0 && historyMeta.index < historyMeta.length - 1,
    historyStep: historyMeta.index + 1,
    historyCount: historyMeta.length,
    canReset,
    snapshots,
    savedProject,
    discardSavedProject: () => {
      setSavedProject(null);
      void clearCurrentProject();
    },
    autoSaveStatus,
    isExporting,
    toast,
    dismissToast: () => setToast(null),
    showToast,

    // Handlers
    uploadFile,
    loadHydratedExternal: (payload: {
      file: File;
      originalBlob: Blob;
      workingWidth: number;
      workingHeight: number;
      originalWidth: number;
      originalHeight: number;
      workingRgba: Uint8ClampedArray;
      mask?: Uint8ClampedArray;
    }) => {
      skipHistoryRef.current = true;
      loadedUrlRef.current = null;
      const loaded = bgRemoval.hydrateImage(payload, autoSettings);
      const len = loaded.workingWidth * loaded.workingHeight;
      const mask = payload.mask ? new Uint8ClampedArray(payload.mask) : null;
      const nextPhase: StudioPhase = mask ? 'refine' : 'select';
      setPhase(nextPhase);
      setActiveTool(nextPhase === 'refine' ? 'restore' : 'select-brush');
      setKeepSelection(mask ? new Uint8ClampedArray(mask) : new Uint8ClampedArray(len));
      setAppliedMask(mask);
      setDisplayMask(mask);
      setDisplayRgba(loaded.workingRgba);
      scribbleBufferRef.current = new Uint8Array(len);
      setScribbleVersion((v) => v + 1);
      setHasScribbles(false);
      initUnifiedHistory(
        nextPhase,
        mask ? new Uint8ClampedArray(mask) : new Uint8ClampedArray(len),
        mask,
        DEFAULT_STUDIO_REFINE,
        background,
        'Loaded batch item'
      );
    },
    handleUndo,
    handleRedo,
    handleResetAllChanges,
    handleCloseProject,
    handleResumeSavedProject,
    handleSaveSnapshot,
    handleRestoreSnapshot,
    handleBakeRefine,
    setKeepSelectionLive: (m: Uint8ClampedArray) => setKeepSelection(m),
    commitSelectionChange,
    setAppliedMaskLive: (m: Uint8ClampedArray) => setAppliedMask(m),
    commitAppliedMaskChange,
    applySelectionDelta,
    handleInvertSelection,
    handleClearSelection,
    handleEraseBackground,
    handleEraseSelection,
    handleAutoRemoveAction,
    handleCycleAutoCandidate,
    handleBackToSelection,
    handleSelectPhaseStep,
    handleMagicWandClick,
    handleColorKeyPick,
    handleBgEyedropperPick,
    handleGrabCutRectComplete,
    handleRunGrabCutScribbles,
    handleRunWatershedScribbles,
    handleClearScribbles,
    handleExportDownload,
    handleExportCopy,
    handleExportGrayscaleMask,
  };
}
