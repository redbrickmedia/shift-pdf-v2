import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  currentAddMoreExcludeIdentities,
  initAddMoreLibraryPicker,
  openAddMoreLibraryPicker,
  resetAddMoreLibraryPicker,
} from '../js/logic/add-more-files';
import {
  addPdfToLibrary,
  clearPdfLibrary,
} from '../js/logic/pdf-library-store';
import * as pdfLibraryPicker from '../js/logic/pdf-library-picker';
import { state } from '../js/state';
import {
  resetWorkspaceFileIndicator,
  setWorkspaceFiles,
} from '../js/logic/workspace-files';

function mountPdfToolShell(multiple = true) {
  document.body.innerHTML = `
    <div id="tool-uploader">
      <div id="drop-zone">
        <input
          id="file-input"
          type="file"
          accept="application/pdf"
          ${multiple ? 'multiple' : ''}
        />
      </div>
      <div id="file-controls">
        <button id="add-more-btn" type="button">Add More Files</button>
      </div>
      <div id="file-display-area"></div>
    </div>
  `;
}

function mountImageToolShell() {
  document.body.innerHTML = `
    <div id="tool-uploader">
      <div id="drop-zone">
        <input id="file-input" type="file" accept="image/jpeg,.jpg" multiple />
      </div>
      <div id="file-controls">
        <button id="add-more-btn" type="button">Add More Files</button>
      </div>
    </div>
  `;
}

afterEach(async () => {
  document.body.innerHTML = '';
  document.body.className = '';
  state.files = [];
  resetAddMoreLibraryPicker();
  resetWorkspaceFileIndicator();
  await clearPdfLibrary();
  vi.restoreAllMocks();
});

describe('add more files library picker', () => {
  it('opens the shared library picker from #add-more-btn on PDF tools', async () => {
    mountPdfToolShell();
    const openPicker = vi
      .spyOn(pdfLibraryPicker, 'openPdfLibraryPicker')
      .mockResolvedValue(undefined);

    initAddMoreLibraryPicker();
    document.getElementById('add-more-btn')?.click();

    expect(openPicker).toHaveBeenCalledOnce();
    expect(openPicker.mock.calls[0]?.[0]).toMatchObject({
      title: 'Add PDFs from library',
    });
    expect(typeof openPicker.mock.calls[0]?.[0]?.onUpload).toBe('function');
  });

  it('does not intercept add-more on non-PDF tools', () => {
    mountImageToolShell();
    const openPicker = vi
      .spyOn(pdfLibraryPicker, 'openPdfLibraryPicker')
      .mockResolvedValue(undefined);
    const input = document.getElementById('file-input') as HTMLInputElement;
    const click = vi.spyOn(input, 'click').mockImplementation(() => {});

    initAddMoreLibraryPicker();
    document.getElementById('add-more-btn')?.addEventListener('click', () => {
      input.click();
    });
    document.getElementById('add-more-btn')?.click();

    expect(openPicker).not.toHaveBeenCalled();
    expect(click).toHaveBeenCalledOnce();
  });

  it('stops page handlers from opening the disk picker on PDF tools', () => {
    mountPdfToolShell();
    vi.spyOn(pdfLibraryPicker, 'openPdfLibraryPicker').mockResolvedValue(
      undefined
    );
    const input = document.getElementById('file-input') as HTMLInputElement;
    const click = vi.spyOn(input, 'click').mockImplementation(() => {});

    initAddMoreLibraryPicker();
    document.getElementById('add-more-btn')?.addEventListener('click', () => {
      input.click();
    });
    document.getElementById('add-more-btn')?.click();

    expect(click).not.toHaveBeenCalled();
  });

  it('appends a library selection through the file input change event', async () => {
    mountPdfToolShell();
    const existing = new File(['a'], 'already.pdf', {
      type: 'application/pdf',
    });
    state.files = [existing];

    const input = document.getElementById('file-input') as HTMLInputElement;
    const appended: string[] = [];
    input.addEventListener('change', () => {
      const next = Array.from(input.files ?? []);
      state.files = [...state.files, ...next];
      appended.push(...next.map((file) => file.name));
    });

    const selected = new File(['b'], 'from-library.pdf', {
      type: 'application/pdf',
    });
    vi.spyOn(pdfLibraryPicker, 'openPdfLibraryPicker').mockImplementation(
      async (options) => {
        options.onSelect([
          {
            id: 'lib-1',
            name: selected.name,
            type: 'application/pdf',
            size: selected.size,
            source: 'upload',
            addedAt: Date.now(),
            file: selected,
          },
        ]);
      }
    );

    await openAddMoreLibraryPicker();

    expect(appended).toEqual(['from-library.pdf']);
    expect(state.files.map((file) => file.name)).toEqual([
      'already.pdf',
      'from-library.pdf',
    ]);
  });

  it('offers upload from device as the secondary action', async () => {
    mountPdfToolShell();
    const input = document.getElementById('file-input') as HTMLInputElement;
    const click = vi.spyOn(input, 'click').mockImplementation(() => {});

    vi.spyOn(pdfLibraryPicker, 'openPdfLibraryPicker').mockImplementation(
      async (options) => {
        options.onUpload?.();
      }
    );

    await openAddMoreLibraryPicker();

    expect(click).toHaveBeenCalledOnce();
  });

  it('excludes files already in state or the workspace', () => {
    state.files = [new File(['x'], 'state.pdf', { type: 'application/pdf' })];
    setWorkspaceFiles([
      new File(['y'], 'workspace.pdf', { type: 'application/pdf' }),
    ]);

    const identities = currentAddMoreExcludeIdentities();
    expect(identities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'state.pdf' }),
        expect.objectContaining({ name: 'workspace.pdf' }),
      ])
    );
  });

  it('renders the real picker dialog when add-more is clicked', async () => {
    mountPdfToolShell();
    await addPdfToLibrary(
      new File(['one'], 'saved.pdf', { type: 'application/pdf' }),
      'upload'
    );

    initAddMoreLibraryPicker();
    document.getElementById('add-more-btn')?.click();

    await vi.waitFor(() => {
      expect(
        document.getElementById('shift-pdf-library-picker')
      ).not.toBeNull();
    });

    expect(
      document.querySelector('.shift-library-picker-footer')
    ).not.toBeNull();
    expect(
      document.querySelector('.shift-library-picker-upload')?.textContent
    ).toBe('Upload from device');
  });
});
