import { showAlert } from '../ui.js';
import {
  PDF_OUTPUT_DOWNLOADED_EVENT,
  PDF_OUTPUT_READY_EVENT,
} from '../utils/helpers.js';
import { addPdfToLibrary, replacePdfInLibrary } from './pdf-library-store.js';
import {
  getHomeLibraryEpoch,
  getPrimaryLibrarySaveTarget,
  getWorkspacePdfSelectionCount,
  markFileLibraryId,
  setWorkspaceFiles,
  syncHomeLibraryFromStore,
} from './workspace-files.js';
import { TOOL_VIEWER_ACTIONS_ATTR } from './tool-viewer-layout.js';

export type PdfOutputDetail = {
  blob: Blob;
  filename: string;
};

export type SaveToShiftPdfResult = 'replaced' | 'added' | 'skipped';

export const SAVE_TO_SHIFT_PDF_LABEL = 'Save to Shift PDF';
export const COMPLETION_SAVE_BUTTON_ID = 'completion-save-shift';
export const OUTPUT_SAVE_BUTTON_ID = 'shift-pdf-save-output';
export const VIEWER_SAVE_BUTTON_ID = 'shift-pdf-save-viewer';
export const OUTPUT_SAVE_BAR_ID = 'shift-pdf-save-bar';

type LatestOutput = PdfOutputDetail & { isPdf: boolean };

const boundRoots = new WeakSet<Document>();
let latestOutput: LatestOutput | null = null;
let saveInFlight = false;

export function isPdfOutput(blob: Blob, filename: string): boolean {
  return (
    blob.type === 'application/pdf' || filename.toLowerCase().endsWith('.pdf')
  );
}

/**
 * Save is offered for a single PDF output when the tool selection is not an
 * ambiguous multi-PDF set. Zero or one selected PDF is allowed.
 */
export function canSaveToShiftPdf(
  output: PdfOutputDetail | null = latestOutput
): boolean {
  if (!output || !isPdfOutput(output.blob, output.filename)) return false;
  return getWorkspacePdfSelectionCount() <= 1;
}

export function getLatestPdfOutput(): LatestOutput | null {
  return latestOutput;
}

export function setLatestPdfOutput(
  detail: PdfOutputDetail,
  root: Document = document
): void {
  latestOutput = {
    ...detail,
    isPdf: isPdfOutput(detail.blob, detail.filename),
  };
  syncSaveActions(root);
}

export function clearLatestPdfOutput(root: Document = document): void {
  latestOutput = null;
  syncSaveActions(root);
}

export async function saveToShiftPdf(
  blob: Blob,
  filename: string,
  root: Document = document
): Promise<SaveToShiftPdfResult> {
  if (!isPdfOutput(blob, filename)) return 'skipped';
  if (getWorkspacePdfSelectionCount() > 1) return 'skipped';

  const epoch = getHomeLibraryEpoch();
  const file = new File([blob], filename, {
    type: blob.type || 'application/pdf',
  });
  const target = getPrimaryLibrarySaveTarget();

  if (target) {
    const replaced = await replacePdfInLibrary(target.id, file);
    if (!replaced) return 'skipped';
    if (epoch !== getHomeLibraryEpoch()) return 'skipped';

    markFileLibraryId(replaced.file, replaced.id);
    setWorkspaceFiles(
      [
        {
          id: replaced.id,
          name: replaced.name,
          size: replaced.size,
          source: replaced.source,
          addedAt: replaced.addedAt,
          blob: replaced.file,
        },
      ],
      root
    );
    await syncHomeLibraryFromStore(root, getHomeLibraryEpoch());
    return 'replaced';
  }

  const added = await addPdfToLibrary(file, 'upload');
  if (epoch !== getHomeLibraryEpoch()) {
    return 'skipped';
  }
  markFileLibraryId(added.file, added.id);
  setWorkspaceFiles(
    [
      {
        id: added.id,
        name: added.name,
        size: added.size,
        source: added.source,
        addedAt: added.addedAt,
        blob: added.file,
      },
    ],
    root
  );
  await syncHomeLibraryFromStore(root, getHomeLibraryEpoch());
  return 'added';
}

export function initShiftPdfSave(root: Document = document): void {
  if (boundRoots.has(root)) {
    syncSaveActions(root);
    return;
  }
  boundRoots.add(root);

  const onOutput = (event: Event) => {
    const detail = (event as CustomEvent<PdfOutputDetail>).detail;
    if (
      !(detail?.blob instanceof Blob) ||
      typeof detail.filename !== 'string' ||
      !detail.filename.trim()
    ) {
      return;
    }
    setLatestPdfOutput(detail, root);
  };

  root.addEventListener(PDF_OUTPUT_READY_EVENT, onOutput);
  // Tools that only emit the legacy download event still surface Save.
  root.addEventListener(PDF_OUTPUT_DOWNLOADED_EVENT, onOutput);

  const observer = new MutationObserver(() => syncSaveActions(root));
  observer.observe(root.body, { childList: true, subtree: true });
  syncSaveActions(root);
}

