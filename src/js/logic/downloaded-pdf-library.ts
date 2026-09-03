import { PDF_OUTPUT_DOWNLOADED_EVENT } from '../utils/helpers.js';
import { syncHomeLibraryFromStore } from './home-files.js';
import { addPdfToLibrary } from './pdf-library-store.js';

type DownloadedPdfDetail = {
  blob: Blob;
  filename: string;
};

const boundRoots = new WeakSet<Document>();

export function initDownloadedPdfLibrary(root: Document = document): void {
  if (boundRoots.has(root)) return;
  boundRoots.add(root);

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

async function saveDownloadedPdf(
  blob: Blob,
  filename: string,
  root: Document
): Promise<void> {
  const file = new File([blob], filename, { type: 'application/pdf' });
  await addPdfToLibrary(file, 'download');
  await syncHomeLibraryFromStore(root);
  navigateToMyPdfs(root);
}

function isMyPdfsPage(root: Document): boolean {
  if (root.getElementById('shift-my-pdfs')) return true;
  const pathname = window.location?.pathname ?? '';
  return /(^|\/)my-pdfs\.html$/i.test(pathname);
}

function myPdfsHref(root: Document): string {
  const nav = root.querySelector<HTMLAnchorElement>('a[data-nav="my-pdfs"]');
  return nav?.getAttribute('href')?.trim() || 'my-pdfs.html';
}

function navigateToMyPdfs(root: Document): void {
  if (isMyPdfsPage(root)) return;
  window.location.assign(myPdfsHref(root));
}
