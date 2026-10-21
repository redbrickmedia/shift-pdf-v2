import { showAlert } from '../ui.js';
import { downloadBlob, PDF_OUTPUT_READY_EVENT } from '../utils/helpers.js';
import {
  hidePdfJsPrintControls,
  printPdfBlob,
  printPdfJsViewerFrame,
} from '../utils/pdfjs-viewer-print.js';
import {
  canSaveToShiftPdf,
  clearLatestPdfOutput,
  getLatestPdfOutput,
  isPdfOutput,
  isZipOutput,
  overwriteToShiftPdf,
  saveToShiftPdf,
  TOOL_OUTPUT_STATE_EVENT,
} from './shift-pdf-save.js';
import {
  createShiftActionButton,
  arrangeShiftActionRow,
} from './shift-action-row.js';
import {
  COMMIT_BAR_ID,
  NON_PDF_OUTPUT_SURFACE_IDS,
  VIEWER_CHROME_FEATURE_ATTR,
  VIEWER_CHROME_HEADER_CLASS,
  applyViewerChromeFeatures,
  detectActiveSurfaceId,
  ensureCommitBar,
  mountViewerChrome,
  resolveViewerChromeFeatures,
  type ViewerChromeFeature,
} from './viewer-chrome.js';
import { getPrimaryLibrarySaveTarget } from './workspace-files.js';

export const TOOL_OUTPUT_TOOLBAR_ID = 'shift-tool-output-toolbar';
export const TOOL_OUTPUT_UNDO_ID = 'shift-tool-output-undo';
export const TOOL_OUTPUT_REDO_ID = 'shift-tool-output-redo';
export const TOOL_OUTPUT_RESET_ID = 'shift-tool-output-reset';
export const TOOL_OUTPUT_SAVE_ID = 'shift-tool-output-save';
export const TOOL_OUTPUT_OVERWRITE_ID = 'shift-tool-output-overwrite';
export const TOOL_OUTPUT_MENU_ID = 'shift-tool-output-menu';
export const TOOL_OUTPUT_DOWNLOAD_ID = 'shift-tool-output-download';
export const TOOL_OUTPUT_PRINT_ID = 'shift-tool-output-print';
export const TOOL_OUTPUT_SAVE_MENU_HIDE_MS = 280;
export const TOOL_OUTPUT_DEFAULT_PRIMARY_LABEL = 'Download';

export type ToolOutputKind =
  | 'pdf'
  | 'multi-pdf-zip'
  | 'non-pdf'
  | 'inspection-only';

export interface ToolOutputSession {
  reset?: () => void | Promise<void>;
  undo?: () => void | Promise<void>;
  redo?: () => void | Promise<void>;
  apply?: () => void | Promise<void>;
  print?: () => void | Promise<void>;
  canUndo?: () => boolean;
  canRedo?: () => boolean;
  canReset?: () => boolean;
  canSave?: () => boolean;
  canDownload?: () => boolean;
  canPrint?: () => boolean;
  outputKind?: ToolOutputKind | (() => ToolOutputKind);
  /** Tool-specific name for the primary commit action. Defaults to Download. */
  primaryLabel?: () => string;
}

let boundRoot: Document | null = null;
let session: ToolOutputSession | null = null;
let saveInFlight = false;
let observer: MutationObserver | null = null;

export function initToolOutputToolbar(root: Document = document): void {
  if (isNonToolPage(root)) return;
  ensureToolbar(root);
  if (boundRoot === root) {
    syncToolOutputToolbar(root);
    return;
  }

  boundRoot = root;
  root.addEventListener(TOOL_OUTPUT_STATE_EVENT, () => {
    syncToolOutputToolbar(root);
  });
  root.addEventListener(PDF_OUTPUT_READY_EVENT, () => {
    syncToolOutputToolbar(root);
  });
  observeToolOutputToolbar(root);
  syncToolOutputToolbar(root);
}

