import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import type {
  DocumentInitParameters,
  PDFDocumentLoadingTask,
  PDFDocumentProxy,
} from 'pdfjs-dist/types/src/display/api';

export const PDFJS_WORKER_SRC = new URL(
  'pdfjs-dist/legacy/build/pdf.worker.min.mjs',
  import.meta.url
).toString();

export const PDFJS_WASM_URL = import.meta.env.BASE_URL + 'pdfjs-viewer/wasm/';

pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_SRC;

export { pdfjsLib };
export const { PasswordResponses } = pdfjsLib;

export type ShiftPDFDocumentProxy = PDFDocumentProxy & {
  destroy(): Promise<void>;
};

export type ShiftPDFDocumentLoadingTask = Omit<
  PDFDocumentLoadingTask,
  'promise'
> & {
  readonly promise: Promise<ShiftPDFDocumentProxy>;
};

type PDFWorkerInstance = InstanceType<typeof pdfjsLib.PDFWorker>;

let sharedWorker: PDFWorkerInstance | null = null;

/**
 * PDF.js boots a dedicated worker for every `getDocument` call unless one is
 * supplied, and destroys it again on `loadingTask.destroy()`. Pages that load
 * several documents at once (sidebar thumbnails, encryption probes and the tool
 * itself) would otherwise race to spin up a worker plus WASM module each, and a
 * document teardown could take a worker another load still needed. One shared
 * worker multiplexes all of them over a single port.
 */
export function getSharedPDFWorker(): PDFWorkerInstance | undefined {
  if (typeof Worker === 'undefined') return undefined;
  if (sharedWorker && !sharedWorker.destroyed) return sharedWorker;

  try {
    sharedWorker = new pdfjsLib.PDFWorker();
  } catch {
    sharedWorker = null;
  }

  return sharedWorker ?? undefined;
}

/**
 * Load a PDF using the Shift-compatible PDF.js legacy build and shared assets.
 */
export function getPDFDocument(
  src: string | Uint8Array | ArrayBuffer | DocumentInitParameters
): ShiftPDFDocumentLoadingTask {
  let params: DocumentInitParameters;

  if (typeof src === 'string') {
    params = { url: src };
  } else if (src instanceof Uint8Array || src instanceof ArrayBuffer) {
    params = { data: src };
  } else {
    params = src;
  }

  const loadingTask = pdfjsLib.getDocument({
    ...params,
    wasmUrl: PDFJS_WASM_URL,
    worker: params.worker ?? getSharedPDFWorker(),
  });

  void loadingTask.promise.then(
    (document) => {
      if (!('destroy' in document)) {
        Object.defineProperty(document, 'destroy', {
          configurable: true,
          value: () => loadingTask.destroy(),
        });
      }
    },
    () => {
      // The caller observes loading failures through the original promise.
    }
  );

  return loadingTask as unknown as ShiftPDFDocumentLoadingTask;
}
