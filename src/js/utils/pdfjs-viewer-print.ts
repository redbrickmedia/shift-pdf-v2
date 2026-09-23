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

/** Print a published PDF blob from boxed tools that have no viewer iframe. */
export function printPdfBlob(
  blob: Blob,
  root: Document = document
): Promise<void> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const iframe = root.createElement('iframe');
    iframe.setAttribute('aria-hidden', 'true');
    iframe.style.position = 'fixed';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    iframe.style.right = '0';
    iframe.style.bottom = '0';

    const cleanup = () => {
      iframe.remove();
      URL.revokeObjectURL(url);
    };

    iframe.addEventListener('load', () => {
      const win = iframe.contentWindow;
      if (!win) {
        cleanup();
        reject(new Error('Could not print this PDF.'));
        return;
      }
      const finish = () => {
        cleanup();
        resolve();
      };
      win.addEventListener('afterprint', finish, { once: true });
      try {
        win.focus();
        win.print();
      } catch (error) {
        cleanup();
        reject(error);
      }
    });
    iframe.addEventListener('error', () => {
      cleanup();
      reject(new Error('Could not print this PDF.'));
    });

    iframe.src = url;
    root.body.append(iframe);
  });
}
