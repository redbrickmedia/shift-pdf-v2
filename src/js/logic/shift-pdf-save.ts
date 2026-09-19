import { PDF_OUTPUT_READY_EVENT } from '../utils/helpers.js';
import { addPdfToLibrary } from './pdf-library-store.js';
import {
  getHomeLibraryEpoch,
  syncHomeLibraryFromStore,
} from './workspace-files.js';

export type PdfOutputDetail = {
  blob: Blob;
  filename: string;
};

export type SaveToShiftPdfResult = 'added' | 'skipped';

export const SAVE_TO_SHIFT_PDF_LABEL = 'Save';

type LatestOutput = PdfOutputDetail & { isPdf: boolean };

const boundRoots = new WeakSet<Document>();
let latestOutput: LatestOutput | null = null;
export const TOOL_OUTPUT_STATE_EVENT = 'shift:tool-output-state-changed';

export function isPdfOutput(blob: Blob, filename: string): boolean {
  return (
    blob.type === 'application/pdf' || filename.toLowerCase().endsWith('.pdf')
  );
}

export function canSaveToShiftPdf(
  output: PdfOutputDetail | null = latestOutput
): boolean {
  return Boolean(output && isPdfOutput(output.blob, output.filename));
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
  root: Document = document
): Promise<SaveToShiftPdfResult> {
  if (!isPdfOutput(blob, filename)) return 'skipped';

  const epoch = getHomeLibraryEpoch();
  const file = new File([blob], filename, {
    type: blob.type || 'application/pdf',
  });

  const added = await addPdfToLibrary(file, 'upload');
  if (epoch !== getHomeLibraryEpoch()) {
    return 'skipped';
  }
  await syncHomeLibraryFromStore(root, getHomeLibraryEpoch());
  return 'added';
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
