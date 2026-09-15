export type PdfLibrarySource = 'upload' | 'handoff' | 'download';

export type PdfLibraryEntry = {
  id: string;
  name: string;
  type: string;
  size: number;
  addedAt: number;
  source: PdfLibrarySource;
  file: File;
  handle?: FileSystemFileHandle;
};

type StoredPdfLibraryRecord = Omit<PdfLibraryEntry, 'file'> & {
  buffer: ArrayBuffer;
};

type OriginalSavedPdfRecord = {
  id: string;
  filename: string;
  base64: string;
  dateAddedTimestamp: number;
  folderId: string;
  pageCount: number;
  sizeInBytes: number;
  source?: PdfLibrarySource;
  handle?: FileSystemFileHandle;
};

const DB_NAME = 'SavedPdfDatabase';
const DB_VERSION = 2;
const STORE_NAME = 'pdfs';

let memoryRecords: StoredPdfLibraryRecord[] = [];
let libraryGeneration = 0;

export async function addPdfToLibrary(
  file: File,
  source: PdfLibrarySource,
  options: { handle?: FileSystemFileHandle } = {}
): Promise<PdfLibraryEntry> {
  const generation = libraryGeneration;
  const buffer = await file.arrayBuffer();
  const type = file.type || 'application/pdf';
  const base64 = bufferToDataUri(buffer, type);
  const duplicate = await findStoredDuplicate(file.name, file.size, base64);
  if (duplicate && generation === libraryGeneration) {
    if (options.handle) {
      duplicate.handle = options.handle;
      try {
        await withStore('readwrite', (store) =>
          store.put(toOriginalSavedPdfRecord(duplicate), duplicate.id)
        );
      } catch {
        // Keep the handle available in memory when IndexedDB is unavailable.
      }
    }
    if (memoryRecords.some((existing) => existing.id === duplicate.id)) {
      memoryRecords = memoryRecords.map((existing) =>
        existing.id === duplicate.id ? duplicate : existing
      );
    } else {
      memoryRecords = [...memoryRecords, duplicate];
    }
    return toLibraryEntry(duplicate);
  }

  const lastAddedAt = memoryRecords.at(-1)?.addedAt ?? 0;
  const record: StoredPdfLibraryRecord = {
    id: createId(),
    name: file.name,
    type,
    size: file.size,
    addedAt: Math.max(Date.now(), lastAddedAt + 1),
    source,
    buffer,
    handle: options.handle,
  };

  if (generation !== libraryGeneration) {
    return toLibraryEntry(record);
  }
  memoryRecords = [...memoryRecords, record];
  try {
    await withStore('readwrite', (store) =>
      store.put(toOriginalSavedPdfRecord(record, base64), record.id)
    );
  } catch {
    // Keep the in-memory library available when IndexedDB is unavailable.
  }

  return toLibraryEntry(record);
}

export async function readPdfLibrary(): Promise<PdfLibraryEntry[]> {
  let records = memoryRecords;
  try {
    const stored = await withStore('readonly', (store) => store.getAll());
    if (Array.isArray(stored)) {
      records = stored.flatMap((value) => {
        if (!isOriginalSavedPdfRecord(value)) return [];
        try {
          return [fromOriginalSavedPdfRecord(value)];
        } catch {
          return [];
        }
      });
      memoryRecords = records;
    }
  } catch {
    // Fall back to the in-memory library for this tab.
  }

  return records
    .slice()
    .sort((left, right) => right.addedAt - left.addedAt)
    .map(toLibraryEntry);
}

export async function updatePdfInLibrary(
  id: string,
  values: { file?: File; name?: string }
): Promise<PdfLibraryEntry | undefined> {
  const records = await readStoredRecords();
  const current = records.find((record) => record.id === id);
  if (!current) return undefined;

  if (values.file) {
    current.buffer = await values.file.arrayBuffer();
    current.type = values.file.type || current.type;
    current.size = values.file.size;
  }
  if (values.name) {
    current.name = values.name;
  }

  memoryRecords = records.map((record) =>
    record.id === id ? current : record
  );
  try {
    await withStore('readwrite', (store) =>
      store.put(toOriginalSavedPdfRecord(current), current.id)
    );
  } catch {
    // Keep the in-memory library available when IndexedDB is unavailable.
  }
  return toLibraryEntry(current);
}

