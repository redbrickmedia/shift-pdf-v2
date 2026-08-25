import { createIcons, icons } from 'lucide';
import { showAlert, showLoader, hideLoader } from '../ui.js';
import {
  readFileAsArrayBuffer,
  formatBytes,
  downloadFile,
} from '../utils/helpers.js';
import { loadPdfWithPasswordPrompt } from '../utils/password-prompt.js';
import { t } from '../i18n/i18n';
import type { SignState, PDFViewerWindow } from '@/types';
import {
  completionTiming,
  createDefaultToolCompletionPanel,
  type ToolCompletionPanel,
} from '../utils/tool-completion.js';
import { pdfEngineAnalytics, type ToolOperation } from '../analytics/index.js';
import {
  exportFlattenedSignedPdf,
  exportPdfJsAnnotations,
  getSignedPdfFilename,
} from '../utils/sign-pdf-export.js';
import {
  configureSessionOnlySignatureUi,
  waitForPdfJsSignViewer,
} from '../utils/pdfjs-sign-viewer.js';

const signState: SignState = {
  file: null,
  pdfDoc: null,
  viewerIframe: null,
  viewerReady: false,
  blobUrl: null,
};
let completionPanel: ToolCompletionPanel | null = null;
let fileLoadVersion = 0;

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializePage);
} else {
  initializePage();
}

function initializePage() {
  createIcons({ icons });
  completionPanel = createDefaultToolCompletionPanel(resetState);

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
    .getElementById('print-signed-pdf')
    ?.addEventListener('click', printSignedPdf);

  document
    .getElementById('flatten-signature-toggle')
    ?.addEventListener('change', updateDownloadButtonLabel);

  document.getElementById('back-to-tools')?.addEventListener('click', () => {
    cleanup();
    window.location.href = import.meta.env.BASE_URL;
  });
  window.addEventListener('pagehide', cleanup, { once: true });
}

async function handleFileUpload(e: Event) {
  const input = e.target as HTMLInputElement;
  if (input.files && input.files.length > 0) {
    await handleFile(input.files[0]);
  }
}

async function handleFile(file: File) {
  if (
    file.type !== 'application/pdf' &&
    !file.name.toLowerCase().endsWith('.pdf')
  ) {
    showAlert('Invalid File', 'Please select a PDF file.');
    return;
  }

  const loadVersion = ++fileLoadVersion;
  signState.viewerReady = false;
  signState.viewerIframe?.remove();
  signState.viewerIframe = null;
  cleanup();
  signState.file = file;
  if (await updateFileDisplay(file, loadVersion)) {
    await setupSignTool(loadVersion);
  }
}

async function updateFileDisplay(
  requestedFile: File,
  loadVersion: number
): Promise<boolean> {
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
  metaSpan.className = 'text-xs text-gray-400';
  metaSpan.textContent = `${formatBytes(signState.file.size)} • ${t('common.loadingPageCount')}`;

  infoContainer.append(nameSpan, metaSpan);

  const removeBtn = document.createElement('button');
  removeBtn.className = 'ml-4 text-red-400 hover:text-red-300 flex-shrink-0';
  removeBtn.innerHTML = '<i data-lucide="trash-2" class="w-4 h-4"></i>';
  removeBtn.onclick = () => {
    fileLoadVersion++;
    cleanup();
    signState.file = null;
    signState.pdfDoc = null;
    signState.viewerIframe = null;
    signState.viewerReady = false;
    fileDisplayArea.innerHTML = '';
    document.getElementById('signature-editor')?.classList.add('hidden');
  };

  fileDiv.append(infoContainer, removeBtn);
  fileDisplayArea.appendChild(fileDiv);
  createIcons({ icons });

  const result = await loadPdfWithPasswordPrompt(requestedFile);
  if (loadVersion !== fileLoadVersion) {
    await result?.pdf.destroy();
    return false;
  }
  if (!result) {
    signState.file = null;
    signState.pdfDoc = null;
    fileDisplayArea.innerHTML = '';
    document.getElementById('signature-editor')?.classList.add('hidden');
    return false;
  }
  signState.file = result.file;
  nameSpan.textContent = result.file.name;
  metaSpan.textContent = `${formatBytes(result.file.size)} • ${result.pdf.numPages} pages`;
  await result.pdf.destroy();
  return true;
}

