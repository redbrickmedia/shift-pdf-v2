import { state } from '../state.js';

export const TOOL_FILES_SEEDED_EVENT = 'shift:tool-files-seeded';

let toolFilesSeeded = false;

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
