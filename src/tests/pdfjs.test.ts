import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetDocument, workerOptions } = vi.hoisted(() => ({
  mockGetDocument: vi.fn(),
  workerOptions: { workerSrc: '' },
}));

vi.mock('pdfjs-dist/legacy/build/pdf.mjs', () => ({
  getDocument: mockGetDocument,
  GlobalWorkerOptions: workerOptions,
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
