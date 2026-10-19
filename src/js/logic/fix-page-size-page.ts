import { showResultLoader } from './tool-success.js';
import { mountToolInputPreview } from './tool-input-preview.js';
import { hideLoader, showAlert } from '../ui.js';

import {
  convertPoints,
  downloadBlob,
  downloadFile,
  formatBytes,
  getStandardPageName,
  hexToRgb,
} from '../utils/helpers.js';
import { fixPageSize as fixPageSizeCore } from '../utils/pdf-operations';
import { loadPdfWithPasswordPrompt } from '../utils/password-prompt.js';
import { loadPdfDocument } from '../utils/load-pdf-document.js';
import { icons, createIcons } from 'lucide';
import type { PDFDocument } from 'pdf-lib';
import type {
  AnalyzedPageData,
  FixPageSizeState,
  UniqueSizeEntry,
} from '@/types';
import {
  applyLaunchContextToDom,
  resolveLaunchContext,
} from './launch-context.js';
import {
  registerToolOutputSession,
  syncToolOutputToolbar,
} from './tool-output-toolbar.ts';
import { onToolFilesSeeded } from './tool-file-seed.js';
import {
  clearWorkspaceOpenFile,
  setWorkspaceFiles,
} from './workspace-files.js';

const pageState: FixPageSizeState & {
  pdfDoc: PDFDocument | null;
  isStandardizeDirty: boolean;
} = {
  file: null,
  pdfDoc: null,
  isStandardizeDirty: false,
};

let analyzedPagesData: AnalyzedPageData[] = [];

function markStandardizeDirty() {
  pageState.isStandardizeDirty = true;
  syncToolOutputToolbar();
}

function calculateAspectRatio(width: number, height: number): string {
  const ratio = width / height;
  return ratio.toFixed(3);
}

function calculateArea(width: number, height: number, unit: string): string {
  const areaInPoints = width * height;
  let convertedArea: number;
  let unitSuffix: string;

  switch (unit) {
    case 'in':
      convertedArea = areaInPoints / (72 * 72);
      unitSuffix = 'in²';
      break;
    case 'mm':
      convertedArea = (areaInPoints / (72 * 72)) * (25.4 * 25.4);
      unitSuffix = 'mm²';
      break;
    case 'px': {
      const pxPerPoint = 96 / 72;
      convertedArea = areaInPoints * (pxPerPoint * pxPerPoint);
      unitSuffix = 'px²';
      break;
    }
    default:
      convertedArea = areaInPoints;
      unitSuffix = 'pt²';
      break;
  }

  return `${convertedArea.toFixed(2)} ${unitSuffix}`;
}

function getSummaryStats() {
  const totalPages = analyzedPagesData.length;

  const uniqueSizes = new Map<string, UniqueSizeEntry>();
  analyzedPagesData.forEach((pageData) => {
    const key = `${pageData.width.toFixed(2)}x${pageData.height.toFixed(2)}`;
    const label = `${pageData.standardSize} (${pageData.orientation})`;
    uniqueSizes.set(key, {
      count: (uniqueSizes.get(key)?.count || 0) + 1,
      label,
      width: pageData.width,
      height: pageData.height,
    });
  });

  const hasMixedSizes = uniqueSizes.size > 1;

  return {
    totalPages,
    uniqueSizesCount: uniqueSizes.size,
    uniqueSizes: Array.from(uniqueSizes.values()),
    hasMixedSizes,
  };
}

