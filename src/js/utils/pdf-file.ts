/**
 * Cross-platform PDF eligibility for pickers and drag/drop.
 *
 * Windows often reports a blank MIME (or application/octet-stream) for .pdf
 * files; macOS usually sets application/pdf. Accept either the MIME or a
 * case-insensitive .pdf extension so both platforms share one rule.
 */
export function isPdfFile(file: Pick<File, 'name' | 'type'>): boolean {
  const type = (file.type || '').trim().toLowerCase();
  if (type === 'application/pdf') return true;
  return file.name.toLowerCase().endsWith('.pdf');
}

/** True when MIME is missing or a generic binary type (common on Windows). */
export function isBlankOrGenericMime(type: string | undefined | null): boolean {
  const normalized = (type || '').trim().toLowerCase();
  return (
    normalized === '' ||
    normalized === 'application/octet-stream' ||
    normalized === 'binary/octet-stream'
  );
}
