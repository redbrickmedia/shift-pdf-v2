import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  assertLibreOfficeAssetsAvailable,
  assertSharedArrayBufferAvailable,
  ConversionCancelledError,
  ConversionGuardError,
  createConversionSession,
  DEFAULT_CONVERSION_LIMITS,
  isConversionCancelled,
  runWithTimeout,
  validateInputFile,
  validateInputPages,
  validateOutputBlob,
} from '../js/utils/conversion-guard';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('conversion guards', () => {
  it('rejects oversized input files', () => {
    const file = new File(['x'], 'huge.docx');
    Object.defineProperty(file, 'size', {
      value: DEFAULT_CONVERSION_LIMITS.maxInputBytes + 1,
    });
    expect(() => validateInputFile(file)).toThrow(ConversionGuardError);
  });

  it('rejects PDFs with too many pages', () => {
    expect(() =>
      validateInputPages(DEFAULT_CONVERSION_LIMITS.maxPages + 1)
    ).toThrow(/150 pages/);
  });

  it('rejects oversized or exploded output', () => {
    const huge = { size: DEFAULT_CONVERSION_LIMITS.maxOutputBytes + 1 } as Blob;
    expect(() => validateOutputBlob(huge, 1024)).toThrow(/discarded/);

    const exploded = {
      size: DEFAULT_CONVERSION_LIMITS.maxOutputRatio * 1024 * 1024 + 1,
    } as Blob;
    expect(() => validateOutputBlob(exploded, 1024 * 1024)).toThrow(/unusable/);
  });

  it('accepts sane output', () => {
    const output = new Blob([new Uint8Array(2 * 1024 * 1024)]);
    expect(() => validateOutputBlob(output, 8 * 1024 * 1024)).not.toThrow();
  });

  it('times out hung conversions and honors cancel', async () => {
    await expect(
      runWithTimeout(new Promise(() => undefined), 20, 'PDF to Word conversion')
    ).rejects.toThrow(/timed out after/);

    const session = createConversionSession();
    const pending = runWithTimeout(
      new Promise(() => undefined),
      5_000,
      'Word to PDF conversion',
      session.signal
    );
    session.cancel();
    await expect(pending).rejects.toBeInstanceOf(ConversionCancelledError);
    expect(isConversionCancelled(new ConversionCancelledError())).toBe(true);
  });

  it('fails fast when LibreOffice assets are missing', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
    } as Response);

    await expect(
      assertLibreOfficeAssetsAvailable('/libreoffice-wasm/', fetchImpl)
    ).rejects.toThrow(/not available on this host/);
    expect(fetchImpl).toHaveBeenCalled();
  });

  it('requires SharedArrayBuffer isolation', () => {
    vi.stubGlobal('crossOriginIsolated', false);
    expect(() => assertSharedArrayBufferAvailable()).toThrow(
      /cross-origin isolated/
    );
  });
});
