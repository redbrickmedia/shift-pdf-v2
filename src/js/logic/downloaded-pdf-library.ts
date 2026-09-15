import {
  PDF_OUTPUT_DOWNLOADED_EVENT,
  registerPdfOutputInterceptor,
} from '../utils/helpers.js';
import { confirmAction } from './confirm-dialog.js';
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

  registerPdfOutputInterceptor((blob) => handlePdfOutput(blob, root));

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

async function handlePdfOutput(blob: Blob, root: Document): Promise<boolean> {
  const selected = getWorkspaceFiles();
  if (selected.length !== 1 || !selected[0]) return false;
  const selectedFile = selected[0];
  if (!selectedFile.handle) return false;

  const entry = await findWritableLibraryEntry(selectedFile);
  const handle = entry?.handle ?? selectedFile.handle;
  const filename = entry?.name ?? selectedFile.name;

  const shouldSave = await confirmAction({
    root,
    title: 'Save changes to disk?',
    message: `This will replace ${filename} with the updated PDF.`,
    confirmLabel: 'Save changes',
    cancelLabel: 'Keep editing',
  });
  if (!shouldSave) return true;

  try {
    await writePdfThroughHandle(handle, blob);
    if (entry) {
      const file = new File([blob], filename, { type: 'application/pdf' });
      await updatePdfInLibrary(entry.id, { file, handle });
      await syncHomeLibraryFromStore(root);
    }
  } catch (error) {
    await confirmAction({
      root,
      title: 'Could not save changes',
      message:
        error instanceof Error
          ? error.message
          : 'Shift could not save changes to this PDF.',
      confirmLabel: 'OK',
      cancelLabel: 'Close',
    });
  }
  return true;
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
