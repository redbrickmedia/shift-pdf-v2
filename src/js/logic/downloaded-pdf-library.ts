import {
  PDF_OUTPUT_DOWNLOADED_EVENT,
  registerPdfOutputInterceptor,
} from '../utils/helpers.js';
import { syncHomeLibraryFromStore } from './home-files.js';
import { writePdfThroughHandle } from './pdf-file-handle.js';
import {
  addPdfToLibrary,
  findWritableLibraryEntry,
  updatePdfInLibrary,
} from './pdf-library-store.js';
import { getWorkspaceFiles } from './workspace-files.js';

type DownloadedPdfDetail = {
  blob: Blob;
  filename: string;
};

const boundRoots = new WeakSet<Document>();

export function initDownloadedPdfLibrary(root: Document = document): void {
  if (boundRoots.has(root)) return;
  boundRoots.add(root);

  registerPdfOutputInterceptor((blob) => saveInPlaceIfPossible(blob, root));

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

async function saveInPlaceIfPossible(
  blob: Blob,
  root: Document
): Promise<boolean> {
  const selected = getWorkspaceFiles();
  if (selected.length !== 1 || !selected[0]) return false;

  const entry = await findWritableLibraryEntry(selected[0]);
  if (!entry?.handle) return false;

  try {
    await writePdfThroughHandle(entry.handle, blob);
    const file = new File([blob], entry.name, { type: 'application/pdf' });
    await updatePdfInLibrary(entry.id, { file });
    await syncHomeLibraryFromStore(root);
    return true;
  } catch {
    return false;
  }
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
