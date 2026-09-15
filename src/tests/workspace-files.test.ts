import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../js/utils/pdf-thumbnail.js', () => ({
  renderPdfFirstPage: vi.fn().mockResolvedValue(undefined),
}));

import { renderPdfFirstPage } from '../js/utils/pdf-thumbnail';
import { state } from '../js/state';
import {
  PENDING_FILE_ROW_ATTR,
  hasOpenFileFlag,
  markOpenFilePresent,
  readPersistedOpenFile,
  readPersistedOpenFiles,
  writeOpenFileSnapshot,
  writePersistedOpenFile,
} from '../js/logic/open-file-store';
import {
  addPdfToLibrary,
  clearPdfLibrary,
  readPdfLibrary,
} from '../js/logic/pdf-library-store';
import { TOOL_FAVORITES_RAIL_KEY } from '../js/logic/tool-favorites';
import { categories } from '../js/config/tools';
import {
  clearWorkspaceOpenFile,
  copyFileOrigin,
  getHomeOpenFileView,
  getPrimaryLibrarySaveTarget,
  getWorkspaceFiles,
  getWorkspacePdfSelectionCount,
  initWorkspaceFileIndicator,
  markFileFromHandoff,
  markFileLibraryId,
  openLibraryFileInViewer,
  persistWorkspaceOpenFile,
  renderWorkspaceFiles,
  resetWorkspaceFileIndicator,
  setHomeLibraryFiles,
  setHomeOpenFileView,
  setWorkspaceFiles,
} from '../js/logic/workspace-files';

function mountShell() {
  document.body.innerHTML = `
    <aside id="shift-sidebar">
      <section id="shift-open-files">
        <h2 id="shift-open-files-heading">My PDFs</h2>
        <nav class="shift-primary-nav" aria-label="Library"></nav>
        <div id="shift-open-files-list" hidden></div>
      </section>
    </aside>
    <div id="drop-zone">
      <input id="file-input" type="file" />
    </div>
    <div id="file-display-area"></div>
    <div id="file-list"></div>
  `;
}

function mountLibrary() {
  document.body.innerHTML = `
    <section id="shift-my-pdfs" data-view="thumbnail">
      <div id="shift-open-file-tools" hidden></div>
      <h2 id="shift-my-pdfs-heading">My PDFs</h2>
      <table class="shift-my-pdfs-table">
        <tbody id="shift-my-pdfs-body"></tbody>
      </table>
      <div id="shift-my-pdfs-thumbs" class="shift-open-file-thumbs"></div>
    </section>
  `;
}

afterEach(async () => {
  document.body.className = '';
  state.files = [];
  localStorage.removeItem(TOOL_FAVORITES_RAIL_KEY);
  resetWorkspaceFileIndicator();
  vi.mocked(renderPdfFirstPage).mockClear();
  vi.mocked(renderPdfFirstPage).mockResolvedValue(undefined);
  await clearPdfLibrary();
});

describe('primary library save target', () => {
  it('returns the stable id from a single selected library PDF', () => {
    const file = markFileLibraryId(
      new File(['bytes'], 'invoice.pdf', { type: 'application/pdf' }),
      'lib-stable-1'
    );
    setWorkspaceFiles([file]);

    expect(getPrimaryLibrarySaveTarget()).toEqual({
      id: 'lib-stable-1',
      name: 'invoice.pdf',
    });
    expect(getWorkspacePdfSelectionCount()).toBe(1);
  });

  it('returns null for multi-PDF selections and empty workspace', () => {
    expect(getPrimaryLibrarySaveTarget()).toBeNull();
    expect(getWorkspacePdfSelectionCount()).toBe(0);

    setWorkspaceFiles([
      new File(['a'], 'a.pdf', { type: 'application/pdf' }),
      new File(['b'], 'b.pdf', { type: 'application/pdf' }),
    ]);
    expect(getPrimaryLibrarySaveTarget()).toBeNull();
    expect(getWorkspacePdfSelectionCount()).toBe(2);
  });

  it('resolves a unique name+size match from the home library when no id is marked', () => {
    const libraryFile = new File(['same'], 'solo.pdf', {
      type: 'application/pdf',
    });
    setHomeLibraryFiles([
      {
        id: 'from-home',
        name: 'solo.pdf',
        size: libraryFile.size,
        blob: libraryFile,
      },
    ]);
    setWorkspaceFiles([
      new File(['same'], 'solo.pdf', { type: 'application/pdf' }),
    ]);

    expect(getPrimaryLibrarySaveTarget()).toEqual({
      id: 'from-home',
      name: 'solo.pdf',
    });
  });
});

