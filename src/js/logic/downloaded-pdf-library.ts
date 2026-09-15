/**
 * Tool output used to auto-download and auto-add a My PDFs row. Downloads stay
 * browser-file only; a handled PDF can still be written in place when the
 * tool publishes output.
 */
import { registerPdfOutputInterceptor } from '../utils/helpers.js';
import { syncHomeLibraryFromStore } from './workspace-files.js';
import { writePdfThroughHandle } from './pdf-file-handle.js';
import {
  findWritableLibraryEntry,
  updatePdfInLibrary,
} from './pdf-library-store.js';
import { getWorkspaceFiles } from './workspace-files.js';

const boundRoots = new WeakSet<Document>();

export function initDownloadedPdfLibrary(root: Document = document): void {
  if (boundRoots.has(root)) return;
  boundRoots.add(root);

  registerPdfOutputInterceptor((blob) => saveInPlaceIfPossible(blob, root));
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
