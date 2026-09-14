import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addPdfToLibrary,
  clearPdfLibrary,
  readPdfLibrary,
} from '../js/logic/pdf-library-store';
import {
  canSaveToShiftPdf,
  clearLatestPdfOutput,
  COMPLETION_SAVE_BUTTON_ID,
  initShiftPdfSave,
  OUTPUT_SAVE_BUTTON_ID,
  saveToShiftPdf,
  setLatestPdfOutput,
  VIEWER_SAVE_BUTTON_ID,
} from '../js/logic/shift-pdf-save';
import { TOOL_VIEWER_ACTIONS_ATTR } from '../js/logic/tool-viewer-layout';
import {
  getWorkspaceFiles,
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
  it('replaces the single selected library PDF while preserving its id', async () => {
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

    expect(result).toBe('replaced');
    const entries = await readPdfLibrary();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.id).toBe(original.id);
    expect(entries[0]?.name).toBe('invoice.pdf');
    await expect(entries[0]?.file.text()).resolves.toBe('after');
    expect(getWorkspaceFiles()[0]?.id).toBe(original.id);
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

  it('skips non-PDF outputs and multi-input selections', async () => {
    // Placeholders without blobs avoid adoptSelectionIntoLibrary so this
    // asserts Save gating alone, not selection-into-library side effects.
    setWorkspaceFiles([
      { name: 'a.pdf', size: 1 },
      { name: 'b.pdf', size: 1 },
    ]);

    await expect(
      saveToShiftPdf(new Blob(['zip'], { type: 'application/zip' }), 'out.zip')
    ).resolves.toBe('skipped');
    await expect(
      saveToShiftPdf(new Blob(['pdf'], { type: 'application/pdf' }), 'out.pdf')
    ).resolves.toBe('skipped');
    await expect(readPdfLibrary()).resolves.toHaveLength(0);
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

  it('skips replace when the home library epoch changes mid-save (ghost race)', async () => {
    const original = await addPdfToLibrary(
      new File(['before'], 'race.pdf', { type: 'application/pdf' }),
      'upload'
    );
    const selected = markFileLibraryId(
      new File(['before'], 'race.pdf', { type: 'application/pdf' }),
      original.id
    );
    setWorkspaceFiles([selected]);

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

    // Replace may have written bytes, but Save must not adopt them into the
    // workspace after a concurrent library epoch bump.
    expect(getWorkspaceFiles()[0]?.id).toBe(original.id);
  });
});

describe('shift PDF save UI', () => {
  it('gates Save for non-PDF and multi-input outputs', () => {
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
    expect(canSaveToShiftPdf()).toBe(false);

    setWorkspaceFiles([new File(['a'], 'a.pdf', { type: 'application/pdf' })]);
    expect(canSaveToShiftPdf()).toBe(true);
  });

  it('injects a completion Save action when PDF output is ready', () => {
    initShiftPdfSave();

    setLatestPdfOutput({
      blob: new Blob(['ready'], { type: 'application/pdf' }),
      filename: 'ready.pdf',
    });

    const button = document.getElementById(COMPLETION_SAVE_BUTTON_ID);
    expect(button).toBeInstanceOf(HTMLButtonElement);
    expect(button?.hidden).toBe(false);
    expect((button as HTMLButtonElement).disabled).toBe(false);
    expect(button?.textContent).toMatch(/Save to Shift PDF/);
  });

  it('injects a viewer Save action when viewer actions exist', () => {
    document.body.innerHTML = `
      <div id="tool-uploader">
        <div class="shift-tool-viewer-actions"></div>
      </div>
    `;
    const actions = document.querySelector(
      '.shift-tool-viewer-actions'
    ) as HTMLElement;
    actions.setAttribute(TOOL_VIEWER_ACTIONS_ATTR, '');

    initShiftPdfSave();
    setLatestPdfOutput({
      blob: new Blob(['ready'], { type: 'application/pdf' }),
      filename: 'ready.pdf',
    });

    expect(document.getElementById(VIEWER_SAVE_BUTTON_ID)).toBeInstanceOf(
      HTMLButtonElement
    );
    expect(document.getElementById(OUTPUT_SAVE_BUTTON_ID)).toBeNull();
  });
});
