import { state } from '../state.js';
import {
  mergeFileIdentityKey,
  type MergeFileIdentity,
} from './merge-file-identity.js';
import { openPdfLibraryPicker } from './pdf-library-picker.js';
import { applyFilesToToolInput } from './seed-tool-open-file.js';
import { findToolFileInput } from './tool-file-seed.js';
import {
  getActiveFileInput,
  getWorkspaceFiles,
  pickerAcceptsPdf,
} from './workspace-files.js';

export type OpenAddMoreLibraryPickerOptions = {
  root?: Document;
  exclude?: MergeFileIdentity[];
  title?: string;
  emptyMessage?: string;
};

let listenerAbort: AbortController | null = null;
let boundRoot: Document | null = null;

/**
 * Identities already in the tool selection so the library picker can disable
 * duplicates. Prefer explicit `state.files`, then fall back to workspace rows.
 */
export function currentAddMoreExcludeIdentities(): MergeFileIdentity[] {
  const seen = new Set<string>();
  const out: MergeFileIdentity[] = [];

  const push = (identity: MergeFileIdentity) => {
    const key = mergeFileIdentityKey(identity);
    if (seen.has(key)) return;
    seen.add(key);
    out.push(identity);
  };

  for (const file of state.files) {
    push({ name: file.name, size: file.size });
  }

  for (const entry of getWorkspaceFiles()) {
    push({
      name: entry.name,
      size: entry.blob?.size ?? entry.size ?? 0,
      libraryId: entry.id,
    });
  }

  return out;
}

/**
 * Open the shared My PDFs picker for Add More Files. Library selection is
 * primary; upload from device is the secondary footer / empty-state action.
 *
 * Selected files are applied through the tool file input so multi-file pages
 * that append on `change` keep their existing semantics. Single-file inputs
 * replace via `applyFilesToToolInput`.
 */
export async function openAddMoreLibraryPicker(
  options: OpenAddMoreLibraryPickerOptions = {}
): Promise<void> {
  const root = options.root ?? document;
  const input = getActiveFileInput(root) ?? findToolFileInput(root);

  await openPdfLibraryPicker({
    root,
    title: options.title ?? 'Add PDFs from library',
    emptyMessage:
      options.emptyMessage ??
      'No saved PDFs in your library yet. Upload one from your device.',
    exclude: options.exclude ?? currentAddMoreExcludeIdentities(),
    onSelect: (entries) => {
      applyFilesToToolInput(
        entries.map((entry) => entry.file),
        root
      );
    },
    onUpload: () => {
      if (!input) return;
      input.value = '';
      input.click();
    },
  });
}

/**
 * Capture-phase handler so PDF tool pages that still bind `#add-more-btn` to
 * `fileInput.click()` open the library picker instead. Non-PDF tools are left
 * alone so their disk upload handlers keep working.
 */
export function initAddMoreLibraryPicker(root: Document = document): void {
  if (boundRoot === root && listenerAbort) return;

  resetAddMoreLibraryPicker();
  boundRoot = root;
  listenerAbort = new AbortController();

  root.addEventListener(
    'click',
    (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (!target.closest('#add-more-btn')) return;
      if (!pickerAcceptsPdf(root)) return;

      event.preventDefault();
      event.stopImmediatePropagation();
      void openAddMoreLibraryPicker({ root });
    },
    { capture: true, signal: listenerAbort.signal }
  );
}

export function resetAddMoreLibraryPicker(): void {
  listenerAbort?.abort();
  listenerAbort = null;
  boundRoot = null;
}
