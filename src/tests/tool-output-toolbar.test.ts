import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import JSZip from 'jszip';
import {
  initToolOutputToolbar,
  overwriteOutput,
  registerToolOutputSession,
  syncToolOutputToolbar,
  TOOL_OUTPUT_DOWNLOAD_ID,
  TOOL_OUTPUT_MENU_ID,
  TOOL_OUTPUT_OVERWRITE_ID,
  TOOL_OUTPUT_PRINT_ID,
  TOOL_OUTPUT_REDO_ID,
  TOOL_OUTPUT_RESET_ID,
  TOOL_OUTPUT_SAVE_ID,
  TOOL_OUTPUT_TOOLBAR_ID,
  TOOL_OUTPUT_UNDO_ID,
} from '../js/logic/tool-output-toolbar';
import {
  clearLatestPdfOutput,
  initShiftPdfSave,
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
import { downloadFile } from '../js/utils/helpers';
import { showAlert } from '../js/ui.js';
import { MarkdownEditor } from '../js/utils/markdown-editor';

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
  document.documentElement.removeAttribute('data-launch-surface');
  document.documentElement.removeAttribute('data-launch-entry');
  document.documentElement.removeAttribute('data-launch-context-applied');
  window.history.replaceState({}, '', '/');
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
  initShiftPdfSave();
  initToolOutputToolbar();
});

