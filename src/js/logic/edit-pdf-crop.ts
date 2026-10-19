import { PDFDocument as PDFLibDocument } from 'pdf-lib';
import type { CropPercentages } from '@/types';
import { BoundedHistory } from '../utils/bounded-history.js';
import { loadPdfDocument } from '../utils/load-pdf-document.js';

export type CropMap = Record<number, CropPercentages>;

function cloneCropMap(map: CropMap): CropMap {
  const copy: CropMap = {};
  for (const [page, crop] of Object.entries(map)) {
    copy[Number(page)] = { ...crop };
  }
  return copy;
}

function isSameCrop(
  a: CropPercentages | undefined,
  b: CropPercentages
): boolean {
  if (!a) return false;
  const eps = 1e-6;
  return (
    Math.abs(a.x - b.x) < eps &&
    Math.abs(a.y - b.y) < eps &&
    Math.abs(a.width - b.width) < eps &&
    Math.abs(a.height - b.height) < eps
  );
}

export class CropHistoryController {
  pageCrops: CropMap = {};
  private readonly history = new BoundedHistory<CropMap>(cloneCropMap, 30);

  recordCrop(pageNum: number, crop: CropPercentages): boolean {
    if (isSameCrop(this.pageCrops[pageNum], crop)) {
      return false;
    }
    this.history.snapshot(this.pageCrops);
    this.pageCrops[pageNum] = { ...crop };
    return true;
  }

  undo(): CropMap | null {
    const previous = this.history.undo(this.pageCrops);
    if (!previous) return null;
    this.pageCrops = cloneCropMap(previous);
    return this.pageCrops;
  }

  redo(): CropMap | null {
    const next = this.history.redo(this.pageCrops);
    if (!next) return null;
    this.pageCrops = cloneCropMap(next);
    return this.pageCrops;
  }

  reset(): void {
    this.pageCrops = {};
    this.history.clear();
  }

  canUndo(): boolean {
    return this.history.status.canUndo;
  }

  canRedo(): boolean {
    return this.history.status.canRedo;
  }

  hasCrops(): boolean {
    return Object.keys(this.pageCrops).length > 0;
  }

  resolveEffectiveCropData(
    numPages: number,
    currentPageNum: number,
    applyToAll: boolean
  ): CropMap {
    if (applyToAll) {
      const currentCrop = this.pageCrops[currentPageNum];
      if (!currentCrop) return {};
      const all: CropMap = {};
      for (let i = 1; i <= numPages; i++) {
        all[i] = { ...currentCrop };
      }
      return all;
    }
    return cloneCropMap(this.pageCrops);
  }
}

export interface CropPdfJsPage {
  getViewport: (opts: { scale: number }) => {
    width: number;
    height: number;
    convertToPdfPoint: (x: number, y: number) => [number, number] | number[];
  };
  render?: (opts: {
    canvas: HTMLCanvasElement | null;
    canvasContext: CanvasRenderingContext2D | null;
    viewport: unknown;
  }) => { promise: Promise<void> };
}

export interface CropPdfJsDocument {
  numPages: number;
  getPage: (pageNumber: number) => Promise<CropPdfJsPage>;
}

export async function performMetadataCrop(
  pdfBytes: Uint8Array | ArrayBuffer,
  pdfJsDoc: CropPdfJsDocument,
  cropData: CropMap
): Promise<Uint8Array> {
  const bytes =
    pdfBytes instanceof Uint8Array
      ? pdfBytes
      : new Uint8Array(pdfBytes.slice(0));
  const pdfToModify = await loadPdfDocument(bytes);
  const pages = pdfToModify.getPages();

  for (const pageNumKey of Object.keys(cropData)) {
    const pageNum = Number(pageNumKey);
    const crop = cropData[pageNum];
    const page = pages[pageNum - 1];
    if (!crop || !page) continue;

    const pdfJsPage = await pdfJsDoc.getPage(pageNum);
    const viewport = pdfJsPage.getViewport({ scale: 1 });

    const cropX = viewport.width * crop.x;
    const cropY = viewport.height * crop.y;
    const cropW = viewport.width * crop.width;
    const cropH = viewport.height * crop.height;

    const visualCorners = [
      { x: cropX, y: cropY },
      { x: cropX + cropW, y: cropY },
      { x: cropX + cropW, y: cropY + cropH },
      { x: cropX, y: cropY + cropH },
    ];

    const pdfCorners = visualCorners.map((p) =>
      viewport.convertToPdfPoint(p.x, p.y)
    );
    const pdfXs = pdfCorners.map((p) => p[0]);
    const pdfYs = pdfCorners.map((p) => p[1]);

    const minX = Math.min(...pdfXs);
    const maxX = Math.max(...pdfXs);
    const minY = Math.min(...pdfYs);
    const maxY = Math.max(...pdfYs);

    page.setCropBox(minX, minY, maxX - minX, maxY - minY);
  }

  return new Uint8Array(await pdfToModify.save());
}