function observeToolOutputToolbar(root: Document): void {
  observer?.disconnect();
  observer = new MutationObserver(() => {
    // Ignore mutations we cause while hiding legacy controls and syncing
    // disabled state. Watching the whole page for `class` used to re-enter
    // this callback on every layout/i18n/icon update and freeze tool load.
    observer?.disconnect();
    try {
      ensureToolbar(root);
      hideLegacyOutputActions(root);
      syncToolOutputToolbar(root);
    } finally {
      observer?.takeRecords();
      startToolOutputToolbarObserver(root);
    }
  });
  startToolOutputToolbarObserver(root);
}

function startToolOutputToolbarObserver(root: Document): void {
  const host =
    root.getElementById('tool-uploader') ??
    root.getElementById('tool-interface') ??
    root.body;
  observer?.observe(host, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['hidden', 'disabled'],
  });
}

export function registerToolOutputSession(
  nextSession: ToolOutputSession,
  root: Document = document
): () => void {
  session = nextSession;
  ensureToolbar(root);
  syncToolOutputToolbar(root);
  return () => {
    if (session === nextSession) {
      session = null;
      syncToolOutputToolbar(root);
    }
  };
}

function resolveSessionOutputKind(root: Document = document): ToolOutputKind {
  if (session?.outputKind) {
    return typeof session.outputKind === 'function'
      ? session.outputKind()
      : session.outputKind;
  }
  const surfaceId = detectActiveSurfaceId(root);
  const entryId =
    root.documentElement.dataset.launchEntry?.trim().toLowerCase() ?? '';
  if (
    NON_PDF_OUTPUT_SURFACE_IDS.has(surfaceId) ||
    (entryId && NON_PDF_OUTPUT_SURFACE_IDS.has(entryId))
  ) {
    return 'non-pdf';
  }
  const output = getLatestPdfOutput();
  if (output && isZipOutput(output.blob, output.filename)) {
    return 'multi-pdf-zip';
  }
  return 'pdf';
}

/** The header and the Commit Bar read one feature map; each shows its own controls. */
function applyChromeFeatures(
  root: Document,
  header: ParentNode,
  features: ReturnType<typeof resolveViewerChromeFeatures>
): void {
  applyViewerChromeFeatures(header, features);
  const bar = root.getElementById(COMMIT_BAR_ID);
  if (bar) applyViewerChromeFeatures(bar, features);
}

function syncHeaderFeaturesForOutputKind(root: Document): void {
  const header = root.querySelector<HTMLElement>(
    `.${VIEWER_CHROME_HEADER_CLASS}`
  );
  if (!header) return;
  const kind = resolveSessionOutputKind(root);
  const featureOverrides: Partial<Record<ViewerChromeFeature, boolean>> = {};
  if (kind === 'non-pdf') {
    featureOverrides.save = false;
    featureOverrides.print = false;
  } else if (kind === 'inspection-only') {
    featureOverrides.save = false;
  }
  if (session?.undo || session?.redo) {
    featureOverrides.undo = true;
    featureOverrides.redo = true;
  }
  applyChromeFeatures(
    root,
    header,
    resolveViewerChromeFeatures(
      { preset: 'tool', features: featureOverrides },
      root
    )
  );
}

