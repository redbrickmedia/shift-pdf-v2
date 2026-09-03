import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetDocument, workerOptions, MockPDFWorker } = vi.hoisted(() => ({
  mockGetDocument: vi.fn(),
  workerOptions: { workerSrc: '' },
  MockPDFWorker: class {
    destroyed = false;
    destroy(): void {
      this.destroyed = true;
    }
  },
}));

vi.mock('pdfjs-dist/legacy/build/pdf.mjs', () => ({
  getDocument: mockGetDocument,
  GlobalWorkerOptions: workerOptions,
  PDFWorker: MockPDFWorker,
  PasswordResponses: {
    NEED_PASSWORD: 1,
    INCORRECT_PASSWORD: 2,
  },
}));

import {
  getPDFDocument,
  PDFJS_WASM_URL,
  PDFJS_WORKER_SRC,
} from '../js/utils/pdfjs.js';

describe('PDF.js configuration', () => {
  beforeEach(() => {
    mockGetDocument.mockReset();
    mockGetDocument.mockReturnValue({
      destroy: vi.fn(),
      promise: Promise.resolve({}),
    });
  });

  it('uses the legacy worker build', () => {
    expect(PDFJS_WORKER_SRC).toContain(
      'pdfjs-dist/legacy/build/pdf.worker.min.mjs'
    );
    expect(workerOptions.workerSrc).toBe(PDFJS_WORKER_SRC);
  });

  it('adds the shared wasm URL when loading a URL', () => {
    const loadingTask = {
      destroy: vi.fn(),
      promise: Promise.resolve({}),
    };
    mockGetDocument.mockReturnValue(loadingTask);

    expect(getPDFDocument('/example.pdf')).toBe(loadingTask);
    expect(mockGetDocument).toHaveBeenCalledWith({
      url: '/example.pdf',
      wasmUrl: PDFJS_WASM_URL,
    });
    expect(PDFJS_WASM_URL).toBe('/pdfjs-viewer/wasm/');
  });

  it('enforces the shared wasm URL for parameter objects', () => {
    getPDFDocument({
      data: new Uint8Array([1, 2, 3]),
      wasmUrl: '/stale-wasm/',
    });

    expect(mockGetDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        data: new Uint8Array([1, 2, 3]),
        wasmUrl: PDFJS_WASM_URL,
      })
    );
  });

  it('preserves document cleanup through the loading task', async () => {
    const document = {};
    const destroy = vi.fn().mockResolvedValue(undefined);
    mockGetDocument.mockReturnValue({
      destroy,
      promise: Promise.resolve(document),
    });

    const loadedDocument = await getPDFDocument('/example.pdf').promise;
    await loadedDocument.destroy();

    expect(destroy).toHaveBeenCalledOnce();
  });
});

describe('shared PDF.js worker', () => {
  beforeEach(() => {
    mockGetDocument.mockReset();
    mockGetDocument.mockReturnValue({
      destroy: vi.fn(),
      promise: Promise.resolve({}),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // PDF.js boots one worker per getDocument call when none is supplied, and a
  // worker whose startup handshake never lands leaves the loading task pending
  // forever with no error. Pages that load several PDFs at once — sidebar
  // thumbnails plus encryption probes plus the tool itself — hit that far more
  // often, which is what hung Merge on "Loading PDF documents".
  it('reuses one worker across loads and replaces it only once destroyed', async () => {
    vi.stubGlobal('Worker', class {});
    vi.resetModules();
    const { getPDFDocument: load } = await import('../js/utils/pdfjs.js');

    load('/first.pdf');
    load('/second.pdf');

    const worker = mockGetDocument.mock.calls[0]?.[0]?.worker;
    expect(worker).toBeInstanceOf(MockPDFWorker);
    expect(mockGetDocument.mock.calls[1]?.[0]?.worker).toBe(worker);

    (worker as InstanceType<typeof MockPDFWorker>).destroy();
    load('/third.pdf');

    const replacement = mockGetDocument.mock.calls[2]?.[0]?.worker;
    expect(replacement).toBeInstanceOf(MockPDFWorker);
    expect(replacement).not.toBe(worker);
  });

  it('honours a worker supplied by the caller', async () => {
    vi.stubGlobal('Worker', class {});
    vi.resetModules();
    const { getPDFDocument: load } = await import('../js/utils/pdfjs.js');

    const ownWorker = new MockPDFWorker();
    load({ url: '/first.pdf', worker: ownWorker } as never);

    expect(mockGetDocument.mock.calls[0]?.[0]?.worker).toBe(ownWorker);
  });

  it('falls back to PDF.js defaults where workers are unavailable', async () => {
    vi.resetModules();
    const { getPDFDocument: load } = await import('../js/utils/pdfjs.js');

    load('/first.pdf');

    expect(mockGetDocument.mock.calls[0]?.[0]?.worker).toBeUndefined();
  });
});
