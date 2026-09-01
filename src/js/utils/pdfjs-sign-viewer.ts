import type {
  PDFViewerApplication,
  PDFViewerWindow,
} from '../types/sign-pdf-type.js';

export const PDFJS_SIGNATURE_MODE = 101;
export const SIGN_VIEWER_TIMEOUT_MS = 20_000;

export function buildSignViewerUrl(
  blobUrl: string,
  options: { baseUrl?: string; origin?: string } = {}
): string {
  const baseUrl = options.baseUrl ?? import.meta.env.BASE_URL;
  const origin =
    options.origin ??
    (typeof window !== 'undefined'
      ? window.location.origin
      : 'https://shift.test');
  const viewerUrl = new URL(`${baseUrl}pdfjs-viewer/viewer.html`, origin);
  viewerUrl.searchParams.set('file', blobUrl);
  viewerUrl.searchParams.set('bentoSign', '1');
  return viewerUrl.toString();
}

const HIDDEN_EDITOR_IDS = [
  'editorComment',
  'editorFreeText',
  'editorHighlight',
  'editorInk',
  'editorStamp',
] as const;

function getViewerApplication(
  iframe: HTMLIFrameElement
): PDFViewerApplication | null {
  try {
    return (
      (iframe.contentWindow as PDFViewerWindow | null)?.PDFViewerApplication ??
      null
    );
  } catch {
    throw new Error('The PDF.js signing viewer is not same-origin.');
  }
}

export async function waitForPdfJsSignViewer(
  iframe: HTMLIFrameElement,
  timeoutMs = SIGN_VIEWER_TIMEOUT_MS
): Promise<PDFViewerApplication> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const application = getViewerApplication(iframe);
    if (application?.pdfDocument && application.eventBus) {
      return application;
    }
    await new Promise((resolve) => window.setTimeout(resolve, 50));
  }

  throw new Error('Timed out while waiting for the PDF.js signing viewer.');
}

export function configureSessionOnlySignatureUi(
  iframe: HTMLIFrameElement,
  application: PDFViewerApplication
): void {
  const viewerDocument = iframe.contentDocument;
  if (!viewerDocument || !application.eventBus) {
    throw new Error('The PDF.js signing viewer is unavailable.');
  }

  for (const id of HIDDEN_EDITOR_IDS) {
    viewerDocument.getElementById(id)?.setAttribute('hidden', 'true');
  }

  const signatureContainer = viewerDocument.getElementById('editorSignature');
  const signatureButton = viewerDocument.getElementById(
    'editorSignatureButton'
  ) as HTMLButtonElement | null;
  const saveContainer = viewerDocument.getElementById(
    'addSignatureSaveContainer'
  );
  const saveCheckbox = viewerDocument.getElementById(
    'addSignatureSaveCheckbox'
  ) as HTMLInputElement | null;

  signatureContainer?.removeAttribute('hidden');
  signatureButton?.removeAttribute('disabled');
  saveContainer?.setAttribute('hidden', 'true');
  if (saveCheckbox) {
    saveCheckbox.checked = false;
    saveCheckbox.disabled = true;
  }

  application.eventBus.dispatch('switchannotationeditormode', {
    source: window,
    mode: PDFJS_SIGNATURE_MODE,
  });
}
