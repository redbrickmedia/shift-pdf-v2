import { mountToolInputPreview } from './tool-input-preview.js';
import { hideLoader, showAlert, showLoader } from '../ui.js';

import { downloadFile, formatBytes } from '../utils/helpers.js';
import { batchDecryptIfNeeded } from '../utils/password-prompt.js';
import { PDFDocument } from 'pdf-lib';
import { flattenAnnotations } from '../utils/flatten-annotations.js';
import { icons, createIcons } from 'lucide';
import JSZip from 'jszip';
import { deduplicateFileName } from '../utils/deduplicate-filename.js';
import { FlattenPdfState, type PyMuPDFInstance } from '@/types';
import { loadPdfDocument } from '../utils/load-pdf-document.js';
import { loadPyMuPDF, isPyMuPDFAvailable } from '../utils/pymupdf-loader.js';
import { showWasmRequiredDialog } from '../utils/wasm-provider.js';
import {
  applyLaunchContextToDom,
  resolveLaunchContext,
  setLaunchContext,
} from './launch-context.js';
import {
  registerToolOutputSession,
  syncToolOutputToolbar,
  type ToolOutputKind,
} from './tool-output-toolbar.ts';
import { onToolFilesSeeded } from './tool-file-seed.js';
import {
  clearWorkspaceOpenFile,
  setWorkspaceFiles,
} from './workspace-files.js';

type FlattenMode = 'flatten' | 'rasterize';

const pageState: FlattenPdfState & {
  activeMode: FlattenMode;
} = {
  files: [],
  activeMode: 'flatten',
};

function getInitialModeFromContext(): FlattenMode {
  return resolveLaunchContext().entryId === 'rasterize-pdf'
    ? 'rasterize'
    : 'flatten';
}

function syncModeUI() {
  const flattenBtn = document.getElementById(
    'mode-flatten'
  ) as HTMLButtonElement | null;
  const rasterizeBtn = document.getElementById(
    'mode-rasterize'
  ) as HTMLButtonElement | null;
  const flattenOptions = document.getElementById('flatten-options');
  const rasterizeOptions = document.getElementById('rasterize-options');
  const processBtn = document.getElementById('process-btn');

  const isFlatten = pageState.activeMode === 'flatten';

  if (flattenBtn) {
    flattenBtn.setAttribute('aria-pressed', String(isFlatten));
    flattenBtn.classList.toggle('bg-indigo-600', isFlatten);
    flattenBtn.classList.toggle('text-white', isFlatten);
    flattenBtn.classList.toggle('text-gray-300', !isFlatten);
  }
  if (rasterizeBtn) {
    rasterizeBtn.setAttribute('aria-pressed', String(!isFlatten));
    rasterizeBtn.classList.toggle('bg-indigo-600', !isFlatten);
    rasterizeBtn.classList.toggle('text-white', !isFlatten);
    rasterizeBtn.classList.toggle('text-gray-300', isFlatten);
  }

  flattenOptions?.classList.toggle('hidden', !isFlatten);
  rasterizeOptions?.classList.toggle('hidden', isFlatten);

  if (processBtn) {
    processBtn.textContent = isFlatten ? 'Flatten PDF(s)' : 'Rasterize PDF';
  }

  syncToolOutputToolbar();
}

function setMode(mode: FlattenMode) {
  pageState.activeMode = mode;
  setLaunchContext(mode === 'rasterize' ? 'rasterize-pdf' : 'flatten-pdf');
  syncModeUI();
}

function flattenFormsInDoc(pdfDoc: PDFDocument) {
  const form = pdfDoc.getForm();
  form.flatten();
}

function shouldFlattenFormFields(): boolean {
  const el = document.getElementById(
    'flatten-form-fields'
  ) as HTMLInputElement | null;
  return el ? el.checked : true;
}

function shouldFlattenAnnotations(): boolean {
  const el = document.getElementById(
    'flatten-annotations'
  ) as HTMLInputElement | null;
  return el ? el.checked : true;
}

