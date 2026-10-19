import { mountToolInputPreview } from './tool-input-preview.js';
import { createIcons, icons } from 'lucide';
import { showAlert, showLoader, hideLoader } from '../ui.js';
import { downloadFile, hexToRgb, formatBytes } from '../utils/helpers.js';
import { rgb, StandardFonts } from 'pdf-lib';
import JSZip from 'jszip';
import { loadPdfWithPasswordPrompt } from '../utils/password-prompt.js';
import {
  addPageNumbers as addPageNumbersToPdf,
  type PageNumberPosition,
  type PageNumberFormat,
  type PageNumberFontFamily,
} from '../utils/pdf-operations.js';
import { loadPdfDocument } from '../utils/load-pdf-document.js';
import { deduplicateFileName } from '../utils/deduplicate-filename.js';
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
import type { Position, StylePreset } from '@/types';

type NumberingMode = 'page-numbers' | 'header-footer' | 'bates';

interface LoadedPdfEntry {
  file: File;
  bytes: Uint8Array;
  pageCount: number;
}

const FONT_MAP: Record<string, PageNumberFontFamily> = {
  Helvetica: 'Helvetica',
  TimesRoman: 'TimesRoman',
  Courier: 'Courier',
};

const STYLE_PRESETS: Record<string, StylePreset> = {
  'full-6': {
    template: 'Exhibit [FILE] Case XYZ [BATES] Page [PAGE]',
    padding: 6,
  },
  'full-5': {
    template: 'Exhibit [FILE] Case XYZ [BATES] Page [PAGE]',
    padding: 5,
  },
  'full-4': {
    template: 'Exhibit [FILE] Case XYZ [BATES] Page [PAGE]',
    padding: 4,
  },
  'full-3': {
    template: 'Exhibit [FILE] Case XYZ [BATES] Page [PAGE]',
    padding: 3,
  },
  'full-0': {
    template: 'Exhibit [FILE] Case XYZ [BATES] Page [PAGE]',
    padding: 0,
  },
  'no-page-6': { template: 'Exhibit [FILE] Case XYZ [BATES]', padding: 6 },
  'no-page-5': { template: 'Exhibit [FILE] Case XYZ [BATES]', padding: 5 },
  'no-page-4': { template: 'Exhibit [FILE] Case XYZ [BATES]', padding: 4 },
  'no-page-3': { template: 'Exhibit [FILE] Case XYZ [BATES]', padding: 3 },
  'no-page-0': { template: 'Exhibit [FILE] Case XYZ [BATES]', padding: 0 },
  'case-6': { template: 'Case XYZ [BATES]', padding: 6 },
  'case-5': { template: 'Case XYZ [BATES]', padding: 5 },
  'case-4': { template: 'Case XYZ [BATES]', padding: 4 },
  'case-3': { template: 'Case XYZ [BATES]', padding: 3 },
  'case-0': { template: 'Case XYZ [BATES]', padding: 0 },
  'bates-6': { template: '[BATES]', padding: 6 },
  'bates-5': { template: '[BATES]', padding: 5 },
  'bates-4': { template: '[BATES]', padding: 4 },
  'bates-3': { template: '[BATES]', padding: 3 },
  'bates-0': { template: '[BATES]', padding: 0 },
};

const pageState: {
  entries: LoadedPdfEntry[];
  activeMode: NumberingMode;
} = {
  entries: [],
  activeMode: 'page-numbers',
};

function getInitialModeFromContext(): NumberingMode {
  const entryId = resolveLaunchContext().entryId;
  if (entryId === 'header-footer') return 'header-footer';
  if (entryId === 'bates-numbering') return 'bates';
  return 'page-numbers';
}

function entryIdForMode(mode: NumberingMode): string {
  if (mode === 'header-footer') return 'header-footer';
  if (mode === 'bates') return 'bates-numbering';
  return 'page-numbers';
}

