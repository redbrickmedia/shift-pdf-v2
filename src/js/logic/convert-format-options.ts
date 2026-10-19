import { IMAGE_TO_PDF_DESTINATION_ID_SET } from '../config/convert-destinations.js';
import type { ImageQuality } from '../utils/image-compress.js';

export const CONVERT_FORMAT_OPTIONS_ID = 'convert-format-options';
export const OPEN_DEDICATED_EDITOR_BTN_ID = 'open-dedicated-editor-btn';

export type ImageCombineMode = 'combine' | 'separate';
export type ExtractTablesFormat = 'csv' | 'xlsx' | 'json' | 'md';

export type ConvertFormatOptions = {
  imageQuality: ImageQuality;
  imageCombineMode: ImageCombineMode;
  emailPageSize: 'a4' | 'letter' | 'legal';
  emailIncludeCcBcc: boolean;
  emailIncludeAttachments: boolean;
  jpgQuality: number;
  webpQuality: number;
  imageScale: number;
  pngScale: number;
  tiffDpi: number;
  tiffCompression: string;
  tiffColorMode: string;
  tiffMultiPage: boolean;
  includeImages: boolean;
  extractTablesFormat: ExtractTablesFormat;
};

export function createDefaultConvertFormatOptions(): ConvertFormatOptions {
  return {
    imageQuality: 'medium',
    imageCombineMode: 'combine',
    emailPageSize: 'a4',
    emailIncludeCcBcc: true,
    emailIncludeAttachments: true,
    jpgQuality: 0.9,
    webpQuality: 0.85,
    imageScale: 2,
    pngScale: 2.0,
    tiffDpi: 300,
    tiffCompression: 'lzw',
    tiffColorMode: 'rgb',
    tiffMultiPage: false,
    includeImages: false,
    extractTablesFormat: 'csv',
  };
}

