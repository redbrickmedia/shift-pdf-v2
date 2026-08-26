import { PDFDocument } from 'pdf-lib';

export interface SignPdfState {
  file: File | null;
  pdfBytes: ArrayBuffer | null;
  signatureData: string | null;
}

export interface PDFViewerEventBus {
  _on: (event: string, callback: () => void) => void;
  dispatch: (event: string, data: Record<string, unknown>) => void;
}

export interface PDFViewerApplication {
  eventBus?: PDFViewerEventBus;
  pdfDocument?: {
    saveDocument: (storage?: unknown) => Promise<ArrayBuffer | Uint8Array>;
    annotationStorage: unknown;
  };
  triggerPrinting?: () => Promise<void>;
}

export interface PDFViewerWindow extends Window {
  PDFViewerApplication?: PDFViewerApplication;
}

export interface SignState {
  file: File | null;
  pdfDoc: PDFDocument | null;
  viewerIframe: HTMLIFrameElement | null;
  viewerReady: boolean;
  blobUrl: string | null;
}
