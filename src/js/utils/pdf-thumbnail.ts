import { getPDFDocument } from './pdfjs.js';

/** Longest edge of a library / tool / success preview bitmap. */
export const PREVIEW_BITMAP_MAX_EDGE = 1600;
/** Letter-card floor used when the canvas has not been laid out yet. */
export const PREVIEW_BITMAP_FALLBACK_CSS_WIDTH = 280;

/**
 * Bitmap width for a preview that should stay sharp in its CSS box.
 * Explicit callers (the 48px sidebar rail) pass their own max width.
 */
export function previewBitmapMaxWidth(
  canvas: HTMLCanvasElement,
  pageWidth: number,
  pageHeight: number
): number {
  const cssWidth =
    canvas.clientWidth ||
    canvas.parentElement?.clientWidth ||
    PREVIEW_BITMAP_FALLBACK_CSS_WIDTH;
  const dpr =
    typeof window !== 'undefined' && window.devicePixelRatio > 0
      ? window.devicePixelRatio
      : 1;
  let maxWidth = cssWidth * dpr;
  const height = (pageHeight / Math.max(pageWidth, 1)) * maxWidth;
  const longEdge = Math.max(maxWidth, height);
  if (longEdge > PREVIEW_BITMAP_MAX_EDGE) {
    maxWidth *= PREVIEW_BITMAP_MAX_EDGE / longEdge;
  }
  return Math.max(1, Math.ceil(maxWidth));
}

export async function renderPdfFirstPage(
  file: Blob,
  canvas: HTMLCanvasElement,
  maxWidth?: number
): Promise<void> {
  const data = new Uint8Array(await file.arrayBuffer());
  const pdf = await getPDFDocument(data).promise;
  try {
    const page = await pdf.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const width =
      maxWidth ?? previewBitmapMaxWidth(canvas, base.width, base.height);
    const scale = width / Math.max(base.width, 1);
    const viewport = page.getViewport({ scale });
    const context = canvas.getContext('2d');
    if (!context) return;

    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    await page.render({
      canvasContext: context,
      viewport,
      canvas,
    }).promise;
  } finally {
    await pdf.destroy();
  }
}
