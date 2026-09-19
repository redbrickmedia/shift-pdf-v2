import { createIcons, icons } from 'lucide';
import { listenForShiftFileHandoff } from '../embedder/shift-file-handoff.js';
import { showAlert, showLoader, hideLoader } from '../ui.js';
import { formatBytes, downloadFile } from '../utils/helpers.js';
import { t } from '../i18n/i18n';
import { endToolUse } from '../host/analytics.js';
import type { SignState, PDFViewerWindow } from '@/types';
import {
  completionTiming,
  createDefaultToolCompletionPanel,
  type ToolCompletionPanel,
} from '../utils/tool-completion.js';
import {
  exportFlattenedSignedPdf,
  exportPdfJsAnnotations,
  getSignedPdfFilename,
} from '../utils/sign-pdf-export.js';
import {
  bindPdfJsEditorHistory,
  configureSessionOnlySignatureUi,
  EMPTY_PDFJS_EDITOR_HISTORY,
  openPdfJsSignatureDialog,
  redoPdfJsEditor,
  undoPdfJsEditor,
  waitForPdfJsSignViewer,
  type PdfJsEditorHistoryState,
} from '../utils/pdfjs-sign-viewer.js';
import { printPdfJsViewerFrame } from '../utils/pdfjs-viewer-print.js';
import {
  applyPdfViewerDownloadFilename,
  withPdfViewerFilename,
} from '../utils/pdfjs-viewer-filename.js';
import { viewerDisplayName } from './pdf-viewer-page.js';
import {
  clearWorkspaceOpenFile,
  markFileFromHandoff,
  setWorkspaceFilesFromTool,
} from './workspace-files.js';
import {
  registerToolOutputSession,
  syncToolOutputToolbar,
} from './tool-output-toolbar.js';

const signState: SignState = {
  file: null,
  pdfDoc: null,
  viewerIframe: null,
  viewerReady: false,
  blobUrl: null,
};
let completionPanel: ToolCompletionPanel | null = null;
let fileLoadVersion = 0;
let editorHistory: PdfJsEditorHistoryState = EMPTY_PDFJS_EDITOR_HISTORY;
let unbindEditorHistory: (() => void) | null = null;

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializePage);
} else {
  initializePage();
}

function initializePage() {
  createIcons({ icons });
  completionPanel = createDefaultToolCompletionPanel(resetState);
  const unregisterOutputSession = registerToolOutputSession({
    reset: resetEdits,
    apply: applyAndSaveSignatures,
    print: printSignedPdf,
    undo: () => undoPdfJsEditor(getSignViewerApplication()),
    redo: () => redoPdfJsEditor(getSignViewerApplication()),
    canUndo: () => editorHistory.canUndo,
    canRedo: () => editorHistory.canRedo,
    canReset: hasSignEditsToReset,
    canSave: () => editorHistory.hasEdits,
    canPrint: () => signState.viewerReady,
  });
  window.addEventListener('pagehide', unregisterOutputSession, { once: true });

  const fileInput = document.getElementById('file-input') as HTMLInputElement;
  const dropZone = document.getElementById('drop-zone');
  const processBtn = document.getElementById('process-btn');

  if (fileInput) {
    fileInput.addEventListener('change', (event) => {
      void handleFileUpload(event);
    });
  }

  if (dropZone) {
    dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropZone.classList.add('bg-gray-700');
    });

    dropZone.addEventListener('dragleave', () => {
      dropZone.classList.remove('bg-gray-700');
    });

    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.classList.remove('bg-gray-700');
      const droppedFiles = e.dataTransfer?.files;
      if (droppedFiles && droppedFiles.length > 0) {
        void handleFile(droppedFiles[0]);
      }
    });

    // Clear value on click to allow re-selecting the same file
    fileInput?.addEventListener('click', () => {
      if (fileInput) fileInput.value = '';
    });
  }

  if (processBtn) {
    processBtn.addEventListener('click', applyAndSaveSignatures);
  }

  document
    .getElementById('flatten-signature-toggle')
    ?.addEventListener('change', updateDownloadButtonLabel);
  document
    .getElementById('shift-sign-add')
    ?.addEventListener('click', openSignatureDialog);
  window.addEventListener('pagehide', cleanup, { once: true });
  listenForShiftFileHandoff({
    onFile: (file) => {
      markFileFromHandoff(file);
      return handleFile(file);
    },
  });
}