export function syncSaveActions(root: Document = document): void {
  ensureCompletionSaveButton(root);
  ensureViewerSaveButton(root);
  ensureOutputSaveBar(root);
  updateSaveButtonStates(root);
}

function ensureCompletionSaveButton(root: Document): HTMLButtonElement | null {
  const panel = root.getElementById('completion-panel');
  const download = root.getElementById('completion-download');
  if (!panel || !(download instanceof HTMLElement)) return null;

  const existing = root.getElementById(COMPLETION_SAVE_BUTTON_ID);
  if (existing instanceof HTMLButtonElement) return existing;

  const button = root.createElement('button');
  button.id = COMPLETION_SAVE_BUTTON_ID;
  button.type = 'button';
  button.className =
    'btn bg-gray-700 hover:bg-gray-600 text-white font-semibold px-4 py-2 rounded-lg flex-1';
  button.setAttribute('data-i18n', 'common.saveToShiftPdf');
  button.textContent = SAVE_TO_SHIFT_PDF_LABEL;
  button.addEventListener('click', () => {
    void handleSaveClick(root);
  });
  download.insertAdjacentElement('afterend', button);
  return button;
}

function ensureViewerSaveButton(root: Document): HTMLButtonElement | null {
  const actions = root.querySelector<HTMLElement>(
    `[${TOOL_VIEWER_ACTIONS_ATTR}]`
  );
  if (!actions) return null;

  const existing = root.getElementById(VIEWER_SAVE_BUTTON_ID);
  if (existing instanceof HTMLButtonElement) return existing;

  const button = root.createElement('button');
  button.id = VIEWER_SAVE_BUTTON_ID;
  button.type = 'button';
  button.className = 'btn-gradient';
  button.setAttribute('data-i18n', 'common.saveToShiftPdf');
  button.textContent = SAVE_TO_SHIFT_PDF_LABEL;
  button.addEventListener('click', () => {
    void handleSaveClick(root);
  });
  actions.append(button);
  return button;
}

function ensureOutputSaveBar(root: Document): HTMLButtonElement | null {
  // Completion / viewer surfaces already expose Save; avoid a third copy.
  const hasCompletion = Boolean(root.getElementById('completion-panel'));
  const hasViewerActions = Boolean(
    root.querySelector(`[${TOOL_VIEWER_ACTIONS_ATTR}]`)
  );
  const existingBar = root.getElementById(OUTPUT_SAVE_BAR_ID);

  if (hasCompletion || hasViewerActions) {
    existingBar?.remove();
    return null;
  }

  const host =
    root.getElementById('tool-uploader') ??
    root.getElementById('tool-interface');
  if (!host) return null;

  let bar = existingBar;
  if (!(bar instanceof HTMLElement)) {
    bar = root.createElement('div');
    bar.id = OUTPUT_SAVE_BAR_ID;
    bar.className = 'shift-pdf-save-bar hidden mt-4';
    const button = root.createElement('button');
    button.id = OUTPUT_SAVE_BUTTON_ID;
    button.type = 'button';
    button.className = 'btn-gradient';
    button.setAttribute('data-i18n', 'common.saveToShiftPdf');
    button.textContent = SAVE_TO_SHIFT_PDF_LABEL;
    button.addEventListener('click', () => {
      void handleSaveClick(root);
    });
    bar.append(button);
    host.append(bar);
  }

  return root.getElementById(OUTPUT_SAVE_BUTTON_ID) as HTMLButtonElement | null;
}

function updateSaveButtonStates(root: Document): void {
  const enabled = canSaveToShiftPdf(latestOutput);
  const visible = Boolean(latestOutput?.isPdf);

  for (const id of [
    COMPLETION_SAVE_BUTTON_ID,
    VIEWER_SAVE_BUTTON_ID,
    OUTPUT_SAVE_BUTTON_ID,
  ]) {
    const button = root.getElementById(id);
    if (!(button instanceof HTMLButtonElement)) continue;
    button.hidden = !visible;
    button.disabled = !enabled || saveInFlight;
    button.title = enabled
      ? SAVE_TO_SHIFT_PDF_LABEL
      : getWorkspacePdfSelectionCount() > 1
        ? 'Select a single PDF to save in place'
        : SAVE_TO_SHIFT_PDF_LABEL;
  }

  const bar = root.getElementById(OUTPUT_SAVE_BAR_ID);
  if (bar) bar.classList.toggle('hidden', !visible);
}

async function handleSaveClick(root: Document): Promise<void> {
  if (!latestOutput || saveInFlight || !canSaveToShiftPdf(latestOutput)) {
    return;
  }

  saveInFlight = true;
  updateSaveButtonStates(root);
  try {
    const result = await saveToShiftPdf(
      latestOutput.blob,
      latestOutput.filename,
      root
    );
    if (result === 'replaced' || result === 'added') {
      showAlert('Saved', 'Saved to Shift PDF.');
    }
  } finally {
    saveInFlight = false;
    updateSaveButtonStates(root);
  }
}
