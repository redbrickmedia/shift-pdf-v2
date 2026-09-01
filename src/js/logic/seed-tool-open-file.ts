import { renderFileDisplay } from '../ui.js';
import { state } from '../state.js';
import { readPersistedOpenFiles } from './open-file-store.js';
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

  const display = root.getElementById('file-display-area');
  if (display && !display.querySelector('.truncate')) {
    renderFileDisplay(display, state.files);
  }

  return (
    Boolean(input?.files?.length) ||
    state.files.length > 0 ||
    Boolean(display?.querySelector('.truncate'))
  );
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

export async function seedToolOpenFile(
  root: Document = document
): Promise<boolean> {
  if (isHomeDocument(root)) return false;

  const persisted = await readPersistedOpenFiles();
  if (persisted.length === 0) return false;

  const files = persisted.map((entry) =>
    entry.source === 'handoff' ? markFileFromHandoff(entry.file) : entry.file
  );
  const applied = applyFilesToToolInput(files, root);
  setWorkspaceFiles(files, root);
  return applied || getWorkspaceFiles().length > 0;
}
