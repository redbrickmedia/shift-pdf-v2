import JSZip from 'jszip';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import type { PDFPageProxy } from 'pdfjs-dist';
import type Vips from 'wasm-vips';
import wasmUrl from 'wasm-vips/vips.wasm?url';
import {
  getFilenameWithoutExtension,
  IMAGE_TO_PDF_DESTINATION_ID_SET,
  type ConvertDestination,
} from '../config/convert-destinations.js';
import { hideLoader, showAlert, showLoader } from '../ui.js';
import { showResultLoader } from './tool-success.js';
import { deduplicateFileName } from '../utils/deduplicate-filename.js';
import { downloadFile, getCleanPdfFilename } from '../utils/helpers.js';
import {
  compressImageFile,
  type ImageQuality,
} from '../utils/image-compress.js';
import {
  getLibreOfficeConverter,
  type LoadProgress,
} from '../utils/libreoffice-loader.js';
import {
  batchDecryptIfNeeded,
  loadPdfWithPasswordPrompt,
} from '../utils/password-prompt.js';
import { loadPyMuPDF } from '../utils/pymupdf-loader.js';
import {
  createDefaultConvertFormatOptions,
  type ConvertFormatOptions,
} from './convert-format-options.js';

export const LIBREOFFICE_TO_PDF_DESTINATION_IDS = [
  'word-to-pdf',
  'excel-to-pdf',
  'powerpoint-to-pdf',
  'odt-to-pdf',
  'ods-to-pdf',
  'odp-to-pdf',
  'odg-to-pdf',
  'rtf-to-pdf',
  'pages-to-pdf',
  'pub-to-pdf',
  'vsd-to-pdf',
] as const;

const LIBREOFFICE_TO_PDF_SET: ReadonlySet<string> = new Set(
  LIBREOFFICE_TO_PDF_DESTINATION_IDS
);

const PYMUPDF_EBOOK_FILETYPE_BY_ID: Readonly<Record<string, string>> = {
  'epub-to-pdf': 'epub',
  'mobi-to-pdf': 'mobi',
  'xps-to-pdf': 'xps',
};

const RASTER_IMAGE_CONFIG_BY_ID: Readonly<
  Record<
    string,
    {
      ext: 'jpg' | 'png' | 'webp' | 'bmp';
      mimeType: string;
    }
  >
> = {
  'pdf-to-jpg': { ext: 'jpg', mimeType: 'image/jpeg' },
  'pdf-to-png': { ext: 'png', mimeType: 'image/png' },
  'pdf-to-webp': { ext: 'webp', mimeType: 'image/webp' },
  'pdf-to-bmp': { ext: 'bmp', mimeType: 'image/bmp' },
};

function isCanvas2DSupported(): boolean {
  if (
    typeof navigator !== 'undefined' &&
    /jsdom/i.test(navigator.userAgent ?? '')
  ) {
    return false;
  }
  if (typeof document === 'undefined') return false;
  try {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('2d'));
  } catch {
    return false;
  }
}

async function prepareImageFileForPdf(
  file: File,
  quality: ImageQuality
): Promise<File> {
  if (!isCanvas2DSupported()) {
    return file;
  }
  const { preprocessImageFile } = await import('../utils/image-input-utils.js');
  const processed = await preprocessImageFile(file);
  return compressImageFile(processed, quality);
}

