import {
  markOpenFilePresent,
  readPersistedOpenFiles,
} from './open-file-store.js';
import { addPdfToLibrary, readPdfLibrary } from './pdf-library-store.js';
import {
  getHomeLibraryEpoch,
  getWorkspaceFiles,
  markFileFromDownload,
  markFileFromHandoff,
  renderWorkspaceFiles,
  setHomeLibraryFiles,
  setWorkspaceFiles,
} from './workspace-files.js';
import { initMyPdfsSearch } from './my-pdfs-search.js';

function isPdfFile(file: File): boolean {
  return (
    file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
  );
}

type FileWithHandle = {
  file: File;
  handle?: FileSystemFileHandle;
};

type FilePickerWindow = Window & {
  showOpenFilePicker?: (options?: {
    multiple?: boolean;
    types?: Array<{
      description?: string;
      accept: Record<string, string[]>;
    }>;
  }) => Promise<FileSystemFileHandle[]>;
};

type HandleDataTransferItem = DataTransferItem & {
  getAsFileSystemHandle?: () => Promise<FileSystemHandle | null>;
};

function isFileHandle(
  handle: FileSystemHandle | null | undefined
): handle is FileSystemFileHandle {
  return (
    !!handle &&
    handle.kind === 'file' &&
    'getFile' in handle &&
    typeof handle.getFile === 'function'
  );
}

async function addOpenFiles(
  incoming: FileWithHandle[],
  root: Document,
  epoch: number
): Promise<void> {
  const pdfs = incoming.filter(({ file }) => isPdfFile(file));
  if (pdfs.length === 0) return;
  setWorkspaceFiles(
    pdfs.map(({ file, handle }) => ({
      name: file.name,
      size: file.size,
      source: 'upload',
      blob: file,
      handle,
    })),
    root
  );
  await Promise.all(
    pdfs.map(({ file, handle }) => addPdfToLibrary(file, 'upload', { handle }))
  );
  await restorePdfLibrary(root, epoch);
}

async function chooseFilesWithHandles(
  root: Document,
  epoch: number
): Promise<boolean> {
  const picker = (window as FilePickerWindow).showOpenFilePicker;
  if (!picker) return false;

  try {
    const handles: FileSystemFileHandle[] = await picker.call(window, {
      multiple: true,
      types: [
        {
          description: 'PDF documents',
          accept: { 'application/pdf': ['.pdf'] },
        },
      ],
    });
    const files = await Promise.all(
      handles.map(async (handle) => ({
        file: await handle.getFile(),
        handle,
      }))
    );
    await addOpenFiles(files, root, epoch);
  } catch (error) {
    return error instanceof DOMException && error.name === 'AbortError';
  }
  return true;
}

async function filesFromDrop(event: DragEvent): Promise<FileWithHandle[]> {
  const items = Array.from(event.dataTransfer?.items ?? []);
  if (items.length > 0) {
    const handled = await Promise.all(
      items.map(async (item): Promise<FileWithHandle | null> => {
        if (item.kind !== 'file') return null;
        const handle = await (
          item as HandleDataTransferItem
        ).getAsFileSystemHandle?.();
        if (isFileHandle(handle)) {
          return { file: await handle.getFile(), handle };
        }
        const file = item.getAsFile();
        return file ? { file } : null;
      })
    );
    return handled.filter((item): item is FileWithHandle => item !== null);
  }
  return Array.from(event.dataTransfer?.files ?? []).map((file) => ({
    file,
  }));
}

async function restoreOpenFiles(root: Document): Promise<void> {
  const persisted = await readPersistedOpenFiles();
  if (persisted.length === 0) {
    // The rail was painted from the session snapshot before this read; with
    // nothing in the store that snapshot is stale, so withdraw the signal and
    // let the render drop those rows. Tool pages get this from abandonSeed.
    if (getWorkspaceFiles().length === 0) {
      markOpenFilePresent(false);
      renderWorkspaceFiles(root);
    }
    return;
  }
  setWorkspaceFiles(
    persisted.map((entry) => {
      if (entry.source === 'handoff') return markFileFromHandoff(entry.file);
      if (entry.source === 'download') return markFileFromDownload(entry.file);
      return entry.file;
    }),
    root
  );
}

export async function syncHomeLibraryFromStore(
  root: Document = document,
  epoch: number = getHomeLibraryEpoch()
): Promise<void> {
  const entries = await readPdfLibrary();
  setHomeLibraryFiles(
    entries.map((entry) => ({
      id: entry.id,
      name: entry.name,
      size: entry.size,
      source: entry.source,
      addedAt: entry.addedAt,
      blob: entry.file,
      handle: entry.handle,
      availability: entry.availability,
    })),
    root,
    epoch
  );
}

async function restorePdfLibrary(root: Document, epoch: number): Promise<void> {
  await syncHomeLibraryFromStore(root, epoch);
}

export function initHomeFiles(root: Document = document): void {
  const hasLibrary = Boolean(root.getElementById('shift-my-pdfs'));
  const isHomeShell = root.body.classList.contains('shift-home');
  if (!hasLibrary && !isHomeShell) return;

  const dropZone = root.getElementById('drop-zone');
  const input = root.getElementById('file-input') as HTMLInputElement | null;
  const libraryEpoch = getHomeLibraryEpoch();

  const addFiles = (fileList: FileList | File[] | null) => {
    if (fileList) {
      void addOpenFiles(
        Array.from(fileList).map((file) => ({ file })),
        root,
        libraryEpoch
      );
    }
  };

  if (hasLibrary && dropZone) {
    dropZone.addEventListener('click', (event) => {
      if ((event.target as HTMLElement | null)?.closest('input')) return;
      void chooseFilesWithHandles(root, libraryEpoch).then((usedPicker) => {
        if (!usedPicker) input?.click();
      });
    });
    dropZone.addEventListener('dragover', (event) => {
      event.preventDefault();
      dropZone.classList.add('is-dragover');
    });
    dropZone.addEventListener('dragleave', () => {
      dropZone.classList.remove('is-dragover');
    });
    dropZone.addEventListener('drop', (event) => {
      event.preventDefault();
      dropZone.classList.remove('is-dragover');
      const items = Array.from(event.dataTransfer?.items ?? []);
      const canReadHandle = items.some(
        (item) =>
          typeof (item as HandleDataTransferItem).getAsFileSystemHandle ===
          'function'
      );
      if (canReadHandle) {
        void filesFromDrop(event).then((files) =>
          addOpenFiles(files, root, libraryEpoch)
        );
      } else {
        addFiles(event.dataTransfer?.files ?? null);
      }
    });
    input?.addEventListener('change', () => {
      addFiles(input.files);
      input.value = '';
    });
  }

  void restoreOpenFiles(root);
  if (hasLibrary) {
    initMyPdfsSearch(root, () => {
      renderWorkspaceFiles(root);
    });
    void restorePdfLibrary(root, libraryEpoch);
  }
}
