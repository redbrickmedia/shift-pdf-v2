import 'pdfjs-dist';
import 'pdfjs-dist/types/src/display/api';

declare module 'pdfjs-dist' {
  interface PDFDocumentProxy {
    /**
     * Shift compatibility method installed by the centralized PDF.js loader.
     */
    destroy(): Promise<void>;
  }
}

declare module 'pdfjs-dist/types/src/display/api' {
  interface PDFDocumentProxy {
    /**
     * Shift compatibility method installed by the centralized PDF.js loader.
     */
    destroy(): Promise<void>;
  }
}