function syncModeUI() {
  const modeButtons: Array<{ id: string; mode: NumberingMode }> = [
    { id: 'mode-page-numbers', mode: 'page-numbers' },
    { id: 'mode-header-footer', mode: 'header-footer' },
    { id: 'mode-bates', mode: 'bates' },
  ];

  for (const { id, mode } of modeButtons) {
    const btn = document.getElementById(id) as HTMLButtonElement | null;
    if (!btn) continue;
    const isActive = pageState.activeMode === mode;
    btn.setAttribute('aria-pressed', String(isActive));
    btn.classList.toggle('bg-indigo-600', isActive);
    btn.classList.toggle('text-white', isActive);
    btn.classList.toggle('text-gray-300', !isActive);
  }

  document
    .getElementById('page-numbers-options')
    ?.classList.toggle('hidden', pageState.activeMode !== 'page-numbers');
  document
    .getElementById('header-footer-options')
    ?.classList.toggle('hidden', pageState.activeMode !== 'header-footer');
  document
    .getElementById('bates-options')
    ?.classList.toggle('hidden', pageState.activeMode !== 'bates');

  const processBtn = document.getElementById('process-btn');
  if (processBtn) {
    if (pageState.activeMode === 'header-footer') {
      processBtn.textContent = 'Add Header & Footer';
    } else if (pageState.activeMode === 'bates') {
      processBtn.textContent = 'Apply Bates Numbers';
    } else {
      processBtn.textContent = 'Add Page Numbers';
    }
  }

  updatePreview();
  syncToolOutputToolbar();
}

function setMode(mode: NumberingMode) {
  pageState.activeMode = mode;
  setLaunchContext(entryIdForMode(mode));
  syncModeUI();
}

function getActivePadding(): number {
  const presetEl = document.getElementById(
    'style-preset'
  ) as HTMLSelectElement | null;
  const presetValue = presetEl?.value ?? 'bates-6';
  if (presetValue !== 'custom' && STYLE_PRESETS[presetValue]) {
    return STYLE_PRESETS[presetValue].padding;
  }
  return (
    parseInt(
      (document.getElementById('bates-padding') as HTMLSelectElement | null)
        ?.value || '0'
    ) || 0
  );
}

function formatBatesText(
  template: string,
  batesNum: number,
  pageNum: number,
  fileNum: number,
  fileName: string,
  padding: number
): string {
  const batesStr =
    padding > 0 ? String(batesNum).padStart(padding, '0') : String(batesNum);
  return template
    .replace(/\[BATES\]/g, batesStr)
    .replace(/\[PAGE\]/g, String(pageNum))
    .replace(/\[FILE\]/g, String(fileNum))
    .replace(/\[FILENAME\]/g, fileName);
}

function getHeaderFooterTexts() {
  return {
    headerLeft:
      (document.getElementById('header-left') as HTMLInputElement | null)
        ?.value || '',
    headerCenter:
      (document.getElementById('header-center') as HTMLInputElement | null)
        ?.value || '',
    headerRight:
      (document.getElementById('header-right') as HTMLInputElement | null)
        ?.value || '',
    footerLeft:
      (document.getElementById('footer-left') as HTMLInputElement | null)
        ?.value || '',
    footerCenter:
      (document.getElementById('footer-center') as HTMLInputElement | null)
        ?.value || '',
    footerRight:
      (document.getElementById('footer-right') as HTMLInputElement | null)
        ?.value || '',
  };
}