async function handleFileUpload(e: Event) {
  const input = e.target as HTMLInputElement;
  if (input.files && input.files.length > 0) {
    await handleFile(input.files[0]);
  }
}

async function handleFile(file: File): Promise<boolean> {
  if (
    file.type !== 'application/pdf' &&
    !file.name.toLowerCase().endsWith('.pdf')
  ) {
    showAlert('Invalid File', 'Please select a PDF file.');
    return false;
  }

  const loadVersion = ++fileLoadVersion;
  signState.viewerReady = false;
  signState.viewerIframe?.remove();
  signState.viewerIframe = null;
  cleanup();
  signState.file = file;
  if (!updateFileDisplay(file)) return false;
  setupSignTool(loadVersion);
  return true;
}

function updateFileDisplay(requestedFile: File): boolean {
  const fileDisplayArea = document.getElementById('file-display-area');

  if (!fileDisplayArea || signState.file !== requestedFile) return false;

  fileDisplayArea.innerHTML = '';

  const fileDiv = document.createElement('div');
  fileDiv.className =
    'flex items-center justify-between bg-gray-700 p-3 rounded-lg';

  const infoContainer = document.createElement('div');
  infoContainer.className = 'flex flex-col flex-1 min-w-0';

  const nameSpan = document.createElement('div');
  nameSpan.className = 'truncate font-medium text-gray-200 text-sm mb-1';
  nameSpan.textContent = signState.file.name;

  const metaSpan = document.createElement('div');
  metaSpan.id = 'sign-file-meta';
  metaSpan.className = 'text-xs text-gray-400';
  metaSpan.textContent = `${formatBytes(signState.file.size)} • ${t('common.loadingPageCount')}`;

  infoContainer.append(nameSpan, metaSpan);

  const removeBtn = document.createElement('button');
  removeBtn.className = 'ml-4 flex-shrink-0 shift-tool-file-remove';
  removeBtn.type = 'button';
  removeBtn.setAttribute('aria-label', `Remove ${signState.file.name}`);
  removeBtn.title = `Remove ${signState.file.name}`;
  removeBtn.innerHTML = '<i data-lucide="x" class="w-4 h-4"></i>';
  removeBtn.onclick = () => {
    fileLoadVersion++;
    cleanup();
    signState.file = null;
    signState.pdfDoc = null;
    signState.viewerIframe = null;
    signState.viewerReady = false;
    fileDisplayArea.innerHTML = '';
    document.getElementById('signature-editor')?.classList.add('hidden');
    void clearWorkspaceOpenFile();
  };

  fileDiv.append(infoContainer, removeBtn);
  fileDisplayArea.appendChild(fileDiv);
  createIcons({ icons });
  if (signState.file) setWorkspaceFilesFromTool([signState.file]);
  return true;
}