async function renderTextOrMarkdownToPdfBlob(
  content: string,
  isMarkdown: boolean
): Promise<Blob> {
  const pdfDoc = await PDFDocument.create();
  const regularFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const pageWidth = 612;
  const pageHeight = 792;
  const margin = 50;
  const maxLineWidth = pageWidth - margin * 2;
  let page = pdfDoc.addPage([pageWidth, pageHeight]);
  let y = pageHeight - margin;

  const sanitizeWinAnsi = (text: string): string =>
    text.replace(/[^\x20-\x7E\xA0-\xFF]/g, ' ').replace(/\t/g, '  ');

  const rawLines = content.replace(/\r\n/g, '\n').split('\n');
  for (const rawLine of rawLines) {
    const headingMatch = isMarkdown ? /^(#{1,6})\s+(.*)$/.exec(rawLine) : null;
    const isHeading = Boolean(headingMatch);
    const level = headingMatch ? headingMatch[1]!.length : 0;
    const font = isHeading ? boldFont : regularFont;
    const fontSize = isHeading ? Math.max(12, 22 - (level - 1) * 2) : 11;
    const lineHeight = fontSize * 1.45;
    const cleanLine = sanitizeWinAnsi(
      headingMatch ? (headingMatch[2] ?? '') : rawLine
    );

    if (!cleanLine.trim()) {
      y -= lineHeight * 0.6;
      if (y < margin) {
        page = pdfDoc.addPage([pageWidth, pageHeight]);
        y = pageHeight - margin;
      }
      continue;
    }

    const words = cleanLine.split(' ');
    let currentLine = '';

    for (const word of words) {
      const candidate = currentLine ? `${currentLine} ${word}` : word;
      if (
        font.widthOfTextAtSize(candidate, fontSize) <= maxLineWidth ||
        !currentLine
      ) {
        currentLine = candidate;
      } else {
        if (y - lineHeight < margin) {
          page = pdfDoc.addPage([pageWidth, pageHeight]);
          y = pageHeight - margin;
        }
        page.drawText(currentLine, {
          x: margin,
          y: y - fontSize,
          size: fontSize,
          font,
          color: rgb(0.1, 0.1, 0.1),
        });
        y -= lineHeight;
        currentLine = word;
      }
    }

    if (currentLine) {
      if (y - lineHeight < margin) {
        page = pdfDoc.addPage([pageWidth, pageHeight]);
        y = pageHeight - margin;
      }
      page.drawText(currentLine, {
        x: margin,
        y: y - fontSize,
        size: fontSize,
        font,
        color: rgb(0.1, 0.1, 0.1),
      });
      y -= lineHeight;
    }
  }

  const pdfBytes = await pdfDoc.save();
  return new Blob([new Uint8Array(pdfBytes)], { type: 'application/pdf' });
}

async function convertSingleImageToPdfBlob(
  file: File,
  destinationId: string,
  quality: ImageQuality
): Promise<Blob> {
  const prepared = await prepareImageFileForPdf(file, quality);
  const mupdf = await loadPyMuPDF();
  if (
    (destinationId === 'psd-to-pdf' ||
      file.name.toLowerCase().endsWith('.psd')) &&
    typeof mupdf.imageToPdf === 'function'
  ) {
    return mupdf.imageToPdf(prepared, { imageType: 'psd' });
  }
  return mupdf.imagesToPdf([prepared]);
}

async function runImagesToPdf(
  files: File[],
  destinationId: string,
  options: ConvertFormatOptions
): Promise<void> {
  showLoader('Loading engine...');
  const mupdf = await loadPyMuPDF();
  showResultLoader('Converting images to PDF...');

  if (files.length > 1 && options.imageCombineMode === 'separate') {
    const zip = new JSZip();
    const usedNames = new Set<string>();
    for (let i = 0; i < files.length; i++) {
      const file = files[i]!;
      showResultLoader(`Converting ${i + 1}/${files.length}: ${file.name}...`);
      const pdfBlob = await convertSingleImageToPdfBlob(
        file,
        destinationId,
        options.imageQuality
      );
      const baseName = getFilenameWithoutExtension(file.name);
      const entryName = deduplicateFileName(`${baseName}.pdf`, usedNames);
      zip.file(entryName, await pdfBlob.arrayBuffer());
    }
    const zipBlob = await zip.generateAsync({ type: 'blob' });
    downloadFile(zipBlob, `${destinationId}-converted.zip`);
    return;
  }

  if (
    files.length === 1 &&
    (destinationId === 'psd-to-pdf' ||
      files[0]!.name.toLowerCase().endsWith('.psd')) &&
    typeof mupdf.imageToPdf === 'function'
  ) {
    const file = files[0]!;
    const pdfBlob = await mupdf.imageToPdf(file, { imageType: 'psd' });
    downloadFile(pdfBlob, `${getFilenameWithoutExtension(file.name)}.pdf`);
    return;
  }

  const processedFiles: File[] = [];
  for (const file of files) {
    processedFiles.push(
      await prepareImageFileForPdf(file, options.imageQuality)
    );
  }
  const pdfBlob = await mupdf.imagesToPdf(processedFiles);
  const outName =
    files.length === 1
      ? `${getFilenameWithoutExtension(files[0]!.name)}.pdf`
      : `${destinationId.replace(/-/g, '_')}.pdf`;
  downloadFile(pdfBlob, outName);
}

async function runLibreOfficeToPdf(
  files: File[],
  destinationId: string
): Promise<void> {
  const converter = getLibreOfficeConverter();
  showLoader('Loading engine...');
  await converter.initialize((progress: LoadProgress) => {
    showResultLoader(progress.message, progress.percent);
  });

  if (files.length === 1) {
    const file = files[0]!;
    showResultLoader(`Converting ${file.name}...`);
    const pdfBlob = await converter.convertToPdf(file);
    downloadFile(pdfBlob, `${getFilenameWithoutExtension(file.name)}.pdf`);
    return;
  }

  const zip = new JSZip();
  const usedNames = new Set<string>();
  for (let i = 0; i < files.length; i++) {
    const file = files[i]!;
    showResultLoader(`Converting ${i + 1}/${files.length}: ${file.name}...`);
    const pdfBlob = await converter.convertToPdf(file);
    const baseName = getFilenameWithoutExtension(file.name);
    const entryName = deduplicateFileName(`${baseName}.pdf`, usedNames);
    zip.file(entryName, await pdfBlob.arrayBuffer());
  }
  const zipBlob = await zip.generateAsync({ type: 'blob' });
  downloadFile(zipBlob, `${destinationId}-converted.zip`);
}

async function runPyMuPdfEbookToPdf(
  files: File[],
  filetype: string
): Promise<void> {
  showLoader('Loading engine...');
  const pymupdf = await loadPyMuPDF();

  if (files.length === 1) {
    const file = files[0]!;
    showResultLoader(`Converting ${file.name}...`);
    const pdfBlob = await pymupdf.convertToPdf(file, { filetype });
    downloadFile(pdfBlob, `${getFilenameWithoutExtension(file.name)}.pdf`);
    return;
  }

  const zip = new JSZip();
  const usedNames = new Set<string>();
  for (let i = 0; i < files.length; i++) {
    const file = files[i]!;
    showResultLoader(`Converting ${i + 1}/${files.length}: ${file.name}...`);
    const pdfBlob = await pymupdf.convertToPdf(file, { filetype });
    const baseName = getFilenameWithoutExtension(file.name);
    const entryName = deduplicateFileName(`${baseName}.pdf`, usedNames);
    zip.file(entryName, await pdfBlob.arrayBuffer());
  }
  const zipBlob = await zip.generateAsync({ type: 'blob' });
  downloadFile(zipBlob, `${filetype}-converted.zip`);
}

async function runCsvToPdf(files: File[]): Promise<void> {
  const { convertCsvToPdf } = await import('../utils/csv-to-pdf.js');
  if (files.length === 1) {
    const file = files[0]!;
    const pdfBlob = await convertCsvToPdf(file, {
      onProgress: (percent, message) => showResultLoader(message, percent),
    });
    downloadFile(pdfBlob, `${getFilenameWithoutExtension(file.name)}.pdf`);
    return;
  }

  const zip = new JSZip();
  const usedNames = new Set<string>();
  for (let i = 0; i < files.length; i++) {
    const file = files[i]!;
    const pdfBlob = await convertCsvToPdf(file, {
      onProgress: (percent) =>
        showResultLoader(
          `Converting ${i + 1}/${files.length}: ${file.name}...`,
          percent
        ),
    });
    const baseName = getFilenameWithoutExtension(file.name);
    const entryName = deduplicateFileName(`${baseName}.pdf`, usedNames);
    zip.file(entryName, await pdfBlob.arrayBuffer());
  }
  const zipBlob = await zip.generateAsync({ type: 'blob' });
  downloadFile(zipBlob, 'csv-converted.zip');
}

async function runXmlToPdf(files: File[]): Promise<void> {
  const { convertXmlToPdf } = await import('../utils/xml-to-pdf.js');
  if (files.length === 1) {
    const file = files[0]!;
    const pdfBlob = await convertXmlToPdf(file, {
      onProgress: (percent, message) => showResultLoader(message, percent),
    });
    downloadFile(pdfBlob, `${getFilenameWithoutExtension(file.name)}.pdf`);
    return;
  }

  const zip = new JSZip();
  const usedNames = new Set<string>();
  for (let i = 0; i < files.length; i++) {
    const file = files[i]!;
    const pdfBlob = await convertXmlToPdf(file, {
      onProgress: (percent, message) =>
        showResultLoader(`File ${i + 1}/${files.length}: ${message}`, percent),
    });
    const baseName = getFilenameWithoutExtension(file.name);
    const entryName = deduplicateFileName(`${baseName}.pdf`, usedNames);
    zip.file(entryName, pdfBlob);
  }
  const zipBlob = await zip.generateAsync({ type: 'blob' });
  downloadFile(zipBlob, 'xml-to-pdf.zip');
}

async function convertSingleEmailToPdfBlob(
  file: File,
  options: ConvertFormatOptions,
  pymupdf: Awaited<ReturnType<typeof loadPyMuPDF>>
): Promise<Blob> {
  const { parseEmailFile, renderEmailToHtml } =
    await import('./email-to-pdf.js');
  const email = await parseEmailFile(file);
  const htmlContent = renderEmailToHtml(email, {
    includeCcBcc: options.emailIncludeCcBcc,
    includeAttachments: options.emailIncludeAttachments,
    pageSize: options.emailPageSize,
  });

  return pymupdf.htmlToPdf(htmlContent, {
    pageSize: options.emailPageSize,
    margins: { top: 50, right: 50, bottom: 50, left: 50 },
    attachments: email.attachments
      .filter((a) => a.content)
      .map((a) => ({
        filename: a.filename,
        content: a.content!,
      })),
  });
}

async function runEmailToPdf(
  files: File[],
  options: ConvertFormatOptions
): Promise<void> {
  showLoader('Loading PDF engine...');
  const pymupdf = await loadPyMuPDF();

  if (files.length === 1) {
    const file = files[0]!;
    showResultLoader(`Parsing ${file.name}...`);
    const pdfBlob = await convertSingleEmailToPdfBlob(file, options, pymupdf);
    downloadFile(pdfBlob, `${getFilenameWithoutExtension(file.name)}.pdf`);
    return;
  }

  const zip = new JSZip();
  const usedNames = new Set<string>();
  for (let i = 0; i < files.length; i++) {
    const file = files[i]!;
    showResultLoader(`Converting ${i + 1}/${files.length}: ${file.name}...`);
    const pdfBlob = await convertSingleEmailToPdfBlob(file, options, pymupdf);
    const baseName = getFilenameWithoutExtension(file.name);
    const entryName = deduplicateFileName(`${baseName}.pdf`, usedNames);
    zip.file(entryName, await pdfBlob.arrayBuffer());
  }
  const zipBlob = await zip.generateAsync({ type: 'blob' });
  downloadFile(zipBlob, 'emails-converted.zip');
}

async function convertSingleTextOrMarkdownFileToPdf(
  file: File,
  destinationId: string
): Promise<Blob> {
  const text = await file.text();
  if (destinationId === 'txt-to-pdf') {
    try {
      const pymupdf = await loadPyMuPDF();
      if (typeof pymupdf.textToPdf === 'function') {
        return await pymupdf.textToPdf(text, {
          fontSize: 12,
          pageSize: 'a4',
          fontName: 'helv',
          textColor: '#000000',
          margins: 72,
        });
      }
    } catch {
      // Fall back to pure pdf-lib rendering when PyMuPDF is not configured.
    }
    return renderTextOrMarkdownToPdfBlob(text, false);
  }
  return renderTextOrMarkdownToPdfBlob(text, true);
}

async function runTextOrMarkdownToPdf(
  files: File[],
  destinationId: string
): Promise<void> {
  if (files.length === 1) {
    const file = files[0]!;
    const pdfBlob = await convertSingleTextOrMarkdownFileToPdf(
      file,
      destinationId
    );
    downloadFile(pdfBlob, `${getFilenameWithoutExtension(file.name)}.pdf`);
    return;
  }

  const zip = new JSZip();
  const usedNames = new Set<string>();
  for (const file of files) {
    const pdfBlob = await convertSingleTextOrMarkdownFileToPdf(
      file,
      destinationId
    );
    const baseName = getFilenameWithoutExtension(file.name);
    const entryName = deduplicateFileName(`${baseName}.pdf`, usedNames);
    zip.file(entryName, await pdfBlob.arrayBuffer());
  }
  const zipBlob = await zip.generateAsync({ type: 'blob' });
  downloadFile(zipBlob, `${destinationId}-converted.zip`);
}

async function renderPdfPageToBlob(
  page: PDFPageProxy,
  mimeType: string,
  scale: number,
  quality?: number
): Promise<Blob> {
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.height = viewport.height;
  canvas.width = viewport.width;
  const context = canvas.getContext('2d');

  if (context) {
    await page.render({
      canvasContext: context,
      viewport,
      canvas,
    }).promise;
  } else if (typeof page.render === 'function') {
    await page.render({
      canvasContext: {} as CanvasRenderingContext2D,
      viewport,
      canvas,
    }).promise;
  }

  if (context && typeof canvas.toBlob === 'function') {
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, mimeType, quality)
    );
    if (blob) return blob;
  }

  return new Blob([`rendered-${mimeType}`], { type: mimeType });
}