describe('workspace files sidebar', () => {
  it('hides the sidebar file list when no PDF is open', () => {
    mountShell();
    setWorkspaceFiles([]);

    const section = document.getElementById('shift-open-files');
    const list = document.getElementById('shift-open-files-list');
    expect(section?.hidden).toBe(false);
    expect(list?.hidden).toBe(true);
    expect(document.body.classList.contains('shift-has-open-file')).toBe(false);
    expect(document.getElementById('drop-zone')?.hidden).toBe(false);
    expect(getWorkspaceFiles()).toEqual([]);
  });

  it('shows the open file in the sidebar and marks the page', () => {
    mountShell();
    setWorkspaceFiles([{ name: 'contract.pdf', size: 2048 }]);

    const section = document.getElementById('shift-open-files');
    const list = document.getElementById('shift-open-files-list');
    const heading = document.getElementById('shift-open-files-heading');
    const button = document.querySelector('.shift-open-file-item');

    expect(section?.hidden).toBe(false);
    expect(list?.hidden).toBe(false);
    expect(heading?.textContent).toBe('My PDFs');
    expect(list?.getAttribute('aria-label')).toBe('Selected file');
    expect(button?.textContent).toContain('contract.pdf');
    expect(button?.hasAttribute('title')).toBe(false);
    expect(button?.getAttribute('data-shift-tooltip')).toBe('contract.pdf');
    expect(button?.getAttribute('aria-label')).toBe('Selected: contract.pdf');
    expect(button?.getAttribute('aria-current')).toBe('true');
    expect(button?.classList.contains('is-selected')).toBe(true);
    expect(button?.getAttribute('href')).toBe(
      'view-pdf.html?name=contract.pdf'
    );
    expect(
      button?.querySelector('.shift-open-file-selected-label')?.textContent
    ).toBe('Selected');
    expect(button?.getAttribute('data-source')).toBe('upload');
    expect(button?.getAttribute('data-file-name')).toBe('contract.pdf');
    expect(
      button?.querySelector('.shift-open-file-preview.is-empty')
    ).not.toBeNull();
    expect(
      button?.querySelector('.shift-open-file-icon-upload')
    ).not.toBeNull();
    expect(document.body.classList.contains('shift-has-open-file')).toBe(true);
    expect(document.getElementById('drop-zone')?.hidden).toBe(false);
  });

  it('keeps the tool drop zone visible when the library has files but the workspace is empty', () => {
    mountShell();
    const saved = new File(['x'], 'saved.pdf', { type: 'application/pdf' });
    setHomeLibraryFiles([
      {
        name: 'saved.pdf',
        blob: saved,
      },
    ]);

    expect(document.getElementById('drop-zone')?.hidden).toBe(false);
    expect(document.body.classList.contains('shift-open-file-in-tool')).toBe(
      false
    );
  });

  it('hides the tool drop zone when the library and workspace both have files', () => {
    mountShell();
    setHomeLibraryFiles([
      {
        name: 'saved.pdf',
        blob: new File(['x'], 'saved.pdf', { type: 'application/pdf' }),
      },
    ]);
    setWorkspaceFiles([
      new File(['x'], 'saved.pdf', { type: 'application/pdf' }),
    ]);

    expect(document.getElementById('drop-zone')?.hidden).toBe(true);
    expect(document.body.classList.contains('shift-open-file-in-tool')).toBe(
      true
    );
  });

  it('restores the tool drop zone after the workspace is cleared while the library still has files', () => {
    mountShell();
    setHomeLibraryFiles([
      {
        name: 'saved.pdf',
        blob: new File(['x'], 'saved.pdf', { type: 'application/pdf' }),
      },
    ]);
    setWorkspaceFiles([
      new File(['x'], 'saved.pdf', { type: 'application/pdf' }),
    ]);
    expect(document.getElementById('drop-zone')?.hidden).toBe(true);

    setWorkspaceFiles([]);

    expect(document.getElementById('drop-zone')?.hidden).toBe(false);
    expect(document.body.classList.contains('shift-open-file-in-tool')).toBe(
      false
    );
  });

  it('hides the multi-file tool drop zone when the library and workspace both have files', () => {
    document.body.innerHTML = `
      <section id="shift-open-files" hidden>
        <h2 id="shift-open-files-heading">My PDFs</h2>
        <div id="shift-open-files-list"></div>
      </section>
      <div id="drop-zone">
        <input id="file-input" type="file" accept="application/pdf" multiple />
      </div>
    `;
    const saved = new File(['x'], 'saved.pdf', { type: 'application/pdf' });
    setHomeLibraryFiles([
      {
        name: 'saved.pdf',
        blob: saved,
      },
    ]);
    setWorkspaceFiles([saved]);

    expect(document.getElementById('drop-zone')?.hidden).toBe(true);
    expect(document.body.classList.contains('shift-open-file-in-tool')).toBe(
      true
    );
  });

  it('keeps the tool drop zone visible when the library is empty', () => {
    mountShell();
    setWorkspaceFiles([{ name: 'contract.pdf', size: 2048 }]);

    expect(document.getElementById('drop-zone')?.hidden).toBe(false);
    expect(document.body.classList.contains('shift-open-file-in-tool')).toBe(
      false
    );
  });

  it('keeps the upload picker on tools that accept multiple files', () => {
    document.body.innerHTML = `
      <section id="shift-open-files" hidden>
        <h2 id="shift-open-files-heading">My PDFs</h2>
        <div id="shift-open-files-list"></div>
      </section>
      <div id="drop-zone">
        <input id="file-input" type="file" accept="application/pdf" multiple />
      </div>
    `;
    setWorkspaceFiles([
      new File(['x'], 'one.pdf', { type: 'application/pdf' }),
      new File(['y'], 'two.pdf', { type: 'application/pdf' }),
    ]);

    expect(document.getElementById('shift-open-files')?.hidden).toBe(false);
    expect(document.body.classList.contains('shift-open-file-in-tool')).toBe(
      false
    );
    expect(document.getElementById('drop-zone')?.hidden).toBe(false);
  });

  it('keeps the upload picker on tools that accept multiple files', () => {
    document.body.innerHTML = `
      <section id="shift-open-files" hidden>
        <h2 id="shift-open-files-heading">Active file</h2>
        <div id="shift-open-files-list"></div>
      </section>
      <div id="drop-zone">
        <input id="file-input" type="file" accept="application/pdf" multiple />
      </div>
    `;
    setWorkspaceFiles([
      new File(['x'], 'one.pdf', { type: 'application/pdf' }),
      new File(['y'], 'two.pdf', { type: 'application/pdf' }),
    ]);

    expect(document.getElementById('shift-open-files')?.hidden).toBe(false);
    expect(document.body.classList.contains('shift-open-file-in-tool')).toBe(
      false
    );
    expect(document.getElementById('drop-zone')?.hidden).toBe(false);
  });

  it('keeps the upload picker when the tool does not accept the active PDF', () => {
    document.body.innerHTML = `
      <section id="shift-open-files" hidden>
        <h2 id="shift-open-files-heading">My PDFs</h2>
        <div id="shift-open-files-list"></div>
      </section>
      <div id="drop-zone">
        <input id="file-input" type="file" accept="image/jpeg,.jpg" />
      </div>
    `;
    setWorkspaceFiles([
      new File(['x'], 'briefing.pdf', { type: 'application/pdf' }),
    ]);

    expect(document.getElementById('shift-open-files')?.hidden).toBe(false);
    expect(document.body.classList.contains('shift-has-open-file')).toBe(true);
    expect(document.body.classList.contains('shift-open-file-in-tool')).toBe(
      false
    );
    expect(document.getElementById('drop-zone')?.hidden).toBe(false);
  });

  it('keeps the My PDFs heading and caps the visible list', () => {
    mountShell();
    setWorkspaceFiles([
      { name: 'one.pdf' },
      { name: 'two.pdf' },
      { name: 'three.pdf' },
      { name: 'four.pdf' },
      { name: 'five.pdf' },
    ]);

    const heading = document.getElementById('shift-open-files-heading');
    const list = document.getElementById('shift-open-files-list');
    const labels = Array.from(
      document.querySelectorAll('.shift-open-file-item .shift-nav-label')
    ).map((node) => node.textContent);

    expect(heading?.textContent).toBe('My PDFs');
    expect(list?.getAttribute('aria-label')).toBe('Selected files');
    expect(labels).toEqual(['one.pdf', 'two.pdf', 'three.pdf', '2 more']);
  });

  it('formats byte and megabyte sizes in the home table', () => {
    document.body.innerHTML = `
      <section id="shift-open-files" hidden>
        <h2 id="shift-open-files-heading">Open file</h2>
        <div id="shift-open-files-list"></div>
      </section>
      <section id="shift-my-pdfs" hidden>
        <h2 id="shift-my-pdfs-heading">Open file</h2>
        <table><tbody id="shift-my-pdfs-body"></tbody></table>
      </section>
    `;
    setWorkspaceFiles([{ name: 'tiny.pdf', size: 500 }]);
    expect(
      document.querySelector('.shift-my-pdfs-size-cell')?.textContent
    ).toBe('500 B');

    setWorkspaceFiles([{ name: 'large.pdf', size: 2 * 1024 * 1024 }]);
    expect(
      document.querySelector('.shift-my-pdfs-size-cell')?.textContent
    ).toBe('2.0 MB');
  });

  it('links the sidebar file row to the viewer without a file picker present', () => {
    document.body.innerHTML = `
      <section id="shift-open-files" hidden>
        <h2 id="shift-open-files-heading">Open file</h2>
        <div id="shift-open-files-list"></div>
      </section>
    `;
    setWorkspaceFiles([{ name: 'report.pdf' }]);

    const item = document.querySelector<HTMLAnchorElement>(
      '.shift-open-file-item'
    );
    expect(item?.tagName).toBe('A');
    expect(item?.getAttribute('href')).toBe('view-pdf.html?name=report.pdf');
  });

  it('resolves the sidebar viewer href against the My PDFs nav link', () => {
    mountShell();
    document
      .querySelector('.shift-primary-nav')
      ?.insertAdjacentHTML(
        'beforeend',
        '<a href="../my-pdfs.html" data-nav="my-pdfs" class="shift-nav-link"></a>'
      );
    setWorkspaceFiles([{ name: 'report.pdf', size: 512 }]);
    const input = document.getElementById('file-input') as HTMLInputElement;
    const click = vi.spyOn(input, 'click').mockImplementation(() => {});

    const item = document.querySelector<HTMLAnchorElement>(
      '.shift-open-file-item'
    );

    expect(item?.getAttribute('href')).toBe('../view-pdf.html?name=report.pdf');
    expect(click).not.toHaveBeenCalled();
    click.mockRestore();
  });

  it('ignores blank names and missing sidebar markup', () => {
    document.body.innerHTML = '';
    setWorkspaceFiles([{ name: '   ' }, { name: 'kept.pdf' }]);

    expect(getWorkspaceFiles()).toMatchObject([
      { name: 'kept.pdf', size: 0, source: 'upload' },
    ]);
    expect(document.body.classList.contains('shift-has-open-file')).toBe(true);
  });

  it('infers open files from the in-page file list', async () => {
    mountShell();
    initWorkspaceFileIndicator();
    const file = new File(['%PDF-1.4'], 'from-display.pdf', {
      type: 'application/pdf',
    });
    state.files = [file];

    const area = document.getElementById('file-display-area');
    const row = document.createElement('div');
    const name = document.createElement('div');
    name.className = 'truncate';
    name.textContent = 'from-display.pdf';
    row.appendChild(name);
    area?.appendChild(row);

    await vi.waitFor(() => {
      expect(getWorkspaceFiles().map((entry) => entry.name)).toEqual([
        'from-display.pdf',
      ]);
    });
    expect(getWorkspaceFiles()[0]?.blob).toBe(file);
  });

  // `.truncate` is a layout class, so the scrape also sees page labels, status
  // lines, and nodes whose textContent was assigned an undefined value. Taking
  // those as files put blob-less entries in the selection, and persistence skips
  // anything without bytes — so a phantom row silently dropped a real file from
  // the stored selection.
  it('ignores displayed rows that no real file backs', async () => {
    mountShell();
    const file = new File(['%PDF-1.4'], 'real.pdf', {
      type: 'application/pdf',
    });
    state.files = [file];
    setWorkspaceFiles([file]);
    initWorkspaceFileIndicator();

    const area = document.getElementById('file-display-area');
    for (const text of ['undefined', 'real.pdf (p1)']) {
      const label = document.createElement('div');
      label.className = 'truncate';
      label.textContent = text;
      area?.appendChild(label);
    }

    await vi.waitFor(() => {
      expect(area?.querySelectorAll('.truncate')).toHaveLength(2);
    });

    expect(getWorkspaceFiles().map((entry) => entry.name)).toEqual([
      'real.pdf',
    ]);
  });

  it('keeps explicitly set merge files when the sidebar initializes', () => {
    mountShell();
    setWorkspaceFiles([{ name: 'merged.pdf' }]);
    initWorkspaceFileIndicator();

    expect(getWorkspaceFiles().map((file) => file.name)).toEqual([
      'merged.pdf',
    ]);
    expect(document.getElementById('shift-open-files')?.hidden).toBe(false);
  });

  it('does not clear merge files when the simple file list stays empty', async () => {
    mountShell();
    setWorkspaceFiles([{ name: 'merged.pdf' }]);
    document
      .getElementById('file-list')
      ?.appendChild(document.createElement('li'));
    initWorkspaceFileIndicator();

    document
      .getElementById('file-display-area')
      ?.appendChild(document.createElement('span'));

    await Promise.resolve();
    await Promise.resolve();

    expect(getWorkspaceFiles().map((file) => file.name)).toEqual([
      'merged.pdf',
    ]);
  });

  it('clears inferred files when the in-page list is emptied', async () => {
    mountShell();
    initWorkspaceFileIndicator();
    state.files = [
      new File(['%PDF-1.4'], 'temp.pdf', { type: 'application/pdf' }),
    ];

    const area = document.getElementById('file-display-area');
    const name = document.createElement('div');
    name.className = 'truncate';
    name.textContent = 'temp.pdf';
    area?.appendChild(name);

    await vi.waitFor(() => {
      expect(getWorkspaceFiles()).toHaveLength(1);
    });

    area?.replaceChildren();

    await vi.waitFor(() => {
      expect(getWorkspaceFiles()).toEqual([]);
      expect(document.body.classList.contains('shift-has-open-file')).toBe(
        false
      );
    });
  });

  it('renders a first-page thumbnail for sidebar files with blobs', async () => {
    mountShell();
    const file = new File(['%PDF'], 'briefing.pdf', {
      type: 'application/pdf',
    });
    setWorkspaceFiles([file]);

    await vi.waitFor(() => {
      expect(vi.mocked(renderPdfFirstPage)).toHaveBeenCalled();
    });

    const preview = document.querySelector('.shift-open-file-preview');
    const canvas = preview?.querySelector('canvas');
    expect(canvas).not.toBeNull();
    expect(preview?.classList.contains('is-empty')).toBe(false);
    expect(vi.mocked(renderPdfFirstPage)).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'briefing.pdf' }),
      canvas,
      48
    );
  });

  it('keeps the generic icon when sidebar thumbnail rendering fails', async () => {
    mountShell();
    vi.mocked(renderPdfFirstPage).mockRejectedValueOnce(new Error('bad pdf'));
    setWorkspaceFiles([
      new File(['x'], 'broken.pdf', { type: 'application/pdf' }),
    ]);

    await vi.waitFor(() => {
      expect(vi.mocked(renderPdfFirstPage)).toHaveBeenCalled();
    });

    const preview = document.querySelector('.shift-open-file-preview');
    expect(preview?.classList.contains('is-empty')).toBe(true);
    expect(
      preview?.querySelector('.shift-open-file-icon-upload')
    ).not.toBeNull();
  });

  it('paints a sidebar thumbnail once and reuses it across list rebuilds', async () => {
    mountShell();
    vi.mocked(renderPdfFirstPage).mockClear();
    const active = new File(['%PDF-active'], 'Gus.pdf', {
      type: 'application/pdf',
    });
    const other = new File(['%PDF-other'], 'Other.pdf', {
      type: 'application/pdf',
    });
    const paintsOfActive = () =>
      vi
        .mocked(renderPdfFirstPage)
        .mock.calls.filter(([blob]) => blob === active).length;

    setWorkspaceFiles([active]);
    await vi.waitFor(() => {
      expect(
        document.querySelector('.shift-open-file-preview:not(.is-empty)')
      ).not.toBeNull();
    });
    const canvasBefore = document.querySelector<HTMLCanvasElement>(
      '.shift-open-file-item canvas'
    );
    expect(paintsOfActive()).toBe(1);

    // Each of these forces a genuine rebuild of the list markup.
    setWorkspaceFiles([active, other]);
    await vi.waitFor(() => {
      expect(document.querySelectorAll('.shift-open-file-item')).toHaveLength(
        2
      );
    });
    setWorkspaceFiles([other, active]);
    setWorkspaceFiles([active]);
    renderWorkspaceFiles();

    const preview = document.querySelector('.shift-open-file-preview');
    expect(document.querySelectorAll('.shift-open-file-item')).toHaveLength(1);
    expect(
      document.querySelector<HTMLCanvasElement>('.shift-open-file-item canvas')
    ).toBe(canvasBefore);
    expect(preview?.classList.contains('is-empty')).toBe(false);
    expect(paintsOfActive()).toBe(1);
  });

  it('shows a stored thumbnail on the first paint after a navigation', () => {
    const pixel =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    sessionStorage.setItem(
      'shiftSidebarThumbnails',
      JSON.stringify({ 'Gus.pdf|4': pixel })
    );
    mountShell();
    const file = new File(['%PDF'], 'Gus.pdf', { type: 'application/pdf' });

    setWorkspaceFiles([file]);

    const preview = document.querySelector<HTMLElement>(
      '.shift-open-file-preview'
    );
    expect(preview?.classList.contains('is-empty')).toBe(false);
    expect(preview?.style.backgroundImage).toBe(`url("${pixel}")`);
  });

  it('does not rebuild sidebar thumbnails when the open file list is unchanged', async () => {
    mountShell();
    const file = new File(['a'], 'stable.pdf', { type: 'application/pdf' });
    setWorkspaceFiles([file]);

    await vi.waitFor(() => {
      expect(
        document.querySelector('.shift-open-file-preview:not(.is-empty)')
      ).not.toBeNull();
    });

    const canvasBefore = document.querySelector<HTMLCanvasElement>(
      '.shift-open-file-item canvas'
    );
    vi.mocked(renderPdfFirstPage).mockClear();

    setWorkspaceFiles([file]);

    expect(vi.mocked(renderPdfFirstPage)).not.toHaveBeenCalled();
    expect(
      document.querySelector<HTMLCanvasElement>('.shift-open-file-item canvas')
    ).toBe(canvasBefore);
    expect(
      document
        .querySelector('.shift-open-file-preview')
        ?.classList.contains('is-empty')
    ).toBe(false);
  });

  it('uses a handoff icon for files received from Shift', () => {
    mountShell();
    setWorkspaceFiles([
      { name: 'from-tab.pdf', size: 1024, source: 'handoff' },
    ]);

    const button = document.querySelector('.shift-open-file-item');
    expect(button?.getAttribute('data-source')).toBe('handoff');
    expect(button?.hasAttribute('title')).toBe(false);
    expect(button?.getAttribute('data-shift-tooltip')).toBe(
      'from-tab.pdf · Received from Shift'
    );
    expect(button?.getAttribute('aria-label')).toBe(
      'Selected: from-tab.pdf. Received from Shift. Click to open in the viewer.'
    );
    expect(
      button?.querySelector('.shift-open-file-icon-handoff')
    ).not.toBeNull();
    expect(getWorkspaceFiles()[0]).toMatchObject({
      source: 'handoff',
    });
  });

  it('uses a download icon for downloaded copies in the sidebar', () => {
    mountShell();
    setWorkspaceFiles([
      { name: 'compressed.pdf', size: 2048, source: 'download' },
    ]);

    const button = document.querySelector('.shift-open-file-item');
    expect(button?.getAttribute('data-source')).toBe('download');
    expect(button?.getAttribute('data-shift-tooltip')).toBe(
      'compressed.pdf · Downloaded copy'
    );
    expect(button?.getAttribute('aria-label')).toBe(
      'Selected: compressed.pdf. Downloaded copy. Click to open in the viewer.'
    );
    expect(
      button?.querySelector('.shift-open-file-icon-download')
    ).not.toBeNull();
  });

  it('tags a Shift-handoff File as a handoff source', () => {
    mountShell();
    const file = new File([new Uint8Array([1, 2, 3])], 'from-tab.pdf', {
      type: 'application/pdf',
    });
    markFileFromHandoff(file);
    setWorkspaceFiles([file]);

    const button = document.querySelector('.shift-open-file-item');
    expect(button?.getAttribute('data-source')).toBe('handoff');
    expect(button?.getAttribute('data-shift-tooltip')).toBe(
      'from-tab.pdf · Received from Shift'
    );
    expect(getWorkspaceFiles()[0]).toMatchObject({
      name: 'from-tab.pdf',
      source: 'handoff',
    });
  });

  it('keeps the Shift origin when the file-input clones the File', () => {
    mountShell();
    const original = new File([new Uint8Array([1, 2, 3])], 'from-tab.pdf', {
      type: 'application/pdf',
    });
    markFileFromHandoff(original);
    const clone = new File([original], original.name, { type: original.type });
    copyFileOrigin(original, clone);
    setWorkspaceFiles([clone]);

    expect(getWorkspaceFiles()[0]).toMatchObject({
      name: 'from-tab.pdf',
      source: 'handoff',
    });
  });

  it('links a handoff sidebar row to the viewer', () => {
    mountShell();
    setWorkspaceFiles([{ name: 'from-tab.pdf', source: 'handoff' }]);
    const input = document.getElementById('file-input') as HTMLInputElement;
    const click = vi.spyOn(input, 'click').mockImplementation(() => {});

    const item = document.querySelector<HTMLAnchorElement>(
      '.shift-open-file-item'
    );

    expect(item?.getAttribute('href')).toBe('view-pdf.html?name=from-tab.pdf');
    expect(click).not.toHaveBeenCalled();
    click.mockRestore();
  });

  it('links sidebar files to the viewer even when a tool is open on home', () => {
    document.body.innerHTML = `
      <section id="shift-my-pdfs" hidden></section>
      <input id="file-input" type="file" accept="application/pdf" />
      <div id="tool-interface" class="hidden">
        <input id="file-input" type="file" accept="application/pdf" />
      </div>
      <section id="shift-open-files" hidden>
        <div id="shift-open-files-list"></div>
      </section>
    `;
    setWorkspaceFiles([{ name: 'from-tab.pdf', source: 'handoff' }]);
    const item = document.querySelector<HTMLAnchorElement>(
      '.shift-open-file-item'
    );

    expect(item?.getAttribute('href')).toBe('view-pdf.html?name=from-tab.pdf');
  });

  it('gives each sidebar file a directly loadable viewer URL by library id', () => {
    mountShell();
    const file = new File(['pdf'], 'briefing.pdf', {
      type: 'application/pdf',
    });
    setWorkspaceFiles([
      {
        id: 'briefing-id',
        name: file.name,
        size: file.size,
        source: 'upload',
        blob: file,
      },
    ]);

    const item = document.querySelector<HTMLAnchorElement>(
      '.shift-open-file-item'
    );
    expect(item?.getAttribute('href')).toBe('view-pdf.html?file=briefing-id');
  });

  /* The rail paints these from the session snapshot before IndexedDB resolves,
     so there is no blob to re-persist and the href has to carry the click. */
  it('lets a pending sidebar row fall through to the viewer href', () => {
    const location = Object.getOwnPropertyDescriptor(window, 'location');
    const assign = vi.fn();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { assign },
    });

    try {
      mountShell();
      setWorkspaceFiles([{ name: 'pending.pdf', size: 128 }]);

      const item = document.querySelector<HTMLAnchorElement>(
        '.shift-open-file-item'
      );
      const event = new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
      });
      item?.dispatchEvent(event);

      expect(event.defaultPrevented).toBe(false);
      expect(assign).not.toHaveBeenCalled();
      expect(item?.getAttribute('href')).toBe('view-pdf.html?name=pending.pdf');
      expect(item?.hasAttribute('title')).toBe(false);
      expect(item?.getAttribute('data-shift-tooltip')).toBe('pending.pdf');
    } finally {
      if (location) Object.defineProperty(window, 'location', location);
    }
  });

  it('tooltips a pending snapshot row with the full filename', () => {
    mountShell();
    markOpenFilePresent(true);
    writeOpenFileSnapshot([
      {
        name: 'Candidate Sourcing Pipeline_ Briefing for Mark (2) (1).pdf',
        size: 2048,
      },
    ]);
    try {
      renderWorkspaceFiles();

      const item = document.querySelector<HTMLAnchorElement>(
        '.shift-open-file-item'
      );
      expect(item?.hasAttribute(PENDING_FILE_ROW_ATTR)).toBe(true);
      expect(item?.hasAttribute('title')).toBe(false);
      expect(item?.getAttribute('href')).toBe(
        'view-pdf.html?name=Candidate+Sourcing+Pipeline_+Briefing+for+Mark+%282%29+%281%29.pdf'
      );
      expect(item?.getAttribute('data-shift-tooltip')).toBe(
        'Candidate Sourcing Pipeline_ Briefing for Mark (2) (1).pdf'
      );
      expect(item?.getAttribute('aria-label')).toBe(
        'Selected: Candidate Sourcing Pipeline_ Briefing for Mark (2) (1).pdf'
      );
    } finally {
      markOpenFilePresent(false);
    }
  });

  it('keeps the handoff source when the in-page list refreshes the same name', async () => {
    mountShell();
    setWorkspaceFiles([{ name: 'from-tab.pdf', source: 'handoff' }]);
    initWorkspaceFileIndicator();

    const area = document.getElementById('file-display-area');
    const name = document.createElement('div');
    name.className = 'truncate';
    name.textContent = 'from-tab.pdf';
    area?.appendChild(name);

    await vi.waitFor(() => {
      expect(getWorkspaceFiles()[0]).toMatchObject({
        name: 'from-tab.pdf',
        source: 'handoff',
      });
    });
  });

  it('preserves addedAt when the same file is set again', () => {
    mountShell();
    setWorkspaceFiles([{ name: 'kept.pdf', addedAt: 1_000 }]);
    setWorkspaceFiles([{ name: 'kept.pdf', size: 2048 }]);

    expect(getWorkspaceFiles()[0]).toMatchObject({
      name: 'kept.pdf',
      size: 2048,
      addedAt: 1_000,
    });
  });

  it('keeps the My PDFs list chrome and shows an empty-state placeholder when the workspace is empty', () => {
    document.body.innerHTML = `
      <div id="drop-zone">
        <input id="file-input" type="file" />
      </div>
      <section id="shift-my-pdfs" data-view="thumbnail">
        <h2 id="shift-my-pdfs-heading">Open file</h2>
        <table>
          <tbody id="shift-my-pdfs-body"></tbody>
        </table>
        <div id="shift-my-pdfs-thumbs"></div>
      </section>
    `;
    setWorkspaceFiles([]);

    expect(document.getElementById('shift-my-pdfs')?.hidden).toBe(false);
    expect(document.getElementById('drop-zone')?.hidden).toBe(false);
    expect(document.getElementById('shift-my-pdfs-heading')?.textContent).toBe(
      'My PDFs'
    );
    expect(
      document.querySelector('#shift-my-pdfs-body tr.shift-my-pdfs-empty-row')
    ).not.toBeNull();
    expect(
      document.querySelector('#shift-my-pdfs-thumbs .shift-my-pdfs-empty-card')
    ).not.toBeNull();
    expect(
      document.querySelector('#shift-my-pdfs-body tr.shift-my-pdfs-row')
    ).toBeNull();
  });

  it('renders the home Open file table from the current workspace files', () => {
    document.body.innerHTML = `
      <section id="shift-my-pdfs" hidden>
        <h2 id="shift-my-pdfs-heading">Open file</h2>
        <table>
          <tbody id="shift-my-pdfs-body"></tbody>
        </table>
      </section>
    `;
    setWorkspaceFiles([
      { name: 'upload.pdf', size: 512 },
      {
        name: 'briefing.pdf',
        size: 113 * 1024,
        source: 'handoff',
        addedAt: Date.UTC(2026, 7, 26),
      },
    ]);

    const section = document.getElementById('shift-my-pdfs');
    const heading = document.getElementById('shift-my-pdfs-heading');
    const rows = document.querySelectorAll('#shift-my-pdfs-body tr');
    const cells = rows[0]?.querySelectorAll('td');

    expect(document.body.classList.contains('shift-has-open-file')).toBe(true);
    expect(section?.hidden).toBe(false);
    expect(heading?.textContent).toBe('My PDFs');
    expect(rows).toHaveLength(2);
    expect(cells?.[1]?.textContent).toContain('upload.pdf');
    expect(cells?.[3]?.textContent).toBe('512 B');
    expect(
      rows[1]?.querySelector('.shift-my-pdfs-name-cell')?.textContent
    ).toContain('briefing.pdf');
  });

  it('shows an uploaded file in the home Open file section', () => {
    document.body.innerHTML = `
      <div id="drop-zone"></div>
      <section id="shift-my-pdfs" hidden>
        <h2 id="shift-my-pdfs-heading">Open file</h2>
        <table>
          <tbody id="shift-my-pdfs-body"></tbody>
        </table>
      </section>
    `;
    setWorkspaceFiles([{ name: 'dropped.pdf', size: 2048 }]);

    expect(document.getElementById('shift-my-pdfs')?.hidden).toBe(false);
    expect(document.getElementById('drop-zone')?.hidden).toBe(false);
    expect(
      document.querySelector('#shift-my-pdfs-body tr')?.textContent
    ).toContain('dropped.pdf');
  });

  it('lists every active file in the sidebar on the all-tools page', () => {
    document.body.className = 'shift-home';
    document.body.innerHTML = `
      <section id="shift-open-files" hidden>
        <h2 id="shift-open-files-heading">Open file</h2>
        <div id="shift-open-files-list"></div>
      </section>
      <div id="grid-view"><div id="tool-grid"></div></div>
    `;
    setWorkspaceFiles([
      { name: 'upload.pdf', size: 512 },
      { name: 'from-tab.pdf', source: 'handoff' },
    ]);

    const sidebarLabels = Array.from(
      document.querySelectorAll('.shift-open-file-item .shift-nav-label')
    ).map((node) => node.textContent);
    const selectedChips = Array.from(
      document.querySelectorAll(
        '.shift-open-file-item:not(.shift-open-files-more) .shift-open-file-selected-label'
      )
    ).map((node) => node.textContent);

    expect(document.getElementById('shift-open-files')?.hidden).toBe(false);
    expect(sidebarLabels).toEqual(['upload.pdf', 'from-tab.pdf']);
    expect(selectedChips).toEqual(['Selected', 'Selected']);
    expect(
      document.querySelectorAll('.shift-open-file-item.is-selected')
    ).toHaveLength(2);
    expect(document.getElementById('shift-my-pdfs')).toBeNull();
  });

  it('keeps the sidebar active file in sync when a library PDF is activated', async () => {
    document.body.innerHTML = `
      <input id="file-input" type="file" />
      <section id="shift-open-files" hidden>
        <h2 id="shift-open-files-heading">Open file</h2>
        <div id="shift-open-files-list"></div>
      </section>
      <section id="shift-my-pdfs" hidden data-view="thumbnail">
        <h2 id="shift-my-pdfs-heading">My PDFs</h2>
        <button id="shift-open-file-view-list" data-view="list"></button>
        <button id="shift-open-file-view-thumbnail" data-view="thumbnail"></button>
        <table><tbody id="shift-my-pdfs-body"></tbody></table>
        <div id="shift-my-pdfs-thumbs"></div>
      </section>
    `;
    const first = new File(['a'], 'first.pdf', { type: 'application/pdf' });
    const second = new File(['b'], 'second.pdf', { type: 'application/pdf' });
    setHomeLibraryFiles([first, second]);
    initWorkspaceFileIndicator();

    expect(document.getElementById('shift-open-files')?.hidden).toBe(false);
    expect(document.getElementById('shift-open-files-list')?.hidden).toBe(true);

    document
      .querySelector<HTMLButtonElement>(
        '.shift-open-file-thumb[data-file-name="second.pdf"]'
      )
      ?.click();

    await vi.waitFor(() => {
      expect(getWorkspaceFiles()).toMatchObject([{ name: 'second.pdf' }]);
    });

    expect(document.getElementById('shift-open-files')?.hidden).toBe(false);
    expect(document.getElementById('shift-open-files-list')?.hidden).toBe(
      false
    );
    expect(
      document.querySelector('.shift-open-file-item .shift-nav-label')
        ?.textContent
    ).toBe('second.pdf');
    expect(
      document.querySelector(
        '.shift-open-file-item .shift-open-file-selected-label'
      )?.textContent
    ).toBe('Selected');
    expect(
      document
        .querySelector('.shift-open-file-item')
        ?.classList.contains('is-selected')
    ).toBe(true);
  });

  it('does not open the file picker from an uploaded home-table row', () => {
    document.body.innerHTML = `
      <section id="shift-open-files" hidden>
        <h2 id="shift-open-files-heading">Open file</h2>
        <div id="shift-open-files-list"></div>
      </section>
      <section id="shift-my-pdfs" hidden>
        <h2 id="shift-my-pdfs-heading">Open file</h2>
        <table><tbody id="shift-my-pdfs-body"></tbody></table>
      </section>
      <input id="file-input" type="file" />
    `;
    setWorkspaceFiles([{ name: 'upload.pdf', size: 512 }]);
    const input = document.getElementById('file-input') as HTMLInputElement;
    const click = vi.spyOn(input, 'click').mockImplementation(() => {});

    document
      .querySelector<HTMLTableRowElement>('#shift-my-pdfs-body tr')
      ?.click();

    expect(click).not.toHaveBeenCalled();
    click.mockRestore();
  });

  it('does not make a handed-off home-table row interactive', () => {
    document.body.innerHTML = `
      <section id="shift-my-pdfs" hidden>
        <h2 id="shift-my-pdfs-heading">Open file</h2>
        <table><tbody id="shift-my-pdfs-body"></tbody></table>
      </section>
    `;
    setWorkspaceFiles([{ name: 'from-tab.pdf', source: 'handoff' }]);

    expect(
      document
        .querySelector<HTMLTableRowElement>('#shift-my-pdfs-body tr')
        ?.classList.contains('is-revealable')
    ).toBe(false);
  });

  it('identifies a handoff PDF in the library thumbnail', () => {
    document.body.innerHTML = `
      <input id="file-input" type="file" />
      <section id="shift-my-pdfs" hidden data-view="thumbnail">
        <h2 id="shift-my-pdfs-heading">Open file</h2>
        <table><tbody id="shift-my-pdfs-body"></tbody></table>
        <div id="shift-my-pdfs-thumbs"></div>
      </section>
    `;
    setWorkspaceFiles([{ name: 'from-tab.pdf', source: 'handoff' }]);
    const input = document.getElementById('file-input') as HTMLInputElement;
    const pickerClick = vi.spyOn(input, 'click').mockImplementation(() => {});
    const thumbnail = document.querySelector<HTMLButtonElement>(
      '.shift-open-file-thumb'
    );

    expect(thumbnail?.getAttribute('data-shift-tooltip')).toBe(
      'Received from Shift. Click to use this PDF.'
    );
    thumbnail?.click();
    expect(pickerClick).not.toHaveBeenCalled();
    pickerClick.mockRestore();
  });

  it('labels downloaded copies in list and thumbnail views', () => {
    mountLibrary();
    setHomeLibraryFiles([
      {
        id: 'downloaded',
        name: 'compressed.pdf',
        size: 1024,
        source: 'download',
      },
    ]);

    const row = document.querySelector('#shift-my-pdfs-body tr');
    const thumbnail = document.querySelector('.shift-open-file-thumb');

    expect(row?.getAttribute('data-source')).toBe('download');
    expect(row?.querySelector('.shift-open-file-icon-download')).toBeNull();
    expect(row?.querySelector('.shift-my-pdfs-source-badge')?.textContent).toBe(
      'Downloaded copy'
    );
    expect(thumbnail?.getAttribute('data-source')).toBe('download');
    expect(
      thumbnail?.querySelector('.shift-my-pdfs-source-badge')?.textContent
    ).toBe('Downloaded copy');
    expect(thumbnail?.getAttribute('data-shift-tooltip')).toBe(
      'Downloaded copy. Click to use this PDF.'
    );
  });

  it('uses thumbnail view by default and can switch to the list', async () => {
    document.body.innerHTML = `
      <input id="file-input" type="file" />
      <section id="shift-my-pdfs" hidden data-view="thumbnail">
        <h2 id="shift-my-pdfs-heading">Open file</h2>
        <button id="shift-open-file-view-list" data-view="list" aria-pressed="false"></button>
        <button id="shift-open-file-view-thumbnail" data-view="thumbnail" aria-pressed="true"></button>
        <table><tbody id="shift-my-pdfs-body"></tbody></table>
        <div id="shift-my-pdfs-thumbs"></div>
      </section>
    `;
    const pdf = new File(['%PDF-1.4'], 'briefing.pdf', {
      type: 'application/pdf',
    });
    setWorkspaceFiles([pdf]);
    initWorkspaceFileIndicator();

    expect(getHomeOpenFileView()).toBe('thumbnail');
    expect(document.getElementById('shift-my-pdfs')?.dataset.view).toBe(
      'thumbnail'
    );
    expect(
      document.querySelector('.shift-open-file-thumb-name')?.textContent
    ).toBe('briefing.pdf');
    expect(
      document.querySelector('.shift-open-file-thumb-replace')?.textContent
    ).toBe('Use this PDF');
    expect(
      document.querySelector('.shift-open-file-thumb')?.hasAttribute('title')
    ).toBe(false);
    expect(
      document
        .querySelector('.shift-open-file-thumb')
        ?.getAttribute('aria-label')
    ).toBe('Use briefing.pdf');

    const picker = document.getElementById('file-input') as HTMLInputElement;
    const pickerClick = vi.spyOn(picker, 'click');
    document
      .querySelector<HTMLButtonElement>('.shift-open-file-thumb')
      ?.click();
    expect(pickerClick).not.toHaveBeenCalled();
    await vi.waitFor(() => {
      expect(renderPdfFirstPage).toHaveBeenCalled();
    });

    document.getElementById('shift-open-file-view-list')?.click();

    expect(getHomeOpenFileView()).toBe('list');
    expect(document.getElementById('shift-my-pdfs')?.dataset.view).toBe('list');
    expect(
      document
        .getElementById('shift-open-file-view-list')
        ?.getAttribute('aria-pressed')
    ).toBe('true');
  });

  it('tracks list selection through the checkbox with no hover hint', async () => {
    document.body.innerHTML = `
      <input id="file-input" type="file" />
      <section id="shift-my-pdfs" hidden data-view="thumbnail">
        <h2 id="shift-my-pdfs-heading">Open file</h2>
        <button id="shift-open-file-view-list" data-view="list" aria-pressed="false"></button>
        <button id="shift-open-file-view-thumbnail" data-view="thumbnail" aria-pressed="true"></button>
        <table><tbody id="shift-my-pdfs-body"></tbody></table>
        <div id="shift-my-pdfs-thumbs"></div>
      </section>
    `;
    const first = new File(['a'], 'first.pdf', { type: 'application/pdf' });
    const second = new File(['b'], 'second.pdf', { type: 'application/pdf' });
    setHomeLibraryFiles([first, second]);
    setWorkspaceFiles([first]);
    initWorkspaceFileIndicator();

    document.getElementById('shift-open-file-view-list')?.click();

    const rows = document.querySelectorAll<HTMLTableRowElement>(
      '#shift-my-pdfs-body tr.shift-my-pdfs-row'
    );
    expect(rows).toHaveLength(2);

    const activeRow = rows[0];
    const inactiveRow = rows[1];
    expect(activeRow?.classList.contains('is-selected')).toBe(true);
    expect(inactiveRow?.classList.contains('is-selected')).toBe(false);
    expect(
      activeRow?.querySelector<HTMLInputElement>('.shift-my-pdfs-checkbox')
        ?.checked
    ).toBe(true);
    expect(
      inactiveRow?.querySelector<HTMLInputElement>('.shift-my-pdfs-checkbox')
        ?.checked
    ).toBe(false);
    // The hint belongs to the thumbnail cards only; list rows stay plain.
    expect(
      document.querySelectorAll(
        '#shift-my-pdfs-body .shift-open-file-thumb-replace'
      )
    ).toHaveLength(0);

    inactiveRow?.click();
    await vi.waitFor(() => {
      expect(inactiveRow?.classList.contains('is-selected')).toBe(true);
    });
    expect(
      inactiveRow?.querySelector<HTMLInputElement>('.shift-my-pdfs-checkbox')
        ?.checked
    ).toBe(true);
    expect(activeRow?.classList.contains('is-selected')).toBe(true);
    expect(
      document.querySelectorAll(
        '#shift-my-pdfs-body .shift-open-file-thumb-replace'
      )
    ).toHaveLength(0);
  });

  it('drops the sidebar row when the selected thumbnail is deselected, and moves it on reselect', async () => {
    document.body.innerHTML = `
      <input id="file-input" type="file" />
      <section id="shift-open-files" hidden>
        <h2 id="shift-open-files-heading">My PDFs</h2>
        <div id="shift-open-files-list"></div>
      </section>
      <section id="shift-my-pdfs" hidden data-view="thumbnail">
        <h2 id="shift-my-pdfs-heading">My PDFs</h2>
        <table><tbody id="shift-my-pdfs-body"></tbody></table>
        <div id="shift-my-pdfs-thumbs"></div>
      </section>
    `;
    const first = new File(['a'], 'first.pdf', { type: 'application/pdf' });
    const second = new File(['b'], 'second.pdf', { type: 'application/pdf' });
    setHomeLibraryFiles([first, second]);
    initWorkspaceFileIndicator();

    const thumbOf = (name: string) =>
      document.querySelector<HTMLButtonElement>(
        `.shift-open-file-thumb[data-file-name="${name}"]`
      );

    thumbOf('first.pdf')?.click();
    await vi.waitFor(() => {
      expect(getWorkspaceFiles()).toMatchObject([{ name: 'first.pdf' }]);
    });
    expect(document.getElementById('shift-open-files-list')?.hidden).toBe(
      false
    );

    thumbOf('first.pdf')?.click();
    await vi.waitFor(() => {
      expect(getWorkspaceFiles()).toEqual([]);
    });
    expect(thumbOf('first.pdf')?.classList.contains('is-selected')).toBe(false);
    expect(document.getElementById('shift-open-files-list')?.hidden).toBe(true);

    // A different card can be selected after the first is cleared.
    thumbOf('second.pdf')?.click();
    await vi.waitFor(() => {
      expect(getWorkspaceFiles()).toMatchObject([{ name: 'second.pdf' }]);
    });
    expect(thumbOf('second.pdf')?.classList.contains('is-selected')).toBe(true);
    expect(thumbOf('first.pdf')?.classList.contains('is-selected')).toBe(false);
    expect(
      document.querySelector('.shift-open-file-item .shift-nav-label')
        ?.textContent
    ).toBe('second.pdf');
  });

  it('clears persisted files on explicit Clear all', async () => {
    mountShell();
    const file = new File(['pdf'], 'briefing.pdf', { type: 'application/pdf' });
    await writePersistedOpenFile(file, { source: 'upload' });
    setWorkspaceFiles([file]);

    await clearWorkspaceOpenFile();

    expect(getWorkspaceFiles()).toEqual([]);
    expect(document.getElementById('shift-open-files')?.hidden).toBe(false);
    expect(document.getElementById('shift-open-files-list')?.hidden).toBe(true);
    expect(document.body.classList.contains('shift-has-open-file')).toBe(false);
    expect(hasOpenFileFlag()).toBe(false);
    await expect(readPersistedOpenFile()).resolves.toBeNull();
  });

  it('clears persisted files when the workspace is emptied', async () => {
    mountShell();
    const file = new File(['pdf'], 'briefing.pdf', { type: 'application/pdf' });
    setWorkspaceFiles([file]);

    setWorkspaceFiles([]);

    await vi.waitFor(async () => {
      expect(hasOpenFileFlag()).toBe(false);
      expect(await readPersistedOpenFile()).toBeNull();
    });
  });

  it('keeps thumbnail canvases mounted when activating a library file', async () => {
    document.body.innerHTML = `
      <section id="shift-my-pdfs" hidden data-view="thumbnail">
        <h2 id="shift-my-pdfs-heading">Open file</h2>
        <button id="shift-open-file-view-list" data-view="list"></button>
        <button id="shift-open-file-view-thumbnail" data-view="thumbnail"></button>
        <table><tbody id="shift-my-pdfs-body"></tbody></table>
        <div id="shift-my-pdfs-thumbs"></div>
      </section>
    `;
    const first = new File(['a'], 'first.pdf', { type: 'application/pdf' });
    const second = new File(['b'], 'second.pdf', { type: 'application/pdf' });
    setHomeLibraryFiles([first, second]);
    initWorkspaceFileIndicator();

    await vi.waitFor(() => {
      expect(
        document.querySelectorAll('.shift-open-file-thumb canvas')
      ).toHaveLength(2);
      expect(
        document.querySelectorAll('.shift-open-file-thumb-preview.is-empty')
      ).toHaveLength(0);
    });
    vi.mocked(renderPdfFirstPage).mockClear();

    const canvasesBefore = Array.from(
      document.querySelectorAll<HTMLCanvasElement>(
        '.shift-open-file-thumb canvas'
      )
    );
    const renderCallsBefore = vi.mocked(renderPdfFirstPage).mock.calls.length;

    document
      .querySelector<HTMLButtonElement>(
        '.shift-open-file-thumb[data-file-name="second.pdf"]'
      )
      ?.click();

    await vi.waitFor(() => {
      expect(
        document
          .querySelector('.shift-open-file-thumb[data-file-name="second.pdf"]')
          ?.getAttribute('aria-pressed')
      ).toBe('true');
    });

    const canvasesAfter = Array.from(
      document.querySelectorAll<HTMLCanvasElement>(
        '.shift-open-file-thumb canvas'
      )
    );
    expect(vi.mocked(renderPdfFirstPage).mock.calls.length).toBe(
      renderCallsBefore
    );
    expect(canvasesAfter).toHaveLength(2);
    expect(canvasesAfter[0]).toBe(canvasesBefore[0]);
    expect(canvasesAfter[1]).toBe(canvasesBefore[1]);
    expect(
      document.querySelector('.shift-open-file-thumb-selected')
    ).toBeNull();
    expect(
      document
        .querySelector('.shift-open-file-thumb[data-file-name="second.pdf"]')
        ?.classList.contains('is-selected')
    ).toBe(true);
  });

  it('selects and deselects the same My PDFs thumbnail', () => {
    document.body.innerHTML = `
      <section id="shift-my-pdfs" hidden data-view="thumbnail">
        <h2 id="shift-my-pdfs-heading">My PDFs</h2>
        <table><tbody id="shift-my-pdfs-body"></tbody></table>
        <div id="shift-my-pdfs-thumbs"></div>
      </section>
    `;
    const pdf = new File(['a'], 'toggle.pdf', { type: 'application/pdf' });
    setHomeLibraryFiles([pdf]);

    const card = document.querySelector<HTMLButtonElement>(
      '.shift-open-file-thumb[data-file-name="toggle.pdf"]'
    );
    card?.click();
    expect(getWorkspaceFiles()).toMatchObject([{ name: 'toggle.pdf' }]);
    expect(card?.getAttribute('aria-pressed')).toBe('true');

    card?.click();
    expect(getWorkspaceFiles()).toEqual([]);
    expect(card?.getAttribute('aria-pressed')).toBe('false');
  });

  it('keeps multiple My PDFs selected and toggles each independently', () => {
    document.body.innerHTML = `
      <section id="shift-open-files">
        <div id="shift-open-files-list"></div>
      </section>
      <section id="shift-my-pdfs" hidden data-view="thumbnail">
        <div id="shift-open-file-tools" hidden></div>
        <h2 id="shift-my-pdfs-heading">My PDFs</h2>
        <table><tbody id="shift-my-pdfs-body"></tbody></table>
        <div id="shift-my-pdfs-thumbs"></div>
      </section>
    `;
    const first = new File(['a'], 'first.pdf', {
      type: 'application/pdf',
    });
    const second = new File(['b'], 'second.pdf', {
      type: 'application/pdf',
    });
    setHomeLibraryFiles([first, second]);

    const firstCard = document.querySelector<HTMLButtonElement>(
      '.shift-open-file-thumb[data-file-name="first.pdf"]'
    );
    const secondCard = document.querySelector<HTMLButtonElement>(
      '.shift-open-file-thumb[data-file-name="second.pdf"]'
    );
    firstCard?.click();
    secondCard?.click();

    expect(getWorkspaceFiles().map((file) => file.name)).toEqual([
      'first.pdf',
      'second.pdf',
    ]);
    expect(firstCard?.getAttribute('aria-pressed')).toBe('true');
    expect(secondCard?.getAttribute('aria-pressed')).toBe('true');
    expect(
      document.querySelectorAll('#shift-open-files-list .shift-open-file-item')
    ).toHaveLength(2);
    expect(document.getElementById('shift-open-file-tools')?.hidden).toBe(
      false
    );

    firstCard?.click();
    expect(getWorkspaceFiles().map((file) => file.name)).toEqual([
      'second.pdf',
    ]);
    expect(firstCard?.getAttribute('aria-pressed')).toBe('false');
    expect(secondCard?.getAttribute('aria-pressed')).toBe('true');

    secondCard?.click();
    expect(getWorkspaceFiles()).toEqual([]);
    expect(document.getElementById('shift-open-file-tools')?.hidden).toBe(
      false
    );
    expect(
      document
        .getElementById('shift-open-file-tools')
        ?.getAttribute('aria-disabled')
    ).toBe('true');
  });

  it('selects and deselects the same My PDFs table row', () => {
    document.body.innerHTML = `
      <section id="shift-my-pdfs" hidden data-view="list">
        <h2 id="shift-my-pdfs-heading">My PDFs</h2>
        <table><tbody id="shift-my-pdfs-body"></tbody></table>
        <div id="shift-my-pdfs-thumbs"></div>
      </section>
    `;
    const pdf = new File(['a'], 'toggle.pdf', { type: 'application/pdf' });
    setHomeLibraryFiles([pdf]);

    const row = document.querySelector<HTMLTableRowElement>(
      '.shift-my-pdfs-row[data-file-name="toggle.pdf"]'
    );
    row?.click();
    expect(getWorkspaceFiles()).toMatchObject([{ name: 'toggle.pdf' }]);
    expect(row?.getAttribute('aria-pressed')).toBe('true');

    row?.click();
    expect(getWorkspaceFiles()).toEqual([]);
    expect(row?.getAttribute('aria-pressed')).toBe('false');
  });

  it('hides My PDFs header tool actions when no file is selected', () => {
    document.body.innerHTML = `
      <section id="shift-my-pdfs" hidden data-view="thumbnail">
        <div class="shift-open-file-header">
          <h2 id="shift-my-pdfs-heading">My PDFs</h2>
          <div class="shift-open-file-header-controls">
            <div
              id="shift-open-file-tools"
              class="shift-open-file-tools"
              role="group"
              aria-label="Open with"
              hidden
            >
              <span>Open with</span>
              <div class="shift-open-file-tools-toggle">
                <a href="compress-pdf.html" class="shift-open-file-tool-btn">Compress</a>
                <a href="merge-pdf.html" class="shift-open-file-tool-btn">Merge</a>
                <a href="pdf-converter.html" class="shift-open-file-tool-btn">Convert</a>
                <a href="sign-pdf.html" class="shift-open-file-tool-btn">E-sign</a>
              </div>
            </div>
            <div class="shift-open-file-view-by" role="group" aria-label="View by">
              <span>View by</span>
            </div>
          </div>
        </div>
        <table><tbody id="shift-my-pdfs-body"></tbody></table>
        <div id="shift-my-pdfs-thumbs"></div>
      </section>
    `;
    setHomeLibraryFiles([
      new File(['a'], 'library.pdf', { type: 'application/pdf' }),
    ]);

    const tools = document.getElementById('shift-open-file-tools');
    expect(tools?.hidden).toBe(false);
    expect(tools?.getAttribute('aria-disabled')).toBe('true');
    expect(tools?.classList.contains('is-disabled')).toBe(true);
    expect(tools?.classList.contains('shift-open-file-tools')).toBe(true);
    expect(tools?.classList.contains('shift-enter')).toBe(false);
  });

  it('animates My PDFs header tool actions in when a file is selected', () => {
    document.body.innerHTML = `
      <section id="shift-open-files" hidden>
        <div id="shift-open-files-list"></div>
      </section>
      <section id="shift-my-pdfs" hidden data-view="thumbnail">
        <div class="shift-open-file-header">
          <h2 id="shift-my-pdfs-heading">My PDFs</h2>
          <div class="shift-open-file-header-controls">
            <div
              id="shift-open-file-tools"
              class="shift-open-file-tools"
              role="group"
              aria-label="Open with"
              hidden
            >
              <span>Open with</span>
              <div class="shift-open-file-tools-toggle">
                <a
                  href="compress-pdf.html"
                  class="shift-open-file-tool-btn"
                  data-tool="compress"
                  >Compress</a
                >
                <a
                  href="merge-pdf.html"
                  class="shift-open-file-tool-btn"
                  data-tool="merge"
                  >Merge</a
                >
                <a
                  href="pdf-converter.html"
                  class="shift-open-file-tool-btn"
                  data-tool="convert"
                  >Convert</a
                >
                <a
                  href="sign-pdf.html"
                  class="shift-open-file-tool-btn"
                  data-tool="esign"
                  >E-sign</a
                >
              </div>
            </div>
            <div class="shift-open-file-view-by" role="group" aria-label="View by">
              <span>View by</span>
            </div>
          </div>
        </div>
        <table><tbody id="shift-my-pdfs-body"></tbody></table>
        <div id="shift-my-pdfs-thumbs"></div>
      </section>
    `;
    const pdf = new File(['a'], 'selected.pdf', { type: 'application/pdf' });
    setHomeLibraryFiles([pdf]);
    setWorkspaceFiles([pdf]);

    const tools = document.getElementById('shift-open-file-tools');
    expect(tools?.hidden).toBe(false);
    expect(tools?.getAttribute('aria-label')).toBe('Open with');
    expect(tools?.classList.contains('shift-open-file-tools')).toBe(true);

    const links = Array.from(
      tools?.querySelectorAll<HTMLAnchorElement>(
        'a.shift-open-file-tool-btn'
      ) ?? []
    );
    expect(links.map((link) => link.textContent?.trim())).toEqual([
      'Compress',
      'Merge',
      'Convert',
      'E-sign',
    ]);
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      'compress-pdf.html',
      'merge-pdf.html',
      'pdf-converter.html',
      'sign-pdf.html',
    ]);
    expect(
      tools?.querySelector('.shift-open-file-tools-toggle')
    ).not.toBeNull();
    expect(tools?.classList.contains('shift-enter')).toBe(true);

    setWorkspaceFiles([]);
    expect(document.getElementById('shift-open-file-tools')?.hidden).toBe(
      false
    );
    expect(
      document
        .getElementById('shift-open-file-tools')
        ?.getAttribute('aria-disabled')
    ).toBe('true');
    expect(tools?.classList.contains('shift-enter')).toBe(false);
  });

  it('rebuilds the Open with row from saved favorites', () => {
    localStorage.setItem(
      TOOL_FAVORITES_RAIL_KEY,
      JSON.stringify([
        { name: 'Split PDF', href: 'split-pdf.html', icon: 'ph-scissors' },
        { name: 'Crop PDF', href: 'crop-pdf.html', icon: 'ph-crop' },
      ])
    );
    document.body.innerHTML = `
      <section id="shift-my-pdfs" data-view="thumbnail">
        <div id="shift-open-file-tools" class="shift-open-file-tools" hidden>
          <div class="shift-open-file-tools-toggle">
            <a href="compress-pdf.html" class="shift-open-file-tool-btn">Compress</a>
            <a href="merge-pdf.html" class="shift-open-file-tool-btn">Merge</a>
            <a href="pdf-converter.html" class="shift-open-file-tool-btn">Convert</a>
            <a href="sign-pdf.html" class="shift-open-file-tool-btn">E-sign</a>
          </div>
        </div>
        <h2 id="shift-my-pdfs-heading">My PDFs</h2>
        <table><tbody id="shift-my-pdfs-body"></tbody></table>
        <div id="shift-my-pdfs-thumbs"></div>
      </section>
    `;

    setHomeLibraryFiles([]);

    const links = Array.from(
      document.querySelectorAll<HTMLAnchorElement>('a.shift-open-file-tool-btn')
    );
    expect(links.map((link) => link.textContent)).toEqual([
      'Split PDF',
      'Crop PDF',
    ]);
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      'split-pdf.html',
      'crop-pdf.html',
    ]);
    expect(links.map((link) => link.dataset.tool)).toEqual([
      'split-pdf',
      'crop-pdf',
    ]);
    // Delete is appended to the same row, so favorites must stay ahead of it.
    const toggle = document.querySelector('.shift-open-file-tools-toggle');
    expect(toggle?.lastElementChild?.id).toBe('shift-my-pdfs-delete-selected');
  });

  it('keeps the markup fallback when no favorites are cached', () => {
    localStorage.removeItem(TOOL_FAVORITES_RAIL_KEY);
    document.body.innerHTML = `
      <section id="shift-my-pdfs" data-view="thumbnail">
        <div id="shift-open-file-tools" class="shift-open-file-tools" hidden>
          <div class="shift-open-file-tools-toggle">
            <a href="compress-pdf.html" class="shift-open-file-tool-btn">Compress</a>
            <a href="merge-pdf.html" class="shift-open-file-tool-btn">Merge</a>
          </div>
        </div>
        <h2 id="shift-my-pdfs-heading">My PDFs</h2>
        <table><tbody id="shift-my-pdfs-body"></tbody></table>
        <div id="shift-my-pdfs-thumbs"></div>
      </section>
    `;

    setHomeLibraryFiles([]);

    expect(
      Array.from(
        document.querySelectorAll<HTMLAnchorElement>(
          'a.shift-open-file-tool-btn'
        )
      ).map((link) => link.textContent)
    ).toEqual(['Compress', 'Merge']);
  });

  it('shows at most three favorites beside Delete', () => {
    localStorage.setItem(
      TOOL_FAVORITES_RAIL_KEY,
      JSON.stringify(
        ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => ({
          name: id.toUpperCase(),
          href: `${id}.html`,
          icon: '',
        }))
      )
    );
    document.body.innerHTML = `
      <section id="shift-my-pdfs" data-view="thumbnail">
        <div id="shift-open-file-tools" class="shift-open-file-tools" hidden>
          <div class="shift-open-file-tools-toggle"></div>
        </div>
        <h2 id="shift-my-pdfs-heading">My PDFs</h2>
        <table><tbody id="shift-my-pdfs-body"></tbody></table>
        <div id="shift-my-pdfs-thumbs"></div>
      </section>
    `;

    setHomeLibraryFiles([]);

    const pinned = Array.from(
      document.querySelectorAll<HTMLAnchorElement>('a.shift-open-file-tool-btn')
    ).map((link) => link.textContent);
    expect(pinned).toEqual(['A', 'B', 'C']);
  });

  /**
   * The three-favorite cap above is only tolerable if the rest stay reachable
   * from the row, so the overflow menu is the other half of that rule: it has
   * to sit between the last tool and Delete, and it has to actually list the
   * pins the row dropped rather than just linking to the catalog.
   */
  it('offers the dropped favorites from a More tools button before Delete', () => {
    localStorage.setItem(
      TOOL_FAVORITES_RAIL_KEY,
      JSON.stringify(
        ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => ({
          name: id.toUpperCase(),
          href: `${id}.html`,
          icon: '',
        }))
      )
    );
    document.body.innerHTML = `
      <section id="shift-my-pdfs" data-view="thumbnail">
        <div id="shift-open-file-tools" class="shift-open-file-tools" hidden>
          <div class="shift-open-file-tools-toggle"></div>
        </div>
        <h2 id="shift-my-pdfs-heading">My PDFs</h2>
        <table><tbody id="shift-my-pdfs-body"></tbody></table>
        <div id="shift-my-pdfs-thumbs"></div>
      </section>
    `;

    const pdf = new File(['a'], 'selected.pdf', { type: 'application/pdf' });
    setHomeLibraryFiles([pdf]);
    setWorkspaceFiles([pdf]);

    const button = document.getElementById(
      'shift-my-pdfs-more-tools'
    ) as HTMLButtonElement | null;
    const menu = document.getElementById('shift-my-pdfs-more-tools-menu');
    const wrap = button?.closest('.shift-my-pdfs-more-tools-wrap');
    const deleteSelected = document.getElementById(
      'shift-my-pdfs-delete-selected'
    );

    expect(button).not.toBeNull();
    expect(button?.disabled).toBe(false);
    // Secondary like Delete, not one of the blue tool shortcuts: it opens a
    // menu rather than acting on the selected file.
    expect(button?.classList.contains('shift-button')).toBe(true);
    expect(button?.classList.contains('shift-open-file-tool-btn')).toBe(false);
    expect(
      button?.querySelector('.shift-my-pdfs-more-tools-caret')
    ).not.toBeNull();
    expect(button?.textContent?.trim()).toBe('More');
    expect(button?.getAttribute('aria-label')).toBe('More tools');
    expect(button?.hasAttribute('title')).toBe(false);
    expect(wrap?.nextElementSibling).toBe(deleteSelected);

    // Closed until asked for, and it says so.
    expect(menu?.hidden).toBe(true);
    expect(button?.getAttribute('aria-expanded')).toBe('false');

    const list = menu?.querySelector('.shift-my-pdfs-more-tools-list');
    const items = Array.from(
      list?.querySelectorAll<HTMLAnchorElement>(
        '.shift-my-pdfs-more-tools-item'
      ) ?? []
    ).map((item) => item.textContent);
    // D, E and F are the three the row had no room for; A–C are already listed.
    expect(items.slice(0, 3)).toEqual(['D', 'E', 'F']);
    expect(items).not.toContain('A');

    // Favorites then the popular tools, and nothing beyond them: this is a
    // shortlist, so a tool from another category appearing here would mean
    // the whole catalog had leaked back in.
    const pageOf = (href: string): string =>
      href
        .split('/')
        .pop()
        ?.replace(/\.html$/, '') ?? href;
    const rendered = new Set(
      Array.from(
        list?.querySelectorAll<HTMLAnchorElement>('[data-tool]') ?? []
      ).map((item) => item.dataset.tool)
    );
    const popular = categories.find(
      (category) => category.name === 'Popular Tools'
    );
    expect(popular).toBeDefined();
    for (const tool of popular?.tools ?? []) {
      expect(rendered).toContain(pageOf(tool.href));
    }

    const popularPages = new Set(
      (popular?.tools ?? []).map((tool) => pageOf(tool.href))
    );
    const elsewhere = categories
      .filter((category) => category.name !== 'Popular Tools')
      .flatMap((category) => category.tools.map((tool) => pageOf(tool.href)))
      .filter((page) => !popularPages.has(page));
    for (const page of elsewhere) expect(rendered).not.toContain(page);

    // Browse all tools is pinned outside the scroll area, not the last row
    // of it, so it stays visible however far down the list you are.
    const browse = menu?.querySelector('.shift-my-pdfs-more-tools-browse');
    expect(browse?.textContent).toBe('Browse all tools');
    expect(browse?.parentElement).toBe(menu);
    expect(list?.contains(browse ?? null)).toBe(false);

    button?.click();
    expect(menu?.hidden).toBe(false);
    expect(button?.getAttribute('aria-expanded')).toBe('true');

    button?.click();
    expect(menu?.hidden).toBe(true);
  });

  it('closes and disables More tools once no file is selected', () => {
    document.body.innerHTML = `
      <section id="shift-my-pdfs" data-view="thumbnail">
        <div id="shift-open-file-tools" class="shift-open-file-tools" hidden>
          <div class="shift-open-file-tools-toggle"></div>
        </div>
        <h2 id="shift-my-pdfs-heading">My PDFs</h2>
        <table><tbody id="shift-my-pdfs-body"></tbody></table>
        <div id="shift-my-pdfs-thumbs"></div>
      </section>
    `;

    const pdf = new File(['a'], 'selected.pdf', { type: 'application/pdf' });
    setHomeLibraryFiles([pdf]);
    setWorkspaceFiles([pdf]);

    const button = document.getElementById(
      'shift-my-pdfs-more-tools'
    ) as HTMLButtonElement | null;
    const menu = document.getElementById('shift-my-pdfs-more-tools-menu');
    button?.click();
    expect(menu?.hidden).toBe(false);

    // Its items open the selected PDF, so an empty selection leaves nothing
    // for the menu to act on — and an open menu would outlive its subject.
    setWorkspaceFiles([]);

    expect(button?.disabled).toBe(true);
    expect(menu?.hidden).toBe(true);
    expect(button?.getAttribute('aria-expanded')).toBe('false');
  });

  /**
   * A narrow window used to wrap the controls under the selection count.
   * The pins collapse into the overflow menu instead, so the row keeps one
   * line — and a collapsed pin has to turn up in that menu, or narrowing the
   * window would simply lose the shortcut.
   */
  describe('pinned favorite overflow', () => {
    const realResizeObserver = global.ResizeObserver;
    let resizeCallbacks: ResizeObserverCallback[] = [];

    /** The row is watched, not polled, so a test resize has to come from it. */
    function recordResizeObservers(): void {
      resizeCallbacks = [];
      global.ResizeObserver = class {
        constructor(callback: ResizeObserverCallback) {
          resizeCallbacks.push(callback);
        }
        observe(): void {}
        unobserve(): void {}
        disconnect(): void {}
      } as unknown as typeof ResizeObserver;
    }

    function resize(): void {
      for (const callback of resizeCallbacks) {
        callback([], {} as ResizeObserver);
      }
    }

    /**
     * jsdom has no layout: the row reports the width under test, and a
     * content width that grows by one pin-worth for every pin still shown.
     */
    function stubRowLayout(available: number): void {
      const row = document.querySelector(
        '.shift-my-pdfs-controls-row'
      ) as HTMLElement;
      Object.defineProperty(row, 'clientWidth', {
        configurable: true,
        get: () => available,
      });
      Object.defineProperty(row, 'scrollWidth', {
        configurable: true,
        get: () =>
          200 +
          document.querySelectorAll('a.shift-open-file-tool-btn:not([hidden])')
            .length *
            100,
      });
    }

    function mountFavorites(): void {
      localStorage.setItem(
        TOOL_FAVORITES_RAIL_KEY,
        JSON.stringify(
          ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => ({
            name: id.toUpperCase(),
            href: `${id}.html`,
            icon: '',
          }))
        )
      );
      document.body.innerHTML = `
        <section id="shift-my-pdfs" data-view="thumbnail">
          <div id="shift-open-file-tools" class="shift-open-file-tools" hidden>
            <div class="shift-open-file-tools-toggle"></div>
          </div>
          <h2 id="shift-my-pdfs-heading">My PDFs</h2>
          <table><tbody id="shift-my-pdfs-body"></tbody></table>
          <div id="shift-my-pdfs-thumbs"></div>
        </section>
      `;

      const pdf = new File(['a'], 'selected.pdf', { type: 'application/pdf' });
      setHomeLibraryFiles([pdf]);
      setWorkspaceFiles([pdf]);
    }

    function visiblePins(): (string | null)[] {
      return Array.from(
        document.querySelectorAll<HTMLAnchorElement>(
          'a.shift-open-file-tool-btn'
        )
      )
        .filter((link) => !link.hidden)
        .map((link) => link.textContent);
    }

    function menuItems(): (string | null)[] {
      return Array.from(
        document.querySelectorAll<HTMLAnchorElement>(
          '.shift-my-pdfs-more-tools-list .shift-my-pdfs-more-tools-item'
        )
      ).map((item) => item.textContent);
    }

    afterEach(() => {
      global.ResizeObserver = realResizeObserver;
    });

    it('drops pins from the end until the controls fit one line', () => {
      recordResizeObservers();
      mountFavorites();

      // Room for two pins beside Delete, More tools and View by.
      stubRowLayout(420);
      resize();

      expect(visiblePins()).toEqual(['A', 'B']);
      // C is collapsed, not gone: it leads the menu, ahead of the pins the
      // three-favorite cap had already dropped.
      expect(menuItems().slice(0, 4)).toEqual(['C', 'D', 'E', 'F']);
    });

    it('collapses every pin when only the secondary controls fit', () => {
      recordResizeObservers();
      mountFavorites();

      stubRowLayout(260);
      resize();

      expect(visiblePins()).toEqual([]);
      // Delete and More tools survive: the menu is the only way to a tool now.
      expect(menuItems().slice(0, 3)).toEqual(['A', 'B', 'C']);
      expect(
        (
          document.getElementById(
            'shift-my-pdfs-more-tools'
          ) as HTMLButtonElement | null
        )?.disabled
      ).toBe(false);
    });

    it('restores collapsed pins when the row widens again', () => {
      recordResizeObservers();
      mountFavorites();

      stubRowLayout(260);
      resize();
      expect(visiblePins()).toEqual([]);

      stubRowLayout(900);
      resize();

      expect(visiblePins()).toEqual(['A', 'B', 'C']);
      // Back in the row means back out of the menu — no tool listed twice.
      expect(menuItems().slice(0, 3)).toEqual(['D', 'E', 'F']);
    });

    /**
     * The row cannot wrap, so it does not overflow either — the selection
     * count shrinks instead. Cutting that count short is the only sign the
     * pins have overrun the row, so it is what collapsing keys off, and a
     * count with room to spare must leave every pin alone.
     */
    describe('selection count as the fit signal', () => {
      /** Room the count has left once the pins have taken theirs. */
      function stubCountLayout(roomForCount: number): void {
        const row = document.querySelector(
          '.shift-my-pdfs-controls-row'
        ) as HTMLElement;
        // Wide enough that the row itself never overflows.
        Object.defineProperty(row, 'clientWidth', {
          configurable: true,
          get: () => 900,
        });
        Object.defineProperty(row, 'scrollWidth', {
          configurable: true,
          get: () => 900,
        });

        const count = document.getElementById(
          'shift-my-pdfs-selection-count'
        ) as HTMLElement;
        // "1 of 8 selected" needs 120px to render in full.
        Object.defineProperty(count, 'scrollWidth', {
          configurable: true,
          get: () => 120,
        });
        Object.defineProperty(count, 'clientWidth', {
          configurable: true,
          get: () =>
            roomForCount -
            document.querySelectorAll(
              'a.shift-open-file-tool-btn:not([hidden])'
            ).length *
              40,
        });
      }

      it('keeps every pin while the count still renders in full', () => {
        recordResizeObservers();
        mountFavorites();

        // 240 - 3 pins x 40 = 120: exactly the count's natural width.
        stubCountLayout(240);
        resize();

        expect(visiblePins()).toEqual(['A', 'B', 'C']);
      });

      it('collapses only as many pins as the count needs back', () => {
        recordResizeObservers();
        mountFavorites();

        // 200 leaves the count 80px with three pins and 120px with two, so
        // exactly one pin has to go — collapsing a second would be greedy.
        stubCountLayout(200);
        resize();

        expect(visiblePins()).toEqual(['A', 'B']);
        expect(menuItems().slice(0, 1)).toEqual(['C']);
      });
    });

    /**
     * An unmeasured row reports zero for everything, which reads as "nothing
     * fits". Collapsing on that would empty the row on a wide screen before
     * the first paint, so it has to be treated as "no measurement yet".
     */
    it('keeps every pin while the row has no layout', () => {
      recordResizeObservers();
      mountFavorites();

      const row = document.querySelector(
        '.shift-my-pdfs-controls-row'
      ) as HTMLElement;
      Object.defineProperty(row, 'clientWidth', {
        configurable: true,
        get: () => 0,
      });
      Object.defineProperty(row, 'scrollWidth', {
        configurable: true,
        get: () => 5000,
      });
      resize();

      expect(visiblePins()).toEqual(['A', 'B', 'C']);
    });

    it('takes collapsed pins out of the row layout', () => {
      const css = readFileSync('src/css/shift-theme.css', 'utf8');
      const match = /\.shift-open-file-tool-btn\[hidden\] \{([^}]*)\}/.exec(
        css
      );

      // `display: inline-flex` on the pins is unlayered, so it outranks
      // Preflight's `[hidden]`: without this rule collapsing changes nothing.
      expect(match?.[1]).toMatch(/display:\s*none/);
    });

    /**
     * Collapsing replaces wrapping: the tools stay beside the count rather
     * than dropping under it, and the count is the half that gives.
     */
    it('holds the controls row on one line', () => {
      const css = readFileSync('src/css/shift-theme.css', 'utf8');
      const rule = (selector: string): string => {
        const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const match = new RegExp(`(?<=\\n)(?<!,\\n)${escaped} \\{`).exec(css);
        if (!match) throw new Error(`No rule found for ${selector}`);
        return css.slice(match.index, css.indexOf('\n}', match.index));
      };

      expect(rule('.shift-my-pdfs-controls-row')).toMatch(
        /flex-wrap:\s*nowrap/
      );
      // The tools hold their width; the count shrinks and ellipses instead.
      expect(rule('.shift-my-pdfs-controls-cluster')).toMatch(/flex:\s*none/);
      const selection = rule('.shift-my-pdfs-selection');
      expect(selection).toMatch(/flex:\s*1 1 auto/);
      expect(selection).toMatch(/min-width:\s*0/);
      const count = rule('.shift-my-pdfs-selection-count');
      expect(count).toMatch(/min-width:\s*0/);
      expect(count).toMatch(/text-overflow:\s*ellipsis/);
    });
  });

  describe('list row selection styling', () => {
    const css = readFileSync('src/css/shift-theme.css', 'utf8');
    const body = (pattern: RegExp): string => {
      const match = pattern.exec(css);
      if (!match) throw new Error(`No rule found for ${pattern.source}`);
      return match[1];
    };

    it('draws the row checkbox at the design size', () => {
      const checkbox = body(/\n\.shift-my-pdfs-checkbox \{([^}]*)\}/);

      expect(checkbox).toMatch(/appearance:\s*none/);
      expect(checkbox).toMatch(/width:\s*16px/);
      expect(checkbox).toMatch(/height:\s*16px/);
      expect(checkbox).toMatch(/border-radius:\s*var\(--radius-4\)/);
      // `appearance: none` drops the native tick, so both marks are ours.
      // The lookbehind skips the shared colour rule that lists both states.
      expect(
        body(/(?<=\n)(?<!,\n)\.shift-my-pdfs-checkbox:checked \{([^}]*)\}/)
      ).toMatch(/data:image\/svg\+xml/);
      expect(
        body(
          /(?<=\n)(?<!,\n)\.shift-my-pdfs-checkbox:indeterminate \{([^}]*)\}/
        )
      ).toMatch(/data:image\/svg\+xml/);
    });

    /**
     * `p-4 md:p-8` used to double the gutter at 768px, which made the content
     * narrower as the window got wider. The override has to stay unlayered to
     * outrank those utilities, and must not reintroduce a breakpoint.
     */
    it('keeps one panel gutter at every width', () => {
      const gutter = body(
        /body:not\(\.simple-mode\):has\(#shift-sidebar\) #app\.container \{([^}]*padding[^}]*)\}/
      );
      expect(gutter).toMatch(/padding:\s*var\(--shift-panel-gutter\)/);
      expect(body(/\n:root \{([\s\S]*?)\n\}/)).toMatch(
        /--shift-panel-gutter:\s*\d+px/
      );

      // The footer is a `.container` as well, so it steps on its own unless it
      // shares the panel's cap and gutter.
      const footer = body(
        /body:not\(\.simple-mode\):has\(#shift-sidebar\) > \.shift-footer > \.container \{([^}]*)\}/
      );
      expect(footer).toMatch(/padding-inline:\s*var\(--shift-panel-gutter\)/);
      expect(footer).toMatch(/max-width:\s*var\(--shift-panel-max\)/);
      expect(
        body(
          /body:not\(\.simple-mode\):has\(#shift-sidebar\) #app\.container \{([^}]*max-width[^}]*)\}/
        )
      ).toMatch(/max-width:\s*var\(--shift-panel-max\)/);

      // Nothing may wrap the panel gutter in a media query again.
      const gutterRules = css.match(/[^}]*--shift-panel-gutter[^}]*\}/g) ?? [];
      for (const rule of gutterRules) {
        expect(rule).not.toMatch(/@media/);
      }
    });

    it('fills the sticky header with the page surface', () => {
      const header = body(/\.shift-my-pdfs-table thead \{([^}]*)\}/);

      // Opaque, so rows do not show through while scrolling, but the same
      // colour as the page behind it rather than a raised bar.
      expect(header).toMatch(/background:\s*var\(--background-secondary\)/);
      expect(header).not.toMatch(/--background-bar-primary/);
    });

    /**
     * Grid cards are buttons, so without an override they take the global
     * outer double-ring focus style while list rows use an inner ring. The two
     * views have to agree on both the focus ring and the selection ring.
     */
    it('rings selection and focus the same way in both views', () => {
      const ring =
        /outline:\s*2px solid\s*var\(--action-button-surface-primary-default\)/;

      const cardFocus = body(
        /\nbutton\.shift-open-file-thumb:focus-visible \{([^}]*)\}/
      );
      expect(cardFocus).toMatch(ring);
      // The type selector is what matches the global button rule's weight.
      expect(cardFocus).toMatch(/box-shadow:\s*none/);

      const rowFocus = body(/\n\.shift-my-pdfs-row:focus-visible \{([^}]*)\}/);
      expect(rowFocus).toMatch(ring);

      // Selected: same ring, same raised fill, no soft outer glow.
      const cardSelected = body(
        /\n\.shift-open-file-thumb\.is-selected \{([^}]*)\}/
      );
      expect(cardSelected).toMatch(ring);
      expect(cardSelected).toMatch(
        /background:\s*var\(--background-bar-primary\)/
      );
      expect(cardSelected).not.toMatch(/box-shadow:\s*0 0 0/);
      expect(
        body(/\n\.shift-my-pdfs-row\.is-selected > td \{([^}]*)\}/)
      ).toMatch(/background:\s*var\(--background-bar-primary\)/);
    });

    /**
     * A card is filled edge to edge by the page preview, so an inset ring
     * paints over the thumbnail. Both card rings sit outside the box instead,
     * which only works if the scrollport leaves them room.
     */
    it('keeps the card ring outside the preview and unclipped', () => {
      for (const rule of [
        /\n\.shift-open-file-thumb\.is-selected \{([^}]*)\}/,
        /\nbutton\.shift-open-file-thumb:focus-visible \{([^}]*)\}/,
      ]) {
        const declarations = body(rule);
        expect(declarations).toMatch(/outline-offset:\s*0/);
        expect(declarations).not.toMatch(/outline-offset:\s*-/);
      }

      // The pane clips both axes, so the left column and end rows need space.
      const pane = body(
        /body\.shift-home #shift-my-pdfs\[data-view='thumbnail'\] \.shift-my-pdfs-scroll \{([^}]*)\}/
      );
      expect(pane).toMatch(/padding-block:\s*2px/);
      expect(pane).toMatch(/padding-left:\s*2px/);
    });

    it('leaves list rows plain on hover but keeps the focus ring', () => {
      // Hover may still reveal the row's delete control; what it must not do
      // is restyle the row itself, so nothing may target the row on hover.
      expect(css).not.toMatch(/\.shift-my-pdfs-row:hover\s*[,{]/);
      expect(body(/\n\.shift-my-pdfs-row:focus-visible \{([^}]*)\}/)).toMatch(
        /outline:\s*2px solid/
      );
    });

    it('outlines neighbouring selected rows as one block', () => {
      const shared = body(
        /\n\.shift-my-pdfs-row\.is-selected > td \{([^}]*)\}/
      );

      // A row in the middle of a run keeps the plain divider, so neither
      // horizontal edge may be set on every selected row.
      expect(shared).not.toMatch(/--shift-row-edge-top:\s*0 2px/);
      expect(shared).not.toMatch(/--shift-row-edge-bottom:\s*0 -2px/);

      expect(
        body(
          /\ntr:not\(\.is-selected\) \+ \.shift-my-pdfs-row\.is-selected > td \{([^}]*)\}/
        )
      ).toMatch(/--shift-row-edge-top:\s*0 2px/);
      // Only `:has()` can see the next row, which is what keeps the closing
      // edge off rows that continue into another selected row.
      expect(
        body(
          /\n\.shift-my-pdfs-row\.is-selected:has\(\+ tr:not\(\.is-selected\)\) > td \{([^}]*)\}/
        )
      ).toMatch(/--shift-row-edge-bottom:\s*0 -2px/);
    });

    /**
     * Selection must not move the page. Borders and outlines with a positive
     * offset both take space, so the edges are drawn as inset shadows.
     */
    it('draws the selection edges without taking up space', () => {
      const shared = body(
        /\n\.shift-my-pdfs-row\.is-selected > td \{([^}]*)\}/
      );
      expect(shared).toMatch(/box-shadow:/);
      expect(shared).toMatch(/inset var\(--shift-row-edge-top\)/);
      expect(shared).toMatch(/inset var\(--shift-row-edge-bottom\)/);
      expect(shared).toMatch(/inset var\(--shift-row-edge-left\)/);
      expect(shared).toMatch(/inset var\(--shift-row-edge-right\)/);

      // No selected-row rule may add a border, which would change the row box.
      const selectedRules = css.match(
        /\n\.shift-my-pdfs-row\.is-selected[^{]*\{[^}]*\}/g
      );
      expect(selectedRules?.length).toBeGreaterThan(0);
      for (const rule of selectedRules ?? []) {
        expect(rule).not.toMatch(/border(-(top|bottom|left|right))?:\s*\d/);
        expect(rule).not.toMatch(/border-\w+-width:/);
      }
    });
  });

  it('renders an empty-state placeholder in list and thumbnail markup when the library is empty', () => {
    document.body.innerHTML = `
      <div id="drop-zone">
        <input id="file-input" type="file" accept="application/pdf,.pdf" />
      </div>
      <section id="shift-my-pdfs" data-view="thumbnail">
        <div class="shift-open-file-header">
          <h2 id="shift-my-pdfs-heading">My PDFs</h2>
          <div class="shift-open-file-header-controls">
            <div id="shift-open-file-tools" class="shift-open-file-tools" hidden></div>
            <div class="shift-open-file-view-by" role="group" aria-label="View by">
              <span>View by</span>
            </div>
          </div>
        </div>
        <table class="shift-my-pdfs-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Date added</th>
              <th>Size</th>
            </tr>
          </thead>
          <tbody id="shift-my-pdfs-body"></tbody>
        </table>
        <div id="shift-my-pdfs-thumbs" class="shift-open-file-thumbs"></div>
      </section>
    `;
    setHomeLibraryFiles([]);

    const section = document.getElementById('shift-my-pdfs');
    const row = document.querySelector<HTMLTableRowElement>(
      '#shift-my-pdfs-body tr.shift-my-pdfs-empty-row'
    );
    const card = document.querySelector('.shift-my-pdfs-empty-card');

    expect(section?.hidden).toBe(false);
    const cluster = document.querySelector('.shift-my-pdfs-controls-cluster');
    expect(cluster?.querySelector('.shift-my-pdfs-actions')).not.toBeNull();
    expect(cluster?.querySelector('.shift-open-file-view-by')).not.toBeNull();
    expect(document.getElementById('shift-open-file-tools')?.hidden).toBe(
      false
    );
    expect(
      document
        .getElementById('shift-open-file-tools')
        ?.getAttribute('aria-disabled')
    ).toBe('true');
    expect(row?.querySelector('td')?.colSpan).toBe(4);
    expect(row?.textContent).toContain('Add a PDF to get started');
    expect(row?.textContent).toContain(
      'The selected PDF is what tools will use. Files stay on your machine.'
    );
    expect(row?.textContent).toContain('Choose files');
    expect(card?.textContent).toContain('Add a PDF to get started');
    expect(card?.textContent).toContain('Choose files');
    expect(document.querySelector('.shift-my-pdfs-row')).toBeNull();

    section?.setAttribute('data-view', 'list');
    expect(
      document.querySelector('#shift-my-pdfs-body tr.shift-my-pdfs-empty-row')
    ).not.toBeNull();
  });

  it('wraps the table and thumbs in one scroll pane under the controls', () => {
    document.body.innerHTML = `
      <section id="shift-my-pdfs" data-view="thumbnail">
        <h2 id="shift-my-pdfs-heading">My PDFs</h2>
        <div id="drop-zone"></div>
        <div class="shift-open-file-header">
          <div class="shift-open-file-header-controls">
            <div id="shift-open-file-tools" hidden></div>
            <div class="shift-open-file-view-by">
              <span>View by</span>
            </div>
          </div>
        </div>
        <table class="shift-my-pdfs-table">
          <tbody id="shift-my-pdfs-body"></tbody>
        </table>
        <div id="shift-my-pdfs-thumbs" class="shift-open-file-thumbs"></div>
      </section>
    `;
    setHomeLibraryFiles([]);

    const section = document.getElementById('shift-my-pdfs');
    const pane = section?.querySelector('.shift-my-pdfs-scroll');
    const controls = section?.querySelector('.shift-my-pdfs-controls');
    const table = section?.querySelector('.shift-my-pdfs-table');
    const thumbs = document.getElementById('shift-my-pdfs-thumbs');

    expect(pane).not.toBeNull();
    expect(pane?.contains(table as Node)).toBe(true);
    expect(pane?.contains(thumbs as Node)).toBe(true);
    expect(controls?.nextElementSibling).toBe(pane);
    // Idempotent — a second paint must not nest another pane.
    setHomeLibraryFiles([]);
    expect(section?.querySelectorAll('.shift-my-pdfs-scroll')).toHaveLength(1);
  });

  it('offers a delete control on every library row and thumbnail', () => {
    mountLibrary();
    setHomeLibraryFiles([
      { id: 'a', name: 'keep.pdf', size: 10, source: 'upload' },
      { id: 'b', name: 'drop.pdf', size: 20, source: 'upload' },
    ]);

    const rowButtons = document.querySelectorAll(
      '#shift-my-pdfs-body .shift-my-pdfs-delete'
    );
    const thumbButtons = document.querySelectorAll(
      '#shift-my-pdfs-thumbs .shift-my-pdfs-delete'
    );

    expect(rowButtons).toHaveLength(2);
    expect(thumbButtons).toHaveLength(2);
    expect(rowButtons[0]?.getAttribute('aria-label')).toBe('Delete keep.pdf');
    // The card is a button, so the delete control must be its sibling.
    expect(document.querySelectorAll('.shift-my-pdfs-thumb-item')).toHaveLength(
      2
    );
    expect(
      document.querySelector('.shift-open-file-thumb .shift-my-pdfs-delete')
    ).toBeNull();
  });

  it('offers a View button on every library row and thumbnail', () => {
    mountLibrary();
    const first = new File(['first'], 'first.pdf', {
      type: 'application/pdf',
    });
    const second = new File(['second'], 'second.pdf', {
      type: 'application/pdf',
    });
    setHomeLibraryFiles([first, second]);

    const rowButtons = document.querySelectorAll(
      '#shift-my-pdfs-body .shift-my-pdfs-view'
    );
    const thumbButtons = document.querySelectorAll(
      '#shift-my-pdfs-thumbs .shift-my-pdfs-view'
    );

    expect(rowButtons).toHaveLength(2);
    expect(thumbButtons).toHaveLength(2);
    expect(rowButtons[0]?.textContent).toBe('View');
    expect(rowButtons[0]?.getAttribute('aria-label')).toBe('View first.pdf');
    expect(
      document.querySelector('.shift-open-file-thumb .shift-my-pdfs-view')
    ).toBeNull();
  });

  it('opens a library PDF without changing a multi-file selection', async () => {
    mountLibrary();
    const first = new File(['first'], 'first.pdf', {
      type: 'application/pdf',
    });
    const second = new File(['second'], 'second.pdf', {
      type: 'application/pdf',
    });
    const viewed = new File(['viewed'], 'viewer.pdf', {
      type: 'application/pdf',
    });
    setWorkspaceFiles([first, second]);
    await persistWorkspaceOpenFile();
    const persistedBefore = (await readPersistedOpenFiles()).map(
      (entry) => entry.name
    );
    const assignLocation = vi.fn();

    await expect(
      openLibraryFileInViewer(
        {
          id: 'viewer-id',
          name: viewed.name,
          size: viewed.size,
          source: 'upload',
          blob: viewed,
        },
        document,
        assignLocation
      )
    ).resolves.toBe(true);

    expect(assignLocation).toHaveBeenCalledWith('view-pdf.html?file=viewer-id');
    expect(getWorkspaceFiles().map((file) => file.name)).toEqual([
      'first.pdf',
      'second.pdf',
    ]);
    expect((await readPersistedOpenFiles()).map((entry) => entry.name)).toEqual(
      persistedBefore
    );
  });

  it('paints thumbnails when the library first renders in list view', async () => {
    document.body.innerHTML = `
      <section id="shift-my-pdfs" data-view="thumbnail">
        <button id="shift-open-file-view-list" data-view="list"></button>
        <button id="shift-open-file-view-thumbnail" data-view="thumbnail"></button>
        <table><tbody id="shift-my-pdfs-body"></tbody></table>
        <div id="shift-my-pdfs-thumbs" class="shift-open-file-thumbs"></div>
      </section>
    `;
    initWorkspaceFileIndicator();
    setHomeOpenFileView('list');
    vi.mocked(renderPdfFirstPage).mockClear();

    const first = new File(['%PDF-a'], 'alpha.pdf', {
      type: 'application/pdf',
    });
    const second = new File(['%PDF-b'], 'beta.pdf', {
      type: 'application/pdf',
    });
    setHomeLibraryFiles([first, second]);

    expect(getHomeOpenFileView()).toBe('list');
    expect(document.getElementById('shift-my-pdfs')?.dataset.view).toBe('list');
    await vi.waitFor(() => {
      expect(renderPdfFirstPage).toHaveBeenCalledTimes(2);
    });
    await vi.waitFor(() => {
      expect(
        document.querySelectorAll('.shift-open-file-thumb-preview.is-empty')
      ).toHaveLength(0);
    });

    // A same-list re-render must not leave blank canvases behind either.
    vi.mocked(renderPdfFirstPage).mockClear();
    setHomeLibraryFiles([first, second]);
    expect(
      document.querySelectorAll('.shift-open-file-thumb-preview.is-empty')
    ).toHaveLength(0);

    setHomeOpenFileView('thumbnail');
    expect(
      document.querySelectorAll('.shift-open-file-thumb-preview.is-empty')
    ).toHaveLength(0);
    expect(document.querySelectorAll('.shift-my-pdfs-thumb-item')).toHaveLength(
      2
    );
  });

  it('clears is-empty after paint even if a newer thumbnail pass supersedes it', async () => {
    mountLibrary();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.mocked(renderPdfFirstPage).mockImplementation(() => gate);

    setHomeLibraryFiles([
      new File(['%PDF'], 'race.pdf', { type: 'application/pdf' }),
    ]);
    // Bump the render token while the first pass is awaiting paint.
    setHomeOpenFileView('thumbnail');
    release();

    await vi.waitFor(() => {
      expect(
        document
          .querySelector('.shift-open-file-thumb-preview')
          ?.classList.contains('is-empty')
      ).toBe(false);
    });
  });

  it('asks for confirmation and keeps the file when the delete is cancelled', async () => {
    mountLibrary();
    setHomeLibraryFiles([
      { id: 'a', name: 'keep.pdf', size: 10, source: 'upload' },
    ]);

    document
      .querySelector<HTMLButtonElement>(
        '#shift-my-pdfs-body .shift-my-pdfs-delete'
      )
      ?.click();

    const dialog = document.getElementById('shift-confirm-dialog');
    expect(dialog).not.toBeNull();
    expect(dialog?.textContent).toContain('keep.pdf');

    dialog?.querySelector<HTMLButtonElement>('.shift-confirm-cancel')?.click();
    await Promise.resolve();

    expect(document.getElementById('shift-confirm-dialog')).toBeNull();
    expect(document.querySelectorAll('.shift-my-pdfs-row')).toHaveLength(1);
  });

  it('drops the row and deselects the file once the delete is confirmed', async () => {
    mountLibrary();
    const file = new File(['pdf'], 'drop.pdf', { type: 'application/pdf' });
    setHomeLibraryFiles([
      {
        id: 'b',
        name: 'drop.pdf',
        size: file.size,
        source: 'upload',
        blob: file,
      },
    ]);

    document.querySelector<HTMLTableRowElement>('.shift-my-pdfs-row')?.click();
    expect(getWorkspaceFiles().map((entry) => entry.name)).toEqual([
      'drop.pdf',
    ]);

    document
      .querySelector<HTMLButtonElement>(
        '#shift-my-pdfs-body .shift-my-pdfs-delete'
      )
      ?.click();
    document.querySelector<HTMLButtonElement>('.shift-confirm-accept')?.click();
    await vi.waitFor(() => {
      expect(document.querySelector('.shift-my-pdfs-row')).toBeNull();
    });

    expect(getWorkspaceFiles()).toHaveLength(0);
    expect(document.querySelector('.shift-my-pdfs-empty-row')).not.toBeNull();
  });

  it('removes the IndexedDB library copy once delete is confirmed', async () => {
    mountLibrary();
    const saved = await addPdfToLibrary(
      new File(['pdf'], 'stored.pdf', { type: 'application/pdf' }),
      'upload'
    );
    setHomeLibraryFiles([
      {
        id: saved.id,
        name: saved.name,
        size: saved.size,
        source: saved.source,
        blob: saved.file,
      },
    ]);

    document
      .querySelector<HTMLButtonElement>(
        '#shift-my-pdfs-body .shift-my-pdfs-delete'
      )
      ?.click();
    document.querySelector<HTMLButtonElement>('.shift-confirm-accept')?.click();
    await vi.waitFor(() => {
      expect(document.querySelector('.shift-my-pdfs-row')).toBeNull();
    });
    await expect(readPdfLibrary()).resolves.toHaveLength(0);
  });

  it('removes the empty-state placeholder once a library file exists and restores it after the last file is cleared', () => {
    document.body.innerHTML = `
      <section id="shift-my-pdfs" data-view="thumbnail">
        <div id="shift-open-file-tools" hidden></div>
        <h2 id="shift-my-pdfs-heading">My PDFs</h2>
        <table><tbody id="shift-my-pdfs-body"></tbody></table>
        <div id="shift-my-pdfs-thumbs"></div>
      </section>
    `;
    setHomeLibraryFiles([]);
    expect(document.querySelector('.shift-my-pdfs-empty-row')).not.toBeNull();
    expect(document.querySelector('.shift-my-pdfs-empty-card')).not.toBeNull();

    setHomeLibraryFiles([
      new File(['a'], 'kept.pdf', { type: 'application/pdf' }),
    ]);
    expect(document.querySelector('.shift-my-pdfs-empty-row')).toBeNull();
    expect(document.querySelector('.shift-my-pdfs-empty-card')).toBeNull();
    expect(
      document.querySelector('#shift-my-pdfs-body tr.shift-my-pdfs-row')
        ?.textContent
    ).toContain('kept.pdf');
    expect(document.getElementById('shift-open-file-tools')?.hidden).toBe(
      false
    );
    expect(
      document
        .getElementById('shift-open-file-tools')
        ?.getAttribute('aria-disabled')
    ).toBe('true');

    setHomeLibraryFiles([]);
    expect(document.querySelector('.shift-my-pdfs-empty-row')).not.toBeNull();
    expect(document.querySelector('.shift-my-pdfs-empty-card')).not.toBeNull();
    expect(document.querySelector('.shift-my-pdfs-row')).toBeNull();
  });

  it('opens the existing file picker from the empty-state CTA', () => {
    document.body.innerHTML = `
      <div id="drop-zone">
        <input id="file-input" type="file" accept="application/pdf,.pdf" />
      </div>
      <section id="shift-my-pdfs">
        <h2 id="shift-my-pdfs-heading">My PDFs</h2>
        <table><tbody id="shift-my-pdfs-body"></tbody></table>
        <div id="shift-my-pdfs-thumbs"></div>
      </section>
    `;
    setHomeLibraryFiles([]);
    const input = document.getElementById('file-input') as HTMLInputElement;
    const click = vi.spyOn(input, 'click').mockImplementation(() => {});

    document
      .querySelector<HTMLButtonElement>(
        '.shift-my-pdfs-empty .shift-library-picker-upload'
      )
      ?.click();

    expect(click).toHaveBeenCalledTimes(1);
    click.mockRestore();
  });

  /**
   * Short or tall page previews used to stretch `.shift-open-file-thumb-preview`
   * (min-height + canvas height:auto), so meta sat at different Y positions and
   * cards in the grid were uneven. The preview frame must be a fixed box that
   * centers the canvas; the canvas must not be allowed to grow that box.
   */
  it('keeps My PDFs thumbnail preview frames a fixed height', () => {
    const css = readFileSync('src/css/shift-theme.css', 'utf8');
    const ruleBody = (selector: string): string => {
      const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const match = new RegExp(`(?<=\\n)(?<!,\\n)${escaped} \\{`).exec(css);
      if (!match) throw new Error(`No rule found for ${selector}`);
      return css.slice(match.index, css.indexOf('\n}', match.index));
    };

    const preview = ruleBody('.shift-open-file-thumb-preview');
    expect(preview).toMatch(/height:\s*154px/);
    expect(preview).not.toMatch(/min-height:/);
    expect(preview).toContain('align-items: center');
    expect(preview).toContain('justify-content: center');
    expect(preview).toContain('overflow: hidden');

    const canvas = ruleBody('.shift-open-file-thumb-preview canvas');
    expect(canvas).toContain('max-width: 100%');
    expect(canvas).toContain('max-height: 100%');
    expect(canvas).toContain('object-fit: contain');
    // Full-bleed width:100% + height:auto was what let tall pages grow the card.
    expect(canvas).not.toMatch(/^\s*width:\s*100%;/m);
  });
});