function renderSummary() {
  const summaryContainer = document.getElementById('dimensions-summary');
  if (!summaryContainer) return;

  const stats = getSummaryStats();

  let summaryHTML = `
    <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
      <div class="bg-gray-900 border border-gray-700 rounded-lg p-4">
        <p class="text-sm text-gray-400 mb-1">Total Pages</p>
        <p class="text-2xl font-bold text-white">${stats.totalPages}</p>
      </div>
      <div class="bg-gray-900 border border-gray-700 rounded-lg p-4">
        <p class="text-sm text-gray-400 mb-1">Unique Page Sizes</p>
        <p class="text-2xl font-bold text-white">${stats.uniqueSizesCount}</p>
      </div>
      <div class="bg-gray-900 border border-gray-700 rounded-lg p-4">
        <p class="text-sm text-gray-400 mb-1">Document Type</p>
        <p class="text-2xl font-bold ${stats.hasMixedSizes ? 'text-yellow-400' : 'text-green-400'}">
          ${stats.hasMixedSizes ? 'Mixed Sizes' : 'Uniform'}
        </p>
      </div>
    </div>
  `;

  if (stats.hasMixedSizes) {
    summaryHTML += `
      <div class="bg-yellow-900/20 border border-yellow-500/30 rounded-lg p-4 mb-4">
        <div class="flex items-start gap-3">
          <i data-lucide="alert-triangle" class="w-5 h-5 text-yellow-400 mt-0.5 flex-shrink-0"></i>
          <div>
            <h4 class="text-yellow-200 font-semibold mb-2">Mixed Page Sizes Detected</h4>
            <p class="text-sm text-gray-300 mb-3">This document contains pages with different dimensions:</p>
            <ul class="space-y-1 text-sm text-gray-300">
              ${stats.uniqueSizes
                .map(
                  (size: UniqueSizeEntry) => `
                <li>• ${size.label}: ${size.count} page${size.count > 1 ? 's' : ''}</li>
              `
                )
                .join('')}
            </ul>
          </div>
        </div>
      </div>
    `;
  }

  summaryContainer.innerHTML = summaryHTML;

  if (stats.hasMixedSizes) {
    createIcons({ icons });
  }
}

function renderTable(unit: string) {
  const tableBody = document.getElementById('dimensions-table-body');
  if (!tableBody) return;

  tableBody.textContent = '';

  analyzedPagesData.forEach((pageData) => {
    const width = convertPoints(pageData.width, unit);
    const height = convertPoints(pageData.height, unit);
    const aspectRatio = calculateAspectRatio(pageData.width, pageData.height);
    const area = calculateArea(pageData.width, pageData.height, unit);

    const row = document.createElement('tr');

    const pageNumCell = document.createElement('td');
    pageNumCell.className = 'px-4 py-3 text-white';
    pageNumCell.textContent = String(pageData.pageNum);

    const dimensionsCell = document.createElement('td');
    dimensionsCell.className = 'px-4 py-3 text-gray-300';
    dimensionsCell.textContent = `${width} x ${height} ${unit}`;

    const sizeCell = document.createElement('td');
    sizeCell.className = 'px-4 py-3 text-gray-300';
    sizeCell.textContent = pageData.standardSize;

    const orientationCell = document.createElement('td');
    orientationCell.className = 'px-4 py-3 text-gray-300';
    orientationCell.textContent = pageData.orientation;

    const aspectRatioCell = document.createElement('td');
    aspectRatioCell.className = 'px-4 py-3 text-gray-300';
    aspectRatioCell.textContent = aspectRatio;

    const areaCell = document.createElement('td');
    areaCell.className = 'px-4 py-3 text-gray-300';
    areaCell.textContent = area;

    const rotationCell = document.createElement('td');
    rotationCell.className = 'px-4 py-3 text-gray-300';
    rotationCell.textContent = `${pageData.rotation}°`;

    row.append(
      pageNumCell,
      dimensionsCell,
      sizeCell,
      orientationCell,
      aspectRatioCell,
      areaCell,
      rotationCell
    );
    tableBody.appendChild(row);
  });
}

function exportToCSV() {
  const unitsSelect = document.getElementById(
    'units-select'
  ) as HTMLSelectElement | null;
  const unit = unitsSelect?.value || 'pt';

  const headers = [
    'Page #',
    `Width (${unit})`,
    `Height (${unit})`,
    'Standard Size',
    'Orientation',
    'Aspect Ratio',
    `Area (${unit}²)`,
    'Rotation',
  ];
  const csvRows = [headers.join(',')];

  analyzedPagesData.forEach((pageData) => {
    const width = convertPoints(pageData.width, unit);
    const height = convertPoints(pageData.height, unit);
    const aspectRatio = calculateAspectRatio(pageData.width, pageData.height);
    const area = calculateArea(pageData.width, pageData.height, unit);

    const row = [
      pageData.pageNum,
      width,
      height,
      pageData.standardSize,
      pageData.orientation,
      aspectRatio,
      area,
      `${pageData.rotation}°`,
    ];
    csvRows.push(row.join(','));
  });

  const csvContent = csvRows.join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  downloadBlob(blob, 'page-dimensions.csv');
}