export function syncToolOutputToolbar(root: Document = document): void {
  hideLegacyOutputActions(root);
  syncHeaderFeaturesForOutputKind(root);

  const output = getLatestPdfOutput();
  const undo = getButton(root, TOOL_OUTPUT_UNDO_ID);
  const redo = getButton(root, TOOL_OUTPUT_REDO_ID);
  const reset = getButton(root, TOOL_OUTPUT_RESET_ID);
  const save = getButton(root, TOOL_OUTPUT_SAVE_ID);
  const overwrite = getButton(root, TOOL_OUTPUT_OVERWRITE_ID);
  const download = getButton(root, TOOL_OUTPUT_DOWNLOAD_ID);
  const print = getButton(root, TOOL_OUTPUT_PRINT_ID);

  const legacyUndo = getLegacyHistoryButton(root, 'undo');
  const legacyRedo = getLegacyHistoryButton(root, 'redo');
  if (undo) {
    setButtonDisabled(
      undo,
      session?.undo
        ? !(session.canUndo?.() ?? false)
        : !legacyUndo || legacyUndo.disabled
    );
  }
  if (redo) {
    setButtonDisabled(
      redo,
      session?.redo
        ? !(session.canRedo?.() ?? false)
        : !legacyRedo || legacyRedo.disabled
    );
  }
  if (reset)
    setButtonDisabled(reset, !hasResettableState(root, output !== null));
  if (save) {
    setButtonDisabled(save, saveInFlight || !canSaveOutput(root));
  }
  if (overwrite) {
    const canOverwrite = canOverwriteOutput(root);
    overwrite.hidden = !canOverwrite;
    setButtonDisabled(overwrite, saveInFlight || !canOverwrite);
  }
  if (download) {
    setButtonDisabled(download, saveInFlight || !canDownloadOutput(root));
  }
  if (print) {
    setButtonDisabled(print, !canPrintOutput(root));
  }
  const kind = resolveSessionOutputKind(root);
  syncSaveDisclosure(
    root,
    kind !== 'non-pdf' &&
      kind !== 'inspection-only' &&
      (canSaveOutput(root) || Boolean(output))
  );
  syncPrimaryLabel(download);
  syncCommitBarVisibility(root, output !== null);
  hideEmbeddedViewerPrintControls(root);
}

function syncPrimaryLabel(download: HTMLButtonElement | null): void {
  if (!download) return;
  const label =
    session?.primaryLabel?.().trim() || TOOL_OUTPUT_DEFAULT_PRIMARY_LABEL;
  const text = download.querySelector('span');
  if (text && text.textContent !== label) text.textContent = label;
  if (download.getAttribute('aria-label') !== label) {
    download.setAttribute('aria-label', label);
  }
}

/**
 * The bar has nothing to offer until a job exists. Uses the readiness
 * predicates rather than the buttons' disabled state, so it stays put while a
 * commit is in flight and every button is momentarily disabled.
 */
function syncCommitBarVisibility(root: Document, hasOutput: boolean): void {
  const bar = root.getElementById(COMMIT_BAR_ID);
  if (!bar) return;
  const visible =
    hasResettableState(root, hasOutput) ||
    canSaveOutput(root) ||
    canDownloadOutput(root) ||
    canOverwriteOutput(root) ||
    canPrintOutput(root);
  if (bar.hidden === visible) bar.hidden = !visible;
}

/**
 * A process button inside a panel the page keeps hidden until a file is chosen
 * (Compress, for one) is not a job waiting to run. The button itself is hidden
 * by `hideLegacyOutputActions`, so only its ancestors count.
 */
function hasReadyProcessButton(root: Document): boolean {
  const processBtn = findProcessButton(root);
  if (!processBtn) return false;
  if (processBtn.disabled) return false;
  return !processBtn.parentElement?.closest('.hidden, [hidden]');
}

function canSaveOutput(root: Document = document): boolean {
  const kind = resolveSessionOutputKind(root);
  if (kind === 'non-pdf' || kind === 'inspection-only') return false;
  if (session?.canSave) return session.canSave();
  if (hasReadyProcessButton(root)) return true;
  const output = getLatestPdfOutput();
  return canSaveToShiftPdf(output, {
    allowMultiPdfZip: kind === 'multi-pdf-zip',
  });
}

function syncSaveDisclosure(root: Document, canDisclose: boolean): void {
  const menu = root.getElementById(TOOL_OUTPUT_MENU_ID);
  if (!menu) return;
  if (menu.classList.contains('is-ready') !== canDisclose) {
    menu.classList.toggle('is-ready', canDisclose);
  }
  if (!canDisclose) {
    menu.classList.remove('is-open');
    if (menu instanceof HTMLDetailsElement && menu.open) menu.open = false;
  }
}

function canDownloadOutput(root: Document = document): boolean {
  if (session?.canDownload) return session.canDownload();
  if (session?.canSave) return session.canSave();
  if (hasReadyProcessButton(root)) return true;
  if (getLatestPdfOutput()) return true;
  return canSaveOutput(root);
}

