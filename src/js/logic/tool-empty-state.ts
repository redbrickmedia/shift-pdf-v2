import { openPdfLibraryPicker } from './pdf-library-picker.js';
import {
  applyFilesToToolInput,
  isHomeDocument,
} from './seed-tool-open-file.js';
import {
  getWorkspaceFiles,
  pickerAcceptsPdf,
  WORKSPACE_FILES_RENDERED_EVENT,
} from './workspace-files.js';

export const TOOL_LIBRARY_BTN_ID = 'tool-library-btn';
const TOOL_LIBRARY_WRAP_CLASS = 'tool-library-btn-wrap';

let boundRoot: Document | null = null;

/**
 * Shared empty-state for tool pages: keep a "Choose from library" control next
 * to `#drop-zone` so clearing workspace files never dead-ends the uploader.
 */
export function initToolEmptyState(root: Document = document): void {
  if (isHomeDocument(root)) return;
  if (boundRoot === root) {
    syncToolEmptyState(root);
    return;
  }
  boundRoot = root;
  root.addEventListener(WORKSPACE_FILES_RENDERED_EVENT, () => {
    syncToolEmptyState(root);
  });
  syncToolEmptyState(root);
}

export function syncToolEmptyState(root: Document = document): void {
  if (isHomeDocument(root)) return;

  const dropZone = root.getElementById('drop-zone');
  const toolUploader = root.getElementById('tool-uploader');
  if (!dropZone || !toolUploader) {
    removeLibraryButton(root);
    return;
  }

  if (!pickerAcceptsPdf(root)) {
    removeLibraryButton(root);
    return;
  }

  const button = ensureLibraryButton(root, dropZone);
  const show = shouldShowLibraryButton(root, dropZone);
  button.hidden = !show;
  const wrap = button.closest(`.${TOOL_LIBRARY_WRAP_CLASS}`);
  if (wrap instanceof HTMLElement) wrap.hidden = !show;
}

export function resetToolEmptyState(): void {
  boundRoot = null;
}

function shouldShowLibraryButton(
  root: Document,
  dropZone: HTMLElement
): boolean {
  if (dropZone.hidden) return false;
  if (getWorkspaceFiles().length > 0) return false;
  if (root.body.classList.contains('shift-open-file-in-tool')) return false;
  return true;
}

function ensureLibraryButton(
  root: Document,
  dropZone: HTMLElement
): HTMLButtonElement {
  const existing = root.getElementById(
    TOOL_LIBRARY_BTN_ID
  ) as HTMLButtonElement | null;
  if (existing) return existing;

  const wrap = root.createElement('div');
  wrap.className = TOOL_LIBRARY_WRAP_CLASS;

  const button = root.createElement('button');
  button.id = TOOL_LIBRARY_BTN_ID;
  button.type = 'button';
  button.className =
    'btn bg-gray-700 hover:bg-gray-600 text-white font-semibold px-4 py-2 rounded-lg';
  button.textContent = 'Choose from library';
  button.addEventListener('click', () => {
    void openLibraryForTool(root);
  });

  wrap.appendChild(button);
  dropZone.insertAdjacentElement('afterend', wrap);
  return button;
}

function removeLibraryButton(root: Document): void {
  const button = root.getElementById(TOOL_LIBRARY_BTN_ID);
  button?.closest(`.${TOOL_LIBRARY_WRAP_CLASS}`)?.remove();
  button?.remove();
}

async function openLibraryForTool(root: Document): Promise<void> {
  const input = root.getElementById('file-input') as HTMLInputElement | null;
  await openPdfLibraryPicker({
    root,
    title: 'Choose a PDF from your library',
    onSelect: (entries) => {
      const files = entries.map((entry) => entry.file);
      applyFilesToToolInput(files, root);
    },
    onUpload: () => {
      if (!input) return;
      input.value = '';
      input.click();
    },
  });
}
