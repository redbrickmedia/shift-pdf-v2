export function getDerivedPdfFilename(
  originalFilename: string | undefined,
  suffix: string
): string {
  const filename = originalFilename?.trim() || 'document.pdf';
  const base = filename.replace(/\.pdf$/i, '') || 'document';
  return `${base}${suffix}.pdf`;
}
