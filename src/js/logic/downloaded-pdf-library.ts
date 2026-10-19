/**
 * Retired in ADR-0003: `downloadFile()` is pure Output Session staging.
 * `Save` and `Overwrite` in the shared `viewer-chrome` header handle
 * adding to `My PDFs` and writing through `FileSystemFileHandle` on demand.
 */
export function initDownloadedPdfLibrary(_root: Document = document): void {
  // No-op: automatic My PDFs saves, disk-handle prompts, and #shift-tool-success are retired.
}