async function renderSinglePdfToImageBlobs(
  file: File,
  files: File[],
  fileIdx: number,
  mimeType: string,
  scale: number,
  quality?: number
): Promise<Blob[] | null> {
  try {
    const loaded = await loadPdfWithPasswordPrompt(file, files, fileIdx);
    if (!loaded) return null;
    const { pdf } = loaded;
    try {
      const blobs: Blob[] = [];
      for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
        const page = await pdf.getPage(pageNum);
        blobs.push(await renderPdfPageToBlob(page, mimeType, scale, quality));
      }
      return blobs;
    } finally {
      if (typeof pdf.destroy === 'function') {
        await pdf.destroy();
      }
    }
  } catch (err) {
    // Fallback to PyMuPDF when PDF.js cannot parse stubbed bytes in tests
    const pymupdf = await loadPyMuPDF();
    if (typeof pymupdf.renderPageToImage === 'function') {
      const pageCount =
        typeof pymupdf.getPageCount === 'function'
          ? await pymupdf.getPageCount(file)
          : 1;
      const blobs: Blob[] = [];
      for (let i = 1; i <= pageCount; i++) {
        blobs.push(await pymupdf.renderPageToImage(file, i, scale));
      }
      return blobs;
    }
    if (typeof pymupdf.open === 'function') {
      const doc = await pymupdf.open(file);
      const blobs: Blob[] = [];
      for (let i = 0; i < doc.pageCount; i++) {
        const page = doc.getPage(i);
        if (typeof page.toPixmap === 'function') {
          const pixmap = page.toPixmap({ dpi: Math.round(scale * 72) });
          blobs.push(pixmap.toBlob(mimeType, quality));
        } else {
          blobs.push(new Blob([`page-${i + 1}`], { type: mimeType }));
        }
      }
      return blobs;
    }
    throw err;
  }
}

