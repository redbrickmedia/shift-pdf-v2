import { state } from '../state.js';

export const TOOL_FILES_SEEDED_EVENT = 'shift:tool-files-seeded';

/**
 * Canonical and legacy tool upload input ids. Shared seeding looks these up in
 * order so pages that kept upstream ids (`pdf-file-input`, `pdfFile`, …) still
 * receive selected workspace PDFs without a per-tool handoff.
 */
export const TOOL_FILE_INPUT_IDS = [
  'file-input',
  'pdf-file-input',
  'pdfFileInput',
  'pdfFile',
] as const;

let toolFilesSeeded = false;

export function findToolFileInput(
  root: Document = document
): HTMLInputElement | null {
  for (const id of TOOL_FILE_INPUT_IDS) {
    const el = root.getElementById(id);
    if (el instanceof HTMLInputElement) return el;
  }
  return null;
}

/**
 * Mark that seedToolOpenFile / applyFilesToToolInput finished assigning the
 * workspace files into the tool file input and `state.files`. Tool pages should
 * subscribe with onToolFilesSeeded / syncSeededToolFiles instead of reading
 * IndexedDB themselves.
 */
export function markToolFilesSeeded(root: Document = document): void {
  toolFilesSeeded = true;
  root.dispatchEvent(
    new CustomEvent(TOOL_FILES_SEEDED_EVENT, { bubbles: true })
  );
}

export function resetToolFilesSeededState(): void {
  toolFilesSeeded = false;
}

export function onToolFilesSeeded(callback: () => void): void {
  const run = () => {
    if (state.files.length > 0) callback();
  };

  document.addEventListener(TOOL_FILES_SEEDED_EVENT, run);
  if (toolFilesSeeded) run();
}

export type SyncSeededToolFilesOptions = {
  multiple?: boolean;
};

/** Apply library or handoff files into a tool that keeps its own File[] list. */
export function syncSeededToolFiles(
  apply: (files: File[]) => void,
  options: SyncSeededToolFilesOptions = {}
): void {
  const run = () => {
    if (state.files.length === 0) return;
    const files =
      options.multiple === false ? [state.files[0]] : state.files.slice();
    apply(files);
  };

  onToolFilesSeeded(run);
  run();
}

export function runOnDomReady(init: () => void): void {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
}
