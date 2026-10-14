import { createShiftFilePreview } from './shift-file-preview.js';
import {
  PREVIEW_BITMAP_MAX_EDGE,
  renderPdfFirstPage,
} from '../utils/pdf-thumbnail.js';

const CARD_ATTR = 'data-shift-tool-input-card';

function formatSize(bytes: number): string {
  if (!bytes || bytes < 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  const kilobytes = bytes / 1024;
  if (kilobytes < 1024) return `${kilobytes.toFixed(1)} KB`;
  return `${(kilobytes / 1024).toFixed(1)} MB`;
}

function isPdf(file: Blob): boolean {
  const name = file instanceof File ? file.name.toLowerCase() : '';
  return file.type === 'application/pdf' || name.endsWith('.pdf');
}

function isImage(file: Blob): boolean {
  if (file.type.startsWith('image/') && file.type !== 'image/svg+xml') {
    return true;
  }
  if (!(file instanceof File)) return false;
  return /\.(png|jpe?g|gif|webp|bmp|tiff?|heic|heif)$/i.test(file.name);
}

async function drawImageFile(
  file: Blob,
  canvas: HTMLCanvasElement
): Promise<void> {
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error('Could not read the image.'));
      element.src = url;
    });
    const cssWidth =
      canvas.clientWidth || canvas.parentElement?.clientWidth || 280;
    const dpr =
      typeof window !== 'undefined' && window.devicePixelRatio > 0
        ? window.devicePixelRatio
        : 1;
    let width = cssWidth * dpr;
    let height =
      (image.naturalHeight / Math.max(image.naturalWidth, 1)) * width;
    const longEdge = Math.max(width, height);
    if (longEdge > PREVIEW_BITMAP_MAX_EDGE) {
      const fit = PREVIEW_BITMAP_MAX_EDGE / longEdge;
      width *= fit;
      height *= fit;
    }
    canvas.width = Math.max(1, Math.ceil(width));
    canvas.height = Math.max(1, Math.ceil(height));
    const context = canvas.getContext('2d');
    if (!context) return;
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Paint a first-page or image bitmap into a shared preview frame. */
export async function paintFilePreview(
  preview: HTMLElement,
  file: Blob
): Promise<void> {
  const canvas = preview.querySelector('canvas');
  if (!(canvas instanceof HTMLCanvasElement)) return;
  if (isPdf(file)) {
    await renderPdfFirstPage(file, canvas);
  } else if (isImage(file)) {
    await drawImageFile(file, canvas);
  } else {
    preview.classList.add('is-empty');
    return;
  }
  preview.classList.remove('is-empty');
}

function appendPreview(row: HTMLElement, file: File): void {
  if (row.querySelector('.shift-file-preview')) return;
  const preview = createShiftFilePreview(row.ownerDocument, {
    size: 'card',
    empty: true,
  });
  row.prepend(preview);
  void paintFilePreview(preview, file).catch(() => {
    preview.classList.add('is-empty');
  });
}

/**
 * Turn a tool's filename row into the same card the library uses.
 * Existing name, size, and remove controls stay in the row.
 */
export function mountToolInputPreview(row: HTMLElement, file: File): void {
  if (row.getAttribute(CARD_ATTR) === 'true') return;
  row.setAttribute(CARD_ATTR, 'true');
  row.classList.add('shift-open-file-thumb', 'shift-tool-input-card');
  appendPreview(row, file);
}

export interface RenderToolInputFilesOptions {
  onRemove?: (file: File, index: number) => void;
  detail?: (file: File, index: number) => string;
}

/** Replace a container with library-style cards for the selected input files. */
export function renderToolInputFiles(
  container: HTMLElement,
  files: File[],
  options: RenderToolInputFilesOptions = {}
): void {
  const doc = container.ownerDocument;
  container.replaceChildren();
  container.classList.add('shift-tool-input-cards');
  files.forEach((file, index) => {
    const card = doc.createElement('div');
    card.className = 'shift-open-file-thumb shift-tool-input-card';
    card.setAttribute(CARD_ATTR, 'true');

    const preview = createShiftFilePreview(doc, { size: 'card', empty: true });
    const meta = doc.createElement('div');
    meta.className = 'shift-open-file-thumb-meta';

    const name = doc.createElement('span');
    name.className = 'shift-open-file-thumb-name truncate';
    name.textContent = file.name;

    const detail = doc.createElement('span');
    detail.className = 'shift-open-file-thumb-detail';
    detail.textContent = options.detail?.(file, index) ?? formatSize(file.size);

    meta.append(name, detail);

    if (options.onRemove) {
      const remove = doc.createElement('button');
      remove.type = 'button';
      remove.className = 'shift-tool-file-remove';
      remove.setAttribute('aria-label', `Remove ${file.name}`);
      remove.textContent = 'Remove';
      remove.addEventListener('click', () => options.onRemove?.(file, index));
      meta.append(remove);
    }

    card.append(preview, meta);
    container.append(card);
    void paintFilePreview(preview, file).catch(() => {
      preview.classList.add('is-empty');
    });
  });
}
