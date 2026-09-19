import { showAlert } from '../ui.js';
import { downloadBlob, PDF_OUTPUT_READY_EVENT } from '../utils/helpers.js';
import {
  canSaveToShiftPdf,
  clearLatestPdfOutput,
  getLatestPdfOutput,
  saveToShiftPdf,
  TOOL_OUTPUT_STATE_EVENT,
} from './shift-pdf-save.js';

export const TOOL_OUTPUT_TOOLBAR_ID = 'shift-tool-output-toolbar';
export const TOOL_OUTPUT_UNDO_ID = 'shift-tool-output-undo';
export const TOOL_OUTPUT_REDO_ID = 'shift-tool-output-redo';
export const TOOL_OUTPUT_RESET_ID = 'shift-tool-output-reset';
export const TOOL_OUTPUT_SAVE_ID = 'shift-tool-output-save';
export const TOOL_OUTPUT_MENU_ID = 'shift-tool-output-menu';
export const TOOL_OUTPUT_DOWNLOAD_ID = 'shift-tool-output-download';
export const TOOL_OUTPUT_PRINT_ID = 'shift-tool-output-print';

export interface ToolOutputSession {
  reset?: () => void | Promise<void>;
  undo?: () => void | Promise<void>;
  redo?: () => void | Promise<void>;
  print?: () => void | Promise<void>;
  canUndo?: () => boolean;
  canRedo?: () => boolean;
  canPrint?: () => boolean;
}

/** Keeps the print frame alive long enough for the browser print dialog. */
const PRINT_FRAME_CLEANUP_MS = 60000;

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
  observer?.disconnect();
  observer = new MutationObserver(() => {
    ensureToolbar(root);
    hideLegacyOutputActions(root);
    syncToolOutputToolbar(root);
  });
  observer.observe(root.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['disabled', 'class', 'hidden'],
  });
  syncToolOutputToolbar(root);
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
    setButtonDisabled(save, saveInFlight || !canSaveToShiftPdf(output));
  }
  if (download) setButtonDisabled(download, !output);
  if (print) setButtonDisabled(print, !canPrintOutput(output));
}

function canPrintOutput(output: { isPdf: boolean } | null): boolean {
  if (session?.print) return session.canPrint?.() ?? true;
  return Boolean(output?.isPdf);
}

function isNonToolPage(root: Document): boolean {
  return (
    root.body.classList.contains('shift-home') ||
    Boolean(root.getElementById('shift-my-pdfs')) ||
    Boolean(root.getElementById('tool-grid'))
  );
}