function updatePreview() {
  const previewContent =
    document.getElementById('preview-content') ??
    document.getElementById('stamp-preview');
  if (!previewContent) return;

  const firstPageCount = pageState.entries[0]?.pageCount ?? 5;

  if (pageState.activeMode === 'page-numbers') {
    const formatVal =
      (document.getElementById('number-format') as HTMLSelectElement | null)
        ?.value || 'page_only';
    const startNum =
      parseInt(
        (document.getElementById('starting-number') as HTMLInputElement | null)
          ?.value || '1'
      ) || 1;
    const totalDisplay = firstPageCount + startNum - 1;
    const p1 =
      formatVal === 'page_x_of_y'
        ? `${startNum} / ${totalDisplay}`
        : `${startNum}`;
    const p2 =
      formatVal === 'page_x_of_y'
        ? `${startNum + 1} / ${totalDisplay}`
        : `${startNum + 1}`;
    previewContent.textContent = `Page 1: ${p1}\nPage 2: ${p2}`;
    return;
  }

  if (pageState.activeMode === 'header-footer') {
    const texts = getHeaderFooterTexts();
    const resolveTokens = (t: string, pageNum: number, total: number) =>
      t.replace(/{page}/g, String(pageNum)).replace(/{total}/g, String(total));

    const headerParts = [
      resolveTokens(texts.headerLeft, 1, firstPageCount),
      resolveTokens(texts.headerCenter, 1, firstPageCount),
      resolveTokens(texts.headerRight, 1, firstPageCount),
    ].filter(Boolean);
    const footerParts = [
      resolveTokens(texts.footerLeft, 1, firstPageCount),
      resolveTokens(texts.footerCenter, 1, firstPageCount),
      resolveTokens(texts.footerRight, 1, firstPageCount),
    ].filter(Boolean);

    const lines: string[] = [];
    if (headerParts.length > 0) {
      lines.push(`Header: ${headerParts.join(' | ')}`);
    }
    if (footerParts.length > 0) {
      lines.push(`Footer: ${footerParts.join(' | ')}`);
    }
    previewContent.textContent =
      lines.length > 0 ? lines.join('\n') : 'Enter header or footer text above';
    return;
  }

  // Bates mode
  const template =
    (document.getElementById('bates-template') as HTMLInputElement | null)
      ?.value || '[BATES]';
  const padding = getActivePadding();
  const batesStart =
    parseInt(
      (document.getElementById('bates-start') as HTMLInputElement | null)
        ?.value || '1'
    ) || 1;
  const fileStart =
    parseInt(
      (document.getElementById('file-start') as HTMLInputElement | null)
        ?.value || '1'
    ) || 1;

  const lines: string[] = [];
  if (pageState.entries.length === 0) {
    lines.push(
      formatBatesText(template, batesStart, 1, fileStart, 'document', padding)
    );
    lines.push(
      formatBatesText(
        template,
        batesStart + 1,
        2,
        fileStart,
        'document',
        padding
      )
    );
  } else {
    let batesCounter = batesStart;
    let fileCounter = fileStart;
    for (const entry of pageState.entries) {
      const name = entry.file.name.replace(/\.pdf$/i, '');
      lines.push(
        `File ${fileCounter}, Page 1: ${formatBatesText(template, batesCounter, 1, fileCounter, name, padding)}`
      );
      if (entry.pageCount > 1) {
        lines.push(
          `File ${fileCounter}, Page 2: ${formatBatesText(template, batesCounter + 1, 2, fileCounter, name, padding)}`
        );
      }
      batesCounter += entry.pageCount;
      fileCounter++;
    }
    const lastEntry = pageState.entries[pageState.entries.length - 1];
    const lastName = lastEntry.file.name.replace(/\.pdf$/i, '');
    const lastBates = batesCounter - 1;
    lines.push('...');
    lines.push(
      `File ${fileStart + pageState.entries.length - 1}, Page ${lastEntry.pageCount}: ${formatBatesText(template, lastBates, lastEntry.pageCount, fileStart + pageState.entries.length - 1, lastName, padding)}`
    );
  }

  previewContent.textContent = lines.join('\n');
}

