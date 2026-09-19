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
  overwriteToShiftPdf,
  saveToShiftPdf,
  TOOL_OUTPUT_STATE_EVENT,
} from './shift-pdf-save.js';
import { isViewerToolDocument } from './tool-viewer-layout.js';
import {
  VIEWER_CHROME_FEATURE_ATTR,
  applyViewerChromeFeatures,
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
  canPrint?: () => boolean;
}

let boundRoot: Document | null = null;
let session: ToolOutputSession | null = null;
let saveInFlight = false;
let observer: MutationObserver | null = null;
let saveMenuHideTimer: number | null = null;

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

export function syncToolOutputToolbar(root: Document = document): void {
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
    setButtonDisabled(save, saveInFlight || !canSaveOutput());
  }
  if (overwrite) {
    setButtonDisabled(overwrite, saveInFlight || !canOverwriteOutput());
  }
  if (download) {
    setButtonDisabled(download, saveInFlight || !canDownloadOutput());
  }
  if (print) {
    setButtonDisabled(print, !canPrintOutput(root));
  }
  syncSaveDisclosure(root, canSaveOutput() || Boolean(output));
  hideEmbeddedViewerPrintControls(root);
}

function canSaveOutput(): boolean {
  if (session?.canSave) return session.canSave();
  return canSaveToShiftPdf(getLatestPdfOutput());
}

function syncSaveDisclosure(root: Document, canDisclose: boolean): void {
  const menu = root.getElementById(TOOL_OUTPUT_MENU_ID);
  if (!menu) return;
  if (menu.classList.contains('is-ready') !== canDisclose) {
    menu.classList.toggle('is-ready', canDisclose);
  }
  if (!canDisclose) {
    closeViewerSaveMenu(menu);
    if (menu instanceof HTMLDetailsElement && menu.open) menu.open = false;
  }
}

function canDownloadOutput(): boolean {
  if (getLatestPdfOutput()) return true;
  return canSaveOutput();
}

function canOverwriteOutput(): boolean {
  return canSaveOutput() && Boolean(getPrimaryLibrarySaveTarget());
}

function canPrintOutput(root: Document): boolean {
  if (session?.print) return session.canPrint?.() ?? true;
  if (findPrintableViewerFrame(root)) return true;
  if (canSaveToShiftPdf(getLatestPdfOutput())) return true;
  return Boolean(session?.apply && canSaveOutput());
}

