import type { BackgroundOption } from '../config';

const DB_NAME = 'cutout-studio-db';
const DB_VERSION = 2;
const PROJECT_STORE = 'currentProject';
const SNAPSHOTS_STORE = 'compareSnapshots';
const CURRENT_KEY = 'active';

export interface SavedProjectRecord {
  id: string;
  fileName: string;
  mimeType: string;
  originalBlob: Blob;
  workingWidth: number;
  workingHeight: number;
  originalWidth: number;
  originalHeight: number;
  phase: 'select' | 'refine';
  keepSelectionBytes: Uint8Array | null;
  maskBytes: Uint8Array | null;
  background: BackgroundOption;
  updatedAt: number;
}

export interface CompareSnapshotRecord {
  id: string;
  label: string;
  createdAt: number;
  width: number;
  height: number;
  maskCompressed: Uint8Array;
  thumbnailDataUrl: string;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(PROJECT_STORE)) {
        db.createObjectStore(PROJECT_STORE, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(SNAPSHOTS_STORE)) {
        db.createObjectStore(SNAPSHOTS_STORE, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Failed to open IndexedDB'));
  });
}

export async function saveCurrentProject(
  record: Omit<SavedProjectRecord, 'id' | 'updatedAt'>
): Promise<boolean> {
  try {
    const db = await openDatabase();
    const tx = db.transaction(PROJECT_STORE, 'readwrite');
    tx.objectStore(PROJECT_STORE).put({
      ...record,
      id: CURRENT_KEY,
      updatedAt: Date.now(),
    });
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
    return true;
  } catch (err) {
    console.warn('Could not save project to IndexedDB:', err);
    return false;
  }
}

export async function loadCurrentProject(): Promise<SavedProjectRecord | null> {
  try {
    const db = await openDatabase();
    const tx = db.transaction(PROJECT_STORE, 'readonly');
    const req = tx.objectStore(PROJECT_STORE).get(CURRENT_KEY);
    const result = await new Promise<SavedProjectRecord | null>((resolve, reject) => {
      req.onsuccess = () => resolve((req.result as SavedProjectRecord | undefined) ?? null);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return result;
  } catch {
    return null;
  }
}

export async function clearCurrentProject(): Promise<void> {
  try {
    const db = await openDatabase();
    const tx = db.transaction([PROJECT_STORE, SNAPSHOTS_STORE], 'readwrite');
    tx.objectStore(PROJECT_STORE).delete(CURRENT_KEY);
    tx.objectStore(SNAPSHOTS_STORE).clear();
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // Ignore cleanup failures
  }
}

export async function saveCompareSnapshot(snapshot: CompareSnapshotRecord): Promise<void> {
  try {
    const db = await openDatabase();
    const tx = db.transaction(SNAPSHOTS_STORE, 'readwrite');
    tx.objectStore(SNAPSHOTS_STORE).put(snapshot);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch (err) {
    console.warn('Could not save compare snapshot:', err);
  }
}

export async function loadCompareSnapshots(): Promise<CompareSnapshotRecord[]> {
  try {
    const db = await openDatabase();
    const tx = db.transaction(SNAPSHOTS_STORE, 'readonly');
    const req = tx.objectStore(SNAPSHOTS_STORE).getAll();
    const items = await new Promise<CompareSnapshotRecord[]>((resolve, reject) => {
      req.onsuccess = () => resolve((req.result as CompareSnapshotRecord[]) ?? []);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return items.sort((a, b) => b.createdAt - a.createdAt);
  } catch {
    return [];
  }
}
