import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  initToolOutputToolbar,
  registerToolOutputSession,
  syncToolOutputToolbar,
  TOOL_OUTPUT_DOWNLOAD_ID,
  TOOL_OUTPUT_MENU_ID,
  TOOL_OUTPUT_REDO_ID,
  TOOL_OUTPUT_RESET_ID,
  TOOL_OUTPUT_SAVE_ID,
  TOOL_OUTPUT_TOOLBAR_ID,
  TOOL_OUTPUT_UNDO_ID,
} from '../js/logic/tool-output-toolbar';
import {
  clearLatestPdfOutput,
  setLatestPdfOutput,
} from '../js/logic/shift-pdf-save';
import { clearPdfLibrary, readPdfLibrary } from '../js/logic/pdf-library-store';
import { resetWorkspaceFileIndicator } from '../js/logic/workspace-files';

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
  it('renders one consistent action surface with progressive Download', () => {
    expect(document.getElementById(TOOL_OUTPUT_TOOLBAR_ID)).toBeTruthy();
    expect(button(TOOL_OUTPUT_UNDO_ID).disabled).toBe(true);
    expect(button(TOOL_OUTPUT_REDO_ID).disabled).toBe(true);
    expect(button(TOOL_OUTPUT_SAVE_ID).disabled).toBe(true);
    expect(button(TOOL_OUTPUT_DOWNLOAD_ID).disabled).toBe(true);
    expect(document.getElementById(TOOL_OUTPUT_MENU_ID)).toBeInstanceOf(
      HTMLDetailsElement
    );
    expect(document.getElementById('clear-files-btn')?.hidden).toBe(true);
  });

  it('enables Save for PDF and Download for every output', () => {
    setLatestPdfOutput({
      blob: new Blob(['pdf'], { type: 'application/pdf' }),
      filename: 'signed.pdf',
    });
    syncToolOutputToolbar();

    expect(button(TOOL_OUTPUT_SAVE_ID).disabled).toBe(false);
    expect(button(TOOL_OUTPUT_DOWNLOAD_ID).disabled).toBe(false);

    setLatestPdfOutput({
      blob: new Blob(['zip'], { type: 'application/zip' }),
      filename: 'batch.zip',
    });
    syncToolOutputToolbar();

    expect(button(TOOL_OUTPUT_SAVE_ID).disabled).toBe(true);
    expect(button(TOOL_OUTPUT_DOWNLOAD_ID).disabled).toBe(false);
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
});
