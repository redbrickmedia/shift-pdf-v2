import { readPersistedOpenFiles } from './open-file-store.js';
import { markFileFromHandoff, setWorkspaceFiles } from './workspace-files.js';

function isPdfFile(file: File): boolean {
  return (
    file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
  );
}

function addOpenFiles(incoming: File[], root: Document): void {
  const pdfs = incoming.filter(isPdfFile);
  if (pdfs.length === 0) return;
  setWorkspaceFiles(pdfs, root);
}

async function restoreOpenFiles(root: Document): Promise<void> {
  const persisted = await readPersistedOpenFiles();
  if (persisted.length === 0) return;
  setWorkspaceFiles(
    persisted.map((entry) =>
      entry.source === 'handoff' ? markFileFromHandoff(entry.file) : entry.file
    ),
    root
  );
}

export function initHomeFiles(root: Document = document): void {
  if (!root.getElementById('shift-my-pdfs')) return;

  const dropZone = root.getElementById('drop-zone');
  const input = root.getElementById('file-input') as HTMLInputElement | null;

  const addFiles = (fileList: FileList | File[] | null) => {
    if (fileList) addOpenFiles(Array.from(fileList), root);
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

  void restoreOpenFiles(root);
}
