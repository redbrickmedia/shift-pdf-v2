export const OPEN_FILE_FLAG_KEY = 'shiftHasOpenFile';
/**
 * Name/size of the selected files, kept in sessionStorage so sidebar-boot.js can
 * paint a real file row before IndexedDB has produced any blob. Bytes never go
 * here — this is only enough to reserve the row and show the filename.
 */
export const OPEN_FILE_SNAPSHOT_KEY = 'shiftOpenFileSnapshot';
/** Set on <html> by sidebar-boot.js before body parses, so CSS can hide #drop-zone. */
export const OPEN_FILE_PENDING_CLASS = 'shift-open-file-pending';
export const HAS_OPEN_FILE_BODY_CLASS = 'shift-has-open-file';
export const OPEN_FILE_IN_TOOL_CLASS = 'shift-open-file-in-tool';
/** Marks the pre-paint placeholder rows injected by sidebar-boot.js. */
export const OPEN_FILE_SKELETON_ATTR = 'data-shift-skeleton';
/**
 * Marks sidebar rows painted from the snapshot rather than from a resolved
 * blob, in the shell before paint and in workspace-files.ts after it.
 */
export const PENDING_FILE_ROW_ATTR = 'data-shift-pending-file';
/** Marks panels sidebar-boot.js unhid before paint, so they can be put back. */
export const REVEALED_PANEL_ATTR = 'data-shift-revealed';
/**
 * Which tool panels the shell may reveal before paint, matched against the id
 * of a direct child of `#tool-uploader`. Nesting does the rest of the filtering:
 * conditional sub-option groups and mode panels live inside the main panel, so
 * they never match and the skip list stays to the two that would otherwise
 * announce a result before the tool has produced one.
 *
 * These literals are duplicated in public/sidebar-boot.js, which is a classic
 * script and cannot import this module. open-file-boot.test.ts asserts parity.
 */
export const PANEL_REVEAL_PATTERN = '^file-controls$|-options$|-panel$';
export const PANEL_REVEAL_SKIP_PATTERN = '^(?:completion-panel|preview-panel)$';

const MAX_SNAPSHOT_ENTRIES = 6;
const MAX_SNAPSHOT_NAME_LENGTH = 160;

export type OpenFileSnapshotEntry = {
  name: string;
  size: number;
};

export type PersistedOpenFileMeta = {
  name: string;
  type: string;
  source: 'upload' | 'handoff' | 'download';
};

export type PersistedOpenFile = PersistedOpenFileMeta & {
  file: File;
};

type StoredOpenFileEntry = PersistedOpenFileMeta & {
  buffer: ArrayBuffer;
};

/* The top-level entry preserves compatibility with records written before
   multi-select. New records also carry every selected file in order. */
type StoredOpenFileRecord = StoredOpenFileEntry & {
  files?: StoredOpenFileEntry[];
};

const DB_NAME = 'shift-pdf-open-file';
const DB_VERSION = 1;
const STORE_NAME = 'open-file';
const RECORD_KEY = 'current';

let memoryRecord: StoredOpenFileRecord | null = null;
let persistGeneration = 0;

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

export function writeOpenFileSnapshot(
  files: Array<{ name: string; size: number }>
): void {
  const entries: OpenFileSnapshotEntry[] = files
    .slice(0, MAX_SNAPSHOT_ENTRIES)
    .map((file) => ({
      name: String(file.name).slice(0, MAX_SNAPSHOT_NAME_LENGTH),
      size: Number.isFinite(file.size) ? file.size : 0,
    }));

  try {
    if (entries.length === 0) {
      sessionStorage.removeItem(OPEN_FILE_SNAPSHOT_KEY);
      return;
    }
    sessionStorage.setItem(OPEN_FILE_SNAPSHOT_KEY, JSON.stringify(entries));
  } catch {
    // Quota or private mode: the skeleton falls back to a generic row.
  }
}

