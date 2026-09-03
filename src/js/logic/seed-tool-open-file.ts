import { hasShiftFileHandoffRequest } from '../embedder/shift-file-handoff.js';
import { state } from '../state.js';
import { syncHomeLibraryFromStore } from './home-files.js';
import {
  clearOpenFileFlagClasses,
  forgetRevealedPanels,
  holdRevealedPanels,
  markOpenFilePresent,
  readPersistedOpenFiles,
  removeOpenFileSkeleton,
  restoreRevealedPanels,
  retireOpenFileSkeleton,
} from './open-file-store.js';
import { findToolFileInput, markToolFilesSeeded } from './tool-file-seed.js';
import {
  getWorkspaceFiles,
  markFileFromDownload,
  markFileFromHandoff,
  pickerAcceptsFile,
  renderWorkspaceFiles,
  setWorkspaceFiles,
} from './workspace-files.js';

/**
 * Nothing was seeded, so give the tool its picker back: the pre-paint hide was
 * a bet on a file that never materialised, and leaving it in place is what
 * makes a card read as permanently empty. The session flag goes too, since it
 * is the thing that told the shell to make that bet.
 */
function abandonSeed(root: Document): false {
  markOpenFilePresent(false);
  removeOpenFileSkeleton(root);
  restoreRevealedPanels(root);
  clearOpenFileFlagClasses(root);
  renderWorkspaceFiles(root);
  return false;
}

export function isHomeDocument(root: Document = document): boolean {
  return (
    root.body.classList.contains('shift-home') ||
    Boolean(root.getElementById('shift-my-pdfs'))
  );
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
  const input = findToolFileInput(root);
  const accepted = files.filter(
    (file) => !input || inputAcceptsFile(input, file)
  );
  if (accepted.length === 0) return false;
  const applicable =
    input && !input.multiple ? accepted.slice(-1) : accepted.slice();

  if (input) {
    assignInputFiles(input, applicable);
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  if (state.files.length === 0) {
    state.files = applicable;
  }

  markToolFilesSeeded(root);
  forgetRevealedPanels(root);
  retireOpenFileSkeleton(root, {
    onRetired: () => renderWorkspaceFiles(root),
  });

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

/**
 * Shared entry point for applying workspace / persisted PDFs into a tool page.
 * Library membership alone must not invent a selection — only files the user
 * explicitly selected (or uploaded on the tool page) seed the tool.
 * Individual *-page modules must not read IndexedDB themselves — subscribe with
 * onToolFilesSeeded / syncSeededToolFiles for post-seed UI.
 */
export async function seedToolOpenFile(
  root: Document = document
): Promise<boolean> {
  if (isHomeDocument(root)) return false;

  // Before the first await, so a tool module that initialises in this same tick
  // cannot hide the panel the shell revealed.
  holdRevealedPanels(root);

  // Start the open-file read before awaiting the library: it is the read that
  // decides what the card shows, and the library scan can be much larger.
  const persistedRead = readPersistedOpenFiles();

  await syncHomeLibraryFromStore(root);
  // A handoff request means the embedder is about to push its own file in.
  if (hasShiftFileHandoffRequest()) return abandonSeed(root);

  const persisted = await persistedRead;
  let files: File[] | undefined;

  if (persisted.length > 0) {
    files = persisted.map((entry) => {
      if (entry.source === 'handoff') return markFileFromHandoff(entry.file);
      if (entry.source === 'download') return markFileFromDownload(entry.file);
      return entry.file;
    });
  } else {
    files = workspaceFilesWithBlob();
  }

  if (!files || files.length === 0) return abandonSeed(root);

  const applied = applyFilesToToolInput(files, root);
  setWorkspaceFiles(files, root);
  if (applied) return true;

  // Nothing landed in the input — a PDF on an image-only tool, say. The file is
  // still the workspace file for the sidebar, so let renderWorkspaceFiles decide
  // the picker rather than forcing it either way.
  const kept = getWorkspaceFiles().length > 0;
  removeOpenFileSkeleton(root);
  if (!kept) return abandonSeed(root);
  renderWorkspaceFiles(root);
  return true;
}