function ensureToolbar(root: Document): HTMLElement | null {
  const existing = root.getElementById(TOOL_OUTPUT_TOOLBAR_ID);
  const viewerActions = root.querySelector<HTMLElement>(
    '[data-shift-viewer-actions]'
  );
  if (existing) {
    if (viewerActions && existing.parentElement !== viewerActions) {
      viewerActions.append(existing);
    }
    return existing;
  }

  const host =
    viewerActions ??
    root.querySelector<HTMLElement>('.shift-pdf-viewer-actions') ??
    root.getElementById('workflow-toolbar') ??
    root.querySelector<HTMLElement>('.toolbar-container') ??
    root.getElementById('tool-uploader') ??
    root.getElementById('tool-interface') ??
    root.querySelector<HTMLElement>('main');
  if (!host) return null;

  const toolbar = root.createElement('div');
  toolbar.id = TOOL_OUTPUT_TOOLBAR_ID;
  toolbar.className = 'shift-tool-output-toolbar';
  toolbar.setAttribute('role', 'toolbar');
  toolbar.setAttribute('aria-label', 'Document actions');

  const history = root.createElement('div');
  history.className = 'shift-tool-output-history';
  history.append(
    createActionButton(root, TOOL_OUTPUT_UNDO_ID, 'Undo', 'undo-2'),
    createActionButton(root, TOOL_OUTPUT_REDO_ID, 'Redo', 'redo-2')
  );

  const outputActions = root.createElement('div');
  outputActions.className = 'shift-tool-output-actions';
  outputActions.append(
    createActionButton(root, TOOL_OUTPUT_RESET_ID, 'Reset', 'rotate-ccw')
  );

  const split = root.createElement('div');
  split.className = 'shift-tool-output-split';
  const save = createActionButton(
    root,
    TOOL_OUTPUT_SAVE_ID,
    'Save',
    'save',
    true
  );
  const menu = root.createElement('details');
  menu.id = TOOL_OUTPUT_MENU_ID;
  menu.className = 'shift-tool-output-menu';
  const summary = root.createElement('summary');
  summary.className = 'shift-tool-output-disclosure';
  summary.setAttribute('aria-label', 'More save options');
  summary.innerHTML = chevronIcon();
  const menuSurface = root.createElement('div');
  menuSurface.className = 'shift-tool-output-menu-surface';
  const download = createActionButton(
    root,
    TOOL_OUTPUT_DOWNLOAD_ID,
    'Download',
    'download'
  );
  const print = createActionButton(root, TOOL_OUTPUT_PRINT_ID, 'Print', 'print');
  menuSurface.append(download, print);
  menu.append(summary, menuSurface);
  split.append(save, menu);
  outputActions.append(split);

  toolbar.append(history, outputActions);
  const heading = host.querySelector('h1');
  const subtitle =
    heading?.nextElementSibling instanceof HTMLParagraphElement
      ? heading.nextElementSibling
      : null;
  (subtitle ?? heading)?.insertAdjacentElement('afterend', toolbar);
  if (!heading) host.append(toolbar);

  save.addEventListener('click', () => void saveOutput(root));
  download.addEventListener('click', () => downloadOutput(root));
  print.addEventListener('click', () => void printOutput(root));
  getButton(root, TOOL_OUTPUT_RESET_ID)?.addEventListener('click', () => {
    void resetOutput(root);
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

  hideLegacyOutputActions(root);
  return toolbar;
}

function createActionButton(
  root: Document,
  id: string,
  label: string,
  icon: string,
  primary = false
): HTMLButtonElement {
  const button = root.createElement('button');
  button.id = id;
  button.type = 'button';
  button.className = primary
    ? 'shift-tool-output-button shift-tool-output-save'
    : 'shift-tool-output-button';
  button.setAttribute('aria-label', label);
  button.innerHTML = `${actionIcon(icon)}<span>${label}</span>`;
  return button;
}

async function saveOutput(root: Document): Promise<void> {
  const output = getLatestPdfOutput();
  if (!output || saveInFlight || !canSaveToShiftPdf(output)) return;
  saveInFlight = true;
  syncToolOutputToolbar(root);
  try {
    const result = await saveToShiftPdf(output.blob, output.filename, root);
    if (result === 'added') {
      showAlert('Saved', 'A copy was saved to My PDFs.', 'success');
    }
  } finally {
    saveInFlight = false;
    syncToolOutputToolbar(root);
  }
}

function downloadOutput(root: Document): void {
  const output = getLatestPdfOutput();
  if (!output) return;
  downloadBlob(output.blob, output.filename);
  closeOutputMenu(root);
}

async function printOutput(root: Document): Promise<void> {
  const output = getLatestPdfOutput();
  if (!canPrintOutput(output)) return;
  closeOutputMenu(root);
  try {
    if (session?.print) {
      await session.print();
      return;
    }
    if (output) printBlob(root, output.blob);
  } catch (error) {
    showAlert(
      'Print failed',
      error instanceof Error ? error.message : 'Could not print this PDF.'
    );
  }
}

function printBlob(root: Document, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const frame = root.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.title = 'Print preview';
  frame.style.cssText =
    'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
  frame.addEventListener('load', () => {
    const frameWindow = frame.contentWindow;
    if (typeof frameWindow?.print === 'function') {
      frameWindow.focus();
      frameWindow.print();
    }
    globalThis.setTimeout(() => {
      frame.remove();
      URL.revokeObjectURL(url);
    }, PRINT_FRAME_CLEANUP_MS);
  });
  frame.src = url;
  root.body.append(frame);
}

function closeOutputMenu(root: Document): void {
  const menu = root.getElementById(TOOL_OUTPUT_MENU_ID);
  if (menu instanceof HTMLDetailsElement) menu.open = false;
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
  if (hasOutput || session?.reset) return true;
  return Boolean(
    root.querySelector(
      '#file-display-area:not(:empty), #file-list:not(:empty), #signature-editor:not(.hidden)'
    )
  );
}

function hideLegacyOutputActions(root: Document): void {
  for (const id of [
    'completion-download',
    'completion-start-over',
    'completion-save-shift',
    'shift-pdf-save-output',
    'shift-pdf-save-viewer',
    'shift-pdf-viewer-download',
    'shift-pdf-viewer-print',
    'clear-files-btn',
    'undo-merge-btn',
    'redo-merge-btn',
    'undo-btn',
    'redo-btn',
    'reset-btn',
  ]) {
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

function actionIcon(name: string): string {
  const paths: Record<string, string> = {
    'undo-2': '<path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 6 6v1"/>',
    'redo-2': '<path d="m15 14 5-5-5-5"/><path d="M20 9H10a6 6 0 0 0-6 6v1"/>',
    'rotate-ccw': '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>',
    save: '<path d="M15.2 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8.8z"/><path d="M17 21v-8H7v8"/><path d="M7 3v5h8"/>',
    download:
      '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>',
    print:
      '<path d="M6 9V3h12v6"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><path d="M6 14h12v7H6z"/>',
  };
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name] ?? ''}</svg>`;
}

function chevronIcon(): string {
  return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
}
