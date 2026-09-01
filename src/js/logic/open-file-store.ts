export const OPEN_FILE_FLAG_KEY = 'shiftHasOpenFile';

export type PersistedOpenFileMeta = {
  name: string;
  type: string;
  source: 'upload' | 'handoff';
};

export type PersistedOpenFile = PersistedOpenFileMeta & {
  file: File;
};

type StoredOpenFileRecord = PersistedOpenFileMeta & {
  buffer: ArrayBuffer;
};

type StoredOpenFilesPayload = {
  files: StoredOpenFileRecord[];
};

const DB_NAME = 'shift-pdf-open-file';
const DB_VERSION = 1;
const STORE_NAME = 'open-file';
const RECORD_KEY = 'current';

let memoryRecords: StoredOpenFileRecord[] = [];

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

export async function writePersistedOpenFiles(
  files: Array<{ file: File; source: PersistedOpenFileMeta['source'] }>
): Promise<void> {
  if (files.length === 0) {
    await clearPersistedOpenFile();
    return;
  }

  markOpenFilePresent(true);
  const records: StoredOpenFileRecord[] = await Promise.all(
    files.map(async ({ file, source }) => ({
      name: file.name,
      type: file.type || 'application/pdf',
      source,
      buffer: await file.arrayBuffer(),
    }))
  );
  memoryRecords = records;
  try {
    const payload: StoredOpenFilesPayload = { files: records };
    await withStore('readwrite', (store) => store.put(payload, RECORD_KEY));
  } catch {
    // IndexedDB can be unavailable in tests and private mode.
  }
}

export async function writePersistedOpenFile(
  file: File,
  meta: Pick<PersistedOpenFileMeta, 'source'>
): Promise<void> {
  return writePersistedOpenFiles([{ file, source: meta.source }]);
}

export async function readPersistedOpenFiles(): Promise<PersistedOpenFile[]> {
  let records = memoryRecords;
  try {
    const stored = await withStore('readonly', (store) =>
      store.get(RECORD_KEY)
    );
    const parsed = recordsFromStored(stored);
    if (parsed) records = parsed;
  } catch {
    // Fall back to the in-memory copy for this tab.
  }
  return records.map(toPersistedFile);
}

export async function readPersistedOpenFile(): Promise<PersistedOpenFile | null> {
  const files = await readPersistedOpenFiles();
  return files[0] ?? null;
}

export async function clearPersistedOpenFile(): Promise<void> {
  memoryRecords = [];
  markOpenFilePresent(false);
  try {
    await withStore('readwrite', (store) => store.delete(RECORD_KEY));
  } catch {
    // Ignore storage failures.
  }
}

function recordsFromStored(stored: unknown): StoredOpenFileRecord[] | null {
  if (!stored || typeof stored !== 'object') return null;
  const payload = stored as Partial<StoredOpenFilesPayload> &
    Partial<StoredOpenFileRecord>;
  if (Array.isArray(payload.files)) {
    return payload.files.filter(isStoredRecord);
  }
  if (isStoredRecord(payload)) return [payload];
  return null;
}

function isStoredRecord(value: unknown): value is StoredOpenFileRecord {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<StoredOpenFileRecord>;
  return (
    typeof record.name === 'string' &&
    typeof record.type === 'string' &&
    (record.source === 'upload' || record.source === 'handoff') &&
    record.buffer instanceof ArrayBuffer
  );
}

function toPersistedFile(record: StoredOpenFileRecord): PersistedOpenFile {
  return {
    name: record.name,
    type: record.type,
    source: record.source,
    file: new File([record.buffer], record.name, { type: record.type }),
  };
}

function withStore<T>(
  mode: 'readonly' | 'readwrite',
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
