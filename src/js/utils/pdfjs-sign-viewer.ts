import type {
  PDFViewerApplication,
  PDFViewerWindow,
} from '../types/sign-pdf-type.js';

export const PDFJS_SIGNATURE_MODE = 101;

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
  timeoutMs = 15_000
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
