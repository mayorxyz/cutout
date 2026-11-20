import { useCallback, useEffect, useRef, useState } from 'react';
import { DEFAULT_AUTO_SETTINGS, type AutoRemoveSettings } from '../config';
import {
  type AutoDebugSnapshot,
  type CandidateScoreBreakdown,
  runAutoRemovePipeline,
} from '../lib/autoRemoveEngine';
import { validateAndPrepareImage } from '../lib/image';
import { cloneToArrayBuffer } from '../lib/maskAlgorithms';
import type { BgWorkerRequestMessage, BgWorkerResponseMessage } from '../workers/bgRemoval.worker';

export type RemovalStatus = 'idle' | 'processing' | 'done' | 'error';
export type AutoCandidateStatus = 'idle' | 'running' | 'ready' | 'low-confidence' | 'failed';

export interface AutoCandidateMask {
  id: string;
  label: string;
  score: number;
  usedGrabCut: boolean;
  breakdown: CandidateScoreBreakdown;
  mask: Uint8ClampedArray;
}

export interface LoadedImageData {
  originalFile: File;
  originalBlob: Blob;
  originalUrl: string;
  workingWidth: number;
  workingHeight: number;
  workingRgba: Uint8ClampedArray;
  wasDownscaled: boolean;
  notices: string[];
  dimensions: { width: number; height: number };
}

export interface BackgroundRemovalCandidateState {
  image: LoadedImageData | null;
  isDecoding: boolean;
  decodingFileName: string | null;
  decodeError: string | null;
  autoStatus: AutoCandidateStatus;
  autoProgress: number;
  autoProgressDetail: string;
  autoMaskCandidate: Uint8ClampedArray | null;
  candidates: AutoCandidateMask[];
  activeCandidateIndex: number;
  autoScore: number;
  autoConfidence: 'normal' | 'low';
  autoModeUsed: 'plain' | 'complex' | null;
  spillMode: 'green' | 'blue' | null;
  subjectTouchesEdgeDetected: boolean;
  debugData: AutoDebugSnapshot | null;
}

const INITIAL_STATE: BackgroundRemovalCandidateState = {
  image: null,
  isDecoding: false,
  decodingFileName: null,
  decodeError: null,
  autoStatus: 'idle',
  autoProgress: 0,
  autoProgressDetail: '',
  autoMaskCandidate: null,
  candidates: [],
  activeCandidateIndex: 0,
  autoScore: 0,
  autoConfidence: 'normal',
  autoModeUsed: null,
  spillMode: null,
  subjectTouchesEdgeDetected: false,
  debugData: null,
};

