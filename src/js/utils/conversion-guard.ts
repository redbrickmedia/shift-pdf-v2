export const DEFAULT_CONVERSION_LIMITS = {
  maxInputBytes: 40 * 1024 * 1024,
  maxPages: 150,
  maxOutputBytes: 80 * 1024 * 1024,
  maxOutputRatio: 8,
  initTimeoutMs: 90_000,
  conversionTimeoutMs: 180_000,
} as const;

export type ConversionLimits = {
  maxInputBytes?: number;
  maxPages?: number;
  maxOutputBytes?: number;
  maxOutputRatio?: number;
  initTimeoutMs?: number;
  conversionTimeoutMs?: number;
};

export class ConversionCancelledError extends Error {
  constructor(message = 'Conversion cancelled.') {
    super(message);
    this.name = 'ConversionCancelledError';
  }
}

export class ConversionGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConversionGuardError';
  }
}

export function isConversionCancelled(
  error: unknown
): error is ConversionCancelledError {
  return (
    error instanceof ConversionCancelledError ||
    (error instanceof DOMException && error.name === 'AbortError')
  );
}

export function formatMegabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function validateInputFile(
  file: File,
  limits: ConversionLimits = DEFAULT_CONVERSION_LIMITS
): void {
  const maxInputBytes =
    limits.maxInputBytes ?? DEFAULT_CONVERSION_LIMITS.maxInputBytes;
  if (file.size > maxInputBytes) {
    throw new ConversionGuardError(
      `${file.name} is ${formatMegabytes(file.size)}. The limit is ${formatMegabytes(maxInputBytes)}.`
    );
  }
}

export function validateInputPages(
  pageCount: number,
  limits: ConversionLimits = DEFAULT_CONVERSION_LIMITS
): void {
  const maxPages = limits.maxPages ?? DEFAULT_CONVERSION_LIMITS.maxPages;
  if (pageCount > maxPages) {
    throw new ConversionGuardError(
      `This PDF has ${pageCount} pages. The limit is ${maxPages} pages.`
    );
  }
}

export function validateOutputBlob(
  blob: Blob,
  inputBytes: number,
  limits: ConversionLimits = DEFAULT_CONVERSION_LIMITS
): void {
  const maxOutputBytes =
    limits.maxOutputBytes ?? DEFAULT_CONVERSION_LIMITS.maxOutputBytes;
  const maxOutputRatio =
    limits.maxOutputRatio ?? DEFAULT_CONVERSION_LIMITS.maxOutputRatio;

  if (blob.size > maxOutputBytes) {
    throw new ConversionGuardError(
      `The converted file is ${formatMegabytes(blob.size)}, which is over the ${formatMegabytes(maxOutputBytes)} limit. The conversion was discarded.`
    );
  }

  if (inputBytes > 0 && blob.size / inputBytes > maxOutputRatio) {
    throw new ConversionGuardError(
      `The converted file grew to ${formatMegabytes(blob.size)} from ${formatMegabytes(inputBytes)}. That usually means the output is unusable, so it was discarded.`
    );
  }
}

export function assertSharedArrayBufferAvailable(): void {
  const isolated =
    typeof globalThis.crossOriginIsolated === 'boolean'
      ? globalThis.crossOriginIsolated
      : true;
  if (typeof SharedArrayBuffer === 'undefined' || !isolated) {
    throw new ConversionGuardError(
      'Word to PDF needs a cross-origin isolated page (SharedArrayBuffer). This host is not set up for that engine.'
    );
  }
}

export async function assertLibreOfficeAssetsAvailable(
  basePath: string,
  fetchImpl: typeof fetch = fetch
): Promise<void> {
  const assets = ['soffice.wasm.gz', 'soffice.data.gz'];
  const prefix = basePath.endsWith('/') ? basePath : `${basePath}/`;

  for (const asset of assets) {
    const url = `${prefix}${asset}`;
    let response: Response;
    try {
      response = await fetchImpl(url, { method: 'HEAD' });
    } catch {
      throw new ConversionGuardError(
        'The Word to PDF engine could not be reached. Check your connection and try again.'
      );
    }

    if (response.status === 405 || response.status === 501) {
      try {
        response = await fetchImpl(url, {
          method: 'GET',
          headers: { Range: 'bytes=0-0' },
        });
      } catch {
        throw new ConversionGuardError(
          'The Word to PDF engine could not be reached. Check your connection and try again.'
        );
      }
    }

    if (!response.ok) {
      throw new ConversionGuardError(
        'The Word to PDF engine is not available on this host. This preview cannot ship the full conversion engine, so the conversion was stopped instead of hanging.'
      );
    }
  }
}

export function runWithTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
  signal?: AbortSignal
): Promise<T> {
  if (signal?.aborted) {
    return Promise.reject(new ConversionCancelledError());
  }

  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      reject(
        new ConversionGuardError(
          `${label} timed out after ${Math.round(timeoutMs / 1000)} seconds.`
        )
      );
    }, timeoutMs);

    const onAbort = () => {
      window.clearTimeout(timer);
      reject(new ConversionCancelledError());
    };

    signal?.addEventListener('abort', onAbort, { once: true });

    promise.then(
      (value) => {
        window.clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        if (signal?.aborted) {
          reject(new ConversionCancelledError());
          return;
        }
        resolve(value);
      },
      (error: unknown) => {
        window.clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        reject(error);
      }
    );
  });
}

export function createConversionSession(): {
  signal: AbortSignal;
  cancel(): void;
} {
  const controller = new AbortController();
  return {
    signal: controller.signal,
    cancel() {
      controller.abort();
    },
  };
}