export async function findWritableLibraryEntry(file: {
  id?: string;
  name: string;
  size?: number;
  handle?: FileSystemFileHandle;
}): Promise<PdfLibraryEntry | undefined> {
  const entries = await readPdfLibrary();
  const entry = entries.find((candidate) => {
    if (file.id) return candidate.id === file.id;
    return candidate.name === file.name && candidate.size === file.size;
  });
  const handle = entry?.handle ?? file.handle;
  if (!entry || !handle) return undefined;
  return { ...entry, handle };
}

async function readStoredRecords(): Promise<StoredPdfLibraryRecord[]> {
  await readPdfLibrary();
  return memoryRecords;
}

export async function removePdfFromLibrary(id: string): Promise<void> {
  memoryRecords = memoryRecords.filter((record) => record.id !== id);
  try {
    await withStore('readwrite', (store) => store.delete(id));
  } catch {
    // Keep the in-memory library authoritative when IndexedDB is unavailable.
  }
}

export async function clearPdfLibrary(): Promise<void> {
  libraryGeneration += 1;
  memoryRecords = [];
  try {
    await withStore('readwrite', (store) => store.clear());
  } catch {
    // Ignore storage failures.
  }
}

async function findStoredDuplicate(
  name: string,
  size: number,
  base64: string
): Promise<StoredPdfLibraryRecord | null> {
  const matches = (value: unknown): value is OriginalSavedPdfRecord =>
    isOriginalSavedPdfRecord(value) &&
    value.filename === name &&
    value.sizeInBytes === size &&
    value.base64 === base64;

  try {
    const stored = await withStore('readonly', (store) => store.getAll());
    const match = Array.isArray(stored) ? stored.find(matches) : undefined;
    if (match) return fromOriginalSavedPdfRecord(match);
  } catch {
    // Fall back to the in-memory library when IndexedDB is unavailable.
  }

  return (
    memoryRecords.find(
      (record) =>
        record.name === name &&
        record.size === size &&
        bufferToDataUri(record.buffer, record.type) === base64
    ) ?? null
  );
}

function createId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function isOriginalSavedPdfRecord(
  value: unknown
): value is OriginalSavedPdfRecord {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<OriginalSavedPdfRecord>;
  return (
    typeof record.id === 'string' &&
    typeof record.filename === 'string' &&
    typeof record.base64 === 'string' &&
    typeof record.dateAddedTimestamp === 'number' &&
    typeof record.sizeInBytes === 'number'
  );
}

function toOriginalSavedPdfRecord(
  record: StoredPdfLibraryRecord,
  base64 = bufferToDataUri(record.buffer, record.type)
): OriginalSavedPdfRecord {
  return {
    id: record.id,
    filename: record.name,
    base64,
    dateAddedTimestamp: record.addedAt,
    folderId: '',
    pageCount: 0,
    sizeInBytes: record.size,
    source: record.source,
    handle: record.handle,
  };
}

function fromOriginalSavedPdfRecord(
  record: OriginalSavedPdfRecord
): StoredPdfLibraryRecord {
  return {
    id: record.id,
    name: record.filename,
    type: 'application/pdf',
    size: record.sizeInBytes,
    addedAt: record.dateAddedTimestamp,
    source:
      record.source === 'handoff' || record.source === 'download'
        ? record.source
        : 'upload',
    buffer: dataUriToBuffer(record.base64),
    handle: record.handle,
  };
}

function bufferToDataUri(buffer: ArrayBuffer, type: string): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `data:${type};base64,${btoa(binary)}`;
}

function dataUriToBuffer(dataUri: string): ArrayBuffer {
  const encoded = dataUri.slice(dataUri.indexOf(',') + 1);
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer;
}

function toLibraryEntry(record: StoredPdfLibraryRecord): PdfLibraryEntry {
  return {
    id: record.id,
    name: record.name,
    type: record.type,
    size: record.size,
    addedAt: record.addedAt,
    source: record.source,
    file: new File([record.buffer], record.name, { type: record.type }),
    handle: record.handle,
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
      const operation = run(transaction.objectStore(STORE_NAME));
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