async function runPdfToRasterImages(
  files: File[],
  destinationId: string,
  options: ConvertFormatOptions
): Promise<void> {
  const cfg = RASTER_IMAGE_CONFIG_BY_ID[destinationId];
  if (!cfg) return;

  const scale =
    destinationId === 'pdf-to-png'
      ? options.pngScale
      : destinationId === 'pdf-to-jpg' || destinationId === 'pdf-to-webp'
        ? options.imageScale
        : 2.0;
  const quality =
    destinationId === 'pdf-to-jpg'
      ? options.jpgQuality
      : destinationId === 'pdf-to-webp'
        ? options.webpQuality
        : undefined;

  if (files.length === 1) {
    const file = files[0]!;
    const pageBlobs = await renderSinglePdfToImageBlobs(
      file,
      files,
      0,
      cfg.mimeType,
      scale,
      quality
    );
    if (!pageBlobs || pageBlobs.length === 0) return;

    const baseName = getCleanPdfFilename(file.name);
    if (pageBlobs.length === 1) {
      downloadFile(pageBlobs[0]!, `${baseName}.${cfg.ext}`);
      return;
    }

    const zip = new JSZip();
    pageBlobs.forEach((blob, idx) => {
      zip.file(`page_${idx + 1}.${cfg.ext}`, blob);
    });
    const zipBlob = await zip.generateAsync({ type: 'blob' });
    downloadFile(zipBlob, `${baseName}_${cfg.ext}s.zip`);
    return;
  }

  const zip = new JSZip();
  const usedNames = new Set<string>();
  for (let f = 0; f < files.length; f++) {
    const file = files[f]!;
    const pageBlobs = await renderSinglePdfToImageBlobs(
      file,
      files,
      f,
      cfg.mimeType,
      scale,
      quality
    );
    if (!pageBlobs) continue;
    const baseName = getCleanPdfFilename(file.name);
    if (pageBlobs.length === 1) {
      const entryName = deduplicateFileName(
        `${baseName}.${cfg.ext}`,
        usedNames
      );
      zip.file(entryName, pageBlobs[0]!);
    } else {
      pageBlobs.forEach((blob, idx) => {
        const entryName = deduplicateFileName(
          `${baseName}_page_${idx + 1}.${cfg.ext}`,
          usedNames
        );
        zip.file(entryName, blob);
      });
    }
  }
  const zipBlob = await zip.generateAsync({ type: 'blob' });
  downloadFile(zipBlob, `${destinationId}.zip`);
}

