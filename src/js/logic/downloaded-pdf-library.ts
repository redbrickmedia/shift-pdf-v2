/**
 * Browser downloads used to auto-add a My PDFs row. Downloads are now
 * browser-file only; explicit Save to Shift PDF lives in shift-pdf-save.ts.
 */
export function initDownloadedPdfLibrary(_root: Document = document): void {
  // Intentionally a no-op: Download must not mutate My PDFs.
}