function setupSignTool(loadVersion: number) {
  const signatureEditor = document.getElementById('signature-editor');
  if (signatureEditor) {
    signatureEditor.classList.remove('hidden');
  }

  const container = document.getElementById('canvas-container-sign');
  if (!container) {
    console.error('Sign tool canvas container not found');
    return;
  }

  if (!signState.file) {
    console.error('No file loaded for signing');
    return;
  }

  container.textContent = '';
  cleanup();
  signState.viewerReady = false;
  const iframe = document.createElement('iframe');
  iframe.title = 'Visual signature editor';
  iframe.className = 'shift-pdf-viewer-frame';
  iframe.style.width = '100%';
  iframe.style.height = '100%';
  iframe.style.border = 'none';
  container.appendChild(iframe);
  signState.viewerIframe = iframe;

  // Give the original File directly to PDF.js. The previous flow parsed the
  // whole document for page count, destroyed that parse, copied the bytes into
  // another Blob, and then made this viewer parse it again.
  signState.blobUrl = URL.createObjectURL(signState.file);

  const viewerUrl = new URL(
    `${import.meta.env.BASE_URL}pdfjs-viewer/viewer.html`,
    window.location.origin
  );
  const query = new URLSearchParams({
    file: withPdfViewerFilename(signState.blobUrl, signState.file?.name),
    bentoSign: '1',
    shiftLaunchpad: '1',
  });
  setSignViewerTitle(signState.file?.name ?? 'Sign PDF');
  iframe.src = `${viewerUrl.toString()}?${query.toString()}`;

  iframe.onload = async () => {
    if (signState.viewerIframe !== iframe || loadVersion !== fileLoadVersion) {
      return;
    }
    try {
      const app = await waitForPdfJsSignViewer(iframe);
      applyPdfViewerDownloadFilename(app, signState.file?.name);
      configureSessionOnlySignatureUi(iframe, app);
      signState.viewerReady = true;
      bindSignEditorHistory(app);
      const pageCount = app.pdfDocument?.numPages;
      const meta = document.getElementById('sign-file-meta');
      if (meta && typeof pageCount === 'number' && signState.file) {
        meta.textContent = `${formatBytes(signState.file.size)} • ${pageCount} pages`;
      }

      const saveBtn = document.getElementById(
        'process-btn'
      ) as HTMLButtonElement | null;
      if (saveBtn) {
        saveBtn.style.display = '';
      }
      syncToolOutputToolbar();
    } catch (error) {
      console.error('Could not initialize PDF.js viewer for signing:', error);
      showAlert(
        'Viewer failed to load',
        error instanceof Error
          ? error.message
          : 'Could not initialize the signature editor.'
      );
    } finally {
      hideLoader();
    }
  };
}

function getSignViewerApplication(): PDFViewerWindow['PDFViewerApplication'] {
  return (signState.viewerIframe?.contentWindow as PDFViewerWindow | null)
    ?.PDFViewerApplication;
}

function setSignViewerTitle(filename: string): void {
  const title = viewerDisplayName(filename);
  const heading = document.querySelector<HTMLElement>(
    '.shift-pdf-viewer-heading h1'
  );
  if (heading) heading.textContent = title;
  document.title = `${title} | Shift PDF`;
}

function openSignatureDialog(): void {
  openPdfJsSignatureDialog(signState.viewerIframe, getSignViewerApplication());
}

function bindSignEditorHistory(
  application: NonNullable<PDFViewerWindow['PDFViewerApplication']>
): void {
  unbindEditorHistory?.();
  editorHistory = EMPTY_PDFJS_EDITOR_HISTORY;
  const unbindEvents = bindPdfJsEditorHistory(application, (next) => {
    editorHistory = next;
    syncToolOutputToolbar();
  });
  const storage = application.pdfDocument?.annotationStorage as
    | {
        onSetModified?: (() => void) | null;
        size?: number;
      }
    | undefined;
  const previousModified = storage?.onSetModified;
  if (storage) {
    storage.onSetModified = () => {
      previousModified?.();
      if (!editorHistory.hasEdits || !editorHistory.canUndo) {
        editorHistory = {
          ...editorHistory,
          hasEdits: true,
          canUndo: true,
        };
        syncToolOutputToolbar();
      }
    };
  }
  unbindEditorHistory = () => {
    unbindEvents();
    if (storage) storage.onSetModified = previousModified ?? null;
  };
}

async function printSignedPdf() {
  await printPdfJsViewerFrame(signState.viewerIframe);
}

function updateDownloadButtonLabel() {
  const flatten = (
    document.getElementById(
      'flatten-signature-toggle'
    ) as HTMLInputElement | null
  )?.checked;
  const processButton = document.getElementById('process-btn');
  if (processButton) {
    processButton.textContent = flatten
      ? 'Apply and flatten signatures'
      : 'Apply signatures';
  }
}

