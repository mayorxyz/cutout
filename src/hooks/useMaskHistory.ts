import { useCallback, useRef, useState } from 'react';
import { MAX_HISTORY_BYTES, MAX_HISTORY_STEPS } from '../config';
import { compressMaskRLE, decompressMaskRLE } from '../lib/maskAlgorithms';

interface HistoryEntry {
  label: string;
  compressed: Uint8Array;
  byteLength: number;
}

export function useMaskHistory() {
  const entriesRef = useRef<HistoryEntry[]>([]);
  const indexRef = useRef(-1);
  const expectedLengthRef = useRef(0);
  const [meta, setMeta] = useState({ index: -1, length: 0, memoryBytes: 0 });

  const syncMeta = useCallback(() => {
    const totalBytes = entriesRef.current.reduce((acc, item) => acc + item.byteLength, 0);
    setMeta({
      index: indexRef.current,
      length: entriesRef.current.length,
      memoryBytes: totalBytes,
    });
  }, []);

  const init = useCallback(
    (initialMask: Uint8ClampedArray, label = 'Initial AI cutout') => {
      expectedLengthRef.current = initialMask.length;
      const compressed = compressMaskRLE(initialMask);
      entriesRef.current = [{ label, compressed, byteLength: compressed.byteLength }];
      indexRef.current = 0;
      syncMeta();
    },
    [syncMeta]
  );

  const push = useCallback(
    (mask: Uint8ClampedArray, label: string) => {
      expectedLengthRef.current = mask.length;
      const compressed = compressMaskRLE(mask);

      // Discard redo tail
      const sliced = entriesRef.current.slice(0, indexRef.current + 1);
      sliced.push({ label, compressed, byteLength: compressed.byteLength });

      // Enforce step cap (keep >= 30 steps, configured 40) and memory cap
      while (sliced.length > MAX_HISTORY_STEPS) {
        sliced.shift();
      }
      let totalBytes = sliced.reduce((acc, item) => acc + item.byteLength, 0);
      while (sliced.length > 2 && totalBytes > MAX_HISTORY_BYTES) {
        const removed = sliced.shift();
        totalBytes -= removed ? removed.byteLength : 0;
      }

      entriesRef.current = sliced;
      indexRef.current = sliced.length - 1;
      syncMeta();
    },
    [syncMeta]
  );

  const undo = useCallback((): Uint8ClampedArray | null => {
    if (indexRef.current <= 0) return null;
    indexRef.current -= 1;
    const entry = entriesRef.current[indexRef.current];
    syncMeta();
    return decompressMaskRLE(entry.compressed, expectedLengthRef.current);
  }, [syncMeta]);

  const redo = useCallback((): Uint8ClampedArray | null => {
    if (indexRef.current >= entriesRef.current.length - 1) return null;
    indexRef.current += 1;
    const entry = entriesRef.current[indexRef.current];
    syncMeta();
    return decompressMaskRLE(entry.compressed, expectedLengthRef.current);
  }, [syncMeta]);

  const clear = useCallback(() => {
    entriesRef.current = [];
    indexRef.current = -1;
    expectedLengthRef.current = 0;
    syncMeta();
  }, [syncMeta]);

  return {
    init,
    push,
    undo,
    redo,
    clear,
    canUndo: meta.index > 0,
    canRedo: meta.index >= 0 && meta.index < meta.length - 1,
    stepCount: meta.length,
    currentStep: meta.index + 1,
    memoryBytes: meta.memoryBytes,
  };
}
