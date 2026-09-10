import { getPDFDocument } from './pdfjs.js';

const DEFAULT_MAX_WIDTH = 120;

export async function renderPdfFirstPage(
  file: Blob,
  canvas: HTMLCanvasElement,
  maxWidth = DEFAULT_MAX_WIDTH
): Promise<void> {
  const data = new Uint8Array(await file.arrayBuffer());
  const pdf = await getPDFDocument(data).promise;
  try {
    const page = await pdf.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const scale = maxWidth / Math.max(base.width, 1);
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