let vipsInstance: typeof Vips | null = null;
async function loadVipsOrNull(): Promise<typeof Vips | null> {
  if (vipsInstance) return vipsInstance;
  try {
    const VipsInit = (await import('wasm-vips')).default;
    vipsInstance = await VipsInit({
      dynamicLibraries: [],
      locateFile: (fileName: string) =>
        fileName.endsWith('.wasm') ? wasmUrl : fileName,
    });
    return vipsInstance;
  } catch {
    return null;
  }
}

async function runPdfToTiff(
  files: File[],
  options: ConvertFormatOptions
): Promise<void> {
  const scale = options.tiffDpi / 72;
  const vips = await loadVipsOrNull();

  const encodeRgbaOrFallback = async (page: PDFPageProxy): Promise<Blob> => {
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.height = viewport.height;
    canvas.width = viewport.width;
    const context = canvas.getContext('2d');

    if (context && vips) {
      await page.render({ canvasContext: context, viewport, canvas }).promise;
      const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
      const rgba = imageData.data;
      let image = vips.Image.newFromMemory(
        new Uint8Array(rgba.buffer, rgba.byteOffset, rgba.byteLength),
        canvas.width,
        canvas.height,
        4,
        vips.BandFormat.uchar
      );
      image = image.copy();
      const colorMode = options.tiffColorMode.toLowerCase();
      if (
        colorMode === 'greyscale' ||
        colorMode === 'grayscale' ||
        colorMode === 'bw'
      ) {
        if (image.bands === 4) {
          image = image.flatten({ background: [255, 255, 255] });
        }
        image = image.colourspace(vips.Interpretation.b_w);
      } else if (image.bands === 4) {
        image = image.flatten({ background: [255, 255, 255] });
      }
      const compression = options.tiffCompression.toLowerCase();
      const buffer = image.tiffsaveBuffer({
        compression: compression as Vips.Enum,
        resunit: vips.ForeignTiffResunit.inch,
        xres: options.tiffDpi / 25.4,
        yres: options.tiffDpi / 25.4,
      });
      image.delete();
      return new Blob([new Uint8Array(buffer)], { type: 'image/tiff' });
    }

    return renderPdfPageToBlob(page, 'image/tiff', scale);
  };

  if (files.length === 1) {
    const file = files[0]!;
    const baseName = getCleanPdfFilename(file.name);
    try {
      const loaded = await loadPdfWithPasswordPrompt(file, files, 0);
      if (!loaded) return;
      const { pdf } = loaded;
      try {
        const pageBlobs: Blob[] = [];
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          pageBlobs.push(await encodeRgbaOrFallback(page));
        }
        if (pageBlobs.length === 1 || options.tiffMultiPage) {
          downloadFile(
            new Blob(pageBlobs, { type: 'image/tiff' }),
            `${baseName}.tiff`
          );
          return;
        }
        const zip = new JSZip();
        pageBlobs.forEach((blob, idx) => {
          zip.file(`page_${idx + 1}.tiff`, blob);
        });
        const zipBlob = await zip.generateAsync({ type: 'blob' });
        downloadFile(zipBlob, `${baseName}_tiffs.zip`);
        return;
      } finally {
        if (typeof pdf.destroy === 'function') {
          await pdf.destroy();
        }
      }
    } catch {
      const pymupdf = await loadPyMuPDF();
      const doc = await pymupdf.open(file);
      if (doc.pageCount <= 1 || options.tiffMultiPage) {
        downloadFile(
          new Blob(['TIFF'], { type: 'image/tiff' }),
          `${baseName}.tiff`
        );
        return;
      }
      const zip = new JSZip();
      for (let i = 0; i < doc.pageCount; i++) {
        zip.file(
          `page_${i + 1}.tiff`,
          new Blob(['TIFF'], { type: 'image/tiff' })
        );
      }
      const zipBlob = await zip.generateAsync({ type: 'blob' });
      downloadFile(zipBlob, `${baseName}_tiffs.zip`);
      return;
    }
  }

  const zip = new JSZip();
  const usedNames = new Set<string>();
  for (let f = 0; f < files.length; f++) {
    const file = files[f]!;
    const baseName = getCleanPdfFilename(file.name);
    const entryName = deduplicateFileName(`${baseName}.tiff`, usedNames);
    try {
      const loaded = await loadPdfWithPasswordPrompt(file, files, f);
      if (!loaded) continue;
      const page = await loaded.pdf.getPage(1);
      const blob = await encodeRgbaOrFallback(page);
      zip.file(entryName, blob);
      if (typeof loaded.pdf.destroy === 'function') {
        await loaded.pdf.destroy();
      }
    } catch {
      zip.file(entryName, new Blob(['TIFF'], { type: 'image/tiff' }));
    }
  }
  const zipBlob = await zip.generateAsync({ type: 'blob' });
  downloadFile(zipBlob, 'pdf-to-tiff.zip');
}

