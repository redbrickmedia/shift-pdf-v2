import { isPdfFile } from '../utils/pdf-file.js';
import {
  markOpenFilePresent,
  readPersistedOpenFiles,
} from './open-file-store.js';
import {
  getHomeLibraryEpoch,
  getWorkspaceFiles,
  markFileFromDownload,
  markFileFromHandoff,
  markFileLibraryId,
  renderWorkspaceFiles,
  setWorkspaceFiles,
  syncHomeLibraryFromStore,
} from './workspace-files.js';
import { initMyPdfsSearch } from './my-pdfs-search.js';

async function addOpenFiles(
  incoming: File[],
  root: Document,
  epoch: number
): Promise<void> {
  const pdfs = incoming.filter(isPdfFile);
  if (pdfs.length === 0) return;
  // setWorkspaceFiles saves the selection to the library itself; adding here
  // too would race its store read and land a second copy of each file.
  setWorkspaceFiles(pdfs, root);
  await restorePdfLibrary(root, epoch);
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
      let file = entry.file;
      if (entry.libraryId) file = markFileLibraryId(file, entry.libraryId);
      if (entry.source === 'handoff') return markFileFromHandoff(file);
      if (entry.source === 'download') return markFileFromDownload(file);
      return file;
    }),
    root
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
    if (fileList) void addOpenFiles(Array.from(fileList), root, libraryEpoch);
  };

  if (hasLibrary && dropZone) {
    dropZone.addEventListener('click', (event) => {
      if ((event.target as HTMLElement | null)?.closest('input')) return;
      input?.click();
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
      addFiles(event.dataTransfer?.files ?? null);
    });
    input?.addEventListener('change', () => {
      addFiles(input.files);
      input.value = '';
    });
  }

  // Onboarding CTA opens the same library picker as the drop zone / Choose files.
  root.getElementById('shift-promise-upload')?.addEventListener('click', () => {
    input?.click();
  });

  void restoreOpenFiles(root);
  if (hasLibrary) {
    initMyPdfsSearch(root, () => {
      renderWorkspaceFiles(root);
    });
    void restorePdfLibrary(root, libraryEpoch);
  }
}