function calculatePosition(
  pageWidth: number,
  pageHeight: number,
  xOffset: number,
  yOffset: number,
  textWidth: number,
  fontSize: number,
  position: Position
): { x: number; y: number } {
  const minMargin = 8;
  const maxMargin = 40;
  const marginPct = 0.04;

  const hMargin = Math.max(
    minMargin,
    Math.min(maxMargin, pageWidth * marginPct)
  );
  const vMargin = Math.max(
    minMargin,
    Math.min(maxMargin, pageHeight * marginPct)
  );
  const safeH = Math.max(hMargin, textWidth / 2 + 3);
  const safeV = Math.max(vMargin, fontSize + 3);

  let x = 0,
    y = 0;

  switch (position) {
    case 'bottom-center':
      x =
        Math.max(
          safeH,
          Math.min(pageWidth - safeH - textWidth, (pageWidth - textWidth) / 2)
        ) + xOffset;
      y = safeV + yOffset;
      break;
    case 'bottom-left':
      x = safeH + xOffset;
      y = safeV + yOffset;
      break;
    case 'bottom-right':
      x = Math.max(safeH, pageWidth - safeH - textWidth) + xOffset;
      y = safeV + yOffset;
      break;
    case 'top-center':
      x =
        Math.max(
          safeH,
          Math.min(pageWidth - safeH - textWidth, (pageWidth - textWidth) / 2)
        ) + xOffset;
      y = pageHeight - safeV - fontSize + yOffset;
      break;
    case 'top-left':
      x = safeH + xOffset;
      y = pageHeight - safeV - fontSize + yOffset;
      break;
    case 'top-right':
      x = Math.max(safeH, pageWidth - safeH - textWidth) + xOffset;
      y = pageHeight - safeV - fontSize + yOffset;
      break;
  }

  x = Math.max(xOffset + 3, Math.min(xOffset + pageWidth - textWidth - 3, x));
  y = Math.max(yOffset + 3, Math.min(yOffset + pageHeight - fontSize - 3, y));

  return { x, y };
}

function updateFileDisplay() {
  const fileDisplayArea = document.getElementById('file-display-area');
  const optionsPanel = document.getElementById('options-panel');
  const fileControls = document.getElementById('file-controls');
  const totalPagesSpan = document.getElementById('total-pages');

  if (!fileDisplayArea) return;
  fileDisplayArea.innerHTML = '';

  let totalPages = 0;

  if (pageState.entries.length > 0) {
    pageState.entries.forEach((entry, index) => {
      totalPages += entry.pageCount;

      const fileDiv = document.createElement('div');
      fileDiv.className =
        'flex items-center justify-between bg-gray-700 p-3 rounded-lg';
      mountToolInputPreview(fileDiv, entry.file);

      const infoContainer = document.createElement('div');
      infoContainer.className = 'flex flex-col flex-1 min-w-0';

      const nameSpan = document.createElement('div');
      nameSpan.className = 'truncate font-medium text-gray-200 text-sm mb-1';
      nameSpan.textContent = entry.file.name;

      const metaSpan = document.createElement('div');
      metaSpan.className = 'text-xs text-gray-400';
      metaSpan.textContent = `${formatBytes(entry.file.size)} • ${entry.pageCount} pages`;

      infoContainer.append(nameSpan, metaSpan);

      const removeBtn = document.createElement('button');
      removeBtn.className = 'ml-4 flex-shrink-0 shift-tool-file-remove';
      removeBtn.type = 'button';
      removeBtn.setAttribute('aria-label', `Remove ${entry.file.name}`);
      removeBtn.title = `Remove ${entry.file.name}`;
      removeBtn.innerHTML = '<i data-lucide="x" class="w-4 h-4"></i>';
      removeBtn.onclick = () => {
        pageState.entries.splice(index, 1);
        if (pageState.entries.length === 0) {
          resetState();
        } else {
          updateFileDisplay();
          updatePreview();
        }
      };

      fileDiv.append(infoContainer, removeBtn);
      fileDisplayArea.appendChild(fileDiv);
    });

    createIcons({ icons });
    optionsPanel?.classList.remove('hidden');
    fileControls?.classList.remove('hidden');
    const maxEntryPages = Math.max(
      ...pageState.entries.map((e) => e.pageCount)
    );
    if (totalPagesSpan) {
      totalPagesSpan.textContent =
        pageState.entries.length === 1
          ? String(totalPages)
          : `${maxEntryPages} per file (${totalPages} total)`;
    }
    setWorkspaceFiles(pageState.entries.map((e) => e.file));
  } else {
    optionsPanel?.classList.add('hidden');
    fileControls?.classList.add('hidden');
    if (totalPagesSpan) totalPagesSpan.textContent = '0';
  }
  syncToolOutputToolbar();
}