export function useBackgroundRemoval() {
  const [state, setState] = useState<BackgroundRemovalCandidateState>(INITIAL_STATE);
  const decodeIdRef = useRef(0);
  const autoReqIdRef = useRef(0);
  const workerRef = useRef<Worker | null>(null);
  const watchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const originalUrlRef = useRef<string | null>(null);
  const imageRef = useRef<LoadedImageData | null>(null);
  imageRef.current = state.image;

  const revokeUrl = useCallback(() => {
    if (originalUrlRef.current) {
      URL.revokeObjectURL(originalUrlRef.current);
      originalUrlRef.current = null;
    }
  }, []);

  const terminateWorker = useCallback(() => {
    if (watchdogRef.current) {
      clearTimeout(watchdogRef.current);
      watchdogRef.current = null;
    }
    if (workerRef.current) {
      workerRef.current.terminate();
      workerRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      decodeIdRef.current += 1;
      autoReqIdRef.current += 1;
      terminateWorker();
      revokeUrl();
    };
  }, [revokeUrl, terminateWorker]);

  const runSilentCandidate = useCallback(
    (
      rgba: Uint8ClampedArray,
      width: number,
      height: number,
      settings: AutoRemoveSettings,
      includeDebug = false
    ): Promise<Uint8ClampedArray | null> => {
      const reqId = autoReqIdRef.current + 1;
      autoReqIdRef.current = reqId;
      terminateWorker();

      setState((prev) => ({
        ...prev,
        autoStatus: 'running',
        autoProgress: 8,
        autoProgressDetail: 'Analyzing image...',
      }));

      const runInMainThread = async (): Promise<Uint8ClampedArray | null> => {
        try {
          const res = await runAutoRemovePipeline(rgba, width, height, settings, {
            includeDebug: import.meta.env.DEV && includeDebug,
            onProgress: (pct, detail) => {
              if (autoReqIdRef.current === reqId) {
                setState((prev) => ({
                  ...prev,
                  autoStatus: 'running',
                  autoProgress: pct,
                  autoProgressDetail: detail,
                }));
              }
            },
          });
          if (autoReqIdRef.current === reqId) {
            const nextStatus: AutoCandidateStatus =
              res.confidence === 'low' ? 'low-confidence' : 'ready';
            setState((prev) => ({
              ...prev,
              autoStatus: nextStatus,
              autoProgress: 100,
              autoProgressDetail: '',
              autoMaskCandidate: res.mask,
              candidates: res.candidates,
              activeCandidateIndex: 0,
              autoScore: res.score,
              autoConfidence: res.confidence,
              autoModeUsed: res.modeUsed,
              spillMode: res.spillMode,
              subjectTouchesEdgeDetected: res.subjectTouchesEdgeDetected,
              debugData: res.debug ?? null,
            }));
            return res.mask;
          }
          return null;
        } catch {
          if (autoReqIdRef.current === reqId) {
            setState((prev) => ({ ...prev, autoStatus: 'failed', autoProgress: 0 }));
          }
          return null;
        }
      };

      return new Promise<Uint8ClampedArray | null>((resolve) => {
        if (typeof Worker === 'undefined') {
          void runInMainThread().then(resolve);
          return;
        }

        let worker: Worker;
        try {
          worker = new Worker(new URL('../workers/bgRemoval.worker.ts', import.meta.url), {
            type: 'module',
          });
        } catch {
          void runInMainThread().then(resolve);
          return;
        }

        workerRef.current = worker;

        watchdogRef.current = setTimeout(() => {
          worker.terminate();
          if (workerRef.current === worker) workerRef.current = null;
          watchdogRef.current = null;
          if (autoReqIdRef.current === reqId) {
            setState((prev) => ({
              ...prev,
              autoStatus: 'failed',
              autoProgress: 0,
              autoProgressDetail: 'Auto removal timed out. Try a smaller image or another mode.',
            }));
          }
          resolve(null);
        }, 90_000);

        worker.onmessage = (event: MessageEvent<BgWorkerResponseMessage>) => {
          const data = event.data;
          if (data.requestId !== reqId || autoReqIdRef.current !== reqId) return;

          if (data.type === 'progress') {
            setState((prev) => ({
              ...prev,
              autoStatus: 'running',
              autoProgress: Math.min(96, data.progress),
              autoProgressDetail: data.detail,
            }));
          } else if (data.type === 'done') {
            worker.terminate();
            if (workerRef.current === worker) workerRef.current = null;
            if (watchdogRef.current) clearTimeout(watchdogRef.current);
            watchdogRef.current = null;
            const mask = new Uint8ClampedArray(data.maskBuffer);
            const candidates: AutoCandidateMask[] = data.candidates.map((c) => ({
              id: c.id,
              label: c.label,
              score: c.score,
              usedGrabCut: c.usedGrabCut,
              breakdown: c.breakdown,
              mask: new Uint8ClampedArray(c.maskBuffer),
            }));
            const nextStatus: AutoCandidateStatus =
              data.confidence === 'low' ? 'low-confidence' : 'ready';

            setState((prev) => ({
              ...prev,
              autoStatus: nextStatus,
              autoProgress: 100,
              autoProgressDetail: '',
              autoMaskCandidate: candidates[0]?.mask ?? mask,
              candidates,
              activeCandidateIndex: 0,
              autoScore: data.score,
              autoConfidence: data.confidence,
              autoModeUsed: data.modeUsed,
              spillMode: data.spillMode,
              subjectTouchesEdgeDetected: data.subjectTouchesEdgeDetected,
              debugData: import.meta.env.DEV ? (data.debug ?? null) : null,
            }));
            resolve(mask);
          } else if (data.type === 'error') {
            worker.terminate();
            if (workerRef.current === worker) workerRef.current = null;
            clearTimeout(watchdogRef.current!);
            watchdogRef.current = null;
            setState((prev) => ({
              ...prev,
              autoStatus: 'failed',
              autoProgress: 0,
              autoProgressDetail: '',
            }));
            resolve(null);
          }
        };

        worker.onerror = () => {
          worker.terminate();
          if (workerRef.current === worker) workerRef.current = null;
          clearTimeout(watchdogRef.current!);
          if (autoReqIdRef.current === reqId) {
            setState((prev) => ({ ...prev, autoStatus: 'failed', autoProgress: 0 }));
          }
          resolve(null);
        };

        const rgbaBuf = cloneToArrayBuffer(rgba);
        const msg: BgWorkerRequestMessage = {
          requestId: reqId,
          rgbaBuffer: rgbaBuf,
          width,
          height,
          settings,
          includeDebug: import.meta.env.DEV && includeDebug,
        };
        worker.postMessage(msg, { transfer: [rgbaBuf] });
      });
    },
    [terminateWorker]
  );

  const loadImageWithSilentAuto = useCallback(
    async (
      file: File,
      settings: AutoRemoveSettings = DEFAULT_AUTO_SETTINGS,
      includeDebug = false
    ): Promise<LoadedImageData | null> => {
      const decodeId = decodeIdRef.current + 1;
      decodeIdRef.current = decodeId;
      autoReqIdRef.current += 1;
      terminateWorker();
      revokeUrl();

      setState({
        ...INITIAL_STATE,
        isDecoding: true,
        decodingFileName: file.name,
      });

      try {
        const prepared = await validateAndPrepareImage(file);
        if (decodeIdRef.current !== decodeId) return null;

        const originalUrl = URL.createObjectURL(prepared.previewBlob);
        originalUrlRef.current = originalUrl;

        const loaded: LoadedImageData = {
          originalFile: file,
          originalBlob: prepared.previewBlob,
          originalUrl,
          workingWidth: prepared.workingWidth,
          workingHeight: prepared.workingHeight,
          workingRgba: prepared.workingRgba,
          wasDownscaled: prepared.wasDownscaled,
          notices: prepared.notices,
          dimensions: { width: prepared.width, height: prepared.height },
        };

        setState({
          ...INITIAL_STATE,
          image: loaded,
          isDecoding: false,
          autoStatus: 'running',
          autoProgress: 8,
        });

        void runSilentCandidate(
          prepared.workingRgba,
          prepared.workingWidth,
          prepared.workingHeight,
          settings,
          includeDebug
        );

        return loaded;
      } catch (err) {
        if (decodeIdRef.current !== decodeId) return null;
        setState({
          ...INITIAL_STATE,
          isDecoding: false,
          decodeError: err instanceof Error ? err.message : 'Invalid image file.',
        });
        return null;
      }
    },
    [revokeUrl, runSilentCandidate, terminateWorker]
  );

  const recomputeCandidate = useCallback(
    (settings: AutoRemoveSettings, includeDebug = false) => {
      const img = imageRef.current;
      if (!img) return;
      void runSilentCandidate(
        img.workingRgba,
        img.workingWidth,
        img.workingHeight,
        settings,
        includeDebug
      );
    },
    [runSilentCandidate]
  );

  const cycleCandidate = useCallback((): AutoCandidateMask | null => {
    let selected: AutoCandidateMask | null = null;
    setState((prev) => {
      if (prev.candidates.length <= 1) return prev;
      const nextIdx = (prev.activeCandidateIndex + 1) % prev.candidates.length;
      selected = prev.candidates[nextIdx];
      return {
        ...prev,
        activeCandidateIndex: nextIdx,
        autoMaskCandidate: selected.mask,
        autoScore: selected.score,
      };
    });
    return selected;
  }, []);

  const hydrateImage = useCallback(
    (
      payload: {
        file: File;
        originalBlob: Blob;
        workingWidth: number;
        workingHeight: number;
        originalWidth: number;
        originalHeight: number;
        workingRgba: Uint8ClampedArray;
        notice?: string;
      },
      settings: AutoRemoveSettings = DEFAULT_AUTO_SETTINGS,
      includeDebug = false
    ): LoadedImageData => {
      decodeIdRef.current += 1;
      autoReqIdRef.current += 1;
      terminateWorker();
      revokeUrl();

      const originalUrl = URL.createObjectURL(payload.originalBlob);
      originalUrlRef.current = originalUrl;

      const loaded: LoadedImageData = {
        originalFile: payload.file,
        originalBlob: payload.originalBlob,
        originalUrl,
        workingWidth: payload.workingWidth,
        workingHeight: payload.workingHeight,
        workingRgba: payload.workingRgba,
        wasDownscaled: false,
        notices: payload.notice ? [payload.notice] : [],
        dimensions: { width: payload.originalWidth, height: payload.originalHeight },
      };

      setState({
        ...INITIAL_STATE,
        image: loaded,
        isDecoding: false,
        autoStatus: 'running',
        autoProgress: 8,
      });

      void runSilentCandidate(
        payload.workingRgba,
        payload.workingWidth,
        payload.workingHeight,
        settings,
        includeDebug
      );

      return loaded;
    },
    [revokeUrl, runSilentCandidate, terminateWorker]
  );

  const reset = useCallback(() => {
    decodeIdRef.current += 1;
    autoReqIdRef.current += 1;
    terminateWorker();
    revokeUrl();
    setState(INITIAL_STATE);
  }, [revokeUrl, terminateWorker]);

  return {
    ...state,
    loadImageWithSilentAuto,
    recomputeCandidate,
    cycleCandidate,
    hydrateImage,
    reset,
  };
}