function analyzeAndDisplayDimensions() {
  if (!pageState.pdfDoc) return;

  analyzedPagesData = [];
  const pages = pageState.pdfDoc.getPages();

  pages.forEach((page, index) => {
    const { width, height } = page.getSize();
    const rotation = page.getRotation().angle || 0;

    analyzedPagesData.push({
      pageNum: index + 1,
      width,
      height,
      orientation: width > height ? 'Landscape' : 'Portrait',
      standardSize: getStandardPageName(width, height),
      rotation,
    });
  });

  const resultsContainer = document.getElementById('dimensions-results');
  const unitsSelect = document.getElementById(
    'units-select'
  ) as HTMLSelectElement | null;

  renderSummary();
  renderTable(unitsSelect?.value || 'pt');

  resultsContainer?.classList.remove('hidden');
  createIcons({ icons });
}

function resetState() {
  pageState.file = null;
  pageState.pdfDoc = null;
  pageState.isStandardizeDirty = false;
  analyzedPagesData = [];

  const fileDisplayArea = document.getElementById('file-display-area');
  if (fileDisplayArea) fileDisplayArea.innerHTML = '';

  const toolOptions = document.getElementById('tool-options');
  if (toolOptions) toolOptions.classList.add('hidden');

  const resultsContainer = document.getElementById('dimensions-results');
  if (resultsContainer) resultsContainer.classList.add('hidden');

  const fileInput = document.getElementById('file-input') as HTMLInputElement;
  if (fileInput) fileInput.value = '';

  void clearWorkspaceOpenFile();
  syncToolOutputToolbar();
}

async function updateUI() {
  const fileDisplayArea = document.getElementById('file-display-area');
  const toolOptions = document.getElementById('tool-options');

  if (!fileDisplayArea) return;

  fileDisplayArea.innerHTML = '';

  if (pageState.file) {
    const fileDiv = document.createElement('div');
    fileDiv.className =
      'flex items-center justify-between bg-gray-700 p-3 rounded-lg text-sm';
    mountToolInputPreview(fileDiv, pageState.file);

    const infoContainer = document.createElement('div');
    infoContainer.className = 'flex flex-col overflow-hidden';

    const nameSpan = document.createElement('div');
    nameSpan.className = 'truncate font-medium text-gray-200 text-sm mb-1';
    nameSpan.textContent = pageState.file.name;

    const metaSpan = document.createElement('div');
    metaSpan.className = 'text-xs text-gray-400';
    const pageCount = pageState.pdfDoc?.getPageCount();
    metaSpan.textContent = pageCount
      ? `${formatBytes(pageState.file.size)} • ${pageCount} pages`
      : formatBytes(pageState.file.size);

    infoContainer.append(nameSpan, metaSpan);

    const removeBtn = document.createElement('button');
    removeBtn.className = 'ml-4 flex-shrink-0 shift-tool-file-remove';
    removeBtn.type = 'button';
    removeBtn.setAttribute('aria-label', `Remove ${pageState.file.name}`);
    removeBtn.title = `Remove ${pageState.file.name}`;
    removeBtn.innerHTML = '<i data-lucide="x" class="w-4 h-4"></i>';
    removeBtn.onclick = function () {
      resetState();
    };

    fileDiv.append(infoContainer, removeBtn);
    fileDisplayArea.appendChild(fileDiv);
    createIcons({ icons });

    if (toolOptions) toolOptions.classList.remove('hidden');
    setWorkspaceFiles([pageState.file]);
  } else {
    if (toolOptions) toolOptions.classList.add('hidden');
  }
  syncToolOutputToolbar();
}

async function handleFileSelect(files: FileList | File[] | null) {
  if (files && files.length > 0) {
    const file = files[0];
    if (
      file.type === 'application/pdf' ||
      file.name.toLowerCase().endsWith('.pdf')
    ) {
      try {
        const result = await loadPdfWithPasswordPrompt(file);
        if (!result) return;
        result.pdf.destroy();
        pageState.file = result.file;
        pageState.pdfDoc = await loadPdfDocument(result.bytes);
        pageState.isStandardizeDirty = false;
        analyzeAndDisplayDimensions();
        await updateUI();
      } catch (e) {
        console.error('Error loading PDF:', e);
        showAlert('Error', 'Failed to load PDF file.');
      }
    }
  }
}

