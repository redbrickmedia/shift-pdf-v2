// Self-contained Form Filler logic for standalone page
import { createIcons, icons } from 'lucide';
import { downloadFile, getPDFDocument } from '../utils/helpers.js';
import { loadPdfWithPasswordPrompt } from '../utils/password-prompt.js';
import { hideLoader, showLoader } from '../ui.js';
import { getDerivedPdfFilename } from '../utils/derived-pdf-filename.js';
import { exportPdfJsAnnotations } from '../utils/sign-pdf-export.js';
import {
  applyPdfViewerDownloadFilename,
  encodePdfjsViewerFileParam,
} from '../utils/pdfjs-viewer-filename.js';
import {
  hidePdfJsPrintControls,
  printPdfJsViewerFrame,
} from '../utils/pdfjs-viewer-print.js';
import { waitForPdfJsSignViewer } from '../utils/pdfjs-sign-viewer.js';
import {
  registerToolOutputSession,
  syncToolOutputToolbar,
} from './tool-output-toolbar.js';

let viewerIframe: HTMLIFrameElement | null = null;
let viewerReady = false;
let currentFile: File | null = null;
let formDirty = false;

function showAlert(
  title: string,
  message: string,
  type: string = 'error',
  callback?: () => void
) {
  const modal = document.getElementById('alert-modal');
  const alertTitle = document.getElementById('alert-title');
  const alertMessage = document.getElementById('alert-message');
  const okBtn = document.getElementById('alert-ok');

  if (alertTitle) alertTitle.textContent = title;
  if (alertMessage) alertMessage.textContent = message;
  if (modal) modal.classList.remove('hidden');

  if (okBtn) {
    const newOkBtn = okBtn.cloneNode(true) as HTMLElement;
    okBtn.replaceWith(newOkBtn);
    newOkBtn.addEventListener('click', () => {
      modal?.classList.add('hidden');
      if (callback) callback();
    });
  }
}

function updateFileDisplay() {
  const displayArea = document.getElementById('file-display-area');
  if (!displayArea || !currentFile) return;

  const fileSize =
    currentFile.size < 1024 * 1024
      ? `${(currentFile.size / 1024).toFixed(1)} KB`
      : `${(currentFile.size / 1024 / 1024).toFixed(2)} MB`;

  displayArea.textContent = '';

  const card = document.createElement('div');
  card.className =
    'bg-gray-700 p-3 rounded-lg border border-gray-600 hover:border-indigo-500 transition-colors';

  const row = document.createElement('div');
  row.className = 'flex items-center justify-between';

  const info = document.createElement('div');
  info.className = 'flex-1 min-w-0';

  const nameP = document.createElement('p');
  nameP.className = 'truncate font-medium text-white';
  nameP.textContent = currentFile.name;

  const sizeP = document.createElement('p');
  sizeP.className = 'text-gray-400 text-sm';
  sizeP.textContent = fileSize;

  info.append(nameP, sizeP);

  const removeBtn = document.createElement('button');
  removeBtn.id = 'remove-file';
  removeBtn.type = 'button';
  removeBtn.className = 'p-2 flex-shrink-0 ml-2 shift-tool-file-remove';
  removeBtn.setAttribute('aria-label', `Remove ${currentFile.name}`);
  removeBtn.title = `Remove ${currentFile.name}`;

  const removeIcon = document.createElement('i');
  removeIcon.setAttribute('data-lucide', 'x');
  removeIcon.className = 'w-4 h-4';
  removeBtn.appendChild(removeIcon);

  row.append(info, removeBtn);
  card.appendChild(row);
  displayArea.appendChild(card);

  createIcons({ icons });

  document
    .getElementById('remove-file')
    ?.addEventListener('click', () => resetState());
}

function resetState() {
  viewerIframe = null;
  viewerReady = false;
  currentFile = null;
  formDirty = false;
  syncToolOutputToolbar();
  const displayArea = document.getElementById('file-display-area');
  if (displayArea) displayArea.innerHTML = '';
  document.getElementById('form-filler-options')?.classList.add('hidden');
  const fileInput = document.getElementById('file-input') as HTMLInputElement;
  if (fileInput) fileInput.value = '';

  // Clear viewer
  const viewerContainer = document.getElementById('pdf-viewer-container');
  if (viewerContainer) {
    viewerContainer.innerHTML = '';
    viewerContainer.style.height = '';
    viewerContainer.style.aspectRatio = '';
  }

  const toolUploader = document.getElementById('tool-uploader');
  const isFullWidth = localStorage.getItem('fullWidthMode') !== 'false';
  if (toolUploader && !isFullWidth) {
    toolUploader.classList.remove('max-w-6xl');
    toolUploader.classList.add('max-w-2xl');
  }
}

// File handling
async function handleFileUpload(file: File) {
  if (!file || file.type !== 'application/pdf') {
    showAlert('Error', 'Please upload a valid PDF file.');
    return;
  }

  try {
    const result = await loadPdfWithPasswordPrompt(file);
    if (!result) return;
    result.pdf.destroy();
    currentFile = result.file;
    updateFileDisplay();
    await setupFormViewer();
  } catch (error) {
    console.error(error);
    showAlert('Error', 'Failed to load PDF file.');
    hideLoader();
  }
}