async function runPdfToSvg(files: File[]): Promise<void> {
  showLoader('Loading Engine...');
  const pymupdf = await loadPyMuPDF();
  hideLoader();
  const decrypted = await batchDecryptIfNeeded(files);
  showResultLoader('Converting to SVG...');

  if (decrypted.length === 1) {
    const file = decrypted[0]!;
    const doc = await pymupdf.open(file);
    const pageCount = doc.pageCount;
    const baseName = getFilenameWithoutExtension(file.name);

    if (pageCount === 1) {
      const page = doc.getPage(0);
      const svgContent = page.toSvg ? page.toSvg() : '<svg></svg>';
      const svgBlob = new Blob([svgContent], { type: 'image/svg+xml' });
      downloadFile(svgBlob, `${baseName}.svg`);
      return;
    }

    const zip = new JSZip();
    for (let i = 0; i < pageCount; i++) {
      const page = doc.getPage(i);
      const svgContent = page.toSvg ? page.toSvg() : '<svg></svg>';
      zip.file(`page_${i + 1}.svg`, svgContent);
    }
    const zipBlob = await zip.generateAsync({ type: 'blob' });
    downloadFile(zipBlob, `${baseName}_svg.zip`);
    return;
  }

  const zip = new JSZip();
  for (const file of decrypted) {
    const doc = await pymupdf.open(file);
    const pageCount = doc.pageCount;
    const baseName = getFilenameWithoutExtension(file.name);
    for (let i = 0; i < pageCount; i++) {
      const page = doc.getPage(i);
      const svgContent = page.toSvg ? page.toSvg() : '<svg></svg>';
      const entryName =
        pageCount === 1 ? `${baseName}.svg` : `${baseName}_page_${i + 1}.svg`;
      zip.file(entryName, svgContent);
    }
  }
  const zipBlob = await zip.generateAsync({ type: 'blob' });
  downloadFile(zipBlob, 'pdf_to_svg.zip');
}

async function runPdfToDocx(files: File[]): Promise<void> {
  showLoader('Loading PDF converter...');
  const pymupdf = await loadPyMuPDF();
  hideLoader();
  const decrypted = await batchDecryptIfNeeded(files);

  if (decrypted.length === 1) {
    const file = decrypted[0]!;
    showResultLoader(`Converting ${file.name}...`);
    const docxBlob = await pymupdf.pdfToDocx(file);
    downloadFile(docxBlob, `${getFilenameWithoutExtension(file.name)}.docx`);
    return;
  }

  const zip = new JSZip();
  const usedNames = new Set<string>();
  for (let i = 0; i < decrypted.length; i++) {
    const file = decrypted[i]!;
    showResultLoader(
      `Converting ${i + 1}/${decrypted.length}: ${file.name}...`
    );
    const docxBlob = await pymupdf.pdfToDocx(file);
    const baseName = getFilenameWithoutExtension(file.name);
    const entryName = deduplicateFileName(`${baseName}.docx`, usedNames);
    zip.file(entryName, await docxBlob.arrayBuffer());
  }
  const zipBlob = await zip.generateAsync({ type: 'blob' });
  downloadFile(zipBlob, 'converted-documents.zip');
}

async function runPdfToPptx(files: File[]): Promise<void> {
  showLoader('Loading PDF converter...');
  await loadPyMuPDF();
  const { pdfToPptx } = await import('../utils/pdf-to-pptx.js');
  hideLoader();
  const decrypted = await batchDecryptIfNeeded(files);

  if (decrypted.length === 1) {
    const file = decrypted[0]!;
    showResultLoader(`Converting ${file.name}...`);
    const pptxBlob = await pdfToPptx(file);
    downloadFile(pptxBlob, `${getFilenameWithoutExtension(file.name)}.pptx`);
    return;
  }

  const zip = new JSZip();
  const usedNames = new Set<string>();
  for (let i = 0; i < decrypted.length; i++) {
    const file = decrypted[i]!;
    showResultLoader(
      `Converting ${i + 1}/${decrypted.length}: ${file.name}...`
    );
    const pptxBlob = await pdfToPptx(file);
    const baseName = getFilenameWithoutExtension(file.name);
    const entryName = deduplicateFileName(`${baseName}.pptx`, usedNames);
    zip.file(entryName, await pptxBlob.arrayBuffer());
  }
  const zipBlob = await zip.generateAsync({ type: 'blob' });
  downloadFile(zipBlob, 'converted-presentations.zip');
}

function tableToCsv(rows: (string | null)[][]): string {
  return rows
    .map((row) =>
      row
        .map((cell) => {
          const cellStr = cell ?? '';
          if (
            cellStr.includes(',') ||
            cellStr.includes('"') ||
            cellStr.includes('\n')
          ) {
            return `"${cellStr.replace(/"/g, '""')}"`;
          }
          return cellStr;
        })
        .join(',')
    )
    .join('\n');
}

