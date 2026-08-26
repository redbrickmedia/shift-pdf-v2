import { showAlert } from '../ui.js';

export const PDF_FILE_SIZE_LIMIT_BYTES = 16 * 1024 * 1024;
export const PDF_FILE_READ_TIMEOUT_MS = 60_000;
export const SHIFT_FILES_READY_TIMEOUT_MS = 3_000;

export type ShiftFileReadResult = {
  bytesBase64: string;
  filename: string;
  mimeType: string;
};

type ShiftFilesApi = {
  read: (options?: { tabId?: number }) => Promise<ShiftFileReadResult>;
};

type ShiftHostWindow = Window & {
  shift?: {
    files?: ShiftFilesApi;
  };
};

function shiftHostWindow(): ShiftHostWindow {
  return window as ShiftHostWindow;
}

export function getSourceTabIdFromLocation(
  search = window.location.search
): number | undefined {
  const value = new URLSearchParams(search).get('sourceTab');
  if (!value) return undefined;
  const tabId = Number(value);
  return Number.isInteger(tabId) && tabId >= 0 ? tabId : undefined;
}

export function fileFromShiftReadResult(result: ShiftFileReadResult): File {
  const bytes = base64ToUint8Array(result.bytesBase64);
  if (bytes.byteLength === 0) {
    throw new Error('This PDF is empty or could not be read.');
  }
  if (bytes.byteLength > PDF_FILE_SIZE_LIMIT_BYTES) {
    throw new Error('This PDF is larger than 16 MB.');
  }

  const filename = sanitizeIncomingPdfFilename(result.filename);
  const mimeType = result.mimeType || 'application/pdf';
  return new File([bytes], filename, { type: mimeType });
}

export function sanitizeIncomingPdfFilename(value: string | undefined): string {
  const trimmed = value?.trim() ?? '';
  const withoutPath = trimmed.split(/[/\\]/).pop() ?? '';
  const withoutUnsafe = withoutPath
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\.+$/, '');
  const withExtension = withoutUnsafe.toLowerCase().endsWith('.pdf')
    ? withoutUnsafe
    : `${withoutUnsafe || 'document'}.pdf`;
  return withExtension.replace(/^\.pdf$/i, 'document.pdf');
}

export async function waitForShiftFilesApi(
  timeoutMs = SHIFT_FILES_READY_TIMEOUT_MS
): Promise<boolean> {
  if (shiftHostWindow().shift?.files?.read) return true;

  return await new Promise((resolve) => {
    const timer = window.setTimeout(() => {
      window.removeEventListener('shift-files:ready', onReady);
      resolve(Boolean(shiftHostWindow().shift?.files?.read));
    }, timeoutMs);

    const onReady = () => {
      window.clearTimeout(timer);
      window.removeEventListener('shift-files:ready', onReady);
      resolve(true);
    };

    window.addEventListener('shift-files:ready', onReady);
  });
}

export async function readOpenShiftFile(): Promise<File | null> {
  const ready = await waitForShiftFilesApi();
  if (!ready) return null;

  const tabId = getSourceTabIdFromLocation();
  const result = await Promise.race([
    readFromShiftApi(tabId),
    timeoutError(PDF_FILE_READ_TIMEOUT_MS),
  ]);

  return fileFromShiftReadResult(result);
}

export function loadOpenShiftFile(
  onFile: (file: File) => void | Promise<void>
): void {
  void (async () => {
    try {
      const file = await readOpenShiftFile();
      if (!file) return;
      await onFile(file);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Shift could not load this PDF.';
      showAlert('PDF from Shift', message);
    }
  })();
}

async function readFromShiftApi(tabId?: number): Promise<ShiftFileReadResult> {
  const files = shiftHostWindow().shift?.files;
  if (files?.read) {
    return files.read({ tabId });
  }

  return readViaCustomEvents(tabId);
}

function readViaCustomEvents(tabId?: number): Promise<ShiftFileReadResult> {
  return new Promise((resolve, reject) => {
    const requestId = crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;

    const onResult = (event: Event) => {
      const detail = (event as CustomEvent).detail as
        | (ShiftFileReadResult & { error?: string; requestId?: string })
        | undefined;
      if (!detail || detail.requestId !== requestId) return;
      window.removeEventListener('shift-files:result', onResult);
      if (detail.error) {
        reject(new Error(detail.error));
        return;
      }
      resolve(detail);
    };

    window.addEventListener('shift-files:result', onResult);
    window.dispatchEvent(
      new CustomEvent('shift-files:read', {
        detail: { requestId, tabId },
      })
    );
  });
}

function timeoutError(timeoutMs: number): Promise<never> {
  return new Promise((_, reject) => {
    window.setTimeout(() => {
      reject(new Error('Shift could not read the PDF in time.'));
    }, timeoutMs);
  });
}

function base64ToUint8Array(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}
