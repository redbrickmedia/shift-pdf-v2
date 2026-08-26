import {
  isShiftFilesBridgeReady,
  loadOpenShiftFile,
} from '../embedder/shift-file-access.js';
import {
  persistWorkspaceOpenFile,
  setWorkspaceFiles,
} from './workspace-files.js';

function isPdfFile(file: File): boolean {
  return (
    file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
  );
}

function replaceOpenFile(incoming: File[], root: Document): void {
  const pdfs = incoming.filter(isPdfFile);
  const next = pdfs[pdfs.length - 1];
  if (!next) return;
  setWorkspaceFiles([next], root);
}

function hasShiftFilesApi(): boolean {
  return isShiftFilesBridgeReady();
}

let homeReadyListener: (() => void) | null = null;

function loadHomeShiftFile(root: Document, force = false): void {
  if (!force && !hasShiftFilesApi()) return;
  loadOpenShiftFile(
    async (file) => {
      replaceOpenFile([file], root);
      await persistWorkspaceOpenFile();
    },
    { silent: true }
  );
}

export function initHomeFiles(root: Document = document): void {
  if (!root.getElementById('shift-my-pdfs')) return;

  const dropZone = root.getElementById('drop-zone');
  const input = root.getElementById('file-input') as HTMLInputElement | null;

  const addFiles = (fileList: FileList | File[] | null) => {
    if (!fileList) return;
    replaceOpenFile(Array.from(fileList), root);
  };

  dropZone?.addEventListener('click', (event) => {
    if ((event.target as HTMLElement | null)?.closest('input')) return;
    input?.click();
  });

  dropZone?.addEventListener('dragover', (event) => {
    event.preventDefault();
    dropZone.classList.add('is-dragover');
  });

  dropZone?.addEventListener('dragleave', () => {
    dropZone.classList.remove('is-dragover');
  });

  dropZone?.addEventListener('drop', (event) => {
    event.preventDefault();
    dropZone.classList.remove('is-dragover');
    addFiles(event.dataTransfer?.files ?? null);
  });

  input?.addEventListener('change', () => {
    addFiles(input.files);
    input.value = '';
  });

  if (homeReadyListener) {
    window.removeEventListener('shift-files:ready', homeReadyListener);
    homeReadyListener = null;
  }

  loadHomeShiftFile(root);
  if (hasShiftFilesApi()) return;

  homeReadyListener = () => {
    homeReadyListener = null;
    loadHomeShiftFile(root, true);
  };
  window.addEventListener('shift-files:ready', homeReadyListener, {
    once: true,
  });
}
