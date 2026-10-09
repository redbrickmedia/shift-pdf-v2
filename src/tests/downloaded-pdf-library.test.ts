import { afterEach, describe, expect, it, vi } from 'vitest';
import JSZip from 'jszip';
import { initDownloadedPdfLibrary } from '../js/logic/downloaded-pdf-library';
import {
  addPdfToLibrary,
  clearPdfLibrary,
  readPdfLibrary,
} from '../js/logic/pdf-library-store';
import { TOOL_SUCCESS_ID } from '../js/logic/tool-success';
import { downloadFile, PDF_OUTPUT_READY_EVENT } from '../js/utils/helpers';
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
  document.getElementById(TOOL_SUCCESS_ID)?.remove();
  document.getElementById('tool-success-opener')?.remove();
  document.getElementById('completion-panel')?.remove();
  await clearPdfLibrary();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function pressKey(key: string, shiftKey = false): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    key,
    shiftKey,
    bubbles: true,
    cancelable: true,
  });
  document.dispatchEvent(event);
  return event;
}

function focusOpener(): HTMLButtonElement {
  const opener = document.createElement('button');
  opener.id = 'tool-success-opener';
  opener.type = 'button';
  opener.textContent = 'Process';
  document.body.appendChild(opener);
  opener.focus();
  return opener;
}

function successMessage(): string {
  return (
    document.querySelector('#shift-tool-success-message')?.textContent ?? ''
  );
}

