import { PDFDocument } from 'pdf-lib';

export interface SignPdfState {
  file: File | null;
  pdfBytes: ArrayBuffer | null;
  signatureData: string | null;
}

export interface PDFViewerEventBus {
  on?: (event: string, callback: (event?: unknown) => void) => void;
  off?: (event: string, callback: (event?: unknown) => void) => void;
  _on: (event: string, callback: (event?: unknown) => void) => void;
  dispatch: (event: string, data: Record<string, unknown>) => void;
}

export interface PDFViewerApplication {
  eventBus?: PDFViewerEventBus;
  pdfDocument?: {
    saveDocument: (storage?: unknown) => Promise<ArrayBuffer | Uint8Array>;
    annotationStorage: unknown;
    numPages?: number;
  };
  pdfViewer?: {
    pageViewsReady?: boolean;
    _layerProperties?: {
      annotationEditorUIManager?: {
        undo?: () => void;
        redo?: () => void;
      } | null;
    };
  };
  triggerPrinting?: () => Promise<void>;
  /** PDF.js private field used for toolbar Save/Download naming. */
  _contentDispositionFilename?: string | null;
  _title?: string;
  setTitle?: (title: string) => void;
  url?: string;
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