function canCommitFlattenOutput(): boolean {
  if (pageState.files.length === 0) return false;
  if (pageState.activeMode === 'flatten') {
    return shouldFlattenFormFields() || shouldFlattenAnnotations();
  }
  return true;
}

function resolveOutputKind(): ToolOutputKind {
  return pageState.files.length > 1 ? 'multi-pdf-zip' : 'pdf';
}

function resetState() {
  pageState.files = [];

  const fileDisplayArea = document.getElementById('file-display-area');
  if (fileDisplayArea) fileDisplayArea.innerHTML = '';

  const toolOptions = document.getElementById('tool-options');
  if (toolOptions) toolOptions.classList.add('hidden');

  const fileControls = document.getElementById('file-controls');
  if (fileControls) fileControls.classList.add('hidden');

  const fileInput = document.getElementById('file-input') as HTMLInputElement;
  if (fileInput) fileInput.value = '';

  const formFieldsBox = document.getElementById(
    'flatten-form-fields'
  ) as HTMLInputElement | null;
  if (formFieldsBox) formFieldsBox.checked = true;

  const annotsBox = document.getElementById(
    'flatten-annotations'
  ) as HTMLInputElement | null;
  if (annotsBox) annotsBox.checked = true;

  const dpiSelect = document.getElementById(
    'rasterize-dpi'
  ) as HTMLSelectElement | null;
  if (dpiSelect) dpiSelect.value = '150';

  const formatSelect = document.getElementById(
    'rasterize-format'
  ) as HTMLSelectElement | null;
  if (formatSelect) formatSelect.value = 'png';

  const grayscaleBox = document.getElementById(
    'rasterize-grayscale'
  ) as HTMLInputElement | null;
  if (grayscaleBox) grayscaleBox.checked = false;

  void clearWorkspaceOpenFile();
  syncToolOutputToolbar();
}

async function updateUI() {
  const fileDisplayArea = document.getElementById('file-display-area');
  const toolOptions = document.getElementById('tool-options');
  const fileControls = document.getElementById('file-controls');

  if (!fileDisplayArea) return;

  fileDisplayArea.innerHTML = '';

  if (pageState.files.length > 0) {
    pageState.files.forEach((file, index) => {
      const fileDiv = document.createElement('div');
      fileDiv.className =
        'flex items-center justify-between bg-gray-700 p-3 rounded-lg text-sm';
      mountToolInputPreview(fileDiv, file);

      const infoContainer = document.createElement('div');
      infoContainer.className = 'flex flex-col overflow-hidden';

      const nameSpan = document.createElement('div');
      nameSpan.className = 'truncate font-medium text-gray-200 text-sm mb-1';
      nameSpan.textContent = file.name;

      const metaSpan = document.createElement('div');
      metaSpan.className = 'text-xs text-gray-400';
      metaSpan.textContent = formatBytes(file.size);

      infoContainer.append(nameSpan, metaSpan);

      const removeBtn = document.createElement('button');
      removeBtn.className = 'ml-4 flex-shrink-0 shift-tool-file-remove';
      removeBtn.type = 'button';
      removeBtn.setAttribute('aria-label', `Remove ${file.name}`);
      removeBtn.title = `Remove ${file.name}`;
      removeBtn.innerHTML = '<i data-lucide="x" class="w-4 h-4"></i>';
      removeBtn.onclick = function () {
        pageState.files.splice(index, 1);
        if (pageState.files.length === 0) {
          resetState();
        } else {
          void updateUI();
        }
      };

      fileDiv.append(infoContainer, removeBtn);
      fileDisplayArea.appendChild(fileDiv);
    });

    createIcons({ icons });

    if (toolOptions) toolOptions.classList.remove('hidden');
    if (fileControls) fileControls.classList.remove('hidden');
    setWorkspaceFiles(pageState.files);
  } else {
    if (toolOptions) toolOptions.classList.add('hidden');
    if (fileControls) fileControls.classList.add('hidden');
  }
  syncToolOutputToolbar();
}

function handleFileSelect(files: FileList | File[] | null) {
  if (files && files.length > 0) {
    const pdfFiles = Array.from(files).filter(
      (f) =>
        f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf')
    );
    if (pdfFiles.length > 0) {
      pageState.files.push(...pdfFiles);
      void updateUI();
    }
  }
}