function canOverwriteOutput(root: Document = document): boolean {
  const kind = resolveSessionOutputKind(root);
  if (kind !== 'pdf') return false;
  const output = getLatestPdfOutput();
  if (output && !isPdfOutput(output.blob, output.filename)) return false;
  return canSaveOutput(root) && Boolean(getPrimaryLibrarySaveTarget());
}

function canPrintOutput(root: Document = document): boolean {
  const kind = resolveSessionOutputKind(root);
  if (kind === 'non-pdf' || kind === 'multi-pdf-zip') return false;
  if (session?.print) return session.canPrint?.() ?? true;
  if (session?.canPrint) return session.canPrint();
  if (findPrintableViewerFrame(root)) return true;
  const output = getLatestPdfOutput();
  if (output && isZipOutput(output.blob, output.filename)) return false;
  if (canSaveToShiftPdf(output)) return true;
  if (hasReadyProcessButton(root)) return true;
  return Boolean(session?.apply && canSaveOutput(root));
}

function isNonToolPage(root: Document): boolean {
  return (
    root.body.classList.contains('shift-home') ||
    Boolean(root.getElementById('shift-my-pdfs')) ||
    Boolean(root.getElementById('tool-grid')) ||
    // The PDF viewer produces no output, so it keeps its own header actions.
    Boolean(root.getElementById('shift-pdf-viewer'))
  );
}

function ensureToolbar(root: Document): HTMLElement | null {
  root.getElementById(TOOL_OUTPUT_TOOLBAR_ID)?.remove();
  const chrome = mountViewerChrome(root, { preset: 'tool' });
  return ensureViewerHeaderActions(root, chrome?.header ?? null);
}

function ensureViewerHeaderActions(
  root: Document,
  header: HTMLElement | null
): HTMLElement | null {
  const host = root.querySelector<HTMLElement>('[data-shift-viewer-actions]');
  if (!host) return null;
  // Without a header to anchor the bar, keep every control reachable in the
  // authored action row rather than losing the commit actions.
  const commit = ensureCommitBar(root, header) ?? { start: host, end: host };
  if (root.getElementById(TOOL_OUTPUT_UNDO_ID)) {
    arrangeShiftActionRow(host);
    if (header) {
      applyChromeFeatures(
        root,
        header,
        resolveViewerChromeFeatures({ preset: 'tool' }, root)
      );
    }
    return host;
  }

  const undo = createViewerActionButton(
    root,
    TOOL_OUTPUT_UNDO_ID,
    'Undo',
    'ph-arrow-u-up-left',
    'undo'
  );
  const redo = createViewerActionButton(
    root,
    TOOL_OUTPUT_REDO_ID,
    'Redo',
    'ph-arrow-u-up-right',
    'redo'
  );
  const reset = createViewerActionButton(
    root,
    TOOL_OUTPUT_RESET_ID,
    'Reset',
    'ph-arrow-counter-clockwise',
    'reset'
  );
  const saveGroup = root.createElement('div');
  saveGroup.id = TOOL_OUTPUT_MENU_ID;
  saveGroup.className = 'shift-tool-viewer-save';
  saveGroup.setAttribute(VIEWER_CHROME_FEATURE_ATTR, 'save');
  saveGroup.setAttribute('data-shift-action', 'save');
  const save = createViewerActionButton(
    root,
    TOOL_OUTPUT_SAVE_ID,
    'Save',
    'ph-floppy-disk',
    'save'
  );
  const overwrite = createViewerActionButton(
    root,
    TOOL_OUTPUT_OVERWRITE_ID,
    'Overwrite',
    'ph-file',
    undefined,
    'overwrite'
  );
  overwrite.hidden = true;
  const download = createViewerActionButton(
    root,
    TOOL_OUTPUT_DOWNLOAD_ID,
    TOOL_OUTPUT_DEFAULT_PRIMARY_LABEL,
    'ph-download-simple',
    'download'
  );
  const print = createViewerActionButton(
    root,
    TOOL_OUTPUT_PRINT_ID,
    'Print',
    'ph-printer',
    'print'
  );
  saveGroup.append(overwrite, save);
  host.append(undo, redo);
  arrangeShiftActionRow(host);
  commit.start.append(reset);
  commit.end.append(saveGroup, download, print);
  bindSharedActionHandlers(root);
  save.addEventListener('click', () => void saveOutput(root));
  overwrite.addEventListener('click', () => void overwriteOutput(root));
  hideLegacyOutputActions(root);
  if (header) {
    applyChromeFeatures(
      root,
      header,
      resolveViewerChromeFeatures({ preset: 'tool' }, root)
    );
  }
  return host;
}

