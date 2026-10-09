import type {
  ErrorType,
  MemoryBucket,
  PdfKind,
  SizeBucket,
} from './telemetry-schema.js';

const MIB = 1024 * 1024;
const SCAN_WINDOW = 256 * 1024;

export function sizeBucket(bytes: number): SizeBucket | undefined {
  if (!Number.isFinite(bytes) || bytes < 0) return undefined;
  if (bytes < MIB) return 'lt_1mb';
  if (bytes <= 8 * MIB) return '1_8mb';
  return 'gt_8mb';
}

export function memoryBucket(bytes: number): MemoryBucket | undefined {
  if (!Number.isFinite(bytes) || bytes < 0) return undefined;
  if (bytes < 50 * MIB) return 'lt_50mb';
  if (bytes <= 200 * MIB) return '50_200mb';
  return 'gt_200mb';
}

type PerformanceWithMemory = Performance & {
  memory?: { usedJSHeapSize?: number };
};

export function readMemoryBucket(): MemoryBucket | undefined {
  const memory = (performance as PerformanceWithMemory).memory;
  if (!memory || typeof memory.usedJSHeapSize !== 'number') return undefined;
  return memoryBucket(memory.usedJSHeapSize);
}

function ascii(text: string): number[] {
  const codes: number[] = [];
  for (let i = 0; i < text.length; i += 1) codes.push(text.charCodeAt(i));
  return codes;
}

function hasMarker(bytes: Uint8Array, marker: number[]): boolean {
  const end = bytes.length - marker.length;
  for (let i = 0; i <= end; i += 1) {
    let matched = true;
    for (let j = 0; j < marker.length; j += 1) {
      if (bytes[i + j] !== marker[j]) {
        matched = false;
        break;
      }
    }
    if (matched) return true;
  }
  return false;
}

function countPages(bytes: Uint8Array): number {
  const spaced = ascii('/Type /Page');
  const tight = ascii('/Type/Page');
  const pageS = 's'.charCodeAt(0);
  let count = 0;
  const markers = [spaced, tight];
  for (const marker of markers) {
    const end = bytes.length - marker.length;
    for (let i = 0; i <= end; i += 1) {
      let matched = true;
      for (let j = 0; j < marker.length; j += 1) {
        if (bytes[i + j] !== marker[j]) {
          matched = false;
          break;
        }
      }
      if (!matched) continue;
      if (bytes[i + marker.length] === pageS) continue;
      count += 1;
      i += marker.length - 1;
    }
  }
  return count;
}

function scanWindow(bytes: Uint8Array): Uint8Array {
  if (bytes.length <= SCAN_WINDOW * 2) return bytes;
  const windowBytes = new Uint8Array(SCAN_WINDOW * 2);
  windowBytes.set(bytes.subarray(0, SCAN_WINDOW), 0);
  windowBytes.set(bytes.subarray(bytes.length - SCAN_WINDOW), SCAN_WINDOW);
  return windowBytes;
}

export interface PdfCharacteristics {
  pdf_kind: PdfKind;
  page_count?: number;
  size_bucket?: SizeBucket;
}

/**
 * Classify a PDF from structure markers only. The scanned bytes are not
 * returned and page text is never copied into the result.
 */
export function inspectPdfBytes(bytes: Uint8Array): PdfCharacteristics {
  const sample = scanWindow(bytes);
  const encrypted = hasMarker(sample, ascii('/Encrypt'));
  const form = hasMarker(sample, ascii('/AcroForm'));
  const image =
    hasMarker(sample, ascii('/Subtype /Image')) ||
    hasMarker(sample, ascii('/Subtype/Image'));
  const text =
    hasMarker(sample, ascii('/Font')) ||
    hasMarker(sample, ascii('/Subtype /Type1')) ||
    hasMarker(sample, ascii('/Subtype/TrueType'));

  let pdfKind: PdfKind = 'unknown';
  if (encrypted) pdfKind = 'encrypted';
  else if (form) pdfKind = 'form';
  else if (text) pdfKind = 'text';
  else if (image) pdfKind = 'image';

  const pageCount = countPages(sample);
  const bucket = sizeBucket(bytes.byteLength);
  return {
    pdf_kind: pdfKind,
    ...(pageCount > 0 ? { page_count: pageCount } : {}),
    ...(bucket ? { size_bucket: bucket } : {}),
  };
}

export function errorTypeFromPdfjs(error: unknown): ErrorType {
  const name =
    error && typeof error === 'object' && 'name' in error
      ? String((error as { name: unknown }).name)
      : '';
  if (name === 'PasswordException') return 'encrypted';
  if (name === 'InvalidPDFException') return 'malformed';
  return 'load_failed';
}

export function classifyAlertTitle(title: string): ErrorType {
  const normalized = title.trim().toLowerCase();
  if (!normalized) return 'process_failed';
  if (normalized.includes('password') || normalized.includes('encrypt')) {
    return 'encrypted';
  }
  if (
    normalized.includes('invalid') ||
    normalized.includes('corrupt') ||
    normalized.includes('malformed') ||
    normalized.includes('damaged')
  ) {
    return 'malformed';
  }
  if (
    normalized.includes('no file') ||
    normalized.includes('missing') ||
    normalized.includes('empty')
  ) {
    return 'missing_input';
  }
  if (normalized.includes('permission') || normalized.includes('restrict')) {
    return 'restricted';
  }
  if (
    normalized.includes('unsupported') ||
    normalized.includes('not supported')
  ) {
    return 'unsupported';
  }
  return 'process_failed';
}

const HANDOFF_REASON_BY_MESSAGE: Record<string, string> = {
  'The file payload is missing.': 'missing_bytes',
  'The file is empty.': 'empty',
  'This file is larger than the 16 MB handoff limit.': 'too_large',
  'Only PDF files can be handed off.': 'wrong_mime',
  'Shift could not load this file.': 'load_rejected',
};

export function handoffReasonFromError(
  error: unknown
):
  | 'missing_bytes'
  | 'empty'
  | 'too_large'
  | 'wrong_mime'
  | 'load_rejected'
  | 'load_failed' {
  const message = error instanceof Error ? error.message : '';
  const reason = HANDOFF_REASON_BY_MESSAGE[message];
  if (
    reason === 'missing_bytes' ||
    reason === 'empty' ||
    reason === 'too_large' ||
    reason === 'wrong_mime' ||
    reason === 'load_rejected'
  ) {
    return reason;
  }
  return 'load_failed';
}
