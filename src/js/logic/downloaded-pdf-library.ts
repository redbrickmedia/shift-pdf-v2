import { PDF_OUTPUT_DOWNLOADED_EVENT } from '../utils/helpers.js';
import { syncHomeLibraryFromStore } from './home-files.js';
import { addPdfToLibrary } from './pdf-library-store.js';

type DownloadedPdfDetail = {
  blob: Blob;
  filename: string;
};

const boundRoots = new WeakSet<Document>();

export function initDownloadedPdfLibrary(root: Document = document): void {
  if (boundRoots.has(root)) return;
  boundRoots.add(root);

  root.addEventListener(PDF_OUTPUT_DOWNLOADED_EVENT, (event) => {
    const detail = (event as CustomEvent<DownloadedPdfDetail>).detail;
    if (
      !(detail?.blob instanceof Blob) ||
      typeof detail.filename !== 'string' ||
      !detail.filename.trim()
    ) {
      return;
    }

    void saveDownloadedPdf(detail.blob, detail.filename, root);
  });
}

async function saveDownloadedPdf(
  blob: Blob,
  filename: string,
  root: Document
): Promise<void> {
  const file = new File([blob], filename, { type: 'application/pdf' });
  await addPdfToLibrary(file, 'download');
  await syncHomeLibraryFromStore(root);
}
