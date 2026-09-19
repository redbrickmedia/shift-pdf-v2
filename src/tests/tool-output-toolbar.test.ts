import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  initToolOutputToolbar,
  registerToolOutputSession,
  syncToolOutputToolbar,
  TOOL_OUTPUT_DOWNLOAD_ID,
  TOOL_OUTPUT_MENU_ID,
  TOOL_OUTPUT_OVERWRITE_ID,
  TOOL_OUTPUT_PRINT_ID,
  TOOL_OUTPUT_REDO_ID,
  TOOL_OUTPUT_RESET_ID,
  TOOL_OUTPUT_SAVE_ID,
  TOOL_OUTPUT_SAVE_MENU_HIDE_MS,
  TOOL_OUTPUT_TOOLBAR_ID,
  TOOL_OUTPUT_UNDO_ID,
} from '../js/logic/tool-output-toolbar';
import {
  clearLatestPdfOutput,
  setLatestPdfOutput,
} from '../js/logic/shift-pdf-save';
import {
  addPdfToLibrary,
  clearPdfLibrary,
  readPdfLibrary,
} from '../js/logic/pdf-library-store';
import {
  markFileLibraryId,
  resetWorkspaceFileIndicator,
  setWorkspaceFiles,
} from '../js/logic/workspace-files';

vi.mock('../js/ui.js', () => ({
  showAlert: vi.fn(),
  hideAlert: vi.fn(),
  showLoader: vi.fn(),
  hideLoader: vi.fn(),
}));

function button(id: string): HTMLButtonElement {
  return document.getElementById(id) as HTMLButtonElement;
}

beforeEach(() => {
  document.body.className = '';
  document.body.innerHTML = `
    <main>
      <div id="tool-uploader">
        <h1>Sign PDF</h1>
        <p>Sign a document.</p>
        <button id="clear-files-btn">Clear all</button>
      </div>
    </main>
  `;
  initToolOutputToolbar();
});