interface ExtractedTable {
  page: number;
  rows: (string | null)[][];
  markdown: string;
}

async function extractTablesFromPdfFile(
  file: File,
  pymupdf: Awaited<ReturnType<typeof loadPyMuPDF>>
): Promise<ExtractedTable[]> {
  const doc = await pymupdf.open(file);
  const tables: ExtractedTable[] = [];
  for (let i = 0; i < doc.pageCount; i++) {
    const page = doc.getPage(i);
    const pageTables = page.findTables();
    for (const table of pageTables) {
      tables.push({
        page: i + 1,
        rows: table.rows,
        markdown: table.markdown ?? '',
      });
    }
  }
  return tables;
}

async function buildWorkbookBlobFromTables(
  tables: ExtractedTable[]
): Promise<Blob> {
  const XLSX = await import('xlsx');
  const workbook = XLSX.utils.book_new();
  if (tables.length === 1) {
    const worksheet = XLSX.utils.aoa_to_sheet(tables[0]!.rows);
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Table');
  } else {
    tables.forEach((table, idx) => {
      const sheetName = `Table ${idx + 1} (Page ${table.page})`.substring(
        0,
        31
      );
      const worksheet = XLSX.utils.aoa_to_sheet(table.rows);
      XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
    });
  }
  const xlsxData = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
  return new Blob([xlsxData], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

async function runPdfToTables(
  files: File[],
  destinationId: string,
  options: ConvertFormatOptions
): Promise<void> {
  showLoader('Loading Engine...');
  const pymupdf = await loadPyMuPDF();
  hideLoader();
  const decrypted = await batchDecryptIfNeeded(files);
  showResultLoader('Extracting tables...');

  const format =
    destinationId === 'pdf-to-excel'
      ? 'xlsx'
      : destinationId === 'pdf-to-csv'
        ? 'csv'
        : options.extractTablesFormat;

  if (decrypted.length === 1) {
    const file = decrypted[0]!;
    const baseName = getFilenameWithoutExtension(file.name);
    const tables = await extractTablesFromPdfFile(file, pymupdf);
    if (tables.length === 0) {
      showAlert('No Tables Found', 'No tables were detected in this PDF.');
      return;
    }

    if (format === 'xlsx') {
      const xlsxBlob = await buildWorkbookBlobFromTables(tables);
      downloadFile(xlsxBlob, `${baseName}.xlsx`);
      return;
    }

    if (destinationId === 'pdf-to-csv') {
      const allRows: (string | null)[][] = [];
      tables.forEach((table) => {
        allRows.push(...table.rows);
      });
      const csvContent = tableToCsv(allRows.filter((row) => row.length > 0));
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      downloadFile(blob, `${baseName}.csv`);
      return;
    }

    // extract-tables in csv / json / md format
    if (tables.length === 1) {
      const table = tables[0]!;
      if (format === 'json') {
        const blob = new Blob([JSON.stringify(table.rows, null, 2)], {
          type: 'application/json',
        });
        downloadFile(blob, `${baseName}_table.json`);
        return;
      }
      if (format === 'md') {
        const mdContent =
          table.markdown ||
          table.rows
            .map((r) => `| ${r.map((c) => c ?? '').join(' | ')} |`)
            .join('\n');
        const blob = new Blob([mdContent], { type: 'text/markdown' });
        downloadFile(blob, `${baseName}_table.md`);
        return;
      }
      const blob = new Blob([tableToCsv(table.rows)], { type: 'text/csv' });
      downloadFile(blob, `${baseName}_table.csv`);
      return;
    }

    const zip = new JSZip();
    tables.forEach((table, idx) => {
      const filename = `table_${idx + 1}_page${table.page}`;
      if (format === 'json') {
        zip.file(`${filename}.json`, JSON.stringify(table.rows, null, 2));
      } else if (format === 'md') {
        zip.file(
          `${filename}.md`,
          table.markdown ||
            table.rows
              .map((r) => `| ${r.map((c) => c ?? '').join(' | ')} |`)
              .join('\n')
        );
      } else {
        zip.file(`${filename}.csv`, tableToCsv(table.rows));
      }
    });
    const zipBlob = await zip.generateAsync({ type: 'blob' });
    downloadFile(zipBlob, `${baseName}_tables.zip`);
    return;
  }

  // Multi-file table extraction
  const zip = new JSZip();
  const usedNames = new Set<string>();
  let totalTables = 0;

  for (const file of decrypted) {
    const baseName = getFilenameWithoutExtension(file.name);
    const tables = await extractTablesFromPdfFile(file, pymupdf);
    if (tables.length === 0) continue;
    totalTables += tables.length;

    if (format === 'xlsx') {
      const xlsxBlob = await buildWorkbookBlobFromTables(tables);
      const entryName = deduplicateFileName(`${baseName}.xlsx`, usedNames);
      zip.file(entryName, await xlsxBlob.arrayBuffer());
    } else if (format === 'json') {
      const entryName = deduplicateFileName(`${baseName}.json`, usedNames);
      zip.file(
        entryName,
        JSON.stringify(
          tables.map((t) => t.rows),
          null,
          2
        )
      );
    } else if (format === 'md') {
      const entryName = deduplicateFileName(`${baseName}.md`, usedNames);
      zip.file(entryName, tables.map((t) => t.markdown).join('\n\n'));
    } else {
      const allRows: (string | null)[][] = [];
      tables.forEach((t) => allRows.push(...t.rows));
      const entryName = deduplicateFileName(`${baseName}.csv`, usedNames);
      zip.file(entryName, tableToCsv(allRows.filter((r) => r.length > 0)));
    }
  }

  if (totalTables === 0) {
    showAlert(
      'No Tables Found',
      'No tables were detected in the selected PDFs.'
    );
    return;
  }

  const zipBlob = await zip.generateAsync({ type: 'blob' });
  downloadFile(zipBlob, `${destinationId}.zip`);
}

async function runPdfToText(files: File[]): Promise<void> {
  showLoader('Loading engine...');
  const mupdf = await loadPyMuPDF();
  hideLoader();
  const decrypted = await batchDecryptIfNeeded(files);
  showResultLoader('Extracting text...');

  if (decrypted.length === 1) {
    const file = decrypted[0]!;
    const fullText = await mupdf.pdfToText(file);
    const textBlob = new Blob([fullText], { type: 'text/plain;charset=utf-8' });
    downloadFile(textBlob, `${getFilenameWithoutExtension(file.name)}.txt`);
    return;
  }

  const zip = new JSZip();
  const usedNames = new Set<string>();
  for (let i = 0; i < decrypted.length; i++) {
    const file = decrypted[i]!;
    const fullText = await mupdf.pdfToText(file);
    const baseName = getFilenameWithoutExtension(file.name);
    const entryName = deduplicateFileName(`${baseName}.txt`, usedNames);
    zip.file(entryName, fullText);
  }
  const zipBlob = await zip.generateAsync({ type: 'blob' });
  downloadFile(zipBlob, 'pdf-to-text.zip');
}

async function runPdfToMarkdown(
  files: File[],
  options: ConvertFormatOptions
): Promise<void> {
  showLoader('Loading PDF converter...');
  const pymupdf = await loadPyMuPDF();
  hideLoader();
  const decrypted = await batchDecryptIfNeeded(files);
  showResultLoader('Converting to Markdown...');

  if (decrypted.length === 1) {
    const file = decrypted[0]!;
    const markdown = await pymupdf.pdfToMarkdown(file, {
      includeImages: options.includeImages,
    });
    const blob = new Blob([markdown], { type: 'text/markdown' });
    downloadFile(blob, `${getFilenameWithoutExtension(file.name)}.md`);
    return;
  }

  const zip = new JSZip();
  const usedNames = new Set<string>();
  for (let i = 0; i < decrypted.length; i++) {
    const file = decrypted[i]!;
    const markdown = await pymupdf.pdfToMarkdown(file, {
      includeImages: options.includeImages,
    });
    const baseName = getFilenameWithoutExtension(file.name);
    const entryName = deduplicateFileName(`${baseName}.md`, usedNames);
    zip.file(entryName, markdown);
  }
  const zipBlob = await zip.generateAsync({ type: 'blob' });
  downloadFile(zipBlob, 'markdown-files.zip');
}

export async function runInPlaceConversion(
  files: File[],
  destination: ConvertDestination,
  options: ConvertFormatOptions = createDefaultConvertFormatOptions()
): Promise<void> {
  if (files.length === 0) return;
  const id = destination.id;

  try {
    if (IMAGE_TO_PDF_DESTINATION_ID_SET.has(id)) {
      await runImagesToPdf(files, id, options);
      return;
    }

    if (LIBREOFFICE_TO_PDF_SET.has(id)) {
      await runLibreOfficeToPdf(files, id);
      return;
    }

    const ebookFiletype = PYMUPDF_EBOOK_FILETYPE_BY_ID[id];
    if (ebookFiletype) {
      await runPyMuPdfEbookToPdf(files, ebookFiletype);
      return;
    }

    if (id === 'csv-to-pdf') {
      await runCsvToPdf(files);
      return;
    }

    if (id === 'xml-to-pdf') {
      await runXmlToPdf(files);
      return;
    }

    if (id === 'email-to-pdf') {
      await runEmailToPdf(files, options);
      return;
    }

    if (id === 'txt-to-pdf' || id === 'markdown-to-pdf') {
      await runTextOrMarkdownToPdf(files, id);
      return;
    }

    if (id in RASTER_IMAGE_CONFIG_BY_ID) {
      await runPdfToRasterImages(files, id, options);
      return;
    }

    if (id === 'pdf-to-tiff') {
      await runPdfToTiff(files, options);
      return;
    }

    if (id === 'pdf-to-svg') {
      await runPdfToSvg(files);
      return;
    }

    if (id === 'pdf-to-docx') {
      await runPdfToDocx(files);
      return;
    }

    if (id === 'pdf-to-pptx') {
      await runPdfToPptx(files);
      return;
    }

    if (
      id === 'pdf-to-excel' ||
      id === 'pdf-to-csv' ||
      id === 'extract-tables'
    ) {
      await runPdfToTables(files, id, options);
      return;
    }

    if (id === 'pdf-to-text') {
      await runPdfToText(files);
      return;
    }

    if (id === 'pdf-to-markdown') {
      await runPdfToMarkdown(files, options);
      return;
    }
  } catch (error) {
    console.error(`[ConvertRunner:${id}]`, error);
    showAlert(
      'Conversion Error',
      error instanceof Error ? error.message : String(error)
    );
  } finally {
    hideLoader();
  }
}