afterEach(async () => {
  clearLatestPdfOutput();
  await clearPdfLibrary();
  resetWorkspaceFileIndicator();
  document.documentElement.removeAttribute('data-launch-surface');
  document.documentElement.removeAttribute('data-launch-entry');
  document.documentElement.removeAttribute('data-launch-context-applied');
  window.history.replaceState({}, '', '/');
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('tool output toolbar', () => {
  it('does not resync in a loop when unrelated page classes change', () => {
    const bar = document.querySelector('.shift-pdf-viewer-header');
    const host = document.getElementById('tool-uploader');
    expect(bar).toBeTruthy();

    for (let i = 0; i < 40; i++) {
      document.body.classList.toggle('shift-tool-viewer');
      host?.classList.toggle('max-w-6xl');
    }

    expect(document.querySelectorAll('.shift-pdf-viewer-header')).toHaveLength(
      1
    );
    expect(document.querySelector('.shift-pdf-viewer-header')).toBe(bar);
  });

  it('puts the title on the left and Reset/Save on the right outside the card', () => {
    const card = document.getElementById('tool-uploader');
    const bar = document.querySelector('.shift-pdf-viewer-header');
    const title = bar?.querySelector('.shift-pdf-viewer-heading');
    const actions = bar?.querySelector('[data-shift-viewer-actions]');

    expect(bar?.parentElement).toBe(card?.parentElement);
    expect(card?.contains(bar)).toBe(false);
    expect(bar?.nextElementSibling).toBe(card);
    expect(bar?.firstElementChild).toBe(title);
    expect(title?.querySelector('h1')?.textContent).toBe('Sign PDF');
    expect(title?.querySelector('p')?.textContent).toBe('Sign a document.');
    expect(actions?.contains(button(TOOL_OUTPUT_RESET_ID))).toBe(true);
    expect(actions?.contains(button(TOOL_OUTPUT_SAVE_ID))).toBe(true);
    expect(button(TOOL_OUTPUT_UNDO_ID).disabled).toBe(true);
    expect(button(TOOL_OUTPUT_REDO_ID).disabled).toBe(true);
    expect(button(TOOL_OUTPUT_RESET_ID).disabled).toBe(true);
    expect(button(TOOL_OUTPUT_SAVE_ID).disabled).toBe(true);
    expect(button(TOOL_OUTPUT_OVERWRITE_ID).disabled).toBe(true);
    expect(button(TOOL_OUTPUT_DOWNLOAD_ID).disabled).toBe(true);
    expect(button(TOOL_OUTPUT_PRINT_ID).disabled).toBe(true);
    expect(document.getElementById(TOOL_OUTPUT_MENU_ID)?.className).toBe(
      'shift-tool-viewer-save'
    );
    expect(
      document
        .getElementById(TOOL_OUTPUT_MENU_ID)
        ?.classList.contains('is-ready')
    ).toBe(false);
    expect(document.getElementById('clear-files-btn')?.hidden).toBe(true);
    expect(document.getElementById(TOOL_OUTPUT_TOOLBAR_ID)).toBeNull();
  });

  it('keeps a separate action row visible beside the viewer chrome', () => {
    document.body.innerHTML = `
      <main>
        <div id="tool-uploader"><h1>Edit Bookmarks</h1></div>
        <div id="app">
          <div class="shift-action-row" role="group" aria-label="PDF actions">
            <button id="undo-btn" type="button">Undo</button>
            <button id="redo-btn" type="button">Redo</button>
            <button id="reset-btn" type="button">Reset</button>
          </div>
        </div>
      </main>
    `;
    initToolOutputToolbar();

    for (const id of ['undo-btn', 'redo-btn', 'reset-btn']) {
      const control = document.getElementById(id);
      expect(control?.hidden).toBe(false);
      expect(control?.getAttribute('aria-hidden')).not.toBe('true');
    }
    expect(document.getElementById(TOOL_OUTPUT_UNDO_ID)).not.toBeNull();
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

  it('places Save, Overwrite, Download, and Print in one output group', () => {
    const menu = document.getElementById(TOOL_OUTPUT_MENU_ID) as HTMLElement;
    const output = document.querySelector('[data-shift-action-group="output"]');
    const ids = [
      ...document.querySelectorAll('[data-shift-viewer-actions] button'),
    ].map((node) => node.id);

    expect(menu.className).toBe('shift-tool-viewer-save');
    expect(menu.contains(button(TOOL_OUTPUT_SAVE_ID))).toBe(true);
    expect(menu.contains(button(TOOL_OUTPUT_OVERWRITE_ID))).toBe(true);
    expect(menu.contains(button(TOOL_OUTPUT_DOWNLOAD_ID))).toBe(false);
    expect(menu.contains(button(TOOL_OUTPUT_PRINT_ID))).toBe(false);
    expect(output?.contains(button(TOOL_OUTPUT_DOWNLOAD_ID))).toBe(true);
    expect(output?.contains(button(TOOL_OUTPUT_PRINT_ID))).toBe(true);
    expect(ids).toEqual([
      TOOL_OUTPUT_UNDO_ID,
      TOOL_OUTPUT_REDO_ID,
      TOOL_OUTPUT_RESET_ID,
      TOOL_OUTPUT_SAVE_ID,
      TOOL_OUTPUT_OVERWRITE_ID,
      TOOL_OUTPUT_DOWNLOAD_ID,
      TOOL_OUTPUT_PRINT_ID,
    ]);
    expect(
      button(TOOL_OUTPUT_SAVE_ID).classList.contains('shift-pdf-viewer-action')
    ).toBe(true);
    expect(
      button(TOOL_OUTPUT_SAVE_ID).classList.contains('shift-action-button')
    ).toBe(true);
    expect(button(TOOL_OUTPUT_DOWNLOAD_ID).getAttribute('role')).not.toBe(
      'menuitem'
    );
  });

  it('hides in-card #process-btn and legacy primary export buttons universally across all Tool Surfaces', () => {
    document.body.innerHTML = `
      <main>
        <div id="tool-uploader">
          <h1>Compress PDF</h1>
          <button id="process-btn" type="button" disabled>Process</button>
          <button id="export-pdf-btn" type="button">Export PDF</button>
          <button id="download-btn" type="button">Download</button>
          <button id="downloadBtn" type="button">Download Form</button>
          <button id="download-searchable-pdf" type="button">Download Searchable PDF</button>
          <div id="export-dropdown-wrapper"></div>
          <button id="mdExport" type="button">Export Markdown PDF</button>
          <button id="download-all-btn" type="button">Download All (ZIP)</button>
        </div>
      </main>
    `;
    initToolOutputToolbar();

    for (const id of [
      'process-btn',
      'export-pdf-btn',
      'download-btn',
      'downloadBtn',
      'download-searchable-pdf',
      'export-dropdown-wrapper',
      'mdExport',
      'download-all-btn',
    ]) {
      const el = document.getElementById(id);
      expect(el?.hidden).toBe(true);
      expect(el?.getAttribute('aria-hidden')).toBe('true');
    }
  });

  it('bridges tools that use #process-btn internally: reports readiness from !processBtn.disabled and clicks #process-btn on commit', async () => {
    document.body.innerHTML = `
      <main>
        <div id="tool-uploader">
          <h1>Compress PDF</h1>
          <p>Reduce file size.</p>
          <button id="process-btn" type="button" disabled>Process</button>
        </div>
      </main>
    `;
    initToolOutputToolbar();

    const processBtn = document.getElementById(
      'process-btn'
    ) as HTMLButtonElement;
    expect(processBtn.hidden).toBe(true);
    expect(button(TOOL_OUTPUT_SAVE_ID).disabled).toBe(true);
    expect(button(TOOL_OUTPUT_DOWNLOAD_ID).disabled).toBe(true);
    expect(button(TOOL_OUTPUT_PRINT_ID).disabled).toBe(true);

    let callCount = 0;
    processBtn.addEventListener('click', () => {
      callCount += 1;
      downloadFile(
        new Blob([`compressed-${callCount}`], { type: 'application/pdf' }),
        `compressed-${callCount}.pdf`,
        'Reduced by 35%.'
      );
    });

    processBtn.disabled = false;
    syncToolOutputToolbar();

    expect(button(TOOL_OUTPUT_SAVE_ID).disabled).toBe(false);
    expect(button(TOOL_OUTPUT_DOWNLOAD_ID).disabled).toBe(false);
    expect(button(TOOL_OUTPUT_PRINT_ID).disabled).toBe(false);

    button(TOOL_OUTPUT_SAVE_ID).click();

    await vi.waitFor(async () => {
      const entries = await readPdfLibrary();
      expect(entries).toHaveLength(1);
      expect(entries[0]?.name).toBe('compressed-1.pdf');
    });
    expect(callCount).toBe(1);
    expect(showAlert).toHaveBeenCalledWith(
      'Saved',
      'Reduced by 35%. Saved to My PDFs.',
      'success'
    );
  });

  it('re-runs applyToolOutput fresh on every Save, Overwrite, Download, or Print commit', async () => {
    document.body.innerHTML = `
      <main>
        <div id="tool-uploader">
          <h1>Compress PDF</h1>
          <button id="process-btn" type="button">Process</button>
        </div>
      </main>
    `;
    initToolOutputToolbar();

    const processBtn = document.getElementById(
      'process-btn'
    ) as HTMLButtonElement;
    let version = 0;
    processBtn.addEventListener('click', () => {
      version += 1;
      downloadFile(
        new Blob([`v${version}`], { type: 'application/pdf' }),
        `doc-v${version}.pdf`
      );
    });

    // First commit via Save
    button(TOOL_OUTPUT_SAVE_ID).click();
    await vi.waitFor(async () => {
      const entries = await readPdfLibrary();
      expect(entries).toHaveLength(1);
      expect(entries[0]?.name).toBe('doc-v1.pdf');
    });

    // Second commit via Save after option change must re-run applyToolOutput and save v2
    button(TOOL_OUTPUT_SAVE_ID).click();
    await vi.waitFor(async () => {
      const entries = await readPdfLibrary();
      expect(entries).toHaveLength(2);
      expect(entries.map((e) => e.name)).toContain('doc-v2.pdf');
    });
    expect(version).toBe(2);
  });

  it('keeps viewer Save, hover, Undo, and Redo off until the PDF changes', () => {
    document.body.innerHTML = `
      <main>
        <div id="tool-uploader">
          <div data-shift-viewer-actions></div>
          <div id="signature-editor"></div>
          <button id="process-btn" type="button" disabled>Apply signatures</button>
        </div>
      </main>
    `;
    initToolOutputToolbar();

    let hasEdits = false;
    let canUndo = false;
    const canRedo = false;
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
      document
        .getElementById(TOOL_OUTPUT_MENU_ID)
        ?.classList.contains('is-ready')
    ).toBe(false);

    hasEdits = true;
    canUndo = true;
    syncToolOutputToolbar();

    expect(button(TOOL_OUTPUT_SAVE_ID).disabled).toBe(false);
    expect(button(TOOL_OUTPUT_UNDO_ID).disabled).toBe(false);
    expect(button(TOOL_OUTPUT_REDO_ID).disabled).toBe(true);
    expect(
      document
        .getElementById(TOOL_OUTPUT_MENU_ID)
        ?.classList.contains('is-ready')
    ).toBe(true);
    unregister();
  });

  it('shows Overwrite beside Save only when a single My PDFs entry is targeted and output is a single PDF', async () => {
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

    expect(button(TOOL_OUTPUT_OVERWRITE_ID).hidden).toBe(true);
    expect(button(TOOL_OUTPUT_DOWNLOAD_ID).hidden).toBe(false);
    expect(button(TOOL_OUTPUT_PRINT_ID).hidden).toBe(false);
    expect(
      document
        .querySelector('[data-shift-viewer-actions]')
        ?.getAttribute('role')
    ).toBe('group');
    unregister();
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

  it('applies then overwrites the original library PDF and its FileSystemFileHandle in place while staying on the active Tool Surface', async () => {
    document.body.innerHTML = `
      <main>
        <div id="tool-uploader">
          <div data-shift-viewer-actions></div>
          <div id="signature-editor"></div>
        </div>
      </main>
    `;
    initToolOutputToolbar();

    const writable = {
      write: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    };
    const handle = {
      createWritable: vi.fn().mockResolvedValue(writable),
      queryPermission: vi.fn().mockResolvedValue('granted'),
      requestPermission: vi.fn().mockResolvedValue('granted'),
      kind: 'file',
      getFile: vi
        .fn()
        .mockResolvedValue(
          new File(['before'], 'invoice.pdf', { type: 'application/pdf' })
        ),
    } as unknown as FileSystemFileHandle;

    const original = await addPdfToLibrary(
      new File(['before'], 'invoice.pdf', { type: 'application/pdf' }),
      'upload',
      { handle }
    );
    setWorkspaceFiles([
      {
        id: original.id,
        name: original.name,
        size: original.size,
        source: 'upload',
        blob: markFileLibraryId(
          new File(['before'], 'invoice.pdf', { type: 'application/pdf' }),
          original.id
        ),
        handle,
      },
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
    const assignLocation = vi.fn();
    await overwriteOutput(document, assignLocation);

    expect(apply).toHaveBeenCalledOnce();
    const entries = await readPdfLibrary();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.id).toBe(original.id);
    expect(entries[0]?.name).toBe('invoice.pdf');
    expect(writable.write).toHaveBeenCalledOnce();
    expect(assignLocation).not.toHaveBeenCalled();
    expect(showAlert).toHaveBeenCalledWith(
      'Saved',
      'The original PDF was updated in My PDFs.',
      'success'
    );
    unregister();
  });

  it('unpacks all .pdf files from a multi-PDF .zip into My PDFs when Save is clicked', async () => {
    const zip = new JSZip();
    zip.file('part-1.pdf', 'pdf-1-bytes');
    zip.file('nested/part-2.pdf', 'pdf-2-bytes');
    zip.file('readme.txt', 'ignore');
    const zipBlob = await zip.generateAsync({ type: 'blob' });

    const unregister = registerToolOutputSession({
      outputKind: 'multi-pdf-zip',
      apply: () => {
        setLatestPdfOutput({
          blob: zipBlob,
          filename: 'split-pages.zip',
          summary: 'Split into 2 PDFs.',
        });
      },
      canSave: () => true,
    });

    expect(button(TOOL_OUTPUT_SAVE_ID).disabled).toBe(false);
    expect(button(TOOL_OUTPUT_OVERWRITE_ID).hidden).toBe(true);
    expect(button(TOOL_OUTPUT_PRINT_ID).disabled).toBe(true);

    button(TOOL_OUTPUT_SAVE_ID).click();

    await vi.waitFor(async () => {
      const entries = await readPdfLibrary();
      expect(entries.map((e) => e.name).sort()).toEqual([
        'part-1.pdf',
        'part-2.pdf',
      ]);
    });
    expect(showAlert).toHaveBeenCalledWith(
      'Saved',
      'Split into 2 PDFs. Saved to My PDFs.',
      'success'
    );
    unregister();
  });

  it('hides Save, Overwrite, and Print when outputKind is non-pdf and keeps Download and Reset active', async () => {
    const unregister = registerToolOutputSession({
      outputKind: () => 'non-pdf',
      apply: () => {
        setLatestPdfOutput({
          blob: new Blob(['zip'], { type: 'application/zip' }),
          filename: 'extracted-images.zip',
        });
      },
      canDownload: () => true,
      canReset: () => true,
    });

    const saveGroup = document.getElementById(TOOL_OUTPUT_MENU_ID);
    expect(saveGroup?.hidden).toBe(true);
    expect(button(TOOL_OUTPUT_PRINT_ID).hidden).toBe(true);
    expect(button(TOOL_OUTPUT_DOWNLOAD_ID).hidden).toBe(false);
    expect(button(TOOL_OUTPUT_DOWNLOAD_ID).disabled).toBe(false);
    expect(button(TOOL_OUTPUT_RESET_ID).disabled).toBe(false);
    unregister();
  });

  it('hides Save and Overwrite when outputKind is inspection-only', () => {
    const unregister = registerToolOutputSession({
      outputKind: () => 'inspection-only',
      canDownload: () => true,
      canPrint: () => true,
    });

    const saveGroup = document.getElementById(TOOL_OUTPUT_MENU_ID);
    expect(saveGroup?.hidden).toBe(true);
    expect(button(TOOL_OUTPUT_PRINT_ID).hidden).toBe(false);
    expect(button(TOOL_OUTPUT_DOWNLOAD_ID).hidden).toBe(false);
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

  it('applies then downloads from the viewer Download button without modifying My PDFs', async () => {
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
    await expect(readPdfLibrary()).resolves.toHaveLength(0);
    unregister();
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

  it('lets a tool keep Reset disabled until there are edits', () => {
    let canReset = false;
    const reset = vi.fn(() => {
      canReset = false;
    });
    const unregister = registerToolOutputSession({
      reset,
      canReset: () => canReset,
    });

    expect(button(TOOL_OUTPUT_RESET_ID).disabled).toBe(true);

    canReset = true;
    syncToolOutputToolbar();
    expect(button(TOOL_OUTPUT_RESET_ID).disabled).toBe(false);

    unregister();
  });

  it('does not build a second header when boot already lifted the title', () => {
    document.body.innerHTML = `
      <main>
        <div id="uploader">
          <div class="shift-pdf-viewer-header">
            <div class="shift-pdf-viewer-heading"><h1>Compress PDF</h1></div>
            <div class="shift-pdf-viewer-actions" data-shift-viewer-actions></div>
          </div>
          <div id="tool-uploader">
            <button id="process-btn" type="button">Process</button>
          </div>
        </div>
      </main>
    `;
    const existing = document.querySelector('.shift-pdf-viewer-header');
    initToolOutputToolbar();

    expect(document.querySelectorAll('.shift-pdf-viewer-header')).toHaveLength(
      1
    );
    expect(document.querySelector('.shift-pdf-viewer-header')).toBe(existing);
    expect(existing?.contains(button(TOOL_OUTPUT_SAVE_ID))).toBe(true);
  });

  it('lifts the convert title into the shared tool header', () => {
    document.body.innerHTML = `
      <main>
        <div id="uploader">
          <div id="tool-uploader" data-convert-hub>
            <h1>Convert</h1>
            <p>Select one or more documents.</p>
          </div>
        </div>
      </main>
    `;
    initToolOutputToolbar();

    const header = document.querySelector('.shift-pdf-viewer-header');
    expect(header?.querySelector('h1')?.textContent).toBe('Convert');
    expect(header?.parentElement?.id).toBe('uploader');
    expect(document.getElementById(TOOL_OUTPUT_SAVE_ID)).not.toBeNull();
  });

  it('wires MarkdownEditor to registerToolOutputSession and generates a PDF blob on Save', async () => {
    document.body.innerHTML = `
      <div id="uploader">
        <div id="tool-uploader">
          <h1>Markdown to PDF</h1>
          <p>Write or paste Markdown.</p>
          <div id="markdown-editor-container"></div>
        </div>
      </div>
    `;
    initToolOutputToolbar();

    const container = document.getElementById(
      'markdown-editor-container'
    ) as HTMLElement;
    const editor = new MarkdownEditor(container, {
      initialContent: '# Quarterly Report\n\nRevenue grew by 20%.',
    });

    expect(document.getElementById('mdExport')?.hidden).toBe(true);
    expect(button(TOOL_OUTPUT_SAVE_ID).disabled).toBe(false);
    expect(button(TOOL_OUTPUT_RESET_ID).disabled).toBe(false);

    button(TOOL_OUTPUT_SAVE_ID).click();

    await vi.waitFor(async () => {
      const entries = await readPdfLibrary();
      expect(entries).toHaveLength(1);
      expect(entries[0]?.name).toBe('markdown-document.pdf');
    });

    button(TOOL_OUTPUT_RESET_ID).click();
    await vi.waitFor(() => {
      expect(editor.getContent()).toBe('');
    });
    expect(button(TOOL_OUTPUT_SAVE_ID).disabled).toBe(true);

    editor.destroy();
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
