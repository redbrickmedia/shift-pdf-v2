import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../js/utils/pdf-thumbnail.js', () => ({
  renderPdfFirstPage: vi.fn().mockResolvedValue(undefined),
}));

import { renderPdfFirstPage } from '../js/utils/pdf-thumbnail';
import { state } from '../js/state';
import { writePersistedOpenFile } from '../js/logic/open-file-store';
import {
  clearWorkspaceOpenFile,
  copyFileOrigin,
  getHomeOpenFileView,
  getWorkspaceFiles,
  initWorkspaceFileIndicator,
  markFileFromHandoff,
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

afterEach(() => {
  document.body.className = '';
  state.files = [];
  resetWorkspaceFileIndicator();
  vi.mocked(renderPdfFirstPage).mockClear();
  vi.mocked(renderPdfFirstPage).mockResolvedValue(undefined);
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
    expect(button?.getAttribute('data-shift-tooltip')).toBeNull();
    expect(button?.getAttribute('aria-label')).toBe('Selected: contract.pdf');
    expect(button?.getAttribute('aria-current')).toBe('true');
    expect(button?.classList.contains('is-selected')).toBe(true);
    expect(button?.getAttribute('href')).toBe('my-pdfs.html');
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
    setHomeLibraryFiles([
      {
        name: 'saved.pdf',
        blob: new File(['x'], 'saved.pdf', { type: 'application/pdf' }),
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
      document.querySelector('#shift-my-pdfs-body td:nth-child(3)')?.textContent
    ).toBe('500 B');

    setWorkspaceFiles([{ name: 'large.pdf', size: 2 * 1024 * 1024 }]);
    expect(
      document.querySelector('#shift-my-pdfs-body td:nth-child(3)')?.textContent
    ).toBe('2.0 MB');
  });

  it('links the sidebar file row to My PDFs without a file picker present', () => {
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
    expect(item?.getAttribute('href')).toBe('my-pdfs.html');
  });

  it('points the sidebar file row at the My PDFs nav href instead of the picker', () => {
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

    expect(item?.getAttribute('href')).toBe('../my-pdfs.html');
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
      'Received from Shift. Click to open in My PDFs.'
    );
    expect(button?.getAttribute('aria-label')).toBe(
      'Selected: from-tab.pdf. Received from Shift. Click to open in My PDFs.'
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
      'Downloaded copy. Click to open in My PDFs.'
    );
    expect(button?.getAttribute('aria-label')).toBe(
      'Selected: compressed.pdf. Downloaded copy. Click to open in My PDFs.'
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
      'Received from Shift. Click to open in My PDFs.'
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

  it('links a handoff sidebar row to My PDFs', () => {
    mountShell();
    setWorkspaceFiles([{ name: 'from-tab.pdf', source: 'handoff' }]);
    const input = document.getElementById('file-input') as HTMLInputElement;
    const click = vi.spyOn(input, 'click').mockImplementation(() => {});

    const item = document.querySelector<HTMLAnchorElement>(
      '.shift-open-file-item'
    );

    expect(item?.getAttribute('href')).toBe('my-pdfs.html');
    expect(click).not.toHaveBeenCalled();
    click.mockRestore();
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
    expect(cells?.[0]?.textContent).toContain('upload.pdf');
    expect(cells?.[2]?.textContent).toBe('512 B');
    expect(rows[1]?.querySelector('td')?.textContent).toContain('briefing.pdf');
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
    expect(row?.querySelector('.shift-open-file-icon-download')).not.toBeNull();
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

  it('shows Use this PDF only on unselected list rows', async () => {
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
    expect(activeRow?.querySelector('.shift-my-pdfs-row-replace')).toBeNull();
    expect(
      inactiveRow?.querySelector('.shift-my-pdfs-row-replace')?.textContent
    ).toBe('Use this PDF');

    inactiveRow?.click();
    await vi.waitFor(() => {
      expect(inactiveRow?.classList.contains('is-selected')).toBe(true);
    });
    expect(inactiveRow?.querySelector('.shift-my-pdfs-row-replace')).toBeNull();
    expect(activeRow?.classList.contains('is-selected')).toBe(true);
    expect(activeRow?.querySelector('.shift-my-pdfs-row-replace')).toBeNull();
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
      tools?.querySelectorAll<HTMLAnchorElement>('.shift-open-file-tool-btn') ??
        []
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
    expect(document.querySelector('.shift-open-file-view-by')).not.toBeNull();
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
});
