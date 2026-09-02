import { renderFileDisplay } from '../ui.js';
import { state } from '../state.js';
import { readPersistedOpenFile } from './open-file-store.js';
import {
  getActiveFileInput,
  getWorkspaceFiles,
  isInPageToolActive,
  markFileFromHandoff,
  pickerAcceptsFile,
  setWorkspaceFiles,
} from './workspace-files.js';

let inPageToolObserver: MutationObserver | null = null;
const seededInputs = new WeakSet<HTMLInputElement>();

export function isHomeDocument(root: Document = document): boolean {
  return (
    Boolean(root.getElementById('shift-my-pdfs')) && !isInPageToolActive(root)
  );
}

export function inputAcceptsFile(input: HTMLInputElement, file: File): boolean {
  return pickerAcceptsFile(input, file);
}

export function applyFileToToolInput(
  file: File,
  root: Document = document
): boolean {
  const input = getActiveFileInput(root);
  if (input && !inputAcceptsFile(input, file)) return false;

  if (input) {
    assignInputFiles(input, [file]);
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  if (state.files.length === 0) {
    state.files = [file];
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

  const persisted = await readPersistedOpenFile();
  if (!persisted) return false;

  const file =
    persisted.source === 'handoff'
      ? markFileFromHandoff(persisted.file)
      : persisted.file;
  const applied = applyFileToToolInput(file, root);
  setWorkspaceFiles([file], root);
  return applied || getWorkspaceFiles().length > 0;
}

export function initInPageToolOpenFileSeeding(root: Document = document): void {
  inPageToolObserver?.disconnect();
  inPageToolObserver = null;

  const tool = root.getElementById('tool-interface');
  if (!tool) return;

  const seedActiveTool = () => {
    if (!isInPageToolActive(root)) return;
    const input = getActiveFileInput(root);
    if (!input || seededInputs.has(input)) return;
    seededInputs.add(input);
    void seedToolOpenFile(root);
  };

  inPageToolObserver = new MutationObserver(seedActiveTool);
  inPageToolObserver.observe(tool, {
    attributes: true,
    attributeFilter: ['class'],
    childList: true,
    subtree: true,
  });
  seedActiveTool();
}
