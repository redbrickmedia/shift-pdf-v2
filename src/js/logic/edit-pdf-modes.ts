export type EditPdfMode = 'annotate' | 'fill-sign' | 'crop';

export const EDIT_PDF_MODES: readonly EditPdfMode[] = [
  'annotate',
  'fill-sign',
  'crop',
] as const;

/**
 * Resolves the initial workspace mode on `edit-pdf.html` from the active
 * Launch Context (`?entry=<id>`).
 */
export function resolveInitialEditPdfMode(entryId: string): EditPdfMode {
  const normalized = entryId.trim().toLowerCase();
  if (normalized === 'sign-pdf' || normalized === 'form-filler') {
    return 'fill-sign';
  }
  if (normalized === 'crop-pdf') {
    return 'crop';
  }
  return 'annotate';
}

/**
 * Maps an explicit workspace mode switch in `edit-pdf.html` to the Catalog Entry
 * ID used by `setLaunchContext(...)` for URL/header/telemetry sync.
 */
export function entryIdForEditPdfMode(
  mode: EditPdfMode,
  currentEntryId?: string
): string {
  const normalizedCurrent = currentEntryId?.trim().toLowerCase() ?? '';
  if (mode === 'fill-sign') {
    return normalizedCurrent === 'form-filler' ? 'form-filler' : 'sign-pdf';
  }
  if (mode === 'crop') {
    return 'crop-pdf';
  }
  return 'edit-pdf';
}

/**
 * Whether the Annotate & Redact stage should pre-select the Stamp/Image tool
 * (`"annotation:add-stamp"`) when a document opens.
 */
export function shouldAutoActivateStampTool(entryId: string): boolean {
  return entryId.trim().toLowerCase() === 'add-stamps';
}

/**
 * Whether the Fill & Sign stage should automatically arm signature placement
 * (`PDFJS_SIGNATURE_MODE`) when the PDF.js viewer finishes loading.
 * `sign-pdf` arms signature placement; `form-filler` focuses interactive
 * AcroForm/XFA fields without auto-entering signature mode.
 */
export function shouldAutoArmSignatureMode(entryId: string): boolean {
  return entryId.trim().toLowerCase() !== 'form-filler';
}