async function fixPageSize() {
  if (!pageState.file) {
    showAlert('No File', 'Please upload a PDF file first.');
    return;
  }

  const targetSize = (
    document.getElementById('target-size') as HTMLSelectElement
  ).value;
  const orientation = (
    document.getElementById('orientation') as HTMLSelectElement
  ).value;
  const scalingMode = (
    document.querySelector(
      'input[name="scaling-mode"]:checked'
    ) as HTMLInputElement
  ).value;
  const backgroundColor = hexToRgb(
    (document.getElementById('background-color') as HTMLInputElement).value
  );
  showResultLoader('Standardizing pages...');

  try {
    const customWidth =
      parseFloat(
        (document.getElementById('custom-width') as HTMLInputElement)?.value
      ) || 210;
    const customHeight =
      parseFloat(
        (document.getElementById('custom-height') as HTMLInputElement)?.value
      ) || 297;
    const customUnits =
      (document.getElementById('custom-units') as HTMLSelectElement)?.value ||
      'mm';

    const arrayBuffer = await pageState.file.arrayBuffer();
    const pdfBytes = new Uint8Array(arrayBuffer);

    const newPdfBytes = await fixPageSizeCore(pdfBytes, {
      targetSize,
      orientation,
      scalingMode,
      backgroundColor,
      customWidth,
      customHeight,
      customUnits,
    });

    downloadFile(
      new Blob([new Uint8Array(newPdfBytes)], { type: 'application/pdf' }),
      pageState.file?.name || 'document.pdf'
    );
  } catch (e) {
    console.error(e);
    showAlert('Error', 'An error occurred while standardizing pages.');
  } finally {
    hideLoader();
  }
}

document.addEventListener('DOMContentLoaded', function () {
  pageState.file = null;
  pageState.pdfDoc = null;
  pageState.isStandardizeDirty = false;
  analyzedPagesData = [];

  applyLaunchContextToDom(document);

  const fileInput = document.getElementById('file-input') as HTMLInputElement;
  const dropZone = document.getElementById('drop-zone');
  const processBtn = document.getElementById('process-btn');
  const targetSizeSelect = document.getElementById('target-size');
  const customSizeWrapper = document.getElementById('custom-size-wrapper');
  const unitsSelect = document.getElementById(
    'units-select'
  ) as HTMLSelectElement | null;
  const exportCsvBtn = document.getElementById('export-csv-btn');

  if (targetSizeSelect && customSizeWrapper) {
    targetSizeSelect.addEventListener('change', function () {
      customSizeWrapper.classList.toggle(
        'hidden',
        (targetSizeSelect as HTMLSelectElement).value !== 'Custom'
      );
    });
  }

  for (const id of [
    'target-size',
    'custom-width',
    'custom-height',
    'custom-units',
    'orientation',
    'background-color',
  ]) {
    const el = document.getElementById(id);
    el?.addEventListener('input', markStandardizeDirty);
    el?.addEventListener('change', markStandardizeDirty);
  }

  document
    .querySelectorAll<HTMLInputElement>('input[name="scaling-mode"]')
    .forEach((radio) => {
      radio.addEventListener('change', markStandardizeDirty);
    });

  if (unitsSelect) {
    unitsSelect.addEventListener('change', (e) => {
      renderTable((e.target as HTMLSelectElement).value);
    });
  }

  if (exportCsvBtn) {
    exportCsvBtn.addEventListener('click', exportToCSV);
  }

  registerToolOutputSession({
    apply: () => fixPageSize(),
    reset: () => resetState(),
    canSave: () => {
      if (!pageState.file) return false;
      if (resolveLaunchContext().entryId === 'page-dimensions') {
        return pageState.isStandardizeDirty;
      }
      return true;
    },
    canDownload: () => Boolean(pageState.file),
    canPrint: () => Boolean(pageState.file),
    canReset: () => Boolean(pageState.file),
  });

  if (fileInput && dropZone) {
    fileInput.addEventListener('change', function (e) {
      void handleFileSelect((e.target as HTMLInputElement).files);
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
      const files = e.dataTransfer?.files;
      if (files && files.length > 0) {
        const pdfFiles = Array.from(files).filter(function (f) {
          return (
            f.type === 'application/pdf' ||
            f.name.toLowerCase().endsWith('.pdf')
          );
        });
        if (pdfFiles.length > 0) {
          void handleFileSelect([pdfFiles[0]]);
        }
      }
    });

    fileInput.addEventListener('click', function () {
      fileInput.value = '';
    });
  }

  if (processBtn) {
    processBtn.addEventListener('click', () => {
      void fixPageSize();
    });
  }

  onToolFilesSeeded(() => {
    if (fileInput?.files && fileInput.files.length > 0 && !pageState.file) {
      void handleFileSelect(fileInput.files);
    }
  });
});
