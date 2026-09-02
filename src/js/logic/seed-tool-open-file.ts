import { hasShiftFileHandoffRequest } from '../embedder/shift-file-handoff.js';
import { state } from '../state.js';
import { syncHomeLibraryFromStore } from './home-files.js';
import { readPersistedOpenFiles } from './open-file-store.js';
import { readPdfLibrary } from './pdf-library-store.js';
import { markToolFilesSeeded } from './tool-file-seed.js';
import {
  getWorkspaceFiles,
  markFileFromHandoff,
  pickerAcceptsFile,
  setWorkspaceFiles,
} from './workspace-files.js';

export function isHomeDocument(root: Document = document): boolean {
  return Boolean(root.getElementById('shift-my-pdfs'));
}

export function inputAcceptsFile(input: HTMLInputElement, file: File): boolean {
  return pickerAcceptsFile(input, file);
}

export function applyFileToToolInput(
  file: File,
  root: Document = document
): boolean {
  return applyFilesToToolInput([file], root);
}

export function applyFilesToToolInput(
  files: File[],
  root: Document = document
): boolean {
  const input = root.getElementById('file-input') as HTMLInputElement | null;
  const accepted = files.filter(
    (file) => !input || inputAcceptsFile(input, file)
  );
  if (accepted.length === 0) return false;

  if (input) {
    assignInputFiles(input, accepted);
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  if (state.files.length === 0) {
    state.files = accepted.slice();
  }

  markToolFilesSeeded(root);

  return Boolean(input?.files?.length) || state.files.length > 0;
}

function assignInputFiles(input: HTMLInputElement, files: File[]): void {
  if (typeof DataTransfer !== 'undefined') {
    const data = new DataTransfer();
    for (const file of files) data.items.add(file);
    input.files = data.files;
    return;
  }

  Object.defineProperty(input, 'files', {
    configurable: true,
    value: files,
  });
}

function workspaceFilesWithBlob(): File[] {
  return getWorkspaceFiles()
    .map((entry) => entry.blob)
    .filter((blob): blob is File => blob instanceof File);
}

export async function seedToolOpenFile(
  root: Document = document
): Promise<boolean> {
  if (isHomeDocument(root)) return false;

  await syncHomeLibraryFromStore(root);
  if (hasShiftFileHandoffRequest()) return false;

  const persisted = await readPersistedOpenFiles();
  let files: File[] | undefined;

  if (persisted.length > 0) {
    files = persisted.map((entry) =>
      entry.source === 'handoff' ? markFileFromHandoff(entry.file) : entry.file
    );
  } else {
    files = workspaceFilesWithBlob();
    if (files.length === 0) {
      const library = await readPdfLibrary();
      if (library.length > 0) {
        files = [library[0].file];
      }
    }
  }

  if (!files || files.length === 0) return false;

  const applied = applyFilesToToolInput(files, root);
  setWorkspaceFiles(files, root);
  return applied || getWorkspaceFiles().length > 0;
}