async function applyAndSaveSignatures() {
  if (!signState.viewerReady || !signState.viewerIframe) {
    showAlert('Viewer not ready', 'Please wait for the PDF viewer to load.');
    return;
  }

  const startedAt = performance.now();
  try {
    const viewerWindow = signState.viewerIframe
      .contentWindow as PDFViewerWindow | null;
    if (!viewerWindow || !viewerWindow.PDFViewerApplication) {
      showAlert('Viewer not ready', 'The PDF viewer is still initializing.');
      return;
    }

    const app = viewerWindow.PDFViewerApplication;
    const flattenCheckbox = document.getElementById(
      'flatten-signature-toggle'
    ) as HTMLInputElement | null;
    const shouldFlatten = flattenCheckbox?.checked;
    showLoader(
      shouldFlatten ? 'Flattening and saving PDF...' : 'Saving signed PDF...'
    );

    if (!app.pdfDocument) {
      throw new Error('The PDF.js document is unavailable.');
    }
    const outputBytes = shouldFlatten
      ? await exportFlattenedSignedPdf(app.pdfDocument)
      : await exportPdfJsAnnotations(app.pdfDocument);

    const blob = new Blob([Uint8Array.from(outputBytes)], {
      type: 'application/pdf',
    });
    const filename = getSignedPdfFilename(signState.file?.name, shouldFlatten);
    downloadFile(blob, filename);
    hideLoader();
    completionPanel?.show({
      blob,
      filename,
      summary: shouldFlatten
        ? t('tools:signPdf.flattenedReady')
        : t('tools:signPdf.ready'),
      timing: completionTiming(startedAt),
    });
  } catch (error) {
    console.error('Failed to export the signed PDF:', error);
    hideLoader();
    endToolUse('error');
    showAlert(
      'Export failed',
      'Could not export the signed PDF. Please try again.'
    );
  }
}

function hasSignEditsToReset(): boolean {
  return (
    editorHistory.hasEdits ||
    Boolean(
      (
        document.getElementById(
          'flatten-signature-toggle'
        ) as HTMLInputElement | null
      )?.checked
    )
  );
}

async function resetEdits(): Promise<void> {
  const file = signState.file;
  if (!file) return;

  const flattenCheckbox = document.getElementById(
    'flatten-signature-toggle'
  ) as HTMLInputElement | null;
  if (flattenCheckbox) flattenCheckbox.checked = false;
  updateDownloadButtonLabel();

  if (!editorHistory.hasEdits && signState.viewerReady) {
    syncToolOutputToolbar();
    return;
  }

  await handleFile(file);
}

function resetState() {
  fileLoadVersion++;
  cleanup();
  signState.file = null;
  signState.viewerIframe = null;
  signState.viewerReady = false;
  void clearWorkspaceOpenFile();

  const signatureEditor = document.getElementById('signature-editor');
  if (signatureEditor) {
    signatureEditor.classList.add('hidden');
  }

  const container = document.getElementById('canvas-container-sign');
  if (container) {
    container.textContent = '';
  }

  const fileDisplayArea = document.getElementById('file-display-area');
  if (fileDisplayArea) {
    fileDisplayArea.innerHTML = '';
  }

  const processBtn = document.getElementById(
    'process-btn'
  ) as HTMLButtonElement | null;
  if (processBtn) {
    processBtn.style.display = 'none';
    processBtn.textContent = 'Apply signatures';
  }

  const flattenCheckbox = document.getElementById(
    'flatten-signature-toggle'
  ) as HTMLInputElement | null;
  if (flattenCheckbox) {
    flattenCheckbox.checked = false;
  }
  setSignViewerTitle('Sign PDF');
  syncToolOutputToolbar();
}

function cleanup() {
  unbindEditorHistory?.();
  unbindEditorHistory = null;
  editorHistory = EMPTY_PDFJS_EDITOR_HISTORY;
  if (signState.blobUrl) {
    URL.revokeObjectURL(signState.blobUrl);
    signState.blobUrl = null;
  }
}
