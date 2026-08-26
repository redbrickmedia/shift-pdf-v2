export type PageRangeValidation =
  | { valid: true; normalized: string; pages: number[] }
  | { valid: false; error: string };

function isPositiveIntegerText(value: string): boolean {
  return (
    value.length > 0 &&
    Array.from(value).every((character) => character >= '0' && character <= '9')
  );
}

export function validateMergePageRange(
  value: string,
  pageCount: number
): PageRangeValidation {
  const trimmed = value.trim();
  if (!Number.isInteger(pageCount) || pageCount < 1) {
    return { valid: false, error: 'The PDF has no pages.' };
  }
  if (!trimmed) {
    return {
      valid: true,
      normalized: '',
      pages: Array.from({ length: pageCount }, (_, index) => index),
    };
  }

  const pages: number[] = [];
  const normalizedParts: string[] = [];
  const parts = trimmed.split(',');
  for (const rawPart of parts) {
    const part = rawPart.trim();
    if (!part) {
      return { valid: false, error: 'Page ranges cannot contain empty items.' };
    }

    const rangeParts = part.replaceAll(' ', '').split('-');
    if (rangeParts.length > 2 || !rangeParts.every(isPositiveIntegerText)) {
      return {
        valid: false,
        error: `“${part}” is not a valid page or page range.`,
      };
    }

    const start = Number(rangeParts[0]);
    const end = rangeParts[1] ? Number(rangeParts[1]) : start;
    if (start < 1 || end > pageCount) {
      return {
        valid: false,
        error: `Pages must be between 1 and ${pageCount}.`,
      };
    }
    if (start > end) {
      return {
        valid: false,
        error: `“${part}” is a descending page range.`,
      };
    }

    normalizedParts.push(start === end ? String(start) : `${start}-${end}`);
    for (let page = start; page <= end; page++) {
      pages.push(page - 1);
    }
  }

  return { valid: true, normalized: normalizedParts.join(','), pages };
}