function resolveBatchEntryPageIndices(
  rangeString: string,
  entryPageCount: number
): number[] {
  const trimmed = rangeString.trim();
  if (!trimmed) {
    return Array.from({ length: entryPageCount }, (_, i) => i);
  }

  const indices = new Set<number>();
  const parts = trimmed.split(',');

  for (const part of parts) {
    const token = part.trim();
    if (!token) continue;
    if (token.includes('-')) {
      const [start, end] = token.split('-').map(Number);
      if (isNaN(start) || isNaN(end) || start < 1 || start > end) {
        continue;
      }
      if (start > entryPageCount) {
        continue;
      }
      const clampedEnd = Math.min(end, entryPageCount);
      for (let p = start; p <= clampedEnd; p++) {
        indices.add(p - 1);
      }
    } else {
      const pageNum = Number(token);
      if (!isNaN(pageNum) && pageNum >= 1 && pageNum <= entryPageCount) {
        indices.add(pageNum - 1);
      }
    }
  }

  return Array.from(indices).sort((a, b) => a - b);
}

function validateBatchPageRangeOrThrow(pageRangeInput: string): void {
  const trimmed = pageRangeInput.trim();
  if (!trimmed) return;
  const anyMatched = pageState.entries.some(
    (entry) => resolveBatchEntryPageIndices(trimmed, entry.pageCount).length > 0
  );
  if (!anyMatched) {
    throw new Error('Invalid page range specified.');
  }
}

function resetState() {
  pageState.entries = [];
  const fileDisplayArea = document.getElementById('file-display-area');
  if (fileDisplayArea) fileDisplayArea.innerHTML = '';
  document.getElementById('options-panel')?.classList.add('hidden');
  document.getElementById('file-controls')?.classList.add('hidden');
  const fileInput = document.getElementById('file-input') as HTMLInputElement;
  if (fileInput) fileInput.value = '';
  void clearWorkspaceOpenFile();
  updatePreview();
  syncToolOutputToolbar();
}

async function handleFiles(fileList: FileList | File[]) {
  const candidates = Array.from(fileList).filter(
    (f) => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf')
  );
  if (candidates.length === 0) {
    showAlert('Invalid File', 'Please upload a valid PDF file.');
    return;
  }

  try {
    showLoader('Loading PDF...');
    for (const file of candidates) {
      hideLoader();
      const result = await loadPdfWithPasswordPrompt(file);
      if (!result) continue;
      showLoader('Loading PDF...');
      result.pdf.destroy();
      const bytes = new Uint8Array(result.bytes);
      const pdfDoc = await loadPdfDocument(bytes);
      pageState.entries.push({
        file: result.file,
        bytes,
        pageCount: pdfDoc.getPageCount(),
      });
    }
    updateFileDisplay();
    updatePreview();
  } catch (error) {
    console.error(error);
    showAlert('Error', 'Failed to load PDF file.');
  } finally {
    hideLoader();
  }
}

async function applyPageNumbersBatch(
  position: PageNumberPosition,
  fontFamily: PageNumberFontFamily,
  fontSize: number,
  textColor: { r: number; g: number; b: number },
  pageRangeInput: string
): Promise<{ name: string; bytes: Uint8Array }[]> {
  const format =
    (document.getElementById('number-format') as HTMLSelectElement | null)
      ?.value === 'page_x_of_y'
      ? ('page_x_of_y' as PageNumberFormat)
      : ('simple' as PageNumberFormat);
  const startingNumber =
    parseInt(
      (document.getElementById('starting-number') as HTMLInputElement | null)
        ?.value || '1'
    ) || 1;

  validateBatchPageRangeOrThrow(pageRangeInput);
  const outputs: { name: string; bytes: Uint8Array }[] = [];

  for (const entry of pageState.entries) {
    const pageIndices = pageRangeInput.trim()
      ? resolveBatchEntryPageIndices(pageRangeInput, entry.pageCount)
      : undefined;
    const resultBytes = await addPageNumbersToPdf(entry.bytes, {
      position,
      fontSize,
      format,
      color: textColor,
      fontFamily,
      startingNumber,
      pageIndices,
    });
    outputs.push({ name: entry.file.name, bytes: resultBytes });
  }

  return outputs;
}

