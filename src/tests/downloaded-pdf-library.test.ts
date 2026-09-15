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

function confirmSaveToDisk(): void {
  const button = document.querySelector<HTMLButtonElement>(
    '.shift-confirm-accept'
  );
  expect(button?.textContent).toBe('Save changes');
  button?.click();
}

afterEach(async () => {
  resetWorkspaceFileIndicator();
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

  it('keeps the user on the tool page after saving a download', async () => {
    const assign = vi.fn();
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:download'),
      revokeObjectURL: vi.fn(),
    });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    vi.stubGlobal('location', { ...window.location, assign });
    document.body.innerHTML =
      '<main id="compress-pdf"></main><a data-nav="my-pdfs" href="my-pdfs.html">My PDFs</a>';
    initDownloadedPdfLibrary();

    downloadFile(
      new Blob(['generated'], { type: 'application/pdf' }),
      'compressed.pdf'
    );

    await vi.waitFor(async () => {
      await expect(readPdfLibrary()).resolves.toHaveLength(1);
    });
    expect(assign).not.toHaveBeenCalled();
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

    await vi.waitFor(() => {
      expect(document.querySelector('.shift-confirm-accept')).not.toBeNull();
    });
    confirmSaveToDisk();

    await vi.waitFor(async () => {
      expect(writable.write).toHaveBeenCalledOnce();
    });
    expect(click).not.toHaveBeenCalled();
    const entries = await readPdfLibrary();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.id).toBe(saved.id);
    await expect(entries[0]?.file.text()).resolves.toBe('after');
  });

  it('does not auto-download when saving through the handle fails', async () => {
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

    await vi.waitFor(() => {
      expect(document.querySelector('.shift-confirm-accept')).not.toBeNull();
    });
    confirmSaveToDisk();

    await vi.waitFor(() => {
      expect(document.querySelector('.shift-confirm-title')?.textContent).toBe(
        'Could not save changes'
      );
    });
    expect(click).not.toHaveBeenCalled();
    await expect(readPdfLibrary()).resolves.toHaveLength(1);
  });

  it('does not download when the user keeps editing', async () => {
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:download'),
      revokeObjectURL: vi.fn(),
    });
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => {});
    const { handle, writable } = mockHandle({});
    const saved = await addPdfToLibrary(
      new File(['before'], 'report.pdf', { type: 'application/pdf' }),
      'handoff',
      { handle }
    );
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

    await vi.waitFor(() => {
      expect(document.querySelector('.shift-confirm-cancel')).not.toBeNull();
    });
    document.querySelector<HTMLButtonElement>('.shift-confirm-cancel')?.click();

    await vi.waitFor(() => {
      expect(document.querySelector('.shift-confirm-overlay')).toBeNull();
    });
    expect(writable.write).not.toHaveBeenCalled();
    expect(click).not.toHaveBeenCalled();
  });

  it('suppresses download when the workspace handle has no library record', async () => {
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:download'),
      revokeObjectURL: vi.fn(),
    });
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => {});
    const { handle, writable } = mockHandle({});
    setWorkspaceFiles([
      {
        name: 'report.pdf',
        size: 6,
        source: 'upload',
        blob: new File(['before'], 'report.pdf', {
          type: 'application/pdf',
        }),
        handle,
      },
    ]);
    initDownloadedPdfLibrary();

    downloadFile(
      new Blob(['after'], { type: 'application/pdf' }),
      'report.pdf'
    );

    await vi.waitFor(() => {
      expect(document.querySelector('.shift-confirm-accept')).not.toBeNull();
    });
    confirmSaveToDisk();

    await vi.waitFor(() => {
      expect(writable.write).toHaveBeenCalledOnce();
    });
    expect(click).not.toHaveBeenCalled();
  });
});
