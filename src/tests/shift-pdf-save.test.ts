import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addPdfToLibrary,
  clearPdfLibrary,
  readPdfLibrary,
} from '../js/logic/pdf-library-store';
import {
  canSaveToShiftPdf,
  clearLatestPdfOutput,
  initShiftPdfSave,
  saveToShiftPdf,
  setLatestPdfOutput,
} from '../js/logic/shift-pdf-save';
import {
  markFileLibraryId,
  resetWorkspaceFileIndicator,
  setWorkspaceFiles,
} from '../js/logic/workspace-files';
import {
  PDF_OUTPUT_DOWNLOADED_EVENT,
  PDF_OUTPUT_READY_EVENT,
} from '../js/utils/helpers';

vi.mock('../js/ui.js', () => ({
  showAlert: vi.fn(),
  hideAlert: vi.fn(),
  showLoader: vi.fn(),
  hideLoader: vi.fn(),
}));

afterEach(async () => {
  await clearPdfLibrary();
  resetWorkspaceFileIndicator();
  clearLatestPdfOutput();
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

beforeEach(() => {
  document.body.innerHTML = `
    <div id="tool-uploader">
      <section id="completion-panel" class="hidden">
        <a id="completion-download" href="#"></a>
        <button id="completion-start-over" type="button">Start over</button>
      </section>
    </div>
  `;
});

describe('saveToShiftPdf', () => {
  it('saves a copy instead of replacing the selected library PDF', async () => {
    const original = await addPdfToLibrary(
      new File(['before'], 'invoice.pdf', { type: 'application/pdf' }),
      'upload'
    );
    const selected = markFileLibraryId(
      new File(['before'], 'invoice.pdf', { type: 'application/pdf' }),
      original.id
    );
    setWorkspaceFiles([selected]);

    const result = await saveToShiftPdf(
      new Blob(['after'], { type: 'application/pdf' }),
      'invoice-edited.pdf'
    );

    expect(result).toBe('added');
    const entries = await readPdfLibrary();
    expect(entries).toHaveLength(2);
    expect(entries.some((entry) => entry.id === original.id)).toBe(true);
    const copy = entries.find((entry) => entry.id !== original.id);
    expect(copy?.name).toBe('invoice-edited.pdf');
    await expect(copy?.file.text()).resolves.toBe('after');
  });

  it('adds a new library record when there is no library target', async () => {
    const result = await saveToShiftPdf(
      new Blob(['fresh'], { type: 'application/pdf' }),
      'new.pdf'
    );

    expect(result).toBe('added');
    const entries = await readPdfLibrary();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.name).toBe('new.pdf');
    await expect(entries[0]?.file.text()).resolves.toBe('fresh');
  });

  it('skips non-PDF outputs but allows a result from multiple inputs', async () => {
    setWorkspaceFiles([
      { name: 'a.pdf', size: 1 },
      { name: 'b.pdf', size: 1 },
    ]);

    await expect(
      saveToShiftPdf(new Blob(['zip'], { type: 'application/zip' }), 'out.zip')
    ).resolves.toBe('skipped');
    await expect(
      saveToShiftPdf(new Blob(['pdf'], { type: 'application/pdf' }), 'out.pdf')
    ).resolves.toBe('added');
    await expect(readPdfLibrary()).resolves.toHaveLength(1);
  });

  it('does not emit a download event while saving', async () => {
    const downloaded = vi.fn();
    const ready = vi.fn();
    document.addEventListener(PDF_OUTPUT_DOWNLOADED_EVENT, downloaded);
    document.addEventListener(PDF_OUTPUT_READY_EVENT, ready);

    await saveToShiftPdf(
      new Blob(['saved'], { type: 'application/pdf' }),
      'saved.pdf'
    );

    expect(downloaded).not.toHaveBeenCalled();
    expect(ready).not.toHaveBeenCalled();
    document.removeEventListener(PDF_OUTPUT_DOWNLOADED_EVENT, downloaded);
    document.removeEventListener(PDF_OUTPUT_READY_EVENT, ready);
  });

  it('skips adopting a saved copy when the home library epoch changes', async () => {
    const workspace = await import('../js/logic/workspace-files');
    vi.spyOn(workspace, 'getHomeLibraryEpoch')
      .mockReturnValueOnce(10)
      .mockReturnValue(11);

    await expect(
      saveToShiftPdf(
        new Blob(['after'], { type: 'application/pdf' }),
        'race.pdf'
      )
    ).resolves.toBe('skipped');

    await expect(readPdfLibrary()).resolves.toHaveLength(1);
  });
});

describe('shift PDF save UI', () => {
  it('gates Save for non-PDF but not multi-input outputs', () => {
    setLatestPdfOutput({
      blob: new Blob(['x'], { type: 'application/zip' }),
      filename: 'x.zip',
    });
    expect(canSaveToShiftPdf()).toBe(false);

    setLatestPdfOutput({
      blob: new Blob(['x'], { type: 'application/pdf' }),
      filename: 'x.pdf',
    });
    setWorkspaceFiles([
      new File(['a'], 'a.pdf', { type: 'application/pdf' }),
      new File(['b'], 'b.pdf', { type: 'application/pdf' }),
    ]);
    expect(canSaveToShiftPdf()).toBe(true);

    setWorkspaceFiles([new File(['a'], 'a.pdf', { type: 'application/pdf' })]);
    expect(canSaveToShiftPdf()).toBe(true);
  });

  it('tracks output events without injecting another completion action', () => {
    initShiftPdfSave();
    document.dispatchEvent(
      new CustomEvent(PDF_OUTPUT_READY_EVENT, {
        detail: {
          blob: new Blob(['ready'], { type: 'application/pdf' }),
          filename: 'ready.pdf',
        },
      })
    );
    expect(canSaveToShiftPdf()).toBe(true);
    expect(document.getElementById('completion-save-shift')).toBeNull();
  });
});