function bindSharedActionHandlers(root: Document): void {
  getButton(root, TOOL_OUTPUT_RESET_ID)?.addEventListener('click', () => {
    void resetOutput(root);
  });
  getButton(root, TOOL_OUTPUT_DOWNLOAD_ID)?.addEventListener('click', () => {
    void downloadOutput(root);
  });
  getButton(root, TOOL_OUTPUT_PRINT_ID)?.addEventListener('click', () => {
    void printOutput(root);
  });
  getButton(root, TOOL_OUTPUT_UNDO_ID)?.addEventListener('click', () => {
    void runHistoryAction(
      session?.undo ?? (() => getLegacyHistoryButton(root, 'undo')?.click()),
      root
    );
  });
  getButton(root, TOOL_OUTPUT_REDO_ID)?.addEventListener('click', () => {
    void runHistoryAction(
      session?.redo ?? (() => getLegacyHistoryButton(root, 'redo')?.click()),
      root
    );
  });
}

function createViewerActionButton(
  root: Document,
  id: string,
  label: string,
  phosphorIcon: string,
  feature?: ViewerChromeFeature,
  action: string = feature ?? id
): HTMLButtonElement {
  return createShiftActionButton(root, {
    id,
    label,
    iconClass: phosphorIcon,
    action,
    feature,
  });
}

async function saveOutput(root: Document): Promise<void> {
  if (saveInFlight || !canSaveOutput(root)) return;
  saveInFlight = true;
  closeOutputMenu(root);
  syncToolOutputToolbar(root);
  try {
    await applyToolOutput(root);
    const output = getLatestPdfOutput();
    const kind = resolveSessionOutputKind(root);
    const allowMultiPdfZip =
      kind === 'multi-pdf-zip' ||
      (kind === 'pdf' &&
        Boolean(output && isZipOutput(output.blob, output.filename)));
    if (!output || !canSaveToShiftPdf(output, { allowMultiPdfZip })) return;
    const result = await saveToShiftPdf(output.blob, output.filename, root, {
      allowMultiPdfZip,
    });
    if (result === 'added') {
      const message = output.summary
        ? `${output.summary} Saved to My PDFs.`
        : 'A copy was saved to My PDFs.';
      showAlert('Saved', message, 'success');
    }
  } finally {
    saveInFlight = false;
    syncToolOutputToolbar(root);
  }
}

export async function overwriteOutput(
  root: Document = document,
  _assignLocation?: (href: string) => void
): Promise<void> {
  if (saveInFlight || !canOverwriteOutput(root)) return;
  saveInFlight = true;
  closeOutputMenu(root);
  syncToolOutputToolbar(root);
  try {
    await applyToolOutput(root);
    const output = getLatestPdfOutput();
    if (!output || !isPdfOutput(output.blob, output.filename)) return;
    const result = await overwriteToShiftPdf(
      output.blob,
      output.filename,
      root
    );
    if (result === 'replaced') {
      const message = output.summary
        ? `${output.summary} The original PDF was updated in My PDFs.`
        : 'The original PDF was updated in My PDFs.';
      showAlert('Saved', message, 'success');
      return;
    }
    showAlert(
      'Could not overwrite',
      'The original PDF is no longer in My PDFs.'
    );
  } finally {
    saveInFlight = false;
    syncToolOutputToolbar(root);
  }
}