async function flattenSingleDoc(
  file: File,
  doForms: boolean,
  doAnnotations: boolean
): Promise<Uint8Array> {
  const arrayBuffer = await file.arrayBuffer();
  const pdfDoc = await loadPdfDocument(arrayBuffer);

  if (doForms) {
    try {
      flattenFormsInDoc(pdfDoc);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!msg.includes('getForm')) {
        throw e;
      }
    }
  }

  if (doAnnotations) {
    try {
      flattenAnnotations(pdfDoc);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn('Could not flatten annotations:', msg);
    }
  }

  return new Uint8Array(await pdfDoc.save());
}

async function flattenPdfFiles() {
  const doForms = shouldFlattenFormFields();
  const doAnnotations = shouldFlattenAnnotations();

  if (!doForms && !doAnnotations) {
    showAlert(
      'Select an Option',
      'Please select at least one option to flatten.'
    );
    return;
  }

  pageState.files = await batchDecryptIfNeeded(pageState.files);

  try {
    if (pageState.files.length === 1) {
      showLoader('Flattening PDF...');
      const file = pageState.files[0];
      const newPdfBytes = await flattenSingleDoc(file, doForms, doAnnotations);
      downloadFile(
        new Blob([new Uint8Array(newPdfBytes)], { type: 'application/pdf' }),
        `flattened_${file.name}`
      );
      hideLoader();
    } else {
      showLoader('Flattening multiple PDFs...');

      const zip = new JSZip();
      const usedNames = new Set<string>();
      let processedCount = 0;

      for (let i = 0; i < pageState.files.length; i++) {
        const file = pageState.files[i];
        showLoader(
          `Flattening ${i + 1}/${pageState.files.length}: ${file.name}...`
        );

        try {
          const flattenedBytes = await flattenSingleDoc(
            file,
            doForms,
            doAnnotations
          );
          const zipEntryName = deduplicateFileName(file.name, usedNames);
          zip.file(zipEntryName, flattenedBytes);
          processedCount++;
        } catch (e) {
          console.error(`Error processing ${file.name}:`, e);
        }
      }

      if (processedCount > 0) {
        const zipBlob = await zip.generateAsync({ type: 'blob' });
        downloadFile(zipBlob, 'flattened_pdfs.zip');
      } else {
        showAlert('Error', 'No PDFs could be processed.');
      }
      hideLoader();
    }
  } catch (e: unknown) {
    console.error(e);
    hideLoader();
    const errorMessage =
      e instanceof Error ? e.message : 'An unexpected error occurred.';
    showAlert('Error', errorMessage);
  }
}

async function rasterizePdfFiles() {
  if (!isPyMuPDFAvailable()) {
    showWasmRequiredDialog('pymupdf');
    return;
  }

  try {
    showLoader('Loading engine...');
    const pymupdf = await loadPyMuPDF();

    const dpi =
      parseInt(
        (document.getElementById('rasterize-dpi') as HTMLSelectElement | null)
          ?.value || '150'
      ) || 150;
    const format = ((
      document.getElementById('rasterize-format') as HTMLSelectElement | null
    )?.value || 'png') as 'png' | 'jpeg';
    const grayscale = Boolean(
      (
        document.getElementById(
          'rasterize-grayscale'
        ) as HTMLInputElement | null
      )?.checked
    );

    hideLoader();
    pageState.files = await batchDecryptIfNeeded(pageState.files);
    showLoader('Rasterizing...');

    const total = pageState.files.length;

    if (total === 1) {
      const file = pageState.files[0];
      showLoader(`Rasterizing ${file.name}...`);

      const rasterizedBlob = await (pymupdf as PyMuPDFInstance).rasterizePdf(
        file,
        {
          dpi,
          format,
          grayscale,
          quality: 95,
        }
      );

      downloadFile(rasterizedBlob, file.name);
      hideLoader();
    } else {
      const zip = new JSZip();
      const usedNames = new Set<string>();
      let completed = 0;

      for (let fi = 0; fi < pageState.files.length; fi++) {
        try {
          const file = pageState.files[fi];
          showLoader(`Rasterizing ${file.name} (${completed + 1}/${total})...`);

          const rasterizedBlob = await (
            pymupdf as PyMuPDFInstance
          ).rasterizePdf(file, {
            dpi,
            format,
            grayscale,
            quality: 95,
          });

          const zipEntryName = deduplicateFileName(file.name, usedNames);
          zip.file(zipEntryName, rasterizedBlob);
          completed++;
        } catch (error) {
          console.error(
            `Failed to rasterize ${pageState.files[fi].name}:`,
            error
          );
        }
      }

      if (completed > 0) {
        showLoader('Creating ZIP archive...');
        const zipBlob = await zip.generateAsync({ type: 'blob' });
        downloadFile(zipBlob, 'rasterized-pdfs.zip');
      } else {
        showAlert('Error', 'No PDFs could be rasterized.');
      }
      hideLoader();
    }
  } catch (e: unknown) {
    hideLoader();
    showAlert(
      'Error',
      `An error occurred during rasterization. Error: ${e instanceof Error ? e.message : String(e)}`
    );
  }
}