async function applyHeaderFooterBatch(
  fontFamily: PageNumberFontFamily,
  fontSize: number,
  textColor: { r: number; g: number; b: number },
  pageRangeInput: string
): Promise<{ name: string; bytes: Uint8Array }[]> {
  validateBatchPageRangeOrThrow(pageRangeInput);
  const texts = getHeaderFooterTexts();
  const margin = 40;
  const outputs: { name: string; bytes: Uint8Array }[] = [];

  for (const entry of pageState.entries) {
    const pdfDoc = await loadPdfDocument(entry.bytes);
    const font = await pdfDoc.embedFont(StandardFonts[fontFamily]);
    const allPages = pdfDoc.getPages();
    const totalPages = allPages.length;
    const indicesToProcess = resolveBatchEntryPageIndices(
      pageRangeInput,
      totalPages
    );

    const drawOptions = {
      font,
      size: fontSize,
      color: rgb(textColor.r, textColor.g, textColor.b),
    };

    for (const pageIndex of indicesToProcess) {
      const page = allPages[pageIndex];
      const { width, height } = page.getSize();
      const pageNumber = pageIndex + 1;
      const processText = (text: string) =>
        text
          .replace(/{page}/g, String(pageNumber))
          .replace(/{total}/g, String(totalPages));
      const processed = {
        headerLeft: processText(texts.headerLeft),
        headerCenter: processText(texts.headerCenter),
        headerRight: processText(texts.headerRight),
        footerLeft: processText(texts.footerLeft),
        footerCenter: processText(texts.footerCenter),
        footerRight: processText(texts.footerRight),
      };
      if (processed.headerLeft) {
        page.drawText(processed.headerLeft, {
          ...drawOptions,
          x: margin,
          y: height - margin,
        });
      }
      if (processed.headerCenter) {
        page.drawText(processed.headerCenter, {
          ...drawOptions,
          x:
            width / 2 -
            font.widthOfTextAtSize(processed.headerCenter, fontSize) / 2,
          y: height - margin,
        });
      }
      if (processed.headerRight) {
        page.drawText(processed.headerRight, {
          ...drawOptions,
          x:
            width -
            margin -
            font.widthOfTextAtSize(processed.headerRight, fontSize),
          y: height - margin,
        });
      }
      if (processed.footerLeft) {
        page.drawText(processed.footerLeft, {
          ...drawOptions,
          x: margin,
          y: margin,
        });
      }
      if (processed.footerCenter) {
        page.drawText(processed.footerCenter, {
          ...drawOptions,
          x:
            width / 2 -
            font.widthOfTextAtSize(processed.footerCenter, fontSize) / 2,
          y: margin,
        });
      }
      if (processed.footerRight) {
        page.drawText(processed.footerRight, {
          ...drawOptions,
          x:
            width -
            margin -
            font.widthOfTextAtSize(processed.footerRight, fontSize),
          y: margin,
        });
      }
    }

    outputs.push({
      name: entry.file.name,
      bytes: new Uint8Array(await pdfDoc.save()),
    });
  }

  return outputs;
}

