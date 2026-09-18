import { hasShiftFileHandoffRequest } from '../embedder/shift-file-handoff.js';
import { state } from '../state.js';
import { syncHomeLibraryFromStore } from './workspace-files.js';
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
  getActiveFileInput,
  getWorkspaceFiles,
  isInPageToolActive,
  markFileFromDownload,
  markFileFromHandoff,
  markFileLibraryId,
  pickerAcceptsFile,
  renderWorkspaceFiles,
  setWorkspaceFiles,
} from './workspace-files.js';

function abandonSeed(root: Document): false {
  markOpenFilePresent(false);
  removeOpenFileSkeleton(root);
  restoreRevealedPanels(root);
  clearOpenFileFlagClasses(root);
  renderWorkspaceFiles(root);
  return false;
}

let inPageToolObserver: MutationObserver | null = null;
const seededInputs = new WeakSet<HTMLInputElement>();

export function isHomeDocument(root: Document = document): boolean {
  if (isInPageToolActive(root)) return false;
  return (
    root.body.classList.contains('shift-home') ||
    Boolean(root.getElementById('shift-my-pdfs'))
  );
}

/**
 * The viewer reads whichever document its URL points at, so it is not a tool
 * page: it has no output to produce and nothing to seed.
 */
export function isViewerDocument(root: Document = document): boolean {
  return Boolean(root.getElementById('shift-pdf-viewer'));
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

export function filesApplicableToToolInput(
  files: File[],
  root: Document = document
): File[] {
  const input = getActiveFileInput(root) ?? findToolFileInput(root);
  const accepted = files.filter(
    (file) => !input || inputAcceptsFile(input, file)
  );
  if (accepted.length === 0) return [];
  return input && !input.multiple ? accepted.slice(-1) : accepted.slice();
}

export function applyFilesToToolInput(
  files: File[],
  root: Document = document
): boolean {
  const input = getActiveFileInput(root) ?? findToolFileInput(root);
  const applicable = filesApplicableToToolInput(files, root);
  if (applicable.length === 0) return false;

  if (input) {
    assignInputFiles(input, applicable);
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  if (state.files.length === 0) {
    state.files = applicable.slice();
  }

  markToolFilesSeeded(root);
  forgetRevealedPanels(root);
  retireOpenFileSkeleton(root, {
    onRetired: () => renderWorkspaceFiles(root),
  });

  return Boolean(input?.files?.length) || state.files.length > 0;
}

/**
 * Assign files to one specific picker and let that page's own change handler
 * take over. Tools with more than one drop target (compare-pdfs, overlay-pdf)
 * need this rather than applyFilesToToolInput, which resolves a single
 * canonical `#file-input` and also seeds `state.files`.
 */
export function applyFilesToInput(
  input: HTMLInputElement,
  files: File[]
): boolean {
  const accepted = files.filter((file) => inputAcceptsFile(input, file));
  const applicable = input.multiple ? accepted : accepted.slice(-1);
  if (applicable.length === 0) return false;

  assignInputFiles(input, applicable);
  input.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
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
      let file = entry.file;
      if (entry.libraryId) file = markFileLibraryId(file, entry.libraryId);
      if (entry.source === 'handoff') return markFileFromHandoff(file);
      if (entry.source === 'download') return markFileFromDownload(file);
      return file;
    });
  } else {
    files = workspaceFilesWithBlob();
  }

  if (!files || files.length === 0) return abandonSeed(root);

  // Viewing is read-only for the selection. The viewer's own picker takes a
  // single file, so seeding it narrowed the selection to the last persisted
  // file (filesApplicableToToolInput slices anything not `multiple`) and wrote
  // that back — which is what cleared the My PDFs checkboxes on every open.
  // The sidebar still needs the selection in memory, so restore it verbatim.
  if (isViewerDocument(root)) {
    setWorkspaceFiles(files, root);
    removeOpenFileSkeleton(root);
    return true;
  }

  const applicable = filesApplicableToToolInput(files, root);
  const applied = applyFilesToToolInput(files, root);
  setWorkspaceFiles(applied ? applicable : files, root);
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