function isNonToolPage(root: Document): boolean {
  return (
    root.body.classList.contains('shift-home') ||
    Boolean(root.getElementById('shift-my-pdfs')) ||
    Boolean(root.getElementById('tool-grid')) ||
    Boolean(root.getElementById('convert-hub')) ||
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
  if (root.getElementById(TOOL_OUTPUT_UNDO_ID)) {
    if (header) {
      applyViewerChromeFeatures(
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
  const save = createViewerActionButton(
    root,
    TOOL_OUTPUT_SAVE_ID,
    'Save',
    'ph-floppy-disk',
    'save'
  );
  const menu = root.createElement('div');
  menu.className = 'shift-tool-viewer-save-menu';
  const surface = root.createElement('div');
  surface.className = 'shift-tool-viewer-save-menu-surface';
  surface.setAttribute('role', 'menu');
  surface.setAttribute('aria-label', 'More save options');
  const overwrite = createViewerActionButton(
    root,
    TOOL_OUTPUT_OVERWRITE_ID,
    'Overwrite',
    'ph-file'
  );
  const download = createViewerActionButton(
    root,
    TOOL_OUTPUT_DOWNLOAD_ID,
    'Download',
    'ph-download-simple'
  );
  const print = createViewerActionButton(
    root,
    TOOL_OUTPUT_PRINT_ID,
    'Print',
    'ph-printer'
  );
  overwrite.setAttribute('role', 'menuitem');
  download.setAttribute('role', 'menuitem');
  print.setAttribute('role', 'menuitem');
  surface.append(overwrite, download, print);
  menu.append(surface);
  saveGroup.append(save, menu);
  bindViewerSaveHover(saveGroup);
  host.prepend(undo, redo, reset, saveGroup);
  bindSharedActionHandlers(root);
  save.addEventListener('click', () => void saveOutput(root));
  overwrite.addEventListener('click', () => void overwriteOutput(root));
  hideLegacyOutputActions(root);
  if (header) {
    applyViewerChromeFeatures(
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
  feature?: ViewerChromeFeature
): HTMLButtonElement {
  const button = root.createElement('button');
  button.id = id;
  button.type = 'button';
  button.className = 'shift-pdf-viewer-action';
  button.setAttribute('aria-label', label);
  if (feature) button.setAttribute(VIEWER_CHROME_FEATURE_ATTR, feature);
  const icon = root.createElement('i');
  icon.className = `ph ${phosphorIcon}`;
  icon.setAttribute('aria-hidden', 'true');
  const text = root.createElement('span');
  text.textContent = label;
  button.append(icon, text);
  return button;
}

async function saveOutput(root: Document): Promise<void> {
  if (saveInFlight || !canSaveOutput()) return;
  saveInFlight = true;
  syncToolOutputToolbar(root);
  try {
    await applyToolOutput(root);
    const output = getLatestPdfOutput();
    if (!output || !canSaveToShiftPdf(output)) return;
    const result = await saveToShiftPdf(output.blob, output.filename, root);
    if (result === 'added') {
      showAlert('Saved', 'A copy was saved to My PDFs.', 'success');
    }
  } finally {
    saveInFlight = false;
    syncToolOutputToolbar(root);
  }
}

async function overwriteOutput(root: Document): Promise<void> {
  if (saveInFlight || !canOverwriteOutput()) return;
  saveInFlight = true;
  closeOutputMenu(root);
  syncToolOutputToolbar(root);
  try {
    await applyToolOutput(root);
    const output = getLatestPdfOutput();
    if (!output || !canSaveToShiftPdf(output)) return;
    const result = await overwriteToShiftPdf(output.blob, output.filename, root);
    if (result === 'replaced') {
      showAlert('Saved', 'The original PDF was updated in My PDFs.', 'success');
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

async function applyToolOutput(root: Document): Promise<void> {
  if (session?.apply) {
    await session.apply();
    return;
  }
  if (isViewerToolDocument(root)) {
    findProcessButton(root)?.click();
  }
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
  if (saveInFlight || !canDownloadOutput()) return;
  closeOutputMenu(root);
  saveInFlight = true;
  syncToolOutputToolbar(root);
  try {
    if (!getLatestPdfOutput() || Boolean(session?.canSave?.())) {
      await applyToolOutput(root);
    }
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
    if (!getLatestPdfOutput() || Boolean(session?.canSave?.())) {
      await applyToolOutput(root);
    }
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

function bindViewerSaveHover(saveGroup: HTMLElement): void {
  saveGroup.addEventListener('pointerenter', () => {
    if (!saveGroup.classList.contains('is-ready')) return;
    openViewerSaveMenu(saveGroup);
  });
  saveGroup.addEventListener('pointerleave', () => {
    scheduleViewerSaveMenuHide(saveGroup);
  });
}

function openViewerSaveMenu(saveGroup: HTMLElement): void {
  if (saveMenuHideTimer !== null) {
    window.clearTimeout(saveMenuHideTimer);
    saveMenuHideTimer = null;
  }
  saveGroup.classList.add('is-open');
}

function scheduleViewerSaveMenuHide(saveGroup: HTMLElement): void {
  if (saveMenuHideTimer !== null) window.clearTimeout(saveMenuHideTimer);
  saveMenuHideTimer = window.setTimeout(() => {
    saveMenuHideTimer = null;
    closeViewerSaveMenu(saveGroup);
  }, TOOL_OUTPUT_SAVE_MENU_HIDE_MS);
}

function closeViewerSaveMenu(saveGroup: HTMLElement): void {
  if (saveMenuHideTimer !== null) {
    window.clearTimeout(saveMenuHideTimer);
    saveMenuHideTimer = null;
  }
  saveGroup.classList.remove('is-open');
}

function closeOutputMenu(root: Document): void {
  const menu = root.getElementById(TOOL_OUTPUT_MENU_ID);
  if (menu instanceof HTMLDetailsElement) menu.open = false;
  if (menu) closeViewerSaveMenu(menu);
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
  return Boolean(
    root.querySelector(
      '#file-display-area:not(:empty), #file-list:not(:empty), #signature-editor:not(.hidden)'
    )
  );
}

function hideLegacyOutputActions(root: Document): void {
  const ids = [
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
    'export-dropdown-wrapper',
  ];
  if (isViewerToolDocument(root)) {
    ids.push('process-btn');
  }
  for (const id of ids) {
    const control = root.getElementById(id);
    if (control instanceof HTMLElement) {
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