async function processFlattenOrRasterize() {
  if (pageState.files.length === 0) {
    showAlert('No Files', 'Please select at least one PDF file.');
    return;
  }

  if (pageState.activeMode === 'rasterize') {
    await rasterizePdfFiles();
  } else {
    await flattenPdfFiles();
  }
}

document.addEventListener('DOMContentLoaded', function () {
  pageState.files = [];
  applyLaunchContextToDom(document);
  pageState.activeMode = getInitialModeFromContext();
  syncModeUI();

  const fileInput = document.getElementById('file-input') as HTMLInputElement;
  const dropZone = document.getElementById('drop-zone');
  const processBtn = document.getElementById('process-btn');
  const addMoreBtn = document.getElementById('add-more-btn');
  const clearFilesBtn = document.getElementById('clear-files-btn');

  document
    .getElementById('mode-flatten')
    ?.addEventListener('click', () => setMode('flatten'));
  document
    .getElementById('mode-rasterize')
    ?.addEventListener('click', () => setMode('rasterize'));

  for (const id of [
    'flatten-form-fields',
    'flatten-annotations',
    'rasterize-dpi',
    'rasterize-format',
    'rasterize-grayscale',
  ]) {
    document
      .getElementById(id)
      ?.addEventListener('change', () => syncToolOutputToolbar());
  }

  registerToolOutputSession({
    apply: () => processFlattenOrRasterize(),
    reset: () => resetState(),
    canSave: () => canCommitFlattenOutput(),
    canReset: () => pageState.files.length > 0,
    outputKind: resolveOutputKind,
  });

  if (fileInput && dropZone) {
    fileInput.addEventListener('change', function (e) {
      handleFileSelect((e.target as HTMLInputElement).files);
    });

    dropZone.addEventListener('dragover', function (e) {
      e.preventDefault();
      dropZone.classList.add('bg-gray-700');
    });

    dropZone.addEventListener('dragleave', function (e) {
      e.preventDefault();
      dropZone.classList.remove('bg-gray-700');
    });

    dropZone.addEventListener('drop', function (e) {
      e.preventDefault();
      dropZone.classList.remove('bg-gray-700');
      handleFileSelect(e.dataTransfer?.files ?? null);
    });

    fileInput.addEventListener('click', function () {
      fileInput.value = '';
    });
  }

  if (processBtn) {
    processBtn.addEventListener('click', () => {
      void processFlattenOrRasterize();
    });
  }

  if (addMoreBtn && fileInput) {
    addMoreBtn.addEventListener('click', function () {
      fileInput.value = '';
      fileInput.click();
    });
  }

  if (clearFilesBtn) {
    clearFilesBtn.addEventListener('click', function () {
      resetState();
    });
  }

  onToolFilesSeeded(() => {
    if (
      fileInput?.files &&
      fileInput.files.length > 0 &&
      pageState.files.length === 0
    ) {
      handleFileSelect(fileInput.files);
    }
  });
});
