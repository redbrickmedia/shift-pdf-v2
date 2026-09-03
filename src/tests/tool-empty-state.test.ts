import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  addPdfToLibrary,
  clearPdfLibrary,
} from '../js/logic/pdf-library-store';
import {
  initToolEmptyState,
  resetToolEmptyState,
  syncToolEmptyState,
  TOOL_LIBRARY_BTN_ID,
} from '../js/logic/tool-empty-state';
import * as pdfLibraryPicker from '../js/logic/pdf-library-picker';
import {
  resetWorkspaceFileIndicator,
  setHomeLibraryFiles,
  setWorkspaceFiles,
} from '../js/logic/workspace-files';
import { state } from '../js/state';

function mountToolShell() {
  document.body.innerHTML = `
    <div id="tool-uploader">
      <div id="drop-zone">
        <input id="file-input" type="file" accept="application/pdf" />
      </div>
      <div id="file-display-area"></div>
    </div>
  `;
}

function mountNonPdfToolShell() {
  document.body.innerHTML = `
    <div id="tool-uploader">
      <div id="drop-zone">
        <input id="file-input" type="file" accept="image/jpeg,.jpg" />
      </div>
      <div id="file-display-area"></div>
    </div>
  `;
}

afterEach(async () => {
  document.body.className = '';
  state.files = [];
  resetToolEmptyState();
  resetWorkspaceFileIndicator();
  await clearPdfLibrary();
  vi.restoreAllMocks();
});

describe('tool empty state', () => {
  it('shows a library button when the tool workspace is empty', () => {
    mountToolShell();
    initToolEmptyState();
    initToolEmptyState();

    const button = document.getElementById(TOOL_LIBRARY_BTN_ID);
    expect(button).not.toBeNull();
    expect(button?.hidden).toBe(false);
    expect(button?.textContent).toBe('Choose from library');
    expect(document.getElementById('drop-zone')?.hidden).toBe(false);
  });

  it('hides the library button once a workspace file is seeded with a library', () => {
    mountToolShell();
    setHomeLibraryFiles([
      {
        name: 'saved.pdf',
        blob: new File(['x'], 'saved.pdf', { type: 'application/pdf' }),
      },
    ]);
    setWorkspaceFiles([
      new File(['x'], 'saved.pdf', { type: 'application/pdf' }),
    ]);
    initToolEmptyState();

    expect(document.getElementById('drop-zone')?.hidden).toBe(true);
    expect(document.getElementById(TOOL_LIBRARY_BTN_ID)?.hidden).toBe(true);
  });

  it('restores the drop zone and library button after clearing workspace files', () => {
    mountToolShell();
    setHomeLibraryFiles([
      {
        name: 'saved.pdf',
        blob: new File(['x'], 'saved.pdf', { type: 'application/pdf' }),
      },
    ]);
    setWorkspaceFiles([
      new File(['x'], 'saved.pdf', { type: 'application/pdf' }),
    ]);
    initToolEmptyState();

    setWorkspaceFiles([]);
    syncToolEmptyState();

    expect(document.getElementById('drop-zone')?.hidden).toBe(false);
    expect(document.getElementById(TOOL_LIBRARY_BTN_ID)?.hidden).toBe(false);
  });

  it('opens the IndexedDB library picker from the empty-state button', async () => {
    mountToolShell();
    await addPdfToLibrary(
      new File(['x'], 'saved.pdf', { type: 'application/pdf' }),
      'upload'
    );
    const openPicker = vi
      .spyOn(pdfLibraryPicker, 'openPdfLibraryPicker')
      .mockResolvedValue(undefined);

    initToolEmptyState();
    document.getElementById(TOOL_LIBRARY_BTN_ID)?.click();

    expect(openPicker).toHaveBeenCalledOnce();
    expect(openPicker.mock.calls[0]?.[0]).toMatchObject({
      title: 'Choose a PDF from your library',
    });
  });

  it('applies a library selection and can fall back to the device picker', async () => {
    mountToolShell();
    const selected = new File(['x'], 'saved.pdf', { type: 'application/pdf' });
    const input = document.getElementById('file-input') as HTMLInputElement;
    const click = vi.spyOn(input, 'click').mockImplementation(() => {});
    const openPicker = vi
      .spyOn(pdfLibraryPicker, 'openPdfLibraryPicker')
      .mockImplementation(async (options) => {
        options.onSelect([
          {
            id: '1',
            name: selected.name,
            type: 'application/pdf',
            size: selected.size,
            source: 'upload',
            addedAt: Date.now(),
            file: selected,
          },
        ]);
        options.onUpload?.();
      });

    initToolEmptyState();
    document.getElementById(TOOL_LIBRARY_BTN_ID)?.click();
    await vi.waitFor(() => {
      expect(openPicker).toHaveBeenCalledOnce();
    });

    expect(state.files[0]?.name).toBe('saved.pdf');
    expect(click).toHaveBeenCalledOnce();
  });

  it('removes the library button when the tool stops accepting PDFs', () => {
    mountToolShell();
    initToolEmptyState();
    expect(document.getElementById(TOOL_LIBRARY_BTN_ID)).not.toBeNull();

    const input = document.getElementById('file-input') as HTMLInputElement;
    input.accept = 'image/jpeg,.jpg';
    syncToolEmptyState();

    expect(document.getElementById(TOOL_LIBRARY_BTN_ID)).toBeNull();
  });

  it('does not inject the library button on non-PDF tools', () => {
    mountNonPdfToolShell();
    initToolEmptyState();

    expect(document.getElementById(TOOL_LIBRARY_BTN_ID)).toBeNull();
  });

  it('does not inject the library button on the home page', () => {
    document.body.innerHTML = `
      <section id="shift-my-pdfs"></section>
      <div id="drop-zone">
        <input id="file-input" type="file" accept="application/pdf" />
      </div>
    `;
    initToolEmptyState();

    expect(document.getElementById(TOOL_LIBRARY_BTN_ID)).toBeNull();
  });

  it('does not inject the library button on the all-tools page', () => {
    document.body.className = 'shift-home';
    document.body.innerHTML = `
      <div id="grid-view"><div id="tool-grid"></div></div>
      <div id="drop-zone">
        <input id="file-input" type="file" accept="application/pdf" />
      </div>
    `;
    initToolEmptyState();

    expect(document.getElementById(TOOL_LIBRARY_BTN_ID)).toBeNull();
  });
});
