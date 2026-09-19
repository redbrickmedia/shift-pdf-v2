import {
  waitForPdfJsPagesReady,
  waitForPdfJsSignViewer,
} from './pdfjs-sign-viewer.js';

/** Stock PDF.js chrome controls replaced by the shared output toolbar. */
export const PDFJS_PRINT_CONTROL_IDS = [
  'printButton',
  'secondaryPrint',
] as const;

export function hidePdfJsPrintControls(
  viewerDocument: Document | null | undefined
): void {
  if (!viewerDocument) return;
  for (const id of PDFJS_PRINT_CONTROL_IDS) {
    const control = viewerDocument.getElementById(id);
    if (control && !control.hasAttribute('hidden')) {
      control.setAttribute('hidden', 'true');
    }
  }
}

export async function printPdfJsViewerFrame(
  iframe: HTMLIFrameElement | null
): Promise<void> {
  if (!iframe) return;
  const application = await waitForPdfJsSignViewer(iframe);
  if (!application.triggerPrinting) {
    throw new Error('Printing is unavailable in this browser.');
  }
  await waitForPdfJsPagesReady(application);
  iframe.contentWindow?.focus();
  await application.triggerPrinting();
}
