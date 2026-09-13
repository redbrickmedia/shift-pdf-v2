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
  TOOL_LIBRARY_BTN_LABEL,
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
        <div class="drop-zone-copy">Click to select</div>
        <input id="file-input" type="file" accept="application/pdf" class="absolute top-0 left-0 w-full h-full opacity-0" />
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

    const dropZone = document.getElementById('drop-zone');
    const button = document.getElementById(TOOL_LIBRARY_BTN_ID);
    const wrap = button?.closest('.tool-library-btn-wrap');
    const fileInput = document.getElementById('file-input');

    expect(button).not.toBeNull();
    expect(button?.hidden).toBe(false);
    expect(button?.textContent).toBe(TOOL_LIBRARY_BTN_LABEL);
    expect(dropZone?.hidden).toBe(false);
    expect(dropZone?.contains(button)).toBe(true);
    expect(wrap?.querySelector('.tool-library-or')?.textContent).toBe('OR');
    // Overlay must not sit above the library CTA in DOM order.
    expect(wrap?.nextElementSibling).toBe(fileInput);
  });

  it('keeps library-button clicks from hitting the file-input overlay', () => {
    mountToolShell();
    const openPicker = vi
      .spyOn(pdfLibraryPicker, 'openPdfLibraryPicker')
      .mockResolvedValue(undefined);
    const input = document.getElementById('file-input') as HTMLInputElement;
    const inputClick = vi.spyOn(input, 'click').mockImplementation(() => {});

    initToolEmptyState();
    document.getElementById(TOOL_LIBRARY_BTN_ID)?.click();

    expect(openPicker).toHaveBeenCalledOnce();
    expect(inputClick).not.toHaveBeenCalled();
  });

  it('moves a legacy outside-the-zone library button inside the drop zone', () => {
    document.body.innerHTML = `
      <div id="tool-uploader">
        <div id="drop-zone">
          <input id="file-input" type="file" accept="application/pdf" />
        </div>
        <div class="tool-library-btn-wrap">
          <button id="${TOOL_LIBRARY_BTN_ID}" type="button">Choose from library</button>
        </div>
        <div id="file-display-area"></div>
      </div>
    `;

    initToolEmptyState();

    const dropZone = document.getElementById('drop-zone');
    const button = document.getElementById(TOOL_LIBRARY_BTN_ID);
    expect(dropZone?.contains(button)).toBe(true);
    expect(button?.textContent).toBe(TOOL_LIBRARY_BTN_LABEL);
    expect(
      button
        ?.closest('.tool-library-btn-wrap')
        ?.querySelector('.tool-library-or')
    ).not.toBeNull();
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

function mountTwoSlotShell() {
  document.body.innerHTML = `
    <div id="tool-uploader">
      <div id="drop-zone-1">
        <div class="drop-zone-copy">First PDF</div>
        <input id="file-input-1" type="file" accept="application/pdf" class="absolute top-0 left-0 w-full h-full opacity-0" />
      </div>
      <div id="drop-zone-2">
        <div class="drop-zone-copy">Second PDF</div>
        <input id="file-input-2" type="file" accept="application/pdf" class="absolute top-0 left-0 w-full h-full opacity-0" />
      </div>
    </div>
  `;
}

function slotButton(zoneId: string): HTMLButtonElement | null {
  return document.getElementById(
    `${TOOL_LIBRARY_BTN_ID}-${zoneId}`
  ) as HTMLButtonElement | null;
}

function setInputFiles(input: HTMLInputElement, files: File[]): void {
  if (typeof DataTransfer !== 'undefined') {
    const data = new DataTransfer();
    for (const file of files) data.items.add(file);
    input.files = data.files;
    return;
  }
  Object.defineProperty(input, 'files', { configurable: true, value: files });
}

describe('tool empty state: multi-slot uploaders', () => {
  it('gives every slot its own library button inside its own zone', () => {
    mountTwoSlotShell();
    initToolEmptyState();

    for (const zoneId of ['drop-zone-1', 'drop-zone-2']) {
      const button = slotButton(zoneId);
      expect(button).not.toBeNull();
      expect(button?.hidden).toBe(false);
      expect(button?.textContent).toBe(TOOL_LIBRARY_BTN_LABEL);
      expect(document.getElementById(zoneId)?.contains(button)).toBe(true);
    }

    // The primary CTA belongs to #drop-zone, which these pages do not have.
    expect(document.getElementById(TOOL_LIBRARY_BTN_ID)).toBeNull();
  });

  it('marks slot wraps so the primary auto-hide rules skip them', () => {
    mountTwoSlotShell();
    initToolEmptyState();

    const wrap = slotButton('drop-zone-1')?.closest('.tool-library-btn-wrap');
    expect(wrap?.classList.contains('tool-library-slot-wrap')).toBe(true);
    // Overlay pickers must stay after the CTA in DOM order.
    expect(wrap?.nextElementSibling).toBe(
      document.getElementById('file-input-1')
    );
  });

  it('a file in one slot leaves the other slot\u2019s button showing', () => {
    mountTwoSlotShell();
    initToolEmptyState();

    const first = document.getElementById('file-input-1') as HTMLInputElement;
    setInputFiles(first, [
      new File(['x'], 'first.pdf', { type: 'application/pdf' }),
    ]);
    first.dispatchEvent(new Event('change', { bubbles: true }));

    expect(slotButton('drop-zone-1')?.hidden).toBe(true);
    expect(slotButton('drop-zone-2')?.hidden).toBe(false);
  });

  it('routes a library pick to the slot whose button was clicked', async () => {
    mountTwoSlotShell();
    const selected = new File(['x'], 'saved.pdf', { type: 'application/pdf' });
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
      });

    initToolEmptyState();
    slotButton('drop-zone-2')?.click();
    await vi.waitFor(() => {
      expect(openPicker).toHaveBeenCalledOnce();
    });

    const first = document.getElementById('file-input-1') as HTMLInputElement;
    const second = document.getElementById('file-input-2') as HTMLInputElement;
    expect(second.files?.[0]?.name).toBe('saved.pdf');
    expect(first.files?.length ?? 0).toBe(0);
  });

  it('puts the button last when the picker is hidden behind its own control', () => {
    document.body.innerHTML = `
      <div id="upload-area" class="border-2 border-dashed">
        <p>Select PDF or image files</p>
        <input id="pdf-file-input" type="file" accept="application/pdf,image/*" class="hidden" />
        <button id="pdf-file-input-select-btn" type="button">Select Files</button>
      </div>
    `;
    initToolEmptyState();

    const zone = document.getElementById('upload-area');
    const wrap = slotButton('upload-area')?.closest('.tool-library-btn-wrap');
    expect(wrap).not.toBeNull();
    expect(zone?.lastElementChild).toBe(wrap);
  });

  it('skips a slot whose picker does not take PDFs', () => {
    document.body.innerHTML = `
      <div id="tool-uploader">
        <div id="drop-zone-1">
          <input id="file-input-1" type="file" accept="image/png" />
        </div>
        <div id="drop-zone-2">
          <input id="file-input-2" type="file" accept="application/pdf" />
        </div>
      </div>
    `;
    initToolEmptyState();

    expect(slotButton('drop-zone-1')).toBeNull();
    expect(slotButton('drop-zone-2')).not.toBeNull();
  });
});
