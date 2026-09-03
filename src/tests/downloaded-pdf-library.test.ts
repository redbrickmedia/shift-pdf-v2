import { afterEach, describe, expect, it, vi } from 'vitest';
import { initDownloadedPdfLibrary } from '../js/logic/downloaded-pdf-library';
import { clearPdfLibrary, readPdfLibrary } from '../js/logic/pdf-library-store';
import { downloadFile } from '../js/utils/helpers';

afterEach(async () => {
  await clearPdfLibrary();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('downloaded PDF library', () => {
  it('adds a downloaded PDF output to the library', async () => {
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:download'),
      revokeObjectURL: vi.fn(),
    });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    initDownloadedPdfLibrary();

    downloadFile(
      new Blob(['generated'], { type: 'application/pdf' }),
      'merged.pdf'
    );

    await vi.waitFor(async () => {
      const entries = await readPdfLibrary();
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        name: 'merged.pdf',
        source: 'download',
      });
    });
  });

  it('does not add non-PDF downloads to the library', async () => {
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:download'),
      revokeObjectURL: vi.fn(),
    });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    initDownloadedPdfLibrary();

    downloadFile(
      new Blob(['archive'], { type: 'application/zip' }),
      'files.zip'
    );

    await expect(readPdfLibrary()).resolves.toHaveLength(0);
  });

  it('ignores malformed download events', async () => {
    initDownloadedPdfLibrary();

    document.dispatchEvent(
      new CustomEvent('shift:pdf-output-downloaded', {
        detail: { blob: new Blob(['x']), filename: '   ' },
      })
    );

    await expect(readPdfLibrary()).resolves.toHaveLength(0);
  });
});