export type CroppedPageRasterizer = (
  pdfJsDoc: CropPdfJsDocument,
  pageNum: number,
  crop: CropPercentages
) => Promise<{ pngBytes: ArrayBuffer; width: number; height: number }>;

async function defaultRasterizeCroppedPage(
  pdfJsDoc: CropPdfJsDocument,
  pageNum: number,
  crop: CropPercentages
): Promise<{ pngBytes: ArrayBuffer; width: number; height: number }> {
  const page = await pdfJsDoc.getPage(pageNum);
  const viewport = page.getViewport({ scale: 2.5 });

  const tempCanvas = document.createElement('canvas');
  const tempCtx = tempCanvas.getContext('2d');
  tempCanvas.width = viewport.width;
  tempCanvas.height = viewport.height;
  if (page.render) {
    await page.render({
      canvas: null,
      canvasContext: tempCtx,
      viewport,
    }).promise;
  }

  const finalCanvas = document.createElement('canvas');
  const finalCtx = finalCanvas.getContext('2d');
  const finalWidth = Math.max(1, Math.round(tempCanvas.width * crop.width));
  const finalHeight = Math.max(1, Math.round(tempCanvas.height * crop.height));
  finalCanvas.width = finalWidth;
  finalCanvas.height = finalHeight;

  finalCtx?.drawImage(
    tempCanvas,
    tempCanvas.width * crop.x,
    tempCanvas.height * crop.y,
    finalWidth,
    finalHeight,
    0,
    0,
    finalWidth,
    finalHeight
  );

  const pngBytes = await new Promise<ArrayBuffer>((resolve, reject) => {
    finalCanvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('Failed to encode cropped page image.'));
        return;
      }
      blob.arrayBuffer().then(resolve, reject);
    }, 'image/png');
  });

  return { pngBytes, width: finalWidth, height: finalHeight };
}

export async function performFlatteningCrop(
  pdfBytes: Uint8Array | ArrayBuffer,
  pdfJsDoc: CropPdfJsDocument,
  cropData: CropMap,
  rasterizePage: CroppedPageRasterizer = defaultRasterizeCroppedPage,
  onProgress?: (pageNum: number, totalPages: number) => void
): Promise<Uint8Array> {
  const bytes =
    pdfBytes instanceof Uint8Array
      ? pdfBytes
      : new Uint8Array(pdfBytes.slice(0));
  const newPdfDoc = await PDFLibDocument.create();
  const sourcePdfDocForCopying = await loadPdfDocument(bytes);
  const totalPages = pdfJsDoc.numPages;

  for (let i = 0; i < totalPages; i++) {
    const pageNum = i + 1;
    onProgress?.(pageNum, totalPages);

    const crop = cropData[pageNum];
    if (crop) {
      const { pngBytes, width, height } = await rasterizePage(
        pdfJsDoc,
        pageNum,
        crop
      );
      const embeddedImage = await newPdfDoc.embedPng(pngBytes);
      const newPage = newPdfDoc.addPage([width, height]);
      newPage.drawImage(embeddedImage, {
        x: 0,
        y: 0,
        width,
        height,
      });
    } else {
      const [copiedPage] = await newPdfDoc.copyPages(sourcePdfDocForCopying, [
        i,
      ]);
      newPdfDoc.addPage(copiedPage);
    }
  }

  return new Uint8Array(await newPdfDoc.save());
}