async function adjustViewerHeight(file: File) {
  const viewerContainer = document.getElementById('pdf-viewer-container');
  if (!viewerContainer) return;

  try {
    const arrayBuffer = await file.arrayBuffer();
    const loadingTask = getPDFDocument({ data: arrayBuffer });
    const pdf = await loadingTask.promise;
    const page = await pdf.getPage(1);
    const viewport = page.getViewport({ scale: 1 });

    // Add ~50px for toolbar height
    const aspectRatio = viewport.width / (viewport.height + 50);

    viewerContainer.style.height = 'auto';
    viewerContainer.style.aspectRatio = `${aspectRatio}`;
  } catch (e) {
    console.error('Error adjusting viewer height:', e);
    viewerContainer.style.height = '80vh';
  }
}

async function setupFormViewer() {
  if (!currentFile) return;

  showLoader('Loading PDF form...');
  const pdfViewerContainer = document.getElementById('pdf-viewer-container');

  if (!pdfViewerContainer) {
    console.error('PDF viewer container not found');
    hideLoader();
    return;
  }

  const toolUploader = document.getElementById('tool-uploader');
  // Default to true if not set
  const isFullWidth = localStorage.getItem('fullWidthMode') !== 'false';
  if (toolUploader && !isFullWidth) {
    toolUploader.classList.remove('max-w-2xl');
    toolUploader.classList.add('max-w-6xl');
  }

  try {
    // Apply dynamic height
    await adjustViewerHeight(currentFile);

    pdfViewerContainer.innerHTML = '';

    const arrayBuffer = await currentFile.arrayBuffer();
    const blob = new Blob([arrayBuffer], { type: 'application/pdf' });
    const blobUrl = URL.createObjectURL(blob);

    viewerIframe = document.createElement('iframe');
    viewerIframe.src = `${import.meta.env.BASE_URL}pdfjs-viewer/viewer.html?file=${encodePdfjsViewerFileParam(blobUrl, currentFile.name)}`;
    viewerIframe.style.width = '100%';
    viewerIframe.style.height = '100%';
    viewerIframe.style.border = 'none';

    viewerIframe.onload = () => {
      hidePdfJsPrintControls(viewerIframe?.contentDocument);
      void (async () => {
        if (!viewerIframe) return;
        try {
          const app = await waitForPdfJsSignViewer(viewerIframe);
          applyPdfViewerDownloadFilename(app, currentFile?.name);
          const storage = app.pdfDocument?.annotationStorage as
            | {
                onSetModified?: (() => void) | null;
                onResetModified?: (() => void) | null;
              }
            | undefined;
          if (storage) {
            storage.onSetModified = () => {
              formDirty = true;
              syncToolOutputToolbar();
            };
            storage.onResetModified = () => {
              formDirty = false;
              syncToolOutputToolbar();
            };
          }
          viewerReady = true;
          syncToolOutputToolbar();
        } catch (error) {
          console.error('Could not initialize the form viewer:', error);
        } finally {
          hideLoader();
        }
      })();
    };

    pdfViewerContainer.appendChild(viewerIframe);

    const formFillerOptions = document.getElementById('form-filler-options');
    if (formFillerOptions) formFillerOptions.classList.remove('hidden');
  } catch (e) {
    console.error('Critical error setting up form filler:', e);
    showAlert('Error', 'Failed to load PDF form viewer.');
    hideLoader();
  }
}

async function processAndDownloadForm() {
  if (!viewerIframe || !viewerReady) {
    showAlert(
      'Viewer not ready',
      'Please wait for the form to finish loading.'
    );
    return;
  }

  try {
    showLoader('Saving filled form...');
    const app = await waitForPdfJsSignViewer(viewerIframe);
    if (!app.pdfDocument) {
      throw new Error('The PDF.js document is unavailable.');
    }
    const outputBytes = await exportPdfJsAnnotations(app.pdfDocument);
    const blob = new Blob([Uint8Array.from(outputBytes)], {
      type: 'application/pdf',
    });
    downloadFile(blob, getDerivedPdfFilename(currentFile?.name, '_filled'));
  } catch (e) {
    console.error('Failed to export the filled form:', e);
    showAlert(
      'Export failed',
      'Could not export the filled form. Please try again.'
    );
  } finally {
    hideLoader();
  }
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  const fileInput = document.getElementById('file-input') as HTMLInputElement;
  const dropZone = document.getElementById('drop-zone');
  const processBtn = document.getElementById('process-btn');
  fileInput?.addEventListener('change', (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (file) handleFileUpload(file);
  });

  dropZone?.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('border-indigo-500');
  });

  dropZone?.addEventListener('dragleave', () => {
    dropZone.classList.remove('border-indigo-500');
  });

  dropZone?.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('border-indigo-500');
    const file = e.dataTransfer?.files[0];
    if (file) handleFileUpload(file);
  });

  processBtn?.addEventListener('click', processAndDownloadForm);
  registerToolOutputSession({
    reset: resetState,
    apply: processAndDownloadForm,
    print: () => printPdfJsViewerFrame(viewerIframe),
    canSave: () => formDirty,
    canPrint: () => viewerReady,
  });
});