async function setupSignTool(loadVersion: number) {
  const signatureEditor = document.getElementById('signature-editor');
  if (signatureEditor) {
    signatureEditor.classList.remove('hidden');
  }

  showLoader('Loading PDF viewer...');

  const container = document.getElementById('canvas-container-sign');
  if (!container) {
    console.error('Sign tool canvas container not found');
    hideLoader();
    return;
  }

  if (!signState.file) {
    console.error('No file loaded for signing');
    hideLoader();
    return;
  }

  container.textContent = '';
  cleanup();
  signState.viewerReady = false;
  const iframe = document.createElement('iframe');
  iframe.title = 'Visual signature editor';
  iframe.style.width = '100%';
  iframe.style.height = '100%';
  iframe.style.border = 'none';
  container.appendChild(iframe);
  signState.viewerIframe = iframe;

  const pdfBytes = await readFileAsArrayBuffer(signState.file);
  if (loadVersion !== fileLoadVersion) {
    hideLoader();
    return;
  }
  const blob = new Blob([new Uint8Array(pdfBytes as ArrayBuffer)], {
    type: 'application/pdf',
  });
  signState.blobUrl = URL.createObjectURL(blob);

  const viewerUrl = new URL(
    `${import.meta.env.BASE_URL}pdfjs-viewer/sign-viewer.html`,
    window.location.origin
  );
  const query = new URLSearchParams({
    file: signState.blobUrl,
    bentoSign: '1',
  });
  iframe.src = `${viewerUrl.toString()}?${query.toString()}`;

  iframe.onload = async () => {
    if (signState.viewerIframe !== iframe) return;
    try {
      const app = await waitForPdfJsSignViewer(iframe);
      configureSessionOnlySignatureUi(iframe, app);
      signState.viewerReady = true;

      const saveBtn = document.getElementById(
        'process-btn'
      ) as HTMLButtonElement | null;
      if (saveBtn) {
        saveBtn.style.display = '';
      }
      document.getElementById('print-signed-pdf')?.classList.remove('hidden');
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

async function printSignedPdf() {
  if (!signState.viewerIframe) return;
  try {
    const application = await waitForPdfJsSignViewer(signState.viewerIframe);
    if (!application.triggerPrinting) {
      throw new Error('Printing is unavailable in this browser.');
    }
    await application.triggerPrinting();
  } catch (error) {
    showAlert(
      'Print failed',
      error instanceof Error ? error.message : 'Could not print this PDF.'
    );
  }
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
      ? t('tools:signPdf.downloadFlattened')
      : t('tools:signPdf.download');
  }
}

async function applyAndSaveSignatures() {
  if (!signState.viewerReady || !signState.viewerIframe) {
    showAlert('Viewer not ready', 'Please wait for the PDF viewer to load.');
    return;
  }

  let operation: ToolOperation | null = null;
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
    operation = pdfEngineAnalytics?.startToolOperation('sign-pdf') ?? null;
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
    operation?.finish({
      result: 'success',
      inputCount: 1,
      outputCount: 1,
    });
  } catch (error) {
    operation?.finish({
      result: 'error',
      inputCount: 1,
      outputCount: 0,
      errorCategory: 'processing',
    });
    console.error('Failed to export the signed PDF:', error);
    hideLoader();
    showAlert(
      'Export failed',
      'Could not export the signed PDF. Please try again.'
    );
  }
}

function resetState() {
  fileLoadVersion++;
  cleanup();
  signState.file = null;
  signState.viewerIframe = null;
  signState.viewerReady = false;

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
    processBtn.textContent = t('tools:signPdf.download');
  }
  document.getElementById('print-signed-pdf')?.classList.add('hidden');

  const flattenCheckbox = document.getElementById(
    'flatten-signature-toggle'
  ) as HTMLInputElement | null;
  if (flattenCheckbox) {
    flattenCheckbox.checked = false;
  }
}

function cleanup() {
  if (signState.blobUrl) {
    URL.revokeObjectURL(signState.blobUrl);
    signState.blobUrl = null;
  }
}
