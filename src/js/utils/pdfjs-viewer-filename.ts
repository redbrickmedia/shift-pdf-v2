/**
 * Bridge original PDF filenames into embedded PDF.js viewers.
 *
 * PDF.js resolves toolbar Save/Download names via `_docFilename`:
 *   contentDispositionFilename || getPdfFilenameFromUrl(url)
 *
 * Blob URLs have no pathname `.pdf`, so bare `?file=blob:...` becomes
 * `document.pdf`. Upstream's open pattern appends `#filename.pdf` on the
 * file URL (see `_getOpenDataUrl` in viewer.mjs).
 */

export const DEFAULT_PDF_VIEWER_FILENAME = 'document.pdf';

/** Same hash-filename regex PDF.js uses in getPdfFilenameFromUrl. */
const PDFJS_HASH_FILENAME = /[^/?#=]+\.pdf\b(?!.*\.pdf\b)/i;

export type PdfViewerFilenameTarget = {
  _contentDispositionFilename?: string | null;
  _title?: string;
  url?: string;
  setTitle?: (title: string) => void;
};

/**
 * Normalize a source name for PDF.js hash / download attribution.
 * Strips paths, removes `#`/`?` (which break URL parsing), and ensures `.pdf`.
 */
export function sanitizePdfViewerFilename(
  name: string | null | undefined
): string {
  const trimmed = name?.trim() || DEFAULT_PDF_VIEWER_FILENAME;
  const baseName =
    trimmed.replace(/^.*[/\\]/, '') || DEFAULT_PDF_VIEWER_FILENAME;
  const withoutBreakers = baseName.replace(/[#?]/g, '_').trim();
  const safe = withoutBreakers || DEFAULT_PDF_VIEWER_FILENAME;
  return /\.pdf$/i.test(safe) ? safe : `${safe}.pdf`;
}

/**
 * Attach a `#filename.pdf` suffix so PDF.js can recover the name from a blob URL.
 */
export function withPdfViewerFilename(
  blobUrl: string,
  filename?: string | null
): string {
  const safe = sanitizePdfViewerFilename(filename);
  const hashIndex = blobUrl.indexOf('#');
  const base = hashIndex === -1 ? blobUrl : blobUrl.slice(0, hashIndex);
  return `${base}#${safe}`;
}

/**
 * Encode a blob URL + filename for a PDF.js `?file=` query parameter.
 */
export function encodePdfjsViewerFileParam(
  blobUrl: string,
  filename?: string | null
): string {
  return encodeURIComponent(withPdfViewerFilename(blobUrl, filename));
}

/**
 * Mirror the hash branch of PDF.js getPdfFilenameFromUrl for regression tests
 * and diagnostics. Returns the default when no hash filename is present.
 */
export function getPdfFilenameFromViewerFileUrl(
  fileUrl: string,
  defaultFilename = DEFAULT_PDF_VIEWER_FILENAME
): string {
  try {
    const parsed = new URL(fileUrl);
    if (!parsed.hash) return defaultFilename;
    const match = PDFJS_HASH_FILENAME.exec(parsed.hash);
    if (!match) return defaultFilename;
    try {
      return decodeURIComponent(match[0]);
    } catch {
      return match[0];
    }
  } catch {
    return defaultFilename;
  }
}

/**
 * Hardening: pin the download/save name on a loaded PDFViewerApplication.
 * Prefer the URL hash as the primary signal; this covers races and forks
 * that clear title/url after open.
 */
export function applyPdfViewerDownloadFilename(
  application: PdfViewerFilenameTarget | null | undefined,
  filename?: string | null
): string {
  const safe = sanitizePdfViewerFilename(filename);
  if (!application) return safe;

  application._contentDispositionFilename = safe;
  if (typeof application.setTitle === 'function') {
    application.setTitle(safe);
  } else {
    application._title = safe;
  }
  return safe;
}
