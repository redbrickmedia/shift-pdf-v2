/**
 * Tool output used to auto-download and auto-add a My PDFs row. Downloads stay
 * browser-file only. A handled PDF can still be written in place after the
 * user confirms, when the tool publishes output.
 */
import { registerPdfOutputInterceptor } from '../utils/helpers.js';
import { confirmAction } from './confirm-dialog.js';
import { writePdfThroughHandle } from './pdf-file-handle.js';
import {
  findWritableLibraryEntry,
  updatePdfInLibrary,
} from './pdf-library-store.js';
import {
  getWorkspaceFiles,
  syncHomeLibraryFromStore,
} from './workspace-files.js';

const boundRoots = new WeakSet<Document>();

export function initDownloadedPdfLibrary(root: Document = document): void {
  if (boundRoots.has(root)) return;
  boundRoots.add(root);

  registerPdfOutputInterceptor((blob) => handlePdfOutput(blob, root));
}

async function handlePdfOutput(blob: Blob, root: Document): Promise<boolean> {
  const selected = getWorkspaceFiles();
  if (selected.length !== 1 || !selected[0]) return false;
  const selectedFile = selected[0];

  const entry = await findWritableLibraryEntry(selectedFile);
  const handle = entry?.handle ?? selectedFile.handle;
  if (!handle) return false;
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