export function readOpenFileSnapshot(): OpenFileSnapshotEntry[] {
  try {
    const raw = sessionStorage.getItem(OPEN_FILE_SNAPSHOT_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((value) => {
      if (!value || typeof value !== 'object') return [];
      const { name, size } = value as Partial<OpenFileSnapshotEntry>;
      if (typeof name !== 'string') return [];
      return [{ name, size: typeof size === 'number' ? size : 0 }];
    });
  } catch {
    return [];
  }
}

/**
 * Drop the pre-paint placeholder rows. Called when seeding resolves with
 * nothing, so a stale flag cannot strand a placeholder over the drop zone.
 */
export function removeOpenFileSkeleton(root: Document = document): void {
  stopSkeletonRetirement();
  root
    .querySelectorAll(`[${OPEN_FILE_SKELETON_ATTR}]`)
    .forEach((node) => node.remove());
}

export function hasOpenFileSkeleton(root: Document = document): boolean {
  return Boolean(root.querySelector(`[${OPEN_FILE_SKELETON_ATTR}]`));
}

/**
 * Put back the `hidden` class on panels the shell revealed from the session
 * flag. Only for the case where the flag lied: with no file to work on, an
 * options panel over the picker is worse than the pop it was avoiding.
 */
export function restoreRevealedPanels(root: Document = document): void {
  releaseRevealedPanelHold();
  root.querySelectorAll(`[${REVEALED_PANEL_ATTR}]`).forEach((panel) => {
    panel.classList.add('hidden');
    panel.removeAttribute(REVEALED_PANEL_ATTR);
  });
}

let revealHold: MutationObserver | null = null;

/**
 * Keep the shell's reveal in place until the seed resolves.
 *
 * A tool page module runs on its own DOMContentLoaded handler, independent of
 * main.ts, and most of them open by hiding their panel because no file has
 * arrived yet. Without this the panel would show from the first frame, blink
 * out when the module initialises, and come back a hundred milliseconds later
 * when the blob lands — a worse artefact than the pop we set out to remove.
 */
export function holdRevealedPanels(root: Document = document): void {
  releaseRevealedPanelHold();
  const panels = Array.from(
    root.querySelectorAll<HTMLElement>(`[${REVEALED_PANEL_ATTR}]`)
  );
  if (panels.length === 0) return;

  // A module may already have hidden it before we got here.
  for (const panel of panels) panel.classList.remove('hidden');

  revealHold = new MutationObserver((records) => {
    for (const record of records) {
      (record.target as HTMLElement).classList.remove('hidden');
    }
  });
  for (const panel of panels) {
    revealHold.observe(panel, {
      attributes: true,
      attributeFilter: ['class'],
    });
  }
}

export function releaseRevealedPanelHold(): void {
  revealHold?.disconnect();
  revealHold = null;
}

/**
 * Hand the revealed panels over to the tool once its files really landed. The
 * panel stays visible; dropping the marker is what stops a later restore from
 * hiding a panel the tool now owns.
 */
export function forgetRevealedPanels(root: Document = document): void {
  releaseRevealedPanelHold();
  root
    .querySelectorAll(`[${REVEALED_PANEL_ATTR}]`)
    .forEach((panel) => panel.removeAttribute(REVEALED_PANEL_ATTR));
}

/**
 * Undo the classes sidebar-boot.js applied from the session flag. Used when the
 * seed turns up nothing, so the tool falls back to its picker instead of
 * keeping an uploader that was hidden for a file that never arrived.
 */
export function clearOpenFileFlagClasses(root: Document = document): void {
  root.documentElement.classList.remove(OPEN_FILE_PENDING_CLASS);
  root.body.classList.remove(HAS_OPEN_FILE_BODY_CLASS);
  root.body.classList.remove(OPEN_FILE_IN_TOOL_CLASS);
}

/* Tools render their rows into one of these two containers. */
const ROW_CONTAINER_IDS = ['file-display-area', 'file-list'];

let skeletonObserver: MutationObserver | null = null;
let skeletonTimer: ReturnType<typeof setTimeout> | null = null;

function stopSkeletonRetirement(): void {
  skeletonObserver?.disconnect();
  skeletonObserver = null;
  if (skeletonTimer !== null) clearTimeout(skeletonTimer);
  skeletonTimer = null;
}

/**
 * Hold the placeholder until the tool has actually painted its own file row.
 * Tools like crop load the PDF before rendering, so dropping the placeholder
 * the moment the blob is applied reopens the empty-card gap for those frames.
 * The timeout is the backstop for tools that never render a row.
 */
export function retireOpenFileSkeleton(
  root: Document = document,
  options: { timeoutMs?: number; onRetired?: () => void } = {}
): void {
  const { timeoutMs = 3000, onRetired } = options;
  const containers = ROW_CONTAINER_IDS.map((id) =>
    root.getElementById(id)
  ).filter((element): element is HTMLElement => element !== null);

  const retire = () => {
    removeOpenFileSkeleton(root);
    onRetired?.();
  };

  if (containers.length === 0) {
    retire();
    return;
  }

  const hasRealRow = () =>
    containers.some((container) =>
      Array.from(container.children).some(
        (child) => !child.hasAttribute(OPEN_FILE_SKELETON_ATTR)
      )
    );

  if (hasRealRow()) {
    retire();
    return;
  }

  stopSkeletonRetirement();
  skeletonObserver = new MutationObserver(() => {
    if (hasRealRow()) retire();
  });
  for (const container of containers) {
    skeletonObserver.observe(container, { childList: true });
  }
  skeletonTimer = setTimeout(retire, timeoutMs);
}

/**
 * Promote the sync sessionStorage open-file signal onto body classes used by
 * CSS to hide the empty uploader. Callers must pass whether the page picker
 * accepts PDFs; non-PDF tools keep their drop zone.
 */
export function applyOpenFileFlagClasses(
  root: Document = document,
  options: { acceptsPdf: boolean; isHome?: boolean } = { acceptsPdf: false }
): boolean {
  root.documentElement.classList.remove(OPEN_FILE_PENDING_CLASS);
  const isHome =
    options.isHome ??
    (root.body.classList.contains('shift-home') ||
      Boolean(root.getElementById('shift-my-pdfs')));
  if (isHome || !hasOpenFileFlag()) return false;

  root.body.classList.add(HAS_OPEN_FILE_BODY_CLASS);
  if (options.acceptsPdf) {
    root.body.classList.add(OPEN_FILE_IN_TOOL_CLASS);
  }
  return true;
}

export async function writePersistedOpenFiles(
  files: Array<{ file: File; source: PersistedOpenFileMeta['source'] }>
): Promise<void> {
  const last = files[files.length - 1];
  if (!last) {
    await clearPersistedOpenFile();
    return;
  }
  const generation = ++persistGeneration;
  markOpenFilePresent(true);
  writeOpenFileSnapshot(files.map((entry) => entry.file));

  const storedFiles = await Promise.all(
    files.map(async ({ file, source }): Promise<StoredOpenFileEntry> => {
      const buffer = await file.arrayBuffer();
      return {
        name: file.name,
        type: file.type || 'application/pdf',
        source,
        buffer,
      };
    })
  );
  if (generation !== persistGeneration) return;

  const lastStored = storedFiles[storedFiles.length - 1];
  if (!lastStored) return;
  const record: StoredOpenFileRecord = {
    ...lastStored,
    files: storedFiles,
  };
  memoryRecord = record;
  try {
    await withStore('readwrite', (store) => store.put(record, RECORD_KEY));
  } catch {
    // IndexedDB can be unavailable in tests and private mode.
  }
}

export async function writePersistedOpenFile(
  file: File,
  meta: Pick<PersistedOpenFileMeta, 'source'> & {
    snapshot?: Array<{ name: string; size: number }>;
  }
): Promise<void> {
  const generation = ++persistGeneration;
  markOpenFilePresent(true);
  writeOpenFileSnapshot(meta.snapshot ?? [file]);

  const record: StoredOpenFileRecord = {
    name: file.name,
    type: file.type || 'application/pdf',
    source: meta.source,
    buffer: await file.arrayBuffer(),
  };
  if (generation !== persistGeneration) return;
  memoryRecord = record;
  try {
    await withStore('readwrite', (store) => store.put(record, RECORD_KEY));
  } catch {
    // IndexedDB can be unavailable in tests and private mode.
  }
}

export async function readPersistedOpenFiles(): Promise<PersistedOpenFile[]> {
  const record = await readStoredOpenFileRecord();
  if (!record) return [];
  const files = (record.files ?? [record]).map(storedEntryToPersistedFile);
  return files;
}

export async function readPersistedOpenFile(): Promise<PersistedOpenFile | null> {
  const files = await readPersistedOpenFiles();
  return files[files.length - 1] ?? null;
}

async function readStoredOpenFileRecord(): Promise<StoredOpenFileRecord | null> {
  let record = memoryRecord;
  try {
    const stored = await withStore('readonly', (store) =>
      store.get(RECORD_KEY)
    );
    if (stored) record = stored as StoredOpenFileRecord;
  } catch {
    // Fall back to the in-memory copy for this tab.
  }
  return record;
}

function storedEntryToPersistedFile(
  record: StoredOpenFileEntry
): PersistedOpenFile {
  return {
    name: record.name,
    type: record.type,
    source: record.source,
    file: new File([record.buffer], record.name, { type: record.type }),
  };
}

export async function clearPersistedOpenFile(): Promise<void> {
  persistGeneration += 1;
  memoryRecord = null;
  markOpenFilePresent(false);
  writeOpenFileSnapshot([]);
  try {
    await withStore('readwrite', (store) => store.delete(RECORD_KEY));
  } catch {
    // Ignore storage failures.
  }
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
