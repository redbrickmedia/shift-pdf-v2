import { PDF_OUTPUT_READY_EVENT } from '../utils/helpers.js';
import { writePdfThroughHandle } from './pdf-file-handle.js';
import {
  addPdfToLibrary,
  readPdfLibraryEntry,
  replacePdfInLibrary,
} from './pdf-library-store.js';
import {
  getHomeLibraryEpoch,
  getPrimaryLibrarySaveTarget,
  getWorkspaceFiles,
  syncHomeLibraryFromStore,
} from './workspace-files.js';

export type PdfOutputDetail = {
  blob: Blob;
  filename: string;
  summary?: string;
};

export type SaveToShiftPdfResult = 'added' | 'skipped';
export type OverwriteToShiftPdfResult = 'replaced' | 'skipped';

export const SAVE_TO_SHIFT_PDF_LABEL = 'Save';
export const OVERWRITE_TO_SHIFT_PDF_LABEL = 'Overwrite';

type LatestOutput = PdfOutputDetail & { isPdf: boolean };

const boundRoots = new WeakSet<Document>();
let latestOutput: LatestOutput | null = null;
export const TOOL_OUTPUT_STATE_EVENT = 'shift:tool-output-state-changed';

export function isPdfOutput(blob: Blob, filename: string): boolean {
  return (
    blob.type === 'application/pdf' || filename.toLowerCase().endsWith('.pdf')
  );
}

export function isZipOutput(blob: Blob, filename: string): boolean {
  return (
    blob.type === 'application/zip' ||
    blob.type === 'application/x-zip-compressed' ||
    filename.toLowerCase().endsWith('.zip')
  );
}

function filenameOf(path: string): string {
  const slash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return slash >= 0 ? path.slice(slash + 1) : path;
}

export async function unpackPdfsFromZip(blob: Blob): Promise<File[]> {
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(blob);
  const files: File[] = [];
  const entries = Object.values(zip.files);
  for (const entry of entries) {
    if (entry.dir || !entry.name.toLowerCase().endsWith('.pdf')) continue;
    const bytes = await entry.async('arraybuffer');
    files.push(
      new File([bytes], filenameOf(entry.name), { type: 'application/pdf' })
    );
  }
  return files;
}

export function canSaveToShiftPdf(
  output: PdfOutputDetail | null = latestOutput,
  options?: { allowMultiPdfZip?: boolean }
): boolean {
  if (!output) return false;
  if (isPdfOutput(output.blob, output.filename)) return true;
  if (options?.allowMultiPdfZip && isZipOutput(output.blob, output.filename)) {
    return true;
  }
  return false;
}

export function canOverwriteToShiftPdf(
  output: PdfOutputDetail | null = latestOutput
): boolean {
  return (
    Boolean(output && isPdfOutput(output.blob, output.filename)) &&
    Boolean(getPrimaryLibrarySaveTarget())
  );
}

export function getLatestPdfOutput(): LatestOutput | null {
  return latestOutput;
}

export function setLatestPdfOutput(
  detail: PdfOutputDetail,
  root: Document = document
): void {
  latestOutput = {
    ...detail,
    isPdf: isPdfOutput(detail.blob, detail.filename),
  };
  root.dispatchEvent(new CustomEvent(TOOL_OUTPUT_STATE_EVENT));
}

export function clearLatestPdfOutput(root: Document = document): void {
  latestOutput = null;
  root.dispatchEvent(new CustomEvent(TOOL_OUTPUT_STATE_EVENT));
}

export async function saveToShiftPdf(
  blob: Blob,
  filename: string,
  root: Document = document,
  options?: { allowMultiPdfZip?: boolean }
): Promise<SaveToShiftPdfResult> {
  if (isPdfOutput(blob, filename)) {
    const epoch = getHomeLibraryEpoch();
    const file = new File([blob], filename, {
      type: blob.type || 'application/pdf',
    });

    await addPdfToLibrary(file, 'upload');
    if (epoch !== getHomeLibraryEpoch()) {
      return 'skipped';
    }
    await syncHomeLibraryFromStore(root, getHomeLibraryEpoch());
    return 'added';
  }

  if (options?.allowMultiPdfZip && isZipOutput(blob, filename)) {
    let files: File[];
    try {
      files = await unpackPdfsFromZip(blob);
    } catch {
      return 'skipped';
    }
    if (files.length === 0) return 'skipped';

    const epoch = getHomeLibraryEpoch();
    for (const file of files) {
      await addPdfToLibrary(file, 'upload');
      if (epoch !== getHomeLibraryEpoch()) {
        return 'skipped';
      }
    }
    await syncHomeLibraryFromStore(root, getHomeLibraryEpoch());
    return 'added';
  }

  return 'skipped';
}

export async function overwriteToShiftPdf(
  blob: Blob,
  filename: string,
  root: Document = document
): Promise<OverwriteToShiftPdfResult> {
  if (!isPdfOutput(blob, filename)) return 'skipped';

  const target = getPrimaryLibrarySaveTarget();
  if (!target) return 'skipped';

  const epoch = getHomeLibraryEpoch();
  const file = new File([blob], filename, {
    type: blob.type || 'application/pdf',
  });

  const existingEntry = await readPdfLibraryEntry(target.id);
  const workspaceHandle = getWorkspaceFiles().find(
    (entry) => entry.id === target.id || entry.name === target.name
  )?.handle;
  const handle = existingEntry?.handle ?? workspaceHandle;

  const replaced = await replacePdfInLibrary(target.id, file);
  if (!replaced) return 'skipped';

  if (handle) {
    await writePdfThroughHandle(handle, blob);
  }

  if (epoch !== getHomeLibraryEpoch()) {
    return 'skipped';
  }
  await syncHomeLibraryFromStore(root, getHomeLibraryEpoch());
  return 'replaced';
}

export function initShiftPdfSave(root: Document = document): void {
  if (boundRoots.has(root)) return;
  boundRoots.add(root);

  const onOutput = (event: Event) => {
    const detail = (event as CustomEvent<PdfOutputDetail>).detail;
    if (
      !(detail?.blob instanceof Blob) ||
      typeof detail.filename !== 'string' ||
      !detail.filename.trim()
    ) {
      return;
    }
    setLatestPdfOutput(detail, root);
  };

  root.addEventListener(PDF_OUTPUT_READY_EVENT, onOutput);
}
