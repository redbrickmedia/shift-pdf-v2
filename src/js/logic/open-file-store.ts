export const OPEN_FILE_FLAG_KEY = 'shiftHasOpenFile';
export const OPEN_FILE_SOURCE_TAB_KEY = 'shiftOpenFileSourceTab';

export type PersistedOpenFileMeta = {
  name: string;
  type: string;
  source: 'upload' | 'extension';
  sourceTabId?: number;
};

export type PersistedOpenFile = PersistedOpenFileMeta & {
  file: File;
};

type StoredOpenFileRecord = PersistedOpenFileMeta & {
  buffer: ArrayBuffer;
};

const DB_NAME = 'shift-pdf-open-file';
const DB_VERSION = 1;
const STORE_NAME = 'open-file';
const RECORD_KEY = 'current';

let memoryRecord: StoredOpenFileRecord | null = null;

export function markOpenFilePresent(present: boolean): void {
  try {
    if (present) {
      sessionStorage.setItem(OPEN_FILE_FLAG_KEY, '1');
      return;
    }
    sessionStorage.removeItem(OPEN_FILE_FLAG_KEY);
  } catch {
    // Private mode can block storage.
  }
}

export function hasOpenFileFlag(): boolean {
  try {
    return sessionStorage.getItem(OPEN_FILE_FLAG_KEY) === '1';
  } catch {
    return false;
  }
}

export function rememberSourceTabId(tabId?: number): void {
  try {
    if (tabId === undefined) {
      sessionStorage.removeItem(OPEN_FILE_SOURCE_TAB_KEY);
      return;
    }
    sessionStorage.setItem(OPEN_FILE_SOURCE_TAB_KEY, String(tabId));
  } catch {
    // Private mode can block storage.
  }
}

export function getRememberedSourceTabId(): number | undefined {
  try {
    const value = sessionStorage.getItem(OPEN_FILE_SOURCE_TAB_KEY);
    if (!value) return undefined;
    const tabId = Number(value);
    return Number.isInteger(tabId) && tabId >= 0 ? tabId : undefined;
  } catch {
    return undefined;
  }
}

export async function writePersistedOpenFile(
  file: File,
  meta: Pick<PersistedOpenFileMeta, 'source' | 'sourceTabId'>
): Promise<void> {
  markOpenFilePresent(true);
  if (meta.source === 'extension') {
    rememberSourceTabId(meta.sourceTabId);
  } else {
    rememberSourceTabId(undefined);
  }

  const record: StoredOpenFileRecord = {
    name: file.name,
    type: file.type || 'application/pdf',
    source: meta.source,
    sourceTabId: meta.sourceTabId,
    buffer: await file.arrayBuffer(),
  };
  memoryRecord = record;
  try {
    await withStore('readwrite', (store) => store.put(record, RECORD_KEY));
  } catch {
    // IndexedDB can be unavailable in tests and private mode.
  }
}

export async function readPersistedOpenFile(): Promise<PersistedOpenFile | null> {
  let record = memoryRecord;
  try {
    const stored = await withStore('readonly', (store) =>
      store.get(RECORD_KEY)
    );
    if (stored) record = stored as StoredOpenFileRecord;
  } catch {
    // Fall back to the in-memory copy for this tab.
  }
  if (!record) return null;
  return {
    name: record.name,
    type: record.type,
    source: record.source,
    sourceTabId: record.sourceTabId,
    file: new File([record.buffer], record.name, { type: record.type }),
  };
}

export async function clearPersistedOpenFile(): Promise<void> {
  memoryRecord = null;
  markOpenFilePresent(false);
  rememberSourceTabId(undefined);
  try {
    await withStore('readwrite', (store) => store.delete(RECORD_KEY));
  } catch {
    // Ignore storage failures.
  }
}

function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not available.'));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const transaction = db.transaction(STORE_NAME, mode);
      const store = transaction.objectStore(STORE_NAME);
      const operation = run(store);
      operation.onerror = () => {
        db.close();
        reject(operation.error);
      };
      operation.onsuccess = () => {
        db.close();
        resolve(operation.result);
      };
    };
  });
}