const PROCESS_BUTTON_WAIT_TIMEOUT_MS = 5 * 60 * 1000;

async function applyToolOutput(root: Document): Promise<void> {
  if (session?.apply) {
    clearLatestPdfOutput();
    await session.apply();
    return;
  }
  const processBtn = findProcessButton(root);
  if (!processBtn) return;

  clearLatestPdfOutput();

  await new Promise<void>((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let sawBusyOrPrompt = false;

    const finish = () => {
      if (settled) return;
      settled = true;
      if (timer !== null) clearTimeout(timer);
      if (pollTimer !== null) clearInterval(pollTimer);
      root.removeEventListener(PDF_OUTPUT_READY_EVENT, onReady);
      if (root !== document) {
        document.removeEventListener(PDF_OUTPUT_READY_EVENT, onReady);
      }
      resolve();
    };

    const armTimeout = () => {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(finish, PROCESS_BUTTON_WAIT_TIMEOUT_MS);
    };

    const isProcessWorkActive = (): boolean =>
      processBtn.disabled ||
      Boolean(
        root.querySelector(
          '.shift-loader.is-active, #loader-modal:not(.hidden), #password-modal:not(.hidden), [aria-busy="true"]'
        )
      );

    const hasVisibleErrorOrAlert = (): boolean => {
      const alertModal = root.getElementById('alert-modal');
      const errorModal = root.getElementById('errorModal');
      return Boolean(
        (alertModal && !alertModal.classList.contains('hidden')) ||
        (errorModal && !errorModal.classList.contains('hidden'))
      );
    };

    const onReady = () => {
      finish();
    };

    root.addEventListener(PDF_OUTPUT_READY_EVENT, onReady, { once: true });
    if (root !== document) {
      document.addEventListener(PDF_OUTPUT_READY_EVENT, onReady, {
        once: true,
      });
    }

    processBtn.click();

    if (settled) return;

    if (isProcessWorkActive()) {
      sawBusyOrPrompt = true;
    }

    pollTimer = setInterval(() => {
      if (hasVisibleErrorOrAlert()) {
        finish();
        return;
      }
      if (isProcessWorkActive()) {
        sawBusyOrPrompt = true;
        armTimeout();
        return;
      }
      if (sawBusyOrPrompt) {
        // Busy state or password prompt finished without staging output (e.g. cancelled)
        finish();
      }
    }, 50);

    armTimeout();
  });
}

function findProcessButton(root: Document): HTMLButtonElement | null {
  for (const id of [
    'process-btn',
    'download-edited-pdf',
    'crop-button',
    'save-stamped-btn',
  ]) {
    const button = getButton(root, id);
    if (button && !button.disabled) return button;
  }
  return null;
}

async function downloadOutput(root: Document): Promise<void> {
  if (saveInFlight || !canDownloadOutput(root)) return;
  closeOutputMenu(root);
  saveInFlight = true;
  syncToolOutputToolbar(root);
  try {
    await applyToolOutput(root);
    const output = getLatestPdfOutput();
    if (!output) return;
    downloadBlob(output.blob, output.filename);
  } finally {
    saveInFlight = false;
    syncToolOutputToolbar(root);
  }
}

async function printOutput(root: Document): Promise<void> {
  if (!canPrintOutput(root)) return;
  closeOutputMenu(root);
  try {
    if (session?.print) {
      await session.print();
      return;
    }
    const frame = findPrintableViewerFrame(root);
    if (frame) {
      await printPdfJsViewerFrame(frame);
      return;
    }
    await applyToolOutput(root);
    const output = getLatestPdfOutput();
    if (output && canSaveToShiftPdf(output)) {
      await printPdfBlob(output.blob, root);
    }
  } catch (error) {
    showAlert(
      'Print failed',
      error instanceof Error ? error.message : 'Could not print this PDF.'
    );
  }
}

const EMBEDDED_VIEWER_FRAMES =
  '#canvas-container-sign iframe, #pdf-viewer-container iframe, #stamp-viewer-container iframe';