describe('tool success', () => {
  it('adds a PDF result to My PDFs and shows a download action', async () => {
    initDownloadedPdfLibrary();

    downloadFile(
      new Blob(['generated'], { type: 'application/pdf' }),
      'merged.pdf',
      'Combined 2 files.'
    );

    await vi.waitFor(() => {
      expect(successMessage()).toContain('merged.pdf was added to My PDFs.');
    });
    expect(successMessage()).toContain('Combined 2 files.');
    expect(
      document.getElementById('shift-tool-success')?.classList.contains('hidden')
    ).toBe(false);
    expect(
      (document.getElementById('shift-tool-success-library') as HTMLElement)
        .hidden
    ).toBe(false);
    await expect(readPdfLibrary()).resolves.toEqual([
      expect.objectContaining({ name: 'merged.pdf' }),
    ]);

    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => {});
    document.getElementById('shift-tool-success-download')?.dispatchEvent(
      new MouseEvent('click', { bubbles: true })
    );
    expect(click).toHaveBeenCalledOnce();
  });

  it('adds each PDF inside a zip and keeps the zip as the download', async () => {
    initDownloadedPdfLibrary();
    const zip = new JSZip();
    zip.file('Invoice (Compressed).pdf', 'small-pdf');
    zip.file('notes.txt', 'ignore me');
    const blob = await zip.generateAsync({ type: 'blob' });

    downloadFile(blob, 'compressed-pdfs.zip');

    await vi.waitFor(() => {
      expect(successMessage()).toContain(
        'Invoice (Compressed).pdf was added to My PDFs.'
      );
    });
    const library = await readPdfLibrary();
    expect(library.map((entry) => entry.name)).toEqual([
      'Invoice (Compressed).pdf',
    ]);

    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => {});
    (
      document.getElementById(
        'shift-tool-success-download'
      ) as HTMLButtonElement
    ).click();
    expect(click).toHaveBeenCalledOnce();
    const anchor = click.mock.instances[0] as HTMLAnchorElement;
    expect(anchor.download).toBe('compressed-pdfs.zip');
  });

  it('offers a download for a non-PDF result without adding it to My PDFs', async () => {
    initDownloadedPdfLibrary();

    downloadFile(new Blob(['png'], { type: 'image/png' }), 'page.png');

    await vi.waitFor(() => {
      expect(successMessage()).toContain('page.png is ready to download.');
    });
    expect(
      (document.getElementById('shift-tool-success-library') as HTMLElement)
        .hidden
    ).toBe(true);
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
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(
      document.getElementById(TOOL_SUCCESS_ID)?.classList.contains('hidden') ??
        true
    ).toBe(true);
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

  it('writes through a library handle when the workspace file has none', async () => {
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
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(
      document.getElementById(TOOL_SUCCESS_ID)?.classList.contains('hidden') ??
        true
    ).toBe(true);
    confirmSaveToDisk();

    await vi.waitFor(async () => {
      expect(writable.write).toHaveBeenCalledOnce();
    });
    await expect((await readPdfLibrary())[0]?.file.text()).resolves.toBe(
      'after'
    );
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

  it('keeps one labelled dialog, moves focus to Download, and releases it on dismiss', async () => {
    const opener = focusOpener();
    const panel = document.createElement('section');
    panel.id = 'completion-panel';
    document.body.appendChild(panel);
    initDownloadedPdfLibrary();
    initDownloadedPdfLibrary();

    let readyEvents = 0;
    const countReady = () => {
      readyEvents += 1;
    };
    document.addEventListener(PDF_OUTPUT_READY_EVENT, countReady);
    downloadFile(
      new Blob(['generated'], { type: 'application/pdf' }),
      'once.pdf',
      'Combined 2 files.'
    );

    await vi.waitFor(() => {
      expect(successMessage()).toContain('once.pdf was added to My PDFs.');
    });
    expect(successMessage()).not.toContain('files were added');
    expect(document.querySelectorAll(`#${TOOL_SUCCESS_ID}`)).toHaveLength(1);
    expect(panel.classList.contains('hidden')).toBe(true);
    expect(readyEvents).toBe(1);
    await expect(readPdfLibrary()).resolves.toHaveLength(1);

    const dialog = document.getElementById(TOOL_SUCCESS_ID);
    const download = document.getElementById('shift-tool-success-download');
    const library = document.getElementById('shift-tool-success-library');
    const close = document.getElementById('shift-tool-success-close');
    expect(dialog?.getAttribute('role')).toBe('dialog');
    expect(dialog?.getAttribute('aria-modal')).toBe('true');
    expect(dialog?.getAttribute('aria-labelledby')).toBe(
      'shift-tool-success-title'
    );
    expect(dialog?.getAttribute('aria-describedby')).toBe(
      'shift-tool-success-message'
    );
    expect(document.getElementById('shift-tool-success-title')?.textContent).toBe(
      'Your file is ready'
    );
    expect(download?.tagName).toBe('BUTTON');
    expect((download as HTMLButtonElement).type).toBe('button');
    expect(document.activeElement).toBe(download);

    expect(pressKey('Tab').defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(library);
    expect(pressKey('Tab').defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(close);
    expect(pressKey('Tab', true).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(library);
    pressKey('Tab', true);
    expect(document.activeElement).toBe(download);

    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => {});
    (download as HTMLButtonElement).click();
    expect(click).toHaveBeenCalledOnce();
    expect(readyEvents).toBe(1);
    expect(document.activeElement).toBe(download);

    pressKey('Escape');
    expect(dialog?.classList.contains('hidden')).toBe(true);
    expect(dialog?.hidden).toBe(true);
    expect(document.activeElement).toBe(opener);
    expect(pressKey('Tab').defaultPrevented).toBe(false);
    expect(pressKey('Escape').defaultPrevented).toBe(false);

    downloadFile(new Blob(['png'], { type: 'image/png' }), 'page.png');
    await vi.waitFor(() => {
      expect(successMessage()).toContain('page.png is ready to download.');
    });
    expect(
      (document.getElementById('shift-tool-success-library') as HTMLElement)
        .hidden
    ).toBe(true);
    const pngDownload = document.getElementById('shift-tool-success-download');
    const pngClose = document.getElementById('shift-tool-success-close');
    expect(document.activeElement).toBe(pngDownload);
    pressKey('Tab');
    expect(document.activeElement).toBe(pngClose);
    pressKey('Tab');
    expect(document.activeElement).toBe(pngDownload);
    (pngClose as HTMLButtonElement).click();
    expect(document.getElementById(TOOL_SUCCESS_ID)?.classList.contains('hidden')).toBe(
      true
    );
    expect(document.activeElement).toBe(opener);
    document.removeEventListener(PDF_OUTPUT_READY_EVENT, countReady);
  });
});