async function applyBatesBatch(
  position: Position,
  fontFamily: PageNumberFontFamily,
  fontSize: number,
  textColor: { r: number; g: number; b: number },
  pageRangeInput: string
): Promise<{ name: string; bytes: Uint8Array }[]> {
  const template =
    (document.getElementById('bates-template') as HTMLInputElement | null)
      ?.value || '[BATES]';
  const padding = getActivePadding();
  const batesStart =
    parseInt(
      (document.getElementById('bates-start') as HTMLInputElement | null)
        ?.value || '1'
    ) || 1;
  const fileStart =
    parseInt(
      (document.getElementById('file-start') as HTMLInputElement | null)
        ?.value || '1'
    ) || 1;

  validateBatchPageRangeOrThrow(pageRangeInput);
  const outputs: { name: string; bytes: Uint8Array }[] = [];
  let batesCounter = batesStart;
  let fileCounter = fileStart;

  for (const entry of pageState.entries) {
    const pdfDoc = await loadPdfDocument(entry.bytes);
    const font = await pdfDoc.embedFont(StandardFonts[fontFamily]);
    const pages = pdfDoc.getPages();
    const fileName = entry.file.name.replace(/\.pdf$/i, '');
    const allowedIndices = pageRangeInput.trim()
      ? new Set(resolveBatchEntryPageIndices(pageRangeInput, pages.length))
      : null;

    for (let i = 0; i < pages.length; i++) {
      if (allowedIndices && !allowedIndices.has(i)) continue;
      const page = pages[i];
      const bounds = page.getCropBox() || page.getMediaBox();
      const text = formatBatesText(
        template,
        batesCounter,
        i + 1,
        fileCounter,
        fileName,
        padding
      );
      const textWidth = font.widthOfTextAtSize(text, fontSize);

      const { x, y } = calculatePosition(
        bounds.width,
        bounds.height,
        bounds.x || 0,
        bounds.y || 0,
        textWidth,
        fontSize,
        position
      );

      page.drawText(text, {
        x,
        y,
        font,
        size: fontSize,
        color: rgb(textColor.r, textColor.g, textColor.b),
      });

      batesCounter++;
    }

    fileCounter++;
    outputs.push({
      name: entry.file.name,
      bytes: new Uint8Array(await pdfDoc.save()),
    });
  }

  return outputs;
}

async function processNumbering() {
  if (pageState.entries.length === 0) {
    showAlert('Error', 'Please upload at least one PDF file first.');
    return;
  }

  showLoader('Applying numbering...');
  try {
    const position = ((
      document.getElementById('position') as HTMLSelectElement | null
    )?.value || 'bottom-center') as PageNumberPosition;
    const fontKey =
      (document.getElementById('font-family') as HTMLSelectElement | null)
        ?.value || 'Helvetica';
    const fontFamily: PageNumberFontFamily = FONT_MAP[fontKey] || 'Helvetica';
    const fontSize =
      parseInt(
        (document.getElementById('font-size') as HTMLInputElement | null)
          ?.value || '12'
      ) || 12;
    const colorHex =
      (document.getElementById('text-color') as HTMLInputElement | null)
        ?.value || '#000000';
    const textColor = hexToRgb(colorHex);
    const pageRangeInput =
      (document.getElementById('page-range') as HTMLInputElement | null)
        ?.value || '';

    let results: { name: string; bytes: Uint8Array }[];
    if (pageState.activeMode === 'header-footer') {
      results = await applyHeaderFooterBatch(
        fontFamily,
        fontSize,
        textColor,
        pageRangeInput
      );
    } else if (pageState.activeMode === 'bates') {
      results = await applyBatesBatch(
        position,
        fontFamily,
        fontSize,
        textColor,
        pageRangeInput
      );
    } else {
      results = await applyPageNumbersBatch(
        position,
        fontFamily,
        fontSize,
        textColor,
        pageRangeInput
      );
    }

    if (results.length === 1) {
      downloadFile(
        new Blob([new Uint8Array(results[0].bytes)], {
          type: 'application/pdf',
        }),
        results[0].name
      );
    } else if (results.length > 1) {
      const zip = new JSZip();
      const usedNames = new Set<string>();
      for (const item of results) {
        const entryName = deduplicateFileName(item.name, usedNames);
        zip.file(entryName, item.bytes);
      }
      const zipBlob = await zip.generateAsync({ type: 'blob' });
      const zipName =
        pageState.activeMode === 'bates'
          ? 'bates_numbered.zip'
          : pageState.activeMode === 'header-footer'
            ? 'header_footer_pdfs.zip'
            : 'numbered_pdfs.zip';
      downloadFile(zipBlob, zipName);
    }
  } catch (e) {
    console.error(e);
    showAlert(
      'Error',
      e instanceof Error ? e.message : 'Could not apply numbering.'
    );
  } finally {
    hideLoader();
  }
}

