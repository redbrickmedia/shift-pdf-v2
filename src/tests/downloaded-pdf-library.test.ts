import { afterEach, describe, expect, it, vi } from 'vitest';
import { initDownloadedPdfLibrary } from '../js/logic/downloaded-pdf-library';
import {
  addPdfToLibrary,
  clearPdfLibrary,
  readPdfLibrary,
} from '../js/logic/pdf-library-store';
import { downloadFile } from '../js/utils/helpers';
import {
  resetWorkspaceFileIndicator,
  setWorkspaceFiles,
} from '../js/logic/workspace-files';

function mockHandle(options: {
  granted?: boolean;
  writable?: {
    write: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
  };
}) {
  const writable = options.writable ?? {
    write: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  };
  return {
    writable,
    handle: {
      createWritable: vi.fn().mockResolvedValue(writable),
      queryPermission: vi
        .fn()
        .mockResolvedValue(options.granted === false ? 'prompt' : 'granted'),
      requestPermission: vi
        .fn()
        .mockResolvedValue(options.granted === false ? 'denied' : 'granted'),
      kind: 'file',
      getFile: vi.fn(),
    } as unknown as FileSystemFileHandle,
  };
}

afterEach(async () => {
  resetWorkspaceFileIndicator();
  await clearPdfLibrary();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('downloaded PDF library', () => {
  it('does not add a downloaded PDF output to My PDFs', async () => {
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

    await expect(readPdfLibrary()).resolves.toHaveLength(0);
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

  it('ignores download events without mutating My PDFs', async () => {
    initDownloadedPdfLibrary();

    document.dispatchEvent(
      new CustomEvent('shift:pdf-output-downloaded', {
        detail: {
          blob: new Blob(['x'], { type: 'application/pdf' }),
          filename: 'output.pdf',
        },
      })
    );

    await expect(readPdfLibrary()).resolves.toHaveLength(0);
  });

  it('writes a single selected handle in place instead of downloading a copy', async () => {
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:download'),
      revokeObjectURL: vi.fn(),
    });
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => {});
    const { handle, writable } = mockHandle({});
    const original = new File(['before'], 'report.pdf', {
      type: 'application/pdf',
    });
    const saved = await addPdfToLibrary(original, 'handoff', { handle });
    setWorkspaceFiles([
      {
        id: saved.id,
        name: saved.name,
        size: saved.size,
        source: saved.source,
        blob: saved.file,
        handle,
      },
    ]);
    initDownloadedPdfLibrary();

    downloadFile(
      new Blob(['after'], { type: 'application/pdf' }),
      'report.pdf'
    );

    await vi.waitFor(async () => {
      expect(writable.write).toHaveBeenCalledOnce();
    });
    expect(click).not.toHaveBeenCalled();
    const entries = await readPdfLibrary();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.id).toBe(saved.id);
    await expect(entries[0]?.file.text()).resolves.toBe('after');
  });

  it('does not add a library copy when the handle is not writable', async () => {
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:download'),
      revokeObjectURL: vi.fn(),
    });
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => {});
    const { handle } = mockHandle({ granted: false });
    const original = new File(['before'], 'report.pdf', {
      type: 'application/pdf',
    });
    const saved = await addPdfToLibrary(original, 'handoff', { handle });
    setWorkspaceFiles([
      {
        id: saved.id,
        name: saved.name,
        size: saved.size,
        source: saved.source,
        blob: saved.file,
        handle,
      },
    ]);
    initDownloadedPdfLibrary();

    downloadFile(
      new Blob(['after'], { type: 'application/pdf' }),
      'compressed.pdf'
    );

    await vi.waitFor(async () => {
      const entries = await readPdfLibrary();
      expect(entries).toHaveLength(1);
      expect(entries[0]?.source).toBe('handoff');
      await expect(entries[0]?.file.text()).resolves.toBe('before');
    });
    expect(click).not.toHaveBeenCalled();
  });
});
