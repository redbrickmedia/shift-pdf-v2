import type { PDFDocument } from 'pdf-lib';
import { loadPdfDocument } from './load-pdf-document.js';
import { flattenAnnotations } from './flatten-annotations.js';

export interface SignPdfDocument {
  annotationStorage: unknown;
  saveDocument: () => Promise<ArrayBuffer | Uint8Array>;
}

interface FlattenDependencies {
  loadDocument: (bytes: Uint8Array) => Promise<PDFDocument>;
  flatten: (document: PDFDocument) => void;
}

const defaultFlattenDependencies: FlattenDependencies = {
  loadDocument: loadPdfDocument,
  flatten: flattenAnnotations,
};

export function getSignedPdfFilename(
  originalFilename: string | undefined,
  flattened = false
): string {
  const filename = originalFilename?.trim() || 'document.pdf';
  const base = filename.replace(/\.pdf$/i, '') || 'document';
  return `${base}${flattened ? '_signed_flattened' : '_signed'}.pdf`;
}

export async function exportPdfJsAnnotations(
  pdfDocument: SignPdfDocument
): Promise<Uint8Array> {
  const bytes = await pdfDocument.saveDocument();
  return bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
}

export async function exportFlattenedSignedPdf(
  pdfDocument: SignPdfDocument,
  dependencies: FlattenDependencies = defaultFlattenDependencies
): Promise<Uint8Array> {
  const annotatedBytes = await exportPdfJsAnnotations(pdfDocument);
  const document = await dependencies.loadDocument(annotatedBytes);

  document.getForm().flatten();
  dependencies.flatten(document);

  return new Uint8Array(await document.save());
}
