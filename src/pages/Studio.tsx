import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BatchPanel, type BatchItem } from '../components/BatchPanel';
import { DropZone } from '../components/DropZone';
import { ExportModal } from '../components/ExportModal';
import { Toast } from '../components/Toast';
import { AlertIcon, CloseIcon } from '../components/icons';
import { ConfirmDialog } from '../components/studio/ConfirmDialog';
import { DecodingPanel } from '../components/studio/DecodingPanel';
import { StudioCanvas } from '../components/studio/StudioCanvas';
import { StudioPropertiesPanel } from '../components/studio/StudioPropertiesPanel';
import { StudioStatusBar } from '../components/studio/StudioStatusBar';
import { StudioToolColumn } from '../components/studio/StudioToolColumn';
import { StudioTopBar } from '../components/studio/StudioTopBar';
import { APP_NAME } from '../config';
import { useHead } from '../hooks/useHead';
import { useImageFile } from '../hooks/useImageFile';
import { usePasteImage } from '../hooks/usePasteImage';
import { clamp, formatDimensions } from '../lib/format';
import { consumeHandoffFile } from '../lib/handoff';
import { useStudioStore } from '../store/studioStore';

export default function Studio() {
  useHead({
    title: `Studio — ${APP_NAME}`,
    description:
      'Standalone full-screen Cutout mask studio. Select, refine, and export image backgrounds locally in your browser with no AI and no uploads.',
    path: '/studio',
    robots: 'noindex, nofollow',
  });

  const navigate = useNavigate();
  const studio = useStudioStore();
  const [batchMode, setBatchMode] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [mobilePropsOpen, setMobilePropsOpen] = useState(false);
  const [propertiesWidth, setPropertiesWidth] = useState(364);
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const [autoReplaceConfirmOpen, setAutoReplaceConfirmOpen] = useState(false);
  const [leaveConfirmOpen, setLeaveConfirmOpen] = useState(false);
  const isDrawingSelectionRef = useRef(false);
  const propertiesResizeRef = useRef({ startX: 0, startWidth: 364 });

  const handleSelectedFile = useCallback(
    (file: File) => {
      setBatchMode(false);
      void studio.uploadFile(file);
    },
    [studio]
  );

  const { inputRef, openFilePicker, handleInputChange } = useImageFile(handleSelectedFile);
  usePasteImage(!batchMode, handleSelectedFile);

  // Consume optional in-memory file dropped on the Landing Hero
  useEffect(() => {
    const handedOff = consumeHandoffFile();
    if (handedOff) {
      void studio.uploadFile(handedOff);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Warn on tab close when there are unsaved edits
  useEffect(() => {
    if (!studio.image || !studio.canReset) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [studio.canReset, studio.image]);

  const handleTrySample = useCallback(async () => {
    try {
      const response = await fetch('/samples/before.svg');
      const svgText = await response.text();
      const svgBlob = new Blob([svgText], { type: 'image/svg+xml' });
      const svgUrl = URL.createObjectURL(svgBlob);
      try {
        const img = new Image();
        img.decoding = 'async';
        await new Promise<void>((resolve, reject) => {
          img.onload = () => resolve();
          img.onerror = () => reject(new Error('Sample render failed'));
          img.src = svgUrl;
        });
        const canvas = document.createElement('canvas');
        canvas.width = 800;
        canvas.height = 600;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Canvas unavailable');
        ctx.drawImage(img, 0, 0, 800, 600);
        const pngBlob = await new Promise<Blob>((resolve, reject) => {
          canvas.toBlob((blob) => {
            if (!blob) reject(new Error('Failed to encode PNG'));
            else resolve(blob);
          }, 'image/png');
        });
        const sampleFile = new File([pngBlob], 'sample-camera.png', { type: 'image/png' });
        handleSelectedFile(sampleFile);
      } finally {
        URL.revokeObjectURL(svgUrl);
      }
    } catch {
      studio.showToast('error', 'Could not load the sample image.');
    }
  }, [handleSelectedFile, studio]);

  const handleEditBatchItem = useCallback(
    (item: BatchItem) => {
      if (
        !item.originalBlob ||
        !item.workingWidth ||
        !item.workingHeight ||
        !item.workingRgba ||
        !item.originalWidth ||
        !item.originalHeight
      ) {
        return;
      }
      setBatchMode(false);
      studio.loadHydratedExternal({
        file: item.file,
        originalBlob: item.originalBlob,
        workingWidth: item.workingWidth,
        workingHeight: item.workingHeight,
        originalWidth: item.originalWidth,
        originalHeight: item.originalHeight,
        workingRgba: item.workingRgba,
        mask: item.mask,
      });
    },
    [studio]
  );

  // Studio keyboard shortcuts (PART 5)
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }

      const mod = event.ctrlKey || event.metaKey;

      // Ctrl/Cmd+Z undo, Ctrl/Cmd+Shift+Z redo
      if (mod && event.key.toLowerCase() === 'z') {
        if (!studio.image) return;
        event.preventDefault();
        if (event.shiftKey) studio.handleRedo();
        else studio.handleUndo();
        return;
      }
      if (mod && event.key.toLowerCase() === 'y') {
        if (!studio.image) return;
        event.preventDefault();
        studio.handleRedo();
        return;
      }

      if (mod || event.altKey || !studio.image || batchMode) return;

      const key = event.key.toLowerCase();
      if (key === 'v') {
        event.preventDefault();
        studio.setActiveTool('pan');
      } else if (key === 'w' && studio.phase === 'select') {
        event.preventDefault();
        studio.setActiveTool('magic-wand');
      } else if (key === 'l' && studio.phase === 'select') {
        event.preventDefault();
        studio.setActiveTool('lasso');
      } else if (key === 'p' && studio.phase === 'select') {
        event.preventDefault();
        studio.setActiveTool('polygon-lasso');
      } else if (key === 'm' && studio.phase === 'select') {
        event.preventDefault();
        studio.setActiveTool('rect');
      } else if (key === 'e' && studio.phase === 'select') {
        event.preventDefault();
        studio.setActiveTool('ellipse');
      } else if (key === 'b') {
        event.preventDefault();
        studio.setActiveTool(studio.phase === 'select' ? 'select-brush' : 'restore');
      } else if (key === 'x') {
        event.preventDefault();
        if (studio.phase === 'select') {
          if (studio.activeTool === 'edge-brush') {
            studio.setEdgeBrushMode(studio.edgeBrushMode === 'restore' ? 'erase' : 'restore');
          } else {
            studio.setSelectBrushMode(studio.selectBrushMode === 'add' ? 'subtract' : 'add');
          }
        } else {
          if (studio.activeTool === 'edge-brush') {
            studio.setEdgeBrushMode(studio.edgeBrushMode === 'restore' ? 'erase' : 'restore');
          } else if (studio.activeTool === 'erase') {
            studio.setActiveTool('restore');
            studio.setRefineBrushMode('restore');
          } else if (studio.activeTool === 'restore') {
            if (studio.refineBrushMode === 'restore') {
              studio.setRefineBrushMode('erase');
              studio.setActiveTool('erase');
            } else {
              studio.setRefineBrushMode('restore');
            }
          } else {
            studio.setActiveTool('erase');
          }
        }
      } else if (event.key === '[') {
        event.preventDefault();
        studio.setBrushSize((prev) => clamp(prev - (prev <= 20 ? 2 : 10), 1, 300));
      } else if (event.key === ']') {
        event.preventDefault();
        studio.setBrushSize((prev) => clamp(prev + (prev < 20 ? 2 : 10), 1, 300));
      } else if (event.key === 'Enter') {
        if (
          studio.phase === 'select' &&
          studio.hasSelection &&
          !isDrawingSelectionRef.current &&
          studio.activeTool !== 'polygon-lasso' &&
          studio.activeTool !== 'magnetic-lasso'
        ) {
          event.preventDefault();
          studio.handleEraseBackground();
        }
      } else if (event.key === 'Escape') {
        if (mobilePropsOpen) {
          setMobilePropsOpen(false);
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [batchMode, mobilePropsOpen, studio]);

  const handleRequestAutoRemove = () => {
    if (studio.appliedMask !== null) {
      setAutoReplaceConfirmOpen(true);
    } else {
      studio.handleAutoRemoveAction();
    }
  };

  const handleLeaveHome = (e: React.MouseEvent) => {
    if (studio.image && studio.canReset) {
      e.preventDefault();
      setLeaveConfirmOpen(true);
    }
  };

  const toolSizeLabel =
    studio.activeTool === 'magic-wand'
      ? `Tol ${studio.wandTolerance}`
      : studio.activeTool === 'color-key'
        ? `Tol ${studio.colorKeyTolerance}`
        : studio.activeTool === 'scribble'
          ? `${studio.scribbleBrushSize} px`
          : `${studio.brushSize} px`;

  const propertiesContent = (
    <StudioPropertiesPanel
      phase={studio.phase}
      hasAppliedMask={studio.appliedMask !== null}
      hasSelection={studio.hasSelection}
      onSelectPhaseStep={studio.handleSelectPhaseStep}
      onBackToSelection={studio.handleBackToSelection}
      activeTool={studio.activeTool}
      brushSize={studio.brushSize}
      onBrushSizeChange={studio.setBrushSize}
      brushHardness={studio.brushHardness}
      onBrushHardnessChange={studio.setBrushHardness}
      brushStrength={studio.brushStrength}
      onBrushStrengthChange={studio.setBrushStrength}
      brushSmoothing={studio.brushSmoothing}
      onBrushSmoothingChange={studio.setBrushSmoothing}
      selectBrushMode={studio.selectBrushMode}
      onSelectBrushModeChange={studio.setSelectBrushMode}
      refineBrushMode={studio.refineBrushMode}
      onRefineBrushModeChange={studio.setRefineBrushMode}
      edgeBrushMode={studio.edgeBrushMode}
      onEdgeBrushModeChange={studio.setEdgeBrushMode}
      edgeBrushTolerance={studio.edgeBrushTolerance}
      onEdgeBrushToleranceChange={studio.setEdgeBrushTolerance}
      grabCutIterations={studio.grabCutIterations}
      onGrabCutIterationsChange={studio.setGrabCutIterations}
      scribblePolarity={studio.scribblePolarity}
      onScribblePolarityChange={studio.setScribblePolarity}
      scribbleBrushSize={studio.scribbleBrushSize}
      onScribbleBrushSizeChange={studio.setScribbleBrushSize}
      hasScribbles={studio.hasScribbles}
      onRunGrabCutScribbles={studio.handleRunGrabCutScribbles}
      onRunWatershedScribbles={studio.handleRunWatershedScribbles}
      onClearScribbles={studio.handleClearScribbles}
      cvBusyText={studio.cvBusyText}
      wandTolerance={studio.wandTolerance}
      onWandToleranceChange={studio.setWandTolerance}
      wandContiguous={studio.wandContiguous}
      onWandContiguousChange={studio.setWandContiguous}
      colorKeyRgb={studio.colorKeyRgb}
      colorKeyTolerance={studio.colorKeyTolerance}
      onColorKeyToleranceChange={studio.handleColorKeyToleranceChange}
      colorKeySoftness={studio.colorKeySoftness}
      onColorKeySoftnessChange={studio.handleColorKeySoftnessChange}
      combineMode={studio.combineMode}
      onCombineModeChange={studio.setCombineMode}
      selectionFeather={studio.selectionFeather}
      onSelectionFeatherChange={studio.setSelectionFeather}
      selectionExpand={studio.selectionExpand}
      onSelectionExpandChange={studio.setSelectionExpand}
      showSelectionOverlay={studio.showSelectionOverlay}
      onShowSelectionOverlayChange={studio.setShowSelectionOverlay}
      onInvertSelection={studio.handleInvertSelection}
      onClearSelection={studio.handleClearSelection}
      autoStatus={studio.autoStatus}
      autoProgress={studio.autoProgress}
      pendingAutoApply={studio.pendingAutoApply}
      autoSettings={studio.autoSettings}
      onAutoSettingsChange={studio.updateAutoSettings}
      onPickBgColorTool={() => {
        studio.setActiveTool('bg-eyedropper');
        setMobilePropsOpen(false);
        studio.showToast('success', 'Click background pixel on the image to sample.');
      }}
      onEraseBackground={studio.handleEraseBackground}
      onEraseSelection={studio.handleEraseSelection}
      onRequestAutoRemove={handleRequestAutoRemove}
      autoCandidatesCount={studio.autoCandidates.length}
      activeCandidateIndex={studio.activeCandidateIndex}
      autoScore={studio.autoScore}
      autoConfidence={studio.autoConfidence}
      autoModeUsed={studio.autoModeUsed}
      subjectTouchesEdgeDetected={studio.subjectTouchesEdgeDetected}
      onCycleAutoCandidate={studio.handleCycleAutoCandidate}
      showAutoDebug={studio.showAutoDebug}
      onToggleAutoDebug={studio.onToggleAutoDebug}
      viewMode={studio.viewMode}
      onViewModeChange={studio.setViewMode}
      showMaskOverlay={studio.showMaskOverlay}
      onShowMaskOverlayChange={studio.setShowMaskOverlay}
      maskOverlayOpacity={studio.maskOverlayOpacity}
      onMaskOverlayOpacityChange={studio.setMaskOverlayOpacity}
      background={studio.background}
      onBackgroundChange={studio.setBackground}
      refine={studio.refine}
      onRefineChange={studio.setRefine}
      onBakeRefineToMask={studio.handleBakeRefine}
      isRefining={studio.isRefining}
      effects={studio.effects}
      onEffectsChange={studio.setEffects}
      snapshots={studio.snapshots}
      onSaveSnapshot={() => void studio.handleSaveSnapshot()}
      onRestoreSnapshot={studio.handleRestoreSnapshot}
    />
  );

  return (
    <div className="studio-workspace flex flex-col">
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        onChange={handleInputChange}
        aria-label="Choose image file"
        className="sr-only"
      />

      <StudioTopBar
        fileName={studio.image?.originalFile.name ?? null}
        hasImage={Boolean(studio.image)}
        autoStatus={studio.autoStatus}
        autoProgress={studio.autoProgress}
        canUndo={studio.canUndo}
        canRedo={studio.canRedo}
        canReset={studio.canReset}
        zoom={studio.zoom}
        onUndo={studio.handleUndo}
        onRedo={studio.handleRedo}
        onRequestReset={() => setResetConfirmOpen(true)}
        onZoomOut={() => studio.setZoom((z) => clamp(Number((z - 0.25).toFixed(2)), 0.25, 8))}
        onZoomIn={() => studio.setZoom((z) => clamp(Number((z + 0.25).toFixed(2)), 0.25, 8))}
        onZoomReset={() => {
          studio.setZoom(1);
          studio.setPanOffset({ x: 0, y: 0 });
        }}
        onOpenFilePicker={openFilePicker}
        onOpenExport={() => setExportOpen(true)}
        onRequestLeaveHome={handleLeaveHome}
        batchMode={batchMode}
        onToggleBatchMode={() => setBatchMode((prev) => !prev)}
      />

      {/* Main Middle Area */}
      {batchMode ? (
        <main className="studio-scroll flex-1 overflow-y-auto p-4 sm:p-6">
          <div className="mx-auto max-w-6xl">
            <BatchPanel
              autoSettings={studio.autoSettings}
              onEditItemInStudio={handleEditBatchItem}
            />
          </div>
        </main>
      ) : !studio.image ? (
        /* Studio Empty State */
        <main className="studio-scroll flex flex-1 flex-col items-center justify-center overflow-y-auto p-4 sm:p-8">
          <div className="w-full max-w-2xl space-y-5">
            {studio.decodeError && (
              <div
                role="alert"
                className="flex items-start gap-3 rounded-card border border-red-500/40 bg-red-950/30 p-4 text-sm text-red-200"
              >
                <AlertIcon className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
                <span>{studio.decodeError}</span>
              </div>
            )}

            {studio.savedProject && (
  <div className="border border-[#2c2f3a] bg-[#101117]">
    <div className="flex items-center gap-2 border-b border-[#2c2f3a] px-3 py-2 sm:px-4">
      <span className="h-1.5 w-1.5 shrink-0 bg-[#0fa36b]" />
      <span className="truncate font-mono text-[10px] uppercase tracking-[0.14em] text-[#8a8e9c]">
        Session / Auto-saved
      </span>
    </div>

    <div className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:p-4">
      <div className="min-w-0 space-y-1">
        <p className="text-sm font-semibold tracking-tight text-white">Last image</p>
        <p className="truncate font-mono text-[11px] tracking-[0.04em] text-[#8a8e9c]">
          {studio.savedProject.fileName} ·{' '}
          {formatDimensions(studio.savedProject.originalWidth, studio.savedProject.originalHeight)}
        </p>
      </div>

      <div className="grid grid-cols-[1fr_auto] gap-2 sm:flex sm:shrink-0">
        <button
          type="button"
          onClick={() => void studio.handleResumeSavedProject()}
          className="inline-flex h-10 items-center justify-center whitespace-nowrap border border-white bg-white px-4 font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-[#0c0d12] transition-colors duration-150 hover:bg-[#c9ccd6]"
        >
          Resume
        </button>
        <button
          type="button"
          onClick={studio.discardSavedProject}
          className="inline-flex h-10 items-center justify-center border border-[#4a4d5a] bg-transparent px-4 font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-white transition-colors duration-150 hover:bg-[#16171e]"
        >
          Discard
        </button>
      </div>
    </div>
  </div>
)}
            {studio.isDecoding ? (
              <DecodingPanel fileName={studio.decodingFileName ?? undefined} />
            ) : (
              <DropZone
                onFileSelected={handleSelectedFile}
                onOpenPicker={openFilePicker}
                onTrySample={handleTrySample}
              />
            )}

            <p className="text-center text-xs text-muted">
              100% on-device classical processing — no AI, no uploads, works offline.
            </p>
          </div>
        </main>
      ) : (
        /* Active 3-Column Studio Workspace */
        <div className="flex flex-1 min-h-0 flex-col lg:flex-row">
          <StudioToolColumn
            phase={studio.phase}
            activeTool={studio.activeTool}
            onSelectTool={(t) => {
              studio.setActiveTool(t);
              if (t === 'restore') studio.setRefineBrushMode('restore');
              if (t === 'erase') studio.setRefineBrushMode('erase');
            }}
            onBackToSelection={studio.handleBackToSelection}
            hasSelection={studio.hasSelection}
            onEraseBackground={studio.handleEraseBackground}
            onOpenMobileProperties={() => setMobilePropsOpen(true)}
          />

          <div className="relative flex flex-1 min-w-0 min-h-0 flex-col">
            {studio.autoConfidence === 'low' &&
              (studio.autoStatus === 'low-confidence' ||
                (studio.phase === 'refine' && studio.appliedMask !== null)) && (
                <div
                  role="status"
                  className="flex flex-wrap items-center justify-between gap-2 border-b border-amber-500/30 bg-amber-950/60 px-3 py-2 text-xs text-amber-100"
                >
                  <div className="flex items-center gap-2">
                    <AlertIcon className="h-4 w-4 shrink-0 text-amber-400" />
                    <span>
                      Auto result may be inaccurate. Use Box + GrabCut or the selection tools.
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {studio.autoCandidates.length > 1 && (
                      <button
                        type="button"
                        onClick={studio.handleCycleAutoCandidate}
                        className="rounded border border-amber-400/40 bg-amber-900/50 px-2.5 py-1 text-[11px] font-medium text-amber-100 hover:bg-amber-800/60"
                      >
                        Try another result ({studio.activeCandidateIndex + 1}/
                        {studio.autoCandidates.length})
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        if (studio.phase !== 'select') {
                          studio.handleBackToSelection();
                        }
                        studio.setActiveTool('grabcut-rect');
                      }}
                      className="rounded border border-amber-400/50 bg-amber-500/20 px-2.5 py-1 text-[11px] font-semibold text-amber-100 hover:bg-amber-500/30"
                    >
                      Box + GrabCut
                    </button>
                  </div>
                </div>
              )}

            <StudioCanvas
              phase={studio.phase}
              width={studio.image.workingWidth}
              height={studio.image.workingHeight}
              rgba={studio.displayRgba ?? studio.image.workingRgba}
              originalUrl={studio.image.originalUrl}
              keepSelection={studio.keepSelection}
              effectiveKeepSelection={studio.effectiveKeepSelection}
              appliedMask={studio.displayMask ?? studio.appliedMask}
              showSelectionOverlay={studio.showSelectionOverlay}
              background={studio.background}
              effects={studio.effects}
              activeTool={studio.activeTool}
              brushSize={studio.brushSize}
              brushHardness={studio.brushHardness}
              brushStrength={studio.brushStrength}
              brushSmoothing={studio.brushSmoothing}
              selectBrushMode={studio.selectBrushMode}
              refineBrushMode={studio.refineBrushMode}
              edgeBrushMode={studio.edgeBrushMode}
              edgeBrushTolerance={studio.edgeBrushTolerance}
              scribblePolarity={studio.scribblePolarity}
              scribbleBrushSize={studio.scribbleBrushSize}
              scribbleBuffer={studio.scribbleBuffer}
              scribbleVersion={studio.scribbleVersion}
              showMaskOverlay={studio.showMaskOverlay}
              maskOverlayOpacity={studio.maskOverlayOpacity}
              viewMode={studio.viewMode}
              zoom={studio.zoom}
              panOffset={studio.panOffset}
              onZoomChange={studio.setZoom}
              onPanOffsetChange={studio.setPanOffset}
              onKeepStrokeLive={studio.setKeepSelectionLive}
              onKeepStrokeCommit={studio.commitSelectionChange}
              onAppliedStrokeLive={studio.setAppliedMaskLive}
              onAppliedStrokeCommit={studio.commitAppliedMaskChange}
              onMagicWandClick={studio.handleMagicWandClick}
              onColorKeyPick={studio.handleColorKeyPick}
              onBgEyedropperPick={studio.handleBgEyedropperPick}
              onGrabCutRectComplete={studio.handleGrabCutRectComplete}
              onScribblesUpdated={studio.markScribblesUpdated}
              onShapeOrLassoComplete={studio.applySelectionDelta}
              onDrawingActiveChange={(active) => {
                isDrawingSelectionRef.current = active;
              }}
              showAutoDebug={studio.showAutoDebug}
              autoDebugData={studio.autoDebugData}
              autoCandidates={studio.autoCandidates}
              activeCandidateIndex={studio.activeCandidateIndex}
            />
          </div>

          {/* Desktop Properties Panel Resize Handle */}
          <div
            role="separator"
            aria-label="Resize studio properties panel"
            aria-orientation="vertical"
            aria-valuemin={260}
            aria-valuemax={560}
            aria-valuenow={propertiesWidth}
            tabIndex={0}
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId);
              propertiesResizeRef.current = { startX: event.clientX, startWidth: propertiesWidth };
            }}
            onPointerMove={(event) => {
              if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
              const { startX, startWidth } = propertiesResizeRef.current;
              const maxWidth = Math.max(260, Math.min(560, window.innerWidth - 420));
              setPropertiesWidth(clamp(startWidth + startX - event.clientX, 260, maxWidth));
            }}
            onKeyDown={(event) => {
              if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
              event.preventDefault();
              const maxWidth = Math.max(260, Math.min(560, window.innerWidth - 420));
              const delta = event.key === 'ArrowLeft' ? 16 : -16;
              setPropertiesWidth((width) => clamp(width + delta, 260, maxWidth));
            }}
            className="group hidden w-2 shrink-0 cursor-col-resize touch-none items-center justify-center bg-transparent hover:bg-blue-500/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-blue-400 lg:flex"
          >
            <span className="h-10 w-0.5 rounded-full bg-border transition-colors group-hover:bg-blue-400" />
          </div>

          {/* Desktop Right Properties Panel */}
          <aside
            aria-label="Studio properties"
            style={{ width: propertiesWidth, flexBasis: propertiesWidth }}
            className="hidden min-w-0 shrink-0 overflow-hidden border-l border-border lg:flex lg:flex-col"
          >
            {propertiesContent}
          </aside>
        </div>
      )}

      {/* Bottom Status Bar */}
      {studio.image && !batchMode && (
        <StudioStatusBar
          phase={studio.phase}
          activeTool={studio.activeTool}
          toolSizeLabel={toolSizeLabel}
          zoom={studio.zoom}
          width={studio.image.dimensions.width}
          height={studio.image.dimensions.height}
          autoSaveStatus={studio.autoSaveStatus}
        />
      )}

      {/* Mobile Collapsible Properties Drawer */}
      {mobilePropsOpen && studio.image && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Studio properties"
          className="fixed inset-0 z-50 flex flex-col justify-end bg-black/70 lg:hidden"
        >
          <div className="flex max-h-[82dvh] flex-col overflow-hidden rounded-t-xl border-t border-[#2c2f3a] bg-[#0c0d12]">
            <div className="flex items-center justify-between gap-2 border-b border-[#2c2f3a] bg-[#101117] px-4 py-2">
              <div className="flex items-center gap-2">
                <span className="h-1.5 w-1.5 shrink-0 bg-[#2f6bff]" />
                <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[#8a8e9c]">
                  Properties
                </span>
              </div>
              <button
                type="button"
                onClick={() => setMobilePropsOpen(false)}
                aria-label="Close properties drawer"
                className="inline-flex h-8 w-8 items-center justify-center rounded border border-[#2c2f3a] bg-[#1a1c24] text-[#8a8e9c] transition-colors duration-150 hover:bg-[#23252d] hover:text-white"
              >
                <CloseIcon className="h-4 w-4" />
              </button>
            </div>
            <div className="flex-1 overflow-hidden">{propertiesContent}</div>
          </div>
        </div>
      )}

      {/* Export Modal */}
      {studio.image && (
        <ExportModal
          open={exportOpen}
          onClose={() => setExportOpen(false)}
          originalWidth={studio.image.dimensions.width}
          originalHeight={studio.image.dimensions.height}
          background={studio.background}
          onSelectPresetBackground={studio.setBackground}
          onExportDownload={async (opts) => {
            const ok = await studio.handleExportDownload(opts);
            if (ok) setExportOpen(false);
          }}
          onExportCopy={studio.handleExportCopy}
          onExportGrayscaleMask={studio.handleExportGrayscaleMask}
          isExporting={studio.isExporting}
        />
      )}

      {/* Confirm Reset Dialog */}
      <ConfirmDialog
        open={resetConfirmOpen}
        title="Reset all changes?"
        message="Reset all changes? This restores the original image."
        confirmLabel="Reset"
        cancelLabel="Cancel"
        destructive
        onCancel={() => setResetConfirmOpen(false)}
        onConfirm={() => {
          setResetConfirmOpen(false);
          studio.handleResetAllChanges();
        }}
      />

      {/* Confirm Auto Replace Existing Erase */}
      <ConfirmDialog
        open={autoReplaceConfirmOpen}
        title="Replace existing cutout?"
        message="You already have an erased result. Apply automatic background removal instead?"
        confirmLabel="Apply auto"
        cancelLabel="Cancel"
        onCancel={() => setAutoReplaceConfirmOpen(false)}
        onConfirm={() => {
          setAutoReplaceConfirmOpen(false);
          studio.handleAutoRemoveAction();
        }}
      />

      {/* Confirm Leaving Studio With Unsaved Changes */}
      <ConfirmDialog
        open={leaveConfirmOpen}
        title="Leave studio?"
        message="You have unsaved edits in progress. Return to the home page?"
        confirmLabel="Leave studio"
        cancelLabel="Stay"
        onCancel={() => setLeaveConfirmOpen(false)}
        onConfirm={() => {
          setLeaveConfirmOpen(false);
          navigate('/');
        }}
      />

      <Toast toast={studio.toast} onDismiss={studio.dismissToast} />
    </div>
  );
}