function normalizeQualityFraction(
  raw: string | undefined,
  fallback: number
): number {
  if (!raw) return fallback;
  const parsed = Number.parseFloat(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  if (parsed > 1) return Math.min(1, Math.max(0.1, parsed / 100));
  return Math.min(1, Math.max(0.1, parsed));
}

export function readConvertFormatOptionsFromDom(
  root: Document = document,
  fallback: ConvertFormatOptions = createDefaultConvertFormatOptions()
): ConvertFormatOptions {
  const next: ConvertFormatOptions = { ...fallback };

  const jpgPdfQuality = root.getElementById(
    'jpg-pdf-quality'
  ) as HTMLSelectElement | null;
  if (
    jpgPdfQuality &&
    (jpgPdfQuality.value === 'high' ||
      jpgPdfQuality.value === 'medium' ||
      jpgPdfQuality.value === 'low')
  ) {
    next.imageQuality = jpgPdfQuality.value;
  }

  const combineMode = root.getElementById(
    'image-combine-mode'
  ) as HTMLSelectElement | null;
  if (
    combineMode &&
    (combineMode.value === 'combine' || combineMode.value === 'separate')
  ) {
    next.imageCombineMode = combineMode.value;
  }

  const pageSize = root.getElementById('page-size') as HTMLSelectElement | null;
  if (
    pageSize &&
    (pageSize.value === 'a4' ||
      pageSize.value === 'letter' ||
      pageSize.value === 'legal')
  ) {
    next.emailPageSize = pageSize.value;
  }

  const includeCcBcc = root.getElementById(
    'include-cc-bcc'
  ) as HTMLInputElement | null;
  if (includeCcBcc) {
    next.emailIncludeCcBcc = includeCcBcc.checked;
  }

  const includeAttachments = root.getElementById(
    'include-attachments'
  ) as HTMLInputElement | null;
  if (includeAttachments) {
    next.emailIncludeAttachments = includeAttachments.checked;
  }

  const jpgQuality = root.getElementById(
    'jpg-quality'
  ) as HTMLInputElement | null;
  if (jpgQuality) {
    next.jpgQuality = normalizeQualityFraction(
      jpgQuality.value,
      fallback.jpgQuality
    );
  }

  const webpQuality = root.getElementById(
    'webp-quality'
  ) as HTMLInputElement | null;
  if (webpQuality) {
    next.webpQuality = normalizeQualityFraction(
      webpQuality.value,
      fallback.webpQuality
    );
  }

  const imageScale = root.getElementById(
    'image-scale'
  ) as HTMLSelectElement | null;
  if (imageScale) {
    const parsed = Number.parseFloat(imageScale.value);
    if (Number.isFinite(parsed) && parsed > 0) {
      next.imageScale = parsed;
    }
  }

  const pngScale = root.getElementById('png-scale') as HTMLInputElement | null;
  if (pngScale) {
    const parsed = Number.parseFloat(pngScale.value);
    if (Number.isFinite(parsed) && parsed > 0) {
      next.pngScale = parsed;
    }
  }

  const tiffDpi = root.getElementById('tiff-dpi') as
    | HTMLSelectElement
    | HTMLInputElement
    | null;
  if (tiffDpi) {
    const parsed = Number.parseInt(tiffDpi.value, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      next.tiffDpi = parsed;
    }
  }

  const tiffCompression = root.getElementById(
    'tiff-compression'
  ) as HTMLSelectElement | null;
  if (tiffCompression && tiffCompression.value) {
    next.tiffCompression = tiffCompression.value.toLowerCase();
  }

  const tiffColorMode = root.getElementById(
    'tiff-color-mode'
  ) as HTMLSelectElement | null;
  if (tiffColorMode && tiffColorMode.value) {
    next.tiffColorMode = tiffColorMode.value.toLowerCase();
  }

  const tiffMultiPage = root.getElementById(
    'tiff-multipage'
  ) as HTMLInputElement | null;
  if (tiffMultiPage) {
    next.tiffMultiPage = tiffMultiPage.checked;
  }

  const includeImages = root.getElementById(
    'include-images'
  ) as HTMLInputElement | null;
  if (includeImages) {
    next.includeImages = includeImages.checked;
  }

  const exportFormat = root.getElementById(
    'export-format'
  ) as HTMLSelectElement | null;
  if (exportFormat && exportFormat.value) {
    const val = exportFormat.value.toLowerCase();
    if (val === 'csv' || val === 'xlsx' || val === 'json' || val === 'md') {
      next.extractTablesFormat = val;
    } else if (val === 'markdown') {
      next.extractTablesFormat = 'md';
    }
  }

  return next;
}

export function ensureConvertFormatOptionsContainer(
  root: Document
): HTMLElement | null {
  const existing = root.getElementById(CONVERT_FORMAT_OPTIONS_ID);
  if (existing) return existing;

  const destinationStep = root.getElementById('convert-destination-step');
  if (!destinationStep) return null;

  const container = root.createElement('div');
  container.id = CONVERT_FORMAT_OPTIONS_ID;
  container.className = 'hidden mt-6 space-y-4';

  const unsupported = root.getElementById('convert-unsupported-message');
  if (unsupported && unsupported.parentElement === destinationStep) {
    destinationStep.insertBefore(container, unsupported);
  } else {
    destinationStep.appendChild(container);
  }
  return container;
}

export function renderConvertFormatOptions(
  root: Document,
  params: {
    destinationId: string | null;
    sourceFiles: File[];
    options: ConvertFormatOptions;
    onOptionsChange: (next: ConvertFormatOptions) => void;
    onOpenDedicatedEditor?: (
      editorId: 'txt-to-pdf' | 'markdown-to-pdf'
    ) => void;
  }
): void {
  const container = ensureConvertFormatOptionsContainer(root);
  if (!container) return;

  const { destinationId, sourceFiles, options } = params;
  container.replaceChildren();

  if (!destinationId || sourceFiles.length === 0) {
    container.classList.add('hidden');
    return;
  }

  const syncFromDom = () => {
    const updated = readConvertFormatOptionsFromDom(root, options);
    params.onOptionsChange(updated);
  };

  if (IMAGE_TO_PDF_DESTINATION_ID_SET.has(destinationId)) {
    const panel = root.createElement('div');
    panel.className = 'bg-gray-700/50 rounded-lg p-4 space-y-4';

    const qualityGroup = root.createElement('div');
    const qualityLabel = root.createElement('label');
    qualityLabel.setAttribute('for', 'jpg-pdf-quality');
    qualityLabel.className = 'block mb-2 text-sm font-medium text-gray-300';
    qualityLabel.textContent = 'PDF Quality';

    const qualitySelect = root.createElement('select');
    qualitySelect.id = 'jpg-pdf-quality';
    qualitySelect.className =
      'w-full bg-gray-700 border border-gray-600 text-white rounded-lg p-2.5 text-sm';

    const qualityChoices: Array<{ value: ImageQuality; label: string }> = [
      { value: 'high', label: 'High Quality (Larger file)' },
      { value: 'medium', label: 'Medium Quality (Balanced)' },
      { value: 'low', label: 'Low Quality (Smaller file)' },
    ];
    for (const choice of qualityChoices) {
      const opt = root.createElement('option');
      opt.value = choice.value;
      opt.textContent = choice.label;
      opt.selected = choice.value === options.imageQuality;
      qualitySelect.appendChild(opt);
    }
    qualitySelect.value = options.imageQuality;
    qualitySelect.addEventListener('change', syncFromDom);
    qualityGroup.append(qualityLabel, qualitySelect);
    panel.appendChild(qualityGroup);

    if (sourceFiles.length > 1) {
      const combineGroup = root.createElement('div');
      const combineLabel = root.createElement('label');
      combineLabel.setAttribute('for', 'image-combine-mode');
      combineLabel.className = 'block mb-2 text-sm font-medium text-gray-300';
      combineLabel.textContent = 'Output Mode';

      const combineSelect = root.createElement('select');
      combineSelect.id = 'image-combine-mode';
      combineSelect.className =
        'w-full bg-gray-700 border border-gray-600 text-white rounded-lg p-2.5 text-sm';

      const combineChoices: Array<{ value: ImageCombineMode; label: string }> =
        [
          {
            value: 'combine',
            label: 'Single Combined PDF (1 page per image)',
          },
          {
            value: 'separate',
            label: 'Separate PDF per image (.zip)',
          },
        ];
      for (const choice of combineChoices) {
        const opt = root.createElement('option');
        opt.value = choice.value;
        opt.textContent = choice.label;
        opt.selected = choice.value === options.imageCombineMode;
        combineSelect.appendChild(opt);
      }
      combineSelect.value = options.imageCombineMode;
      combineSelect.addEventListener('change', syncFromDom);
      combineGroup.append(combineLabel, combineSelect);
      panel.appendChild(combineGroup);
    }

    container.appendChild(panel);
    container.classList.remove('hidden');
    return;
  }

  if (destinationId === 'email-to-pdf') {
    const panel = root.createElement('div');
    panel.className = 'bg-gray-700/50 rounded-lg p-4 space-y-4';

    const sizeRow = root.createElement('div');
    sizeRow.className = 'flex items-center justify-between';
    const sizeLabel = root.createElement('label');
    sizeLabel.setAttribute('for', 'page-size');
    sizeLabel.className = 'text-gray-300 text-sm';
    sizeLabel.textContent = 'Page Size';

    const sizeSelect = root.createElement('select');
    sizeSelect.id = 'page-size';
    sizeSelect.className =
      'bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-gray-200 text-sm';
    for (const [val, label] of [
      ['a4', 'A4'],
      ['letter', 'Letter'],
      ['legal', 'Legal'],
    ] as const) {
      const opt = root.createElement('option');
      opt.value = val;
      opt.textContent = label;
      opt.selected = val === options.emailPageSize;
      sizeSelect.appendChild(opt);
    }
    sizeSelect.value = options.emailPageSize;
    sizeSelect.addEventListener('change', syncFromDom);
    sizeRow.append(sizeLabel, sizeSelect);

    const ccRow = root.createElement('div');
    ccRow.className = 'flex items-center';
    const ccInput = root.createElement('input');
    ccInput.type = 'checkbox';
    ccInput.id = 'include-cc-bcc';
    ccInput.checked = options.emailIncludeCcBcc;
    ccInput.className =
      'w-4 h-4 text-indigo-600 bg-gray-700 border-gray-600 rounded';
    ccInput.addEventListener('change', syncFromDom);
    const ccLabel = root.createElement('label');
    ccLabel.setAttribute('for', 'include-cc-bcc');
    ccLabel.className = 'ml-3 text-gray-300 text-sm';
    ccLabel.textContent = 'Include CC and BCC recipients in header';
    ccRow.append(ccInput, ccLabel);

    const attRow = root.createElement('div');
    attRow.className = 'flex items-center';
    const attInput = root.createElement('input');
    attInput.type = 'checkbox';
    attInput.id = 'include-attachments';
    attInput.checked = options.emailIncludeAttachments;
    attInput.className =
      'w-4 h-4 text-indigo-600 bg-gray-700 border-gray-600 rounded';
    attInput.addEventListener('change', syncFromDom);
    const attLabel = root.createElement('label');
    attLabel.setAttribute('for', 'include-attachments');
    attLabel.className = 'ml-3 text-gray-300 text-sm';
    attLabel.textContent = 'Include email attachments list';
    attRow.append(attInput, attLabel);

    panel.append(sizeRow, ccRow, attRow);
    container.appendChild(panel);
    container.classList.remove('hidden');
    return;
  }

  if (destinationId === 'pdf-to-jpg' || destinationId === 'pdf-to-webp') {
    const isJpg = destinationId === 'pdf-to-jpg';
    const sliderId = isJpg ? 'jpg-quality' : 'webp-quality';
    const valueId = isJpg ? 'jpg-quality-value' : 'webp-quality-value';
    const currentQuality = isJpg ? options.jpgQuality : options.webpQuality;

    const panel = root.createElement('div');
    panel.className = 'bg-gray-700/50 rounded-lg p-4 space-y-4';

    const qualityGroup = root.createElement('div');
    const qualityLabel = root.createElement('label');
    qualityLabel.setAttribute('for', sliderId);
    qualityLabel.className = 'block mb-2 text-sm font-medium text-gray-300';
    qualityLabel.textContent = 'Image Quality';

    const sliderRow = root.createElement('div');
    sliderRow.className = 'flex items-center gap-4';

    const slider = root.createElement('input');
    slider.type = 'range';
    slider.id = sliderId;
    slider.min = '0.1';
    slider.max = '1.0';
    slider.step = '0.01';
    slider.value = String(currentQuality);
    slider.className = 'flex-1';

    const valueSpan = root.createElement('span');
    valueSpan.id = valueId;
    valueSpan.className = 'text-white font-medium w-16 text-right';
    valueSpan.textContent = `${Math.round(currentQuality * 100)}%`;

    slider.addEventListener('input', () => {
      const normalized = normalizeQualityFraction(slider.value, currentQuality);
      valueSpan.textContent = `${Math.round(normalized * 100)}%`;
      syncFromDom();
    });
    slider.addEventListener('change', syncFromDom);

    sliderRow.append(slider, valueSpan);
    qualityGroup.append(qualityLabel, sliderRow);

    const scaleGroup = root.createElement('div');
    const scaleLabel = root.createElement('label');
    scaleLabel.setAttribute('for', 'image-scale');
    scaleLabel.className = 'block mb-2 text-sm font-medium text-gray-300';
    scaleLabel.textContent = 'Resolution Scale';

    const scaleSelect = root.createElement('select');
    scaleSelect.id = 'image-scale';
    scaleSelect.className =
      'w-full bg-gray-700 border border-gray-600 text-white rounded-lg p-2.5 text-sm';
    for (const [val, label] of [
      ['1', '1x (72 DPI)'],
      ['2', '2x (144 DPI)'],
      ['3', '3x (216 DPI)'],
    ] as const) {
      const opt = root.createElement('option');
      opt.value = val;
      opt.textContent = label;
      opt.selected = Number(val) === options.imageScale;
      scaleSelect.appendChild(opt);
    }
    scaleSelect.value = String(options.imageScale);
    scaleSelect.addEventListener('change', syncFromDom);
    scaleGroup.append(scaleLabel, scaleSelect);

    panel.append(qualityGroup, scaleGroup);
    container.appendChild(panel);
    container.classList.remove('hidden');
    return;
  }

  if (destinationId === 'pdf-to-png') {
    const panel = root.createElement('div');
    panel.className = 'bg-gray-700/50 rounded-lg p-4 space-y-4';

    const scaleGroup = root.createElement('div');
    const scaleLabel = root.createElement('label');
    scaleLabel.setAttribute('for', 'png-scale');
    scaleLabel.className = 'block mb-2 text-sm font-medium text-gray-300';
    scaleLabel.textContent = 'Resolution Scale';

    const sliderRow = root.createElement('div');
    sliderRow.className = 'flex items-center gap-4';

    const slider = root.createElement('input');
    slider.type = 'range';
    slider.id = 'png-scale';
    slider.min = '1.0';
    slider.max = '3.0';
    slider.step = '0.1';
    const formattedScale = options.pngScale.toFixed(1);
    slider.value = formattedScale;
    slider.setAttribute('value', formattedScale);
    slider.className = 'flex-1';

    const valueSpan = root.createElement('span');
    valueSpan.id = 'png-scale-value';
    valueSpan.className = 'text-white font-medium w-16 text-right';
    valueSpan.textContent = `${formattedScale}x`;

    slider.addEventListener('input', () => {
      const parsed = Number.parseFloat(slider.value);
      if (Number.isFinite(parsed)) {
        valueSpan.textContent = `${parsed.toFixed(1)}x`;
      }
      syncFromDom();
    });
    slider.addEventListener('change', syncFromDom);

    sliderRow.append(slider, valueSpan);
    scaleGroup.append(scaleLabel, sliderRow);
    panel.appendChild(scaleGroup);
    container.appendChild(panel);
    container.classList.remove('hidden');
    return;
  }

  if (destinationId === 'pdf-to-tiff') {
    const panel = root.createElement('div');
    panel.className = 'bg-gray-700/50 rounded-lg p-4 space-y-4';

    const dpiGroup = root.createElement('div');
    const dpiLabel = root.createElement('label');
    dpiLabel.setAttribute('for', 'tiff-dpi');
    dpiLabel.className = 'block mb-2 text-sm font-medium text-gray-300';
    dpiLabel.textContent = 'DPI (Resolution)';

    const dpiSelect = root.createElement('select');
    dpiSelect.id = 'tiff-dpi';
    dpiSelect.className =
      'w-full bg-gray-700 border border-gray-600 text-gray-200 rounded-lg px-3 py-2 text-sm';
    for (const dpi of [72, 150, 300, 600]) {
      const opt = root.createElement('option');
      opt.value = String(dpi);
      opt.textContent = `${dpi} DPI`;
      opt.selected = dpi === options.tiffDpi;
      dpiSelect.appendChild(opt);
    }
    dpiSelect.value = String(options.tiffDpi);
    dpiSelect.addEventListener('change', syncFromDom);
    dpiGroup.append(dpiLabel, dpiSelect);

    const compGroup = root.createElement('div');
    const compLabel = root.createElement('label');
    compLabel.setAttribute('for', 'tiff-compression');
    compLabel.className = 'block mb-2 text-sm font-medium text-gray-300';
    compLabel.textContent = 'Compression';

    const compSelect = root.createElement('select');
    compSelect.id = 'tiff-compression';
    compSelect.className =
      'w-full bg-gray-700 border border-gray-600 text-gray-200 rounded-lg px-3 py-2 text-sm';
    for (const [val, label] of [
      ['lzw', 'LZW (Lossless)'],
      ['deflate', 'Deflate (Lossless)'],
      ['packbits', 'PackBits'],
      ['jpeg', 'JPEG (Lossy)'],
      ['ccittfax4', 'CCITT Fax 4'],
      ['none', 'None (Uncompressed)'],
    ] as const) {
      const opt = root.createElement('option');
      opt.value = val;
      opt.textContent = label;
      opt.selected = val === options.tiffCompression.toLowerCase();
      compSelect.appendChild(opt);
    }
    compSelect.value = options.tiffCompression.toLowerCase();
    compSelect.addEventListener('change', syncFromDom);
    compGroup.append(compLabel, compSelect);

    const colorGroup = root.createElement('div');
    const colorLabel = root.createElement('label');
    colorLabel.setAttribute('for', 'tiff-color-mode');
    colorLabel.className = 'block mb-2 text-sm font-medium text-gray-300';
    colorLabel.textContent = 'Color Space';

    const colorSelect = root.createElement('select');
    colorSelect.id = 'tiff-color-mode';
    colorSelect.className =
      'w-full bg-gray-700 border border-gray-600 text-gray-200 rounded-lg px-3 py-2 text-sm';
    for (const [val, label] of [
      ['rgb', 'RGB'],
      ['grayscale', 'Grayscale'],
      ['cmyk', 'CMYK'],
      ['bw', 'Black & White (1-bit)'],
    ] as const) {
      const opt = root.createElement('option');
      opt.value = val;
      opt.textContent = label;
      opt.selected = val === options.tiffColorMode.toLowerCase();
      colorSelect.appendChild(opt);
    }
    colorSelect.value = options.tiffColorMode.toLowerCase();
    colorSelect.addEventListener('change', syncFromDom);
    colorGroup.append(colorLabel, colorSelect);

    const multiRow = root.createElement('div');
    multiRow.className = 'flex items-center gap-3';
    const multiInput = root.createElement('input');
    multiInput.type = 'checkbox';
    multiInput.id = 'tiff-multipage';
    multiInput.checked = options.tiffMultiPage;
    multiInput.className =
      'w-4 h-4 rounded bg-gray-700 border-gray-600 text-indigo-600';
    multiInput.addEventListener('change', syncFromDom);
    const multiLabel = root.createElement('label');
    multiLabel.setAttribute('for', 'tiff-multipage');
    multiLabel.className = 'text-sm font-medium text-gray-300';
    multiLabel.textContent = 'Save as multi-page TIFF (single file)';
    multiRow.append(multiInput, multiLabel);

    panel.append(dpiGroup, compGroup, colorGroup, multiRow);
    container.appendChild(panel);
    container.classList.remove('hidden');
    return;
  }

  if (destinationId === 'pdf-to-markdown') {
    const panel = root.createElement('div');
    panel.className = 'bg-gray-700/50 rounded-lg p-4 space-y-4';

    const row = root.createElement('div');
    row.className = 'flex items-center gap-3';
    const input = root.createElement('input');
    input.type = 'checkbox';
    input.id = 'include-images';
    input.checked = options.includeImages;
    input.className =
      'w-4 h-4 rounded bg-gray-700 border-gray-600 text-indigo-600';
    input.addEventListener('change', syncFromDom);

    const label = root.createElement('label');
    label.setAttribute('for', 'include-images');
    label.className = 'text-sm text-gray-300';
    label.textContent = 'Include embedded images as base64';

    row.append(input, label);
    panel.appendChild(row);
    container.appendChild(panel);
    container.classList.remove('hidden');
    return;
  }

  if (destinationId === 'extract-tables') {
    const panel = root.createElement('div');
    panel.className = 'bg-gray-700/50 rounded-lg p-4 space-y-4';

    const group = root.createElement('div');
    const label = root.createElement('label');
    label.setAttribute('for', 'export-format');
    label.className = 'block mb-2 text-sm font-medium text-gray-300';
    label.textContent = 'Output Format';

    const select = root.createElement('select');
    select.id = 'export-format';
    select.className =
      'w-full bg-gray-700 border border-gray-600 text-gray-200 rounded-lg px-3 py-2 text-sm';

    for (const [val, text] of [
      ['csv', 'CSV (.csv)'],
      ['xlsx', 'Excel (.xlsx)'],
      ['json', 'JSON (.json)'],
      ['md', 'Markdown (.md)'],
    ] as const) {
      const opt = root.createElement('option');
      opt.value = val;
      opt.textContent = text;
      opt.selected = val === options.extractTablesFormat;
      select.appendChild(opt);
    }
    select.value = options.extractTablesFormat;
    select.addEventListener('change', syncFromDom);

    group.append(label, select);
    panel.appendChild(group);
    container.appendChild(panel);
    container.classList.remove('hidden');
    return;
  }

  if (destinationId === 'txt-to-pdf' || destinationId === 'markdown-to-pdf') {
    const isMarkdown = destinationId === 'markdown-to-pdf';
    const panel = root.createElement('div');
    panel.className =
      'bg-gray-700/50 rounded-lg p-4 flex items-center justify-between gap-4';

    const copy = root.createElement('p');
    copy.className = 'text-sm text-gray-300';
    copy.textContent = isMarkdown
      ? 'Convert directly to PDF using default Markdown styling, or open in the live Markdown Editor.'
      : 'Convert directly to PDF using default typography, or open in the Text Editor.';

    const button = root.createElement('button');
    button.type = 'button';
    button.id = OPEN_DEDICATED_EDITOR_BTN_ID;
    button.className =
      'btn bg-gray-700 hover:bg-gray-600 text-white font-semibold px-4 py-2 rounded-lg text-sm flex-shrink-0';
    button.textContent = isMarkdown
      ? 'Open in Markdown Editor'
      : 'Open in Text Editor';
    button.addEventListener('click', () => {
      params.onOpenDedicatedEditor?.(destinationId);
    });

    panel.append(copy, button);
    container.appendChild(panel);
    container.classList.remove('hidden');
    return;
  }

  container.classList.add('hidden');
}
