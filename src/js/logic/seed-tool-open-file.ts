import {
  getHandoffSourceTabId,
  getSourceTabIdFromLocation,
  readOpenShiftFile,
} from '../embedder/shift-file-access.js';
import { renderFileDisplay, showAlert } from '../ui.js';
import { state } from '../state.js';
import {
  hasOpenFileFlag,
  markOpenFilePresent,
  readPersistedOpenFile,
  rememberSourceTabId,
} from './open-file-store.js';
import {
  copyFileOrigin,
  getWorkspaceFiles,
  markFileFromExtension,
  persistWorkspaceOpenFile,
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
  const input = root.getElementById('file-input') as HTMLInputElement | null;
  if (input && !inputAcceptsFile(input, file)) return false;

  if (input) {
    assignInputFiles(input, [file]);
    for (const assigned of Array.from(input.files ?? [])) {
      copyFileOrigin(file, assigned);
    }
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  if (state.files.length === 0) {
    state.files = [file];
  } else {
    for (const current of state.files) {
      copyFileOrigin(file, current);
    }
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

  const sourceTab = getSourceTabIdFromLocation();
  if (sourceTab !== undefined) {
    rememberSourceTabId(sourceTab);
    markOpenFilePresent(true);
    root.body.classList.add('shift-has-open-file');
  }

  const file = await resolveOpenFile();
  if (!file) {
    if (
      getWorkspaceFiles().length === 0 &&
      (hasOpenFileFlag() || getHandoffSourceTabId() !== undefined)
    ) {
      root.body.classList.remove('shift-has-open-file');
      const dropZone = root.getElementById('drop-zone');
      if (dropZone) dropZone.hidden = false;
    }
    return false;
  }

  const applied = applyFileToToolInput(file, root);
  setWorkspaceFiles([file], root);
  await persistWorkspaceOpenFile();
  return applied || getWorkspaceFiles().length > 0;
}

async function resolveOpenFile(): Promise<File | null> {
  const freshHandoff = getSourceTabIdFromLocation() !== undefined;

  if (freshHandoff) {
    try {
      const fromShift = await readOpenShiftFile();
      if (fromShift) return fromShift;
    } catch (error) {
      const persisted = await hydratePersistedFile();
      if (persisted) return persisted;
      const message =
        error instanceof Error
          ? error.message
          : 'Shift could not load this PDF.';
      showAlert('PDF from Shift', message);
      return null;
    }
  }

  const persisted = await hydratePersistedFile();
  if (persisted) return persisted;

  if (getHandoffSourceTabId() === undefined) return null;

  try {
    return (await readOpenShiftFile()) ?? null;
  } catch {
    return null;
  }
}

async function hydratePersistedFile(): Promise<File | null> {
  const persisted = await readPersistedOpenFile();
  if (!persisted) return null;
  if (persisted.source === 'extension') {
    return markFileFromExtension(persisted.file, persisted.sourceTabId);
  }
  return persisted.file;
}