function resolveOutputKind(): ToolOutputKind {
  return pageState.entries.length > 1 ? 'multi-pdf-zip' : 'pdf';
}

function initializePage() {
  pageState.entries = [];
  applyLaunchContextToDom(document);
  pageState.activeMode = getInitialModeFromContext();
  createIcons({ icons });

  const fileInput = document.getElementById('file-input') as HTMLInputElement;
  const dropZone = document.getElementById('drop-zone');
  const processBtn = document.getElementById('process-btn');
  const addMoreBtn = document.getElementById('add-more-btn');
  const clearFilesBtn = document.getElementById('clear-files-btn');
  const stylePreset = document.getElementById(
    'style-preset'
  ) as HTMLSelectElement | null;
  const templateInput = document.getElementById(
    'bates-template'
  ) as HTMLInputElement | null;

  document
    .getElementById('mode-page-numbers')
    ?.addEventListener('click', () => setMode('page-numbers'));
  document
    .getElementById('mode-header-footer')
    ?.addEventListener('click', () => setMode('header-footer'));
  document
    .getElementById('mode-bates')
    ?.addEventListener('click', () => setMode('bates'));

  if (stylePreset && templateInput) {
    stylePreset.addEventListener('change', () => {
      const value = stylePreset.value;
      const isCustom = value === 'custom';
      const paddingGroup = document.getElementById('padding-group');
      if (!isCustom && STYLE_PRESETS[value]) {
        templateInput.value = STYLE_PRESETS[value].template;
        paddingGroup?.classList.add('hidden');
      } else {
        paddingGroup?.classList.remove('hidden');
      }
      templateInput.readOnly = !isCustom;
      updatePreview();
    });

    templateInput.addEventListener('input', () => {
      if (stylePreset.value !== 'custom') {
        stylePreset.value = 'custom';
        templateInput.readOnly = false;
        document.getElementById('padding-group')?.classList.remove('hidden');
      }
      updatePreview();
    });
  }

  for (const id of [
    'number-format',
    'starting-number',
    'header-left',
    'header-center',
    'header-right',
    'footer-left',
    'footer-center',
    'footer-right',
    'bates-padding',
    'bates-start',
    'file-start',
    'position',
    'font-family',
    'font-size',
    'text-color',
    'page-range',
  ]) {
    const el = document.getElementById(id);
    el?.addEventListener('input', () => {
      updatePreview();
      syncToolOutputToolbar();
    });
    el?.addEventListener('change', () => {
      updatePreview();
      syncToolOutputToolbar();
    });
  }

  syncModeUI();

  registerToolOutputSession({
    apply: () => processNumbering(),
    reset: () => resetState(),
    canSave: () => pageState.entries.length > 0,
    canReset: () => pageState.entries.length > 0,
    outputKind: resolveOutputKind,
  });

  if (fileInput) {
    fileInput.addEventListener('change', (e) => {
      const input = e.target as HTMLInputElement;
      if (input.files?.length) {
        void handleFiles(input.files);
      }
    });
    fileInput.addEventListener('click', () => {
      fileInput.value = '';
    });
  }

  if (dropZone) {
    dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropZone.classList.add('border-indigo-500');
    });

    dropZone.addEventListener('dragleave', () => {
      dropZone.classList.remove('border-indigo-500');
    });

    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.classList.remove('border-indigo-500');
      if (e.dataTransfer?.files.length) {
        void handleFiles(e.dataTransfer.files);
      }
    });
  }

  if (addMoreBtn && fileInput) {
    addMoreBtn.addEventListener('click', () => {
      fileInput.value = '';
      fileInput.click();
    });
  }

  if (clearFilesBtn) {
    clearFilesBtn.addEventListener('click', resetState);
  }

  if (processBtn) {
    processBtn.addEventListener('click', () => {
      void processNumbering();
    });
  }

  onToolFilesSeeded(() => {
    if (
      fileInput?.files &&
      fileInput.files.length > 0 &&
      pageState.entries.length === 0
    ) {
      void handleFiles(fileInput.files);
    }
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializePage);
} else {
  initializePage();
}
