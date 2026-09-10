import { readPersistedOpenFile } from './open-file-store.js';
import {
  markFileFromHandoff,
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
  if (next) setWorkspaceFiles([next], root);
}

async function restoreOpenFile(root: Document): Promise<void> {
  const persisted = await readPersistedOpenFile();
  if (!persisted) return;
  const file =
    persisted.source === 'handoff'
      ? markFileFromHandoff(persisted.file)
      : persisted.file;
  replaceOpenFile([file], root);
}

export function initHomeFiles(root: Document = document): void {
  if (!root.getElementById('shift-my-pdfs')) return;

  const dropZone = root.getElementById('drop-zone');
  const input = root.getElementById('file-input') as HTMLInputElement | null;

  const addFiles = (fileList: FileList | File[] | null) => {
    if (fileList) replaceOpenFile(Array.from(fileList), root);
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

  void restoreOpenFile(root);
}
