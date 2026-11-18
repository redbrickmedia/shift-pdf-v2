import { beforeEach, describe, expect, it, vi } from 'vitest';

const isConfigured = vi.fn((_name: string) => true);

vi.mock('../js/utils/wasm-provider.js', () => ({
  WasmProvider: {
    isConfigured: (name: string) => isConfigured(name),
    getUrl: () => 'http://localhost/engine/',
  },
}));

import { clearPyMuPDFCache, preloadPyMuPDF } from '../js/utils/pymupdf-loader';

describe('preloadPyMuPDF', () => {
  beforeEach(() => {
    clearPyMuPDFCache();
    isConfigured.mockReset();
    isConfigured.mockReturnValue(true);
    vi.restoreAllMocks();
  });

  it('does nothing when the engine is not configured', () => {
    isConfigured.mockReturnValue(false);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(() => preloadPyMuPDF()).not.toThrow();
    expect(warn).not.toHaveBeenCalled();
  });

  it('starts the load without throwing and reports a failed load as a warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    preloadPyMuPDF();

    await vi.waitFor(() => {
      expect(warn).toHaveBeenCalledWith(
        '[PyMuPDF Loader] Preload failed:',
        expect.any(Error)
      );
    });
  });
});