function findPrintableViewerFrame(root: Document): HTMLIFrameElement | null {
  const viewerRoot = root.getElementById('tool-uploader') ?? root;
  return viewerRoot.querySelector<HTMLIFrameElement>(EMBEDDED_VIEWER_FRAMES);
}

function hideEmbeddedViewerPrintControls(root: Document): void {
  for (const frame of root.querySelectorAll<HTMLIFrameElement>(
    EMBEDDED_VIEWER_FRAMES
  )) {
    try {
      hidePdfJsPrintControls(frame.contentDocument);
    } catch {
      // Cross-origin viewers are not controlled by the Shift toolbar.
    }
  }
}

function closeOutputMenu(root: Document): void {
  const menu = root.getElementById(TOOL_OUTPUT_MENU_ID);
  if (menu instanceof HTMLDetailsElement) menu.open = false;
  menu?.classList.remove('is-open');
}

async function resetOutput(root: Document): Promise<void> {
  if (session?.reset) {
    await session.reset();
  } else {
    clickFirstLegacyReset(root);
  }
  clearLatestPdfOutput(root);
  syncToolOutputToolbar(root);
}

async function runHistoryAction(
  action: (() => void | Promise<void>) | undefined,
  root: Document
): Promise<void> {
  if (!action) return;
  await action();
  syncToolOutputToolbar(root);
}

function clickFirstLegacyReset(root: Document): void {
  for (const id of [
    'clear-files-btn',
    'completion-start-over',
    'reset-btn',
    'clear-all-crops-btn',
  ]) {
    const button = root.getElementById(id);
    if (button instanceof HTMLButtonElement && !button.disabled) {
      button.click();
      return;
    }
  }
}

function hasResettableState(root: Document, hasOutput: boolean): boolean {
  if (session?.canReset) return session.canReset();
  if (hasOutput || session?.reset) return true;
  if (hasReadyProcessButton(root)) return true;
  return Boolean(
    root.querySelector(
      '#file-display-area:not(:empty), #file-list:not(:empty), #signature-editor:not(.hidden)'
    )
  );
}

function hideLegacyOutputActions(root: Document): void {
  const ids = [
    'process-btn',
    'export-pdf-btn',
    'download-btn',
    'downloadBtn',
    'download-searchable-pdf',
    'export-dropdown-wrapper',
    'mdExport',
    'download-all-btn',
    'completion-download',
    'completion-start-over',
    'completion-save-shift',
    'shift-pdf-save-output',
    'shift-pdf-save-viewer',
    'download-edited-pdf',
    'crop-button',
    'clear-files-btn',
    'undo-merge-btn',
    'redo-merge-btn',
    'undo-btn',
    'redo-btn',
    'reset-btn',
    'save-stamped-btn',
  ];
  for (const id of ids) {
    const control = root.getElementById(id);
    if (control instanceof HTMLElement) {
      // A page that already presents these controls in the shared action row
      // (the bookmark editor, for example) keeps that row. Hiding them would
      // remove the only visible Undo once the upload card is gone.
      const row = control.closest('.shift-action-row');
      if (row && !row.hasAttribute('data-shift-viewer-actions')) continue;
      if (!control.hidden) control.hidden = true;
      if (control.getAttribute('aria-hidden') !== 'true') {
        control.setAttribute('aria-hidden', 'true');
      }
    }
  }
}

function getButton(root: Document, id: string): HTMLButtonElement | null {
  const element = root.getElementById(id);
  return element instanceof HTMLButtonElement ? element : null;
}

function setButtonDisabled(button: HTMLButtonElement, disabled: boolean): void {
  if (button.disabled !== disabled) button.disabled = disabled;
}

function getLegacyHistoryButton(
  root: Document,
  direction: 'undo' | 'redo'
): HTMLButtonElement | null {
  const ids =
    direction === 'undo'
      ? ['undo-merge-btn', 'undo-btn']
      : ['redo-merge-btn', 'redo-btn'];
  for (const id of ids) {
    const button = root.getElementById(id);
    if (button instanceof HTMLButtonElement) return button;
  }
  return null;
}