afterEach(async () => {
  clearLatestPdfOutput();
  await clearPdfLibrary();
  resetWorkspaceFileIndicator();
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('tool output toolbar', () => {
  it('does not resync in a loop when unrelated page classes change', () => {
    const toolbar = document.getElementById(TOOL_OUTPUT_TOOLBAR_ID);
    const host = document.getElementById('tool-uploader');
    expect(toolbar).toBeTruthy();

    for (let i = 0; i < 40; i++) {
      document.body.classList.toggle('shift-tool-viewer');
      host?.classList.toggle('max-w-6xl');
    }

    expect(document.querySelectorAll(`#${TOOL_OUTPUT_TOOLBAR_ID}`)).toHaveLength(
      1
    );
    expect(document.getElementById(TOOL_OUTPUT_TOOLBAR_ID)).toBe(toolbar);
  });

  it('renders one consistent action surface with progressive Download', () => {
    expect(document.getElementById(TOOL_OUTPUT_TOOLBAR_ID)).toBeTruthy();
    expect(button(TOOL_OUTPUT_UNDO_ID).disabled).toBe(true);
    expect(button(TOOL_OUTPUT_REDO_ID).disabled).toBe(true);
    expect(button(TOOL_OUTPUT_SAVE_ID).disabled).toBe(true);
    expect(button(TOOL_OUTPUT_OVERWRITE_ID).disabled).toBe(true);
    expect(button(TOOL_OUTPUT_DOWNLOAD_ID).disabled).toBe(true);
    expect(button(TOOL_OUTPUT_PRINT_ID).disabled).toBe(true);
    expect(document.getElementById(TOOL_OUTPUT_MENU_ID)).toBeInstanceOf(
      HTMLDetailsElement
    );
    expect(
      document.getElementById(TOOL_OUTPUT_MENU_ID)?.classList.contains('is-ready')
    ).toBe(false);
    expect(document.getElementById('clear-files-btn')?.hidden).toBe(true);
  });

  it('stays out of the PDF viewer, which has no output to save', () => {
    document.body.innerHTML = `
      <main id="shift-pdf-viewer">
        <div class="shift-pdf-viewer-actions">
          <button id="shift-pdf-viewer-print" type="button">Print</button>
          <button id="shift-pdf-viewer-download" type="button">Download</button>
        </div>
        <iframe id="shift-pdf-viewer-frame"></iframe>
      </main>
    `;
    initToolOutputToolbar();
    syncToolOutputToolbar();

    expect(document.getElementById(TOOL_OUTPUT_TOOLBAR_ID)).toBeNull();
    expect(document.getElementById('shift-pdf-viewer-print')?.hidden).toBe(
      false
    );
    expect(document.getElementById('shift-pdf-viewer-download')?.hidden).toBe(
      false
    );
  });

  it('keeps Download behind the Save disclosure on tools without a viewer', () => {
    const menu = document.getElementById(
      TOOL_OUTPUT_MENU_ID
    ) as HTMLDetailsElement;

    expect(menu.contains(button(TOOL_OUTPUT_OVERWRITE_ID))).toBe(true);
    expect(menu.contains(button(TOOL_OUTPUT_DOWNLOAD_ID))).toBe(true);
    expect(menu.contains(button(TOOL_OUTPUT_PRINT_ID))).toBe(true);
    expect(menu.contains(button(TOOL_OUTPUT_SAVE_ID))).toBe(false);
  });

  it('puts inline Save in the viewer header and discloses Overwrite, Download, and Print', () => {
    document.body.innerHTML = `
      <main>
        <div id="tool-uploader">
          <div class="shift-tool-viewer-bar">
            <div class="shift-tool-viewer-title"><h1>Sign PDF</h1></div>
            <div data-shift-viewer-actions></div>
          </div>
          <div id="signature-editor"></div>
          <button id="process-btn" type="button">Apply signatures</button>
          <button id="save-stamped-btn" type="button">Save Stamped PDF</button>
        </div>
      </main>
    `;
    initToolOutputToolbar();

    const actions = document.querySelector('[data-shift-viewer-actions]');
    const menu = document.getElementById(
      TOOL_OUTPUT_MENU_ID
    ) as HTMLElement | null;
    expect(document.getElementById(TOOL_OUTPUT_TOOLBAR_ID)).toBeNull();
    expect(document.getElementById(TOOL_OUTPUT_RESET_ID)).toBeNull();
    expect(actions?.contains(button(TOOL_OUTPUT_UNDO_ID))).toBe(true);
    expect(actions?.contains(button(TOOL_OUTPUT_REDO_ID))).toBe(true);
    expect(actions?.contains(button(TOOL_OUTPUT_SAVE_ID))).toBe(true);
    expect(button(TOOL_OUTPUT_SAVE_ID).className).toBe('shift-pdf-viewer-action');
    expect(menu?.className).toBe('shift-tool-viewer-save');
    expect(menu?.contains(button(TOOL_OUTPUT_SAVE_ID))).toBe(true);
    expect(menu?.contains(button(TOOL_OUTPUT_OVERWRITE_ID))).toBe(true);
    expect(menu?.contains(button(TOOL_OUTPUT_DOWNLOAD_ID))).toBe(true);
    expect(menu?.contains(button(TOOL_OUTPUT_PRINT_ID))).toBe(true);
    expect(button(TOOL_OUTPUT_SAVE_ID).disabled).toBe(true);
    expect(button(TOOL_OUTPUT_UNDO_ID).disabled).toBe(true);
    expect(button(TOOL_OUTPUT_REDO_ID).disabled).toBe(true);
    expect(button(TOOL_OUTPUT_OVERWRITE_ID).disabled).toBe(true);
    expect(menu?.classList.contains('is-ready')).toBe(false);
    expect(document.getElementById('process-btn')?.hidden).toBe(true);
    expect(document.getElementById('save-stamped-btn')?.hidden).toBe(true);
  });

  it('keeps viewer Save, hover, Undo, and Redo off until the PDF changes', () => {
    document.body.innerHTML = `
      <main>
        <div id="tool-uploader">
          <div data-shift-viewer-actions></div>
          <div id="signature-editor"></div>
          <button id="process-btn" type="button">Apply signatures</button>
        </div>
      </main>
    `;
    initToolOutputToolbar();

    let hasEdits = false;
    let canUndo = false;
    let canRedo = false;
    const unregister = registerToolOutputSession({
      apply: vi.fn(),
      undo: vi.fn(),
      redo: vi.fn(),
      canSave: () => hasEdits,
      canUndo: () => canUndo,
      canRedo: () => canRedo,
    });

    expect(button(TOOL_OUTPUT_SAVE_ID).disabled).toBe(true);
    expect(button(TOOL_OUTPUT_UNDO_ID).disabled).toBe(true);
    expect(button(TOOL_OUTPUT_REDO_ID).disabled).toBe(true);
    expect(
      document.getElementById(TOOL_OUTPUT_MENU_ID)?.classList.contains('is-ready')
    ).toBe(false);

    hasEdits = true;
    canUndo = true;
    syncToolOutputToolbar();

    expect(button(TOOL_OUTPUT_SAVE_ID).disabled).toBe(false);
    expect(button(TOOL_OUTPUT_UNDO_ID).disabled).toBe(false);
    expect(button(TOOL_OUTPUT_REDO_ID).disabled).toBe(true);
    expect(
      document.getElementById(TOOL_OUTPUT_MENU_ID)?.classList.contains('is-ready')
    ).toBe(true);
    unregister();
  });

  it('keeps the Save menu open while the pointer travels onto it', () => {
    vi.useFakeTimers();
    document.body.innerHTML = `
      <main>
        <div id="tool-uploader">
          <div data-shift-viewer-actions></div>
          <div id="signature-editor"></div>
        </div>
      </main>
    `;
    initToolOutputToolbar();
    const unregister = registerToolOutputSession({
      canSave: () => true,
    });
    syncToolOutputToolbar();

    const group = document.getElementById(TOOL_OUTPUT_MENU_ID) as HTMLElement;
    const dropdown = group.querySelector('.shift-tool-viewer-save-menu');
    expect(dropdown?.querySelector('.shift-tool-viewer-save-menu-surface')).toBeTruthy();

    group.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true }));
    expect(group.classList.contains('is-open')).toBe(true);

    group.dispatchEvent(new PointerEvent('pointerleave', { bubbles: true }));
    expect(group.classList.contains('is-open')).toBe(true);

    vi.advanceTimersByTime(TOOL_OUTPUT_SAVE_MENU_HIDE_MS - 20);
    expect(group.classList.contains('is-open')).toBe(true);

    group.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true }));
    vi.advanceTimersByTime(TOOL_OUTPUT_SAVE_MENU_HIDE_MS + 20);
    expect(group.classList.contains('is-open')).toBe(true);

    group.dispatchEvent(new PointerEvent('pointerleave', { bubbles: true }));
    vi.advanceTimersByTime(TOOL_OUTPUT_SAVE_MENU_HIDE_MS + 20);
    expect(group.classList.contains('is-open')).toBe(false);

    unregister();
    vi.useRealTimers();
  });

  it('prints from the viewer header through the active tool', async () => {
    document.body.innerHTML = `
      <main>
        <div id="tool-uploader">
          <div data-shift-viewer-actions></div>
          <div id="signature-editor"></div>
        </div>
      </main>
    `;
    initToolOutputToolbar();

    let viewerReady = false;
    const print = vi.fn();
    const unregister = registerToolOutputSession({
      print,
      canPrint: () => viewerReady,
    });

    expect(button(TOOL_OUTPUT_PRINT_ID).disabled).toBe(true);

    viewerReady = true;
    syncToolOutputToolbar();
    expect(button(TOOL_OUTPUT_PRINT_ID).disabled).toBe(false);
    button(TOOL_OUTPUT_PRINT_ID).click();

    await vi.waitFor(() => expect(print).toHaveBeenCalledOnce());
    unregister();
  });

  it('applies then overwrites the original library PDF from the viewer menu', async () => {
    document.body.innerHTML = `
      <main>
        <div id="tool-uploader">
          <div data-shift-viewer-actions></div>
          <div id="signature-editor"></div>
        </div>
      </main>
    `;
    initToolOutputToolbar();

    const original = await addPdfToLibrary(
      new File(['before'], 'invoice.pdf', { type: 'application/pdf' }),
      'upload'
    );
    setWorkspaceFiles([
      markFileLibraryId(
        new File(['before'], 'invoice.pdf', { type: 'application/pdf' }),
        original.id
      ),
    ]);

    const apply = vi.fn(() => {
      setLatestPdfOutput({
        blob: new Blob(['signed'], { type: 'application/pdf' }),
        filename: 'invoice-signed.pdf',
      });
    });
    const unregister = registerToolOutputSession({
      apply,
      canSave: () => true,
    });
    syncToolOutputToolbar();

    expect(button(TOOL_OUTPUT_OVERWRITE_ID).disabled).toBe(false);
    button(TOOL_OUTPUT_OVERWRITE_ID).click();

    await vi.waitFor(() => expect(apply).toHaveBeenCalledOnce());
    await vi.waitFor(async () => {
      const entries = await readPdfLibrary();
      expect(entries).toHaveLength(1);
      expect(entries[0]?.id).toBe(original.id);
      expect(entries[0]?.name).toBe('invoice.pdf');
      await expect(entries[0]?.file.text()).resolves.toBe('signed');
    });
    unregister();
  });

  it('applies then saves from the viewer Save button', async () => {
    document.body.innerHTML = `
      <main>
        <div id="tool-uploader">
          <div data-shift-viewer-actions></div>
          <div id="signature-editor"></div>
        </div>
      </main>
    `;
    initToolOutputToolbar();

    const apply = vi.fn(() => {
      setLatestPdfOutput({
        blob: new Blob(['signed'], { type: 'application/pdf' }),
        filename: 'signed.pdf',
      });
    });
    const unregister = registerToolOutputSession({
      apply,
      canSave: () => true,
    });

    expect(button(TOOL_OUTPUT_SAVE_ID).disabled).toBe(false);
    expect(button(TOOL_OUTPUT_DOWNLOAD_ID).disabled).toBe(false);
    button(TOOL_OUTPUT_SAVE_ID).click();

    await vi.waitFor(() => expect(apply).toHaveBeenCalledOnce());
    await vi.waitFor(async () => {
      const entries = await readPdfLibrary();
      expect(entries).toHaveLength(1);
      expect(entries[0]?.name).toBe('signed.pdf');
    });
    unregister();
  });

  it('applies then downloads from the viewer Download button', async () => {
    document.body.innerHTML = `
      <main>
        <div id="tool-uploader">
          <div data-shift-viewer-actions></div>
          <div id="signature-editor"></div>
        </div>
      </main>
    `;
    initToolOutputToolbar();

    const apply = vi.fn(() => {
      setLatestPdfOutput({
        blob: new Blob(['signed'], { type: 'application/pdf' }),
        filename: 'signed.pdf',
      });
    });
    const createElement = document.createElement.bind(document);
    const clicked = vi.fn();
    vi.spyOn(document, 'createElement').mockImplementation((tag) => {
      const element = createElement(tag);
      if (tag === 'a') {
        element.click = clicked;
      }
      return element;
    });
    const unregister = registerToolOutputSession({
      apply,
      canSave: () => true,
    });

    expect(button(TOOL_OUTPUT_DOWNLOAD_ID).disabled).toBe(false);
    button(TOOL_OUTPUT_DOWNLOAD_ID).click();

    await vi.waitFor(() => expect(apply).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(clicked).toHaveBeenCalledOnce());
    unregister();
  });

  it('enables Save for PDF and Download for every output', () => {
    setLatestPdfOutput({
      blob: new Blob(['pdf'], { type: 'application/pdf' }),
      filename: 'signed.pdf',
    });
    syncToolOutputToolbar();

    expect(button(TOOL_OUTPUT_SAVE_ID).disabled).toBe(false);
    expect(button(TOOL_OUTPUT_OVERWRITE_ID).disabled).toBe(true);
    expect(button(TOOL_OUTPUT_DOWNLOAD_ID).disabled).toBe(false);
    expect(button(TOOL_OUTPUT_PRINT_ID).disabled).toBe(false);

    setLatestPdfOutput({
      blob: new Blob(['zip'], { type: 'application/zip' }),
      filename: 'batch.zip',
    });
    syncToolOutputToolbar();

    expect(button(TOOL_OUTPUT_SAVE_ID).disabled).toBe(true);
    expect(button(TOOL_OUTPUT_OVERWRITE_ID).disabled).toBe(true);
    expect(button(TOOL_OUTPUT_DOWNLOAD_ID).disabled).toBe(false);
    expect(button(TOOL_OUTPUT_PRINT_ID).disabled).toBe(true);
  });

  it('saves a PDF copy to My PDFs', async () => {
    setLatestPdfOutput({
      blob: new Blob(['signed'], { type: 'application/pdf' }),
      filename: 'signed.pdf',
    });
    syncToolOutputToolbar();

    button(TOOL_OUTPUT_SAVE_ID).click();

    await vi.waitFor(async () => {
      const entries = await readPdfLibrary();
      expect(entries).toHaveLength(1);
      expect(entries[0]?.name).toBe('signed.pdf');
    });
  });

  it('adapts Undo, Redo, and Reset to the active tool', async () => {
    let canUndo = true;
    let canRedo = false;
    const undo = vi.fn(() => {
      canUndo = false;
      canRedo = true;
    });
    const redo = vi.fn();
    const reset = vi.fn();
    const unregister = registerToolOutputSession({
      undo,
      redo,
      reset,
      canUndo: () => canUndo,
      canRedo: () => canRedo,
    });

    expect(button(TOOL_OUTPUT_UNDO_ID).disabled).toBe(false);
    expect(button(TOOL_OUTPUT_REDO_ID).disabled).toBe(true);

    button(TOOL_OUTPUT_UNDO_ID).click();
    await vi.waitFor(() => expect(undo).toHaveBeenCalledOnce());
    expect(button(TOOL_OUTPUT_UNDO_ID).disabled).toBe(true);
    expect(button(TOOL_OUTPUT_REDO_ID).disabled).toBe(false);

    button(TOOL_OUTPUT_RESET_ID).click();
    await vi.waitFor(() => expect(reset).toHaveBeenCalledOnce());
    unregister();
  });

  it('keeps boxed Process visible and Save disabled until a result exists', () => {
    document.body.innerHTML = `
      <main>
        <div id="tool-uploader">
          <h1>Compress PDF</h1>
          <p>Reduce file size.</p>
          <button id="process-btn" type="button">Process</button>
        </div>
      </main>
    `;
    initToolOutputToolbar();

    expect(document.getElementById('process-btn')?.hidden).toBe(false);
    expect(button(TOOL_OUTPUT_SAVE_ID).disabled).toBe(true);
    expect(button(TOOL_OUTPUT_DOWNLOAD_ID).disabled).toBe(true);
    expect(button(TOOL_OUTPUT_PRINT_ID).disabled).toBe(true);

    setLatestPdfOutput({
      blob: new Blob(['pdf'], { type: 'application/pdf' }),
      filename: 'compressed.pdf',
    });
    syncToolOutputToolbar();

    expect(button(TOOL_OUTPUT_SAVE_ID).disabled).toBe(false);
    expect(button(TOOL_OUTPUT_DOWNLOAD_ID).disabled).toBe(false);
    expect(button(TOOL_OUTPUT_PRINT_ID).disabled).toBe(false);
    expect(document.getElementById('process-btn')?.hidden).toBe(false);
  });

  it('does not click boxed Process when Save already has published output', async () => {
    document.body.innerHTML = `
      <main>
        <div id="tool-uploader">
          <h1>Compress PDF</h1>
          <button id="process-btn" type="button">Process</button>
        </div>
      </main>
    `;
    initToolOutputToolbar();
    const process = document.getElementById('process-btn') as HTMLButtonElement;
    const processClick = vi.fn();
    process.addEventListener('click', processClick);

    setLatestPdfOutput({
      blob: new Blob(['pdf'], { type: 'application/pdf' }),
      filename: 'compressed.pdf',
    });
    syncToolOutputToolbar();
    button(TOOL_OUTPUT_SAVE_ID).click();

    await vi.waitFor(async () => {
      const entries = await readPdfLibrary();
      expect(entries).toHaveLength(1);
    });
    expect(processClick).not.toHaveBeenCalled();
  });

  it('applies Compare output through the shared session before Save', async () => {
    document.body.innerHTML = `
      <main>
        <div id="tool-uploader">
          <h1>Compare PDFs</h1>
          <div data-shift-viewer-actions></div>
          <div id="compare-viewer"></div>
          <div id="export-dropdown-wrapper">
            <button id="export-dropdown-btn" type="button">Export</button>
          </div>
        </div>
      </main>
    `;
    initToolOutputToolbar();

    let pairsReady = false;
    const apply = vi.fn(() => {
      setLatestPdfOutput({
        blob: new Blob(['compare'], { type: 'application/pdf' }),
        filename: 'bentopdf-compare-export.pdf',
      });
    });
    const unregister = registerToolOutputSession({
      apply,
      canSave: () => pairsReady,
    });

    expect(button(TOOL_OUTPUT_SAVE_ID).disabled).toBe(true);
    expect(document.getElementById('export-dropdown-wrapper')?.hidden).toBe(
      true
    );

    pairsReady = true;
    syncToolOutputToolbar();
    expect(button(TOOL_OUTPUT_SAVE_ID).disabled).toBe(false);
    expect(button(TOOL_OUTPUT_PRINT_ID).disabled).toBe(false);

    button(TOOL_OUTPUT_SAVE_ID).click();
    await vi.waitFor(() => expect(apply).toHaveBeenCalledOnce());
    await vi.waitFor(async () => {
      const entries = await readPdfLibrary();
      expect(entries).toHaveLength(1);
      expect(entries[0]?.name).toBe('bentopdf-compare-export.pdf');
    });
    unregister();
  });
});
