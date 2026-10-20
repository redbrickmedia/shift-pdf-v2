import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../js/utils/pdf-thumbnail.js', () => ({
  renderPdfFirstPage: vi.fn().mockResolvedValue(undefined),
}));

import { renderPdfFirstPage } from '../js/utils/pdf-thumbnail';
import { state } from '../js/state';
import {
  hasOpenFileFlag,
  readPersistedOpenFile,
  readPersistedOpenFiles,
  writePersistedOpenFile,
} from '../js/logic/open-file-store';
import {
  addPdfToLibrary,
  clearPdfLibrary,
  readPdfLibrary,
} from '../js/logic/pdf-library-store';
import { TOOL_FAVORITES_RAIL_KEY } from '../js/logic/tool-favorites';
import { categories, extractCatalogEntryIdFromHref } from '../js/config/tools';
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
  openLibraryFileOnDoubleClick,
  persistWorkspaceOpenFile,
  resetWorkspaceFileIndicator,
  setHomeLibraryFiles,
  setHomeOpenFileView,
  setWorkspaceFiles,
} from '../js/logic/workspace-files';

function mountShell(page: 'home' | 'tool' = 'home') {
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
    ${page === 'home' ? '<section id="shift-my-pdfs" hidden></section>' : ''}
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

  it('keeps a selected file out of the sidebar', () => {
    mountShell();
    setWorkspaceFiles([{ name: 'contract.pdf', size: 2048 }]);

    const section = document.getElementById('shift-open-files');
    const list = document.getElementById('shift-open-files-list');
    const heading = document.getElementById('shift-open-files-heading');

    expect(section?.hidden).toBe(false);
    expect(list?.hidden).toBe(true);
    expect(list?.childElementCount).toBe(0);
    expect(heading?.textContent).toBe('My PDFs');
    expect(document.querySelector('.shift-open-file-item')).toBeNull();
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
    mountShell('tool');
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
    mountShell('tool');
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

    expect(document.getElementById('shift-open-files-list')?.hidden).toBe(true);
    expect(document.querySelector('.shift-open-file-item')).toBeNull();
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

    expect(document.getElementById('shift-open-files-list')?.hidden).toBe(true);
    expect(document.querySelector('.shift-open-file-item')).toBeNull();
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

    expect(document.getElementById('shift-open-files-list')?.hidden).toBe(true);
    expect(document.querySelector('.shift-open-file-item')).toBeNull();
    expect(document.body.classList.contains('shift-has-open-file')).toBe(true);
    expect(document.body.classList.contains('shift-open-file-in-tool')).toBe(
      false
    );
    expect(document.getElementById('drop-zone')?.hidden).toBe(false);
  });

  it('keeps the My PDFs heading and leaves the sidebar list empty', () => {
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

    expect(heading?.textContent).toBe('My PDFs');
    expect(list?.hidden).toBe(true);
    expect(list?.querySelector('.shift-open-file-item')).toBeNull();
    expect(getWorkspaceFiles()).toHaveLength(5);
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

  it('tags a Shift-handoff File as a handoff source', () => {
    mountShell();
    const file = new File([new Uint8Array([1, 2, 3])], 'from-tab.pdf', {
      type: 'application/pdf',
    });
    markFileFromHandoff(file);
    setWorkspaceFiles([file]);

    expect(document.getElementById('shift-open-files-list')?.hidden).toBe(true);
    expect(document.querySelector('.shift-open-file-item')).toBeNull();
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

  it('does not list a My PDFs selection in the sidebar on the all-tools page', () => {
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

    expect(document.getElementById('shift-open-files-list')?.hidden).toBe(true);
    expect(sidebarLabels).toEqual([]);
    expect(selectedChips).toEqual([]);
    expect(
      document.querySelectorAll('.shift-open-file-item.is-selected')
    ).toHaveLength(0);
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
    expect(document.getElementById('shift-open-files-list')?.hidden).toBe(true);
    expect(document.querySelector('.shift-open-file-item')).toBeNull();
    expect(
      document
        .querySelector('.shift-open-file-thumb[data-file-name="second.pdf"]')
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
    expect(document.querySelector('.shift-open-file-thumb-replace')).toBeNull();
    expect(document.body.textContent).not.toContain('Use this PDF');
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

    inactiveRow
      ?.querySelector<HTMLInputElement>('.shift-my-pdfs-checkbox')
      ?.click();
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
    expect(document.getElementById('shift-open-files-list')?.hidden).toBe(true);
    expect(document.querySelector('.shift-open-file-item')).toBeNull();

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
    expect(document.querySelector('.shift-open-file-item')).toBeNull();
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
    ).toHaveLength(0);
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
    const checkbox = row?.querySelector<HTMLInputElement>(
      '.shift-my-pdfs-checkbox'
    );
    expect(row?.getAttribute('role')).toBeNull();
    expect(row?.hasAttribute('tabindex')).toBe(false);
    expect(row?.hasAttribute('aria-label')).toBe(false);
    expect(checkbox?.getAttribute('aria-label')).toBe('Select toggle.pdf');
    expect(checkbox?.getAttribute('aria-hidden')).toBeNull();

    checkbox?.click();
    expect(getWorkspaceFiles()).toMatchObject([{ name: 'toggle.pdf' }]);
    expect(
      row?.querySelector<HTMLInputElement>('.shift-my-pdfs-checkbox')?.checked
    ).toBe(true);

    row?.querySelector<HTMLInputElement>('.shift-my-pdfs-checkbox')?.click();
    expect(getWorkspaceFiles()).toEqual([]);
    expect(
      row?.querySelector<HTMLInputElement>('.shift-my-pdfs-checkbox')?.checked
    ).toBe(false);
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
              <div class="shift-open-file-tools-toggle"></div>
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

    // Inline favorite links are replaced by a single Open with dropdown button
    expect(
      tools?.querySelectorAll('a.shift-open-file-tool-btn') ?? []
    ).toHaveLength(0);
    const openWithBtn = document.getElementById(
      'shift-my-pdfs-more-tools'
    ) as HTMLButtonElement | null;
    expect(openWithBtn).not.toBeNull();
    expect(openWithBtn?.textContent?.trim()).toBe('Open with');
    expect(openWithBtn?.disabled).toBe(false);
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
    expect(openWithBtn?.disabled).toBe(true);
    expect(tools?.classList.contains('shift-enter')).toBe(false);
  });

  it('populates the unified Open with menu with all Favorites, deduped Popular Tools, and Browse all tools… before Delete', () => {
    localStorage.setItem(
      'shiftPdfFavoriteToolIds',
      JSON.stringify([
        'rotate-pdf',
        'jpg-to-pdf',
        'compare-pdfs',
        'split-pdf',
        'merge-pdf',
        'compress-pdf',
        'pdf-converter',
        'sign-pdf',
      ])
    );
    localStorage.setItem('shiftPdfFavoritesMigratedV1', '1');
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

    // No inline favorite links in the toggle bar
    expect(
      document.querySelectorAll('a.shift-open-file-tool-btn')
    ).toHaveLength(0);

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
    expect(
      button?.querySelector('.shift-my-pdfs-more-tools-caret')
    ).not.toBeNull();
    expect(button?.textContent?.trim()).toBe('Open with');
    expect(button?.getAttribute('aria-label')).toBe('Open with');
    expect(wrap?.nextElementSibling).toBe(deleteSelected);

    expect(menu?.hidden).toBe(true);
    expect(button?.getAttribute('aria-expanded')).toBe('false');

    const list = menu?.querySelector('.shift-my-pdfs-more-tools-list');
    const items = Array.from(
      list?.querySelectorAll<HTMLAnchorElement>(
        '.shift-my-pdfs-more-tools-item'
      ) ?? []
    );
    // All 8 favorites appear first in saved order (not capped to 6)
    expect(items.slice(0, 8).map((item) => item.dataset.tool)).toEqual([
      'rotate-pdf',
      'jpg-to-pdf',
      'compare-pdfs',
      'split-pdf',
      'merge-pdf',
      'compress-pdf',
      'pdf-converter',
      'sign-pdf',
    ]);

    // Non-PDF favorite (jpg-to-pdf) stays visible in position but disabled with tooltip
    const jpgItem = items.find((item) => item.dataset.tool === 'jpg-to-pdf');
    expect(jpgItem?.getAttribute('aria-disabled')).toBe('true');
    expect(
      jpgItem
        ?.closest('.shift-open-file-tool-wrap')
        ?.getAttribute('data-shift-tooltip')
    ).toBe("This tool doesn't accept PDF files.");

    // Popular tools follow, deduped against favorites
    const pageOf = (href: string): string =>
      extractCatalogEntryIdFromHref(href) || href;
    const rendered = new Set(items.map((item) => item.dataset.tool));
    const popular = categories.find(
      (category) => category.name === 'Popular Tools'
    );
    expect(popular).toBeDefined();
    for (const tool of popular?.tools ?? []) {
      expect(rendered).toContain(pageOf(tool.href));
    }

    // Browse all tools… is pinned outside the scroll area
    const browse = menu?.querySelector('.shift-my-pdfs-more-tools-browse');
    expect(browse?.textContent).toBe('Browse all tools…');
    expect(browse?.parentElement).toBe(menu);
    expect(list?.contains(browse ?? null)).toBe(false);

    button?.click();
    expect(menu?.hidden).toBe(false);
    expect(button?.getAttribute('aria-expanded')).toBe('true');

    button?.click();
    expect(menu?.hidden).toBe(true);

    localStorage.removeItem('shiftPdfFavoriteToolIds');
    localStorage.removeItem('shiftPdfFavoritesMigratedV1');
  });

  it('disables single-file entries when > 1 PDF is selected and Compare PDFs when > 2 PDFs are selected', () => {
    localStorage.setItem(
      'shiftPdfFavoriteToolIds',
      JSON.stringify(['split-pdf', 'compare-pdfs', 'merge-pdf'])
    );
    localStorage.setItem('shiftPdfFavoritesMigratedV1', '1');
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

    const pdf1 = new File(['a'], 'one.pdf', { type: 'application/pdf' });
    const pdf2 = new File(['b'], 'two.pdf', { type: 'application/pdf' });
    const pdf3 = new File(['c'], 'three.pdf', { type: 'application/pdf' });
    setHomeLibraryFiles([pdf1, pdf2, pdf3]);
    setWorkspaceFiles([pdf1, pdf2]);

    const menu = document.getElementById('shift-my-pdfs-more-tools-menu');
    const getItem = (toolId: string) =>
      menu?.querySelector<HTMLAnchorElement>(`[data-tool="${toolId}"]`);

    // 2 PDFs selected: split-pdf (single) disabled, compare-pdfs (dual) enabled, merge-pdf (batch) enabled
    expect(getItem('split-pdf')?.getAttribute('aria-disabled')).toBe('true');
    expect(
      getItem('split-pdf')
        ?.closest('.shift-open-file-tool-wrap')
        ?.getAttribute('data-shift-tooltip')
    ).toBe('Select a single PDF to use this tool.');
    expect(getItem('compare-pdfs')?.getAttribute('aria-disabled')).toBeNull();
    expect(getItem('merge-pdf')?.getAttribute('aria-disabled')).toBeNull();

    // 3 PDFs selected: compare-pdfs (dual) disabled with tooltip
    setWorkspaceFiles([pdf1, pdf2, pdf3]);
    expect(getItem('compare-pdfs')?.getAttribute('aria-disabled')).toBe('true');
    expect(
      getItem('compare-pdfs')
        ?.closest('.shift-open-file-tool-wrap')
        ?.getAttribute('data-shift-tooltip')
    ).toBe('Select 1 or 2 PDFs to compare.');
    expect(getItem('merge-pdf')?.getAttribute('aria-disabled')).toBeNull();

    localStorage.removeItem('shiftPdfFavoriteToolIds');
    localStorage.removeItem('shiftPdfFavoritesMigratedV1');
  });

  it('closes and disables Open with once no file is selected', () => {
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

    setWorkspaceFiles([]);

    expect(button?.disabled).toBe(true);
    expect(menu?.hidden).toBe(true);
    expect(button?.getAttribute('aria-expanded')).toBe('false');
  });

  it('holds the controls row on one line', () => {
    const css = readFileSync('src/css/shift-theme.css', 'utf8');
    const rule = (selector: string): string => {
      const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const match = new RegExp(`(?<=\\n)(?<!,\\n)${escaped} \\{`).exec(css);
      if (!match) throw new Error(`No rule found for ${selector}`);
      return css.slice(match.index, css.indexOf('\n}', match.index));
    };

    expect(rule('.shift-my-pdfs-controls-row')).toMatch(/flex-wrap:\s*nowrap/);
    expect(rule('.shift-my-pdfs-controls-cluster')).toMatch(/flex:\s*none/);
    const selection = rule('.shift-my-pdfs-selection');
    expect(selection).toMatch(/flex:\s*1 1 auto/);
    expect(selection).toMatch(/min-width:\s*0/);
    const count = rule('.shift-my-pdfs-selection-count');
    expect(count).toMatch(/min-width:\s*0/);
    expect(count).toMatch(/text-overflow:\s*ellipsis/);
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

    /**
     * The grid controls are laid-out action items now, so they must rest
     * visible; hover-revealing them would leave an empty strip under the card
     * and the tile has to read as one box across the seam.
     */
    it('rests the grid action row visible and seams it to the card', () => {
      const actions = body(/\n\.shift-my-pdfs-thumb-actions \{([^}]*)\}/);
      expect(actions).toMatch(/border-block-start:\s*0/);
      expect(actions).toMatch(
        /border-end-start-radius:\s*var\(--radius-8\)[\s\S]*border-end-end-radius:\s*var\(--radius-8\)/
      );

      const card = body(
        /\n\.shift-my-pdfs-thumb-item > \.shift-open-file-thumb \{([^}]*)\}/
      );
      expect(card).toMatch(/border-end-start-radius:\s*0/);
      expect(card).toMatch(/border-end-end-radius:\s*0/);

      expect(
        body(
          /\n\.shift-my-pdfs-thumb-actions \.shift-my-pdfs-view,\n\.shift-my-pdfs-thumb-actions \.shift-my-pdfs-download,\n\.shift-my-pdfs-thumb-actions \.shift-my-pdfs-rename,\n\.shift-my-pdfs-thumb-actions \.shift-my-pdfs-delete \{([^}]*)\}/
        )
      ).toMatch(/opacity:\s*1/);
      // Nothing may hover-reveal them back into the tile.
      expect(css).not.toMatch(
        /\.shift-my-pdfs-thumb-item:hover[^{]*\{[^}]*opacity/
      );
    });

    it('tints the whole tile on hover, strip included', () => {
      const card = body(
        /\n\.shift-open-file-thumb:hover,\n\.shift-my-pdfs-thumb-item:hover > \.shift-open-file-thumb:not\(\.is-selected\) \{([^}]*)\}/
      );
      expect(card).toMatch(
        /background:\s*var\(--action-controls-surface-primary-hover\)/
      );
      const strip = body(
        /\n\.shift-my-pdfs-thumb-item:hover:not\(\s*:has\(> \.shift-open-file-thumb\.is-selected\)\s*\)\s*\.shift-my-pdfs-thumb-actions \{([^}]*)\}/
      );
      expect(strip).toMatch(
        /background:\s*var\(--action-controls-surface-primary-hover\)/
      );
      expect(css).not.toContain('shift-open-file-thumb-replace');
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

  it('lays the grid controls out in an action row below the card', () => {
    mountLibrary();
    setHomeLibraryFiles([
      { id: 'a', name: 'keep.pdf', size: 10, source: 'upload' },
    ]);

    const item = document.querySelector('.shift-my-pdfs-thumb-item');
    const card = item?.firstElementChild;
    const actions = item?.lastElementChild;

    expect(card?.classList.contains('shift-open-file-thumb')).toBe(true);
    // The row follows the card, so the controls sit under the details block.
    expect(actions?.className).toBe(
      'shift-my-pdfs-action-layout shift-my-pdfs-thumb-actions'
    );
    expect(actions?.querySelector('.shift-my-pdfs-view')?.textContent).toBe(
      'View'
    );
    expect(
      actions
        ?.querySelector('.shift-my-pdfs-delete')
        ?.getAttribute('aria-label')
    ).toBe('Delete keep.pdf');
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

  describe('double-click opens the viewer', () => {
    const makePdf = (name: string) =>
      new File([name], name, { type: 'application/pdf' });

    it('selects an unselected PDF and opens it', async () => {
      mountLibrary();
      const pdf = makePdf('briefing.pdf');
      setHomeLibraryFiles([pdf]);
      const assignLocation = vi.fn();

      await expect(
        openLibraryFileOnDoubleClick(
          {
            id: 'briefing-id',
            name: pdf.name,
            size: pdf.size,
            source: 'upload',
            blob: pdf,
          },
          document,
          assignLocation
        )
      ).resolves.toBe(true);

      expect(assignLocation).toHaveBeenCalledWith(
        'view-pdf.html?file=briefing-id'
      );
      expect(getWorkspaceFiles().map((file) => file.name)).toEqual([
        'briefing.pdf',
      ]);
    });

    it('keeps an already selected PDF selected', async () => {
      mountLibrary();
      const pdf = makePdf('briefing.pdf');
      setHomeLibraryFiles([pdf]);
      setWorkspaceFiles([pdf]);
      const assignLocation = vi.fn();

      await openLibraryFileOnDoubleClick(
        {
          id: 'briefing-id',
          name: pdf.name,
          size: pdf.size,
          source: 'upload',
          blob: pdf,
        },
        document,
        assignLocation
      );

      expect(assignLocation).toHaveBeenCalledTimes(1);
      expect(getWorkspaceFiles().map((file) => file.name)).toEqual([
        'briefing.pdf',
      ]);
    });

    it.each([
      ['unselected', false],
      ['selected', true],
    ])(
      'ends with a %s card selected after two clicks on a re-rendering grid',
      (_label, startsSelected) => {
        mountLibrary();
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const pdf = makePdf('briefing.pdf');
        setHomeLibraryFiles([pdf]);
        if (startsSelected) setWorkspaceFiles([pdf]);

        const clickCard = (detail: number) => {
          // The grid re-renders on every selection change, so each click lands
          // on a fresh card, exactly like a real double-click.
          document
            .querySelector<HTMLButtonElement>('.shift-open-file-thumb')
            ?.dispatchEvent(new MouseEvent('click', { bubbles: true, detail }));
        };
        clickCard(1);
        clickCard(2);

        expect(getWorkspaceFiles().map((file) => file.name)).toEqual([
          'briefing.pdf',
        ]);
        expect(
          document
            .querySelector('.shift-open-file-thumb')
            ?.classList.contains('is-selected')
        ).toBe(true);
        vi.restoreAllMocks();
      }
    );

    it('still toggles on a single click', () => {
      mountLibrary();
      const pdf = makePdf('briefing.pdf');
      setHomeLibraryFiles([pdf]);

      const card = () =>
        document.querySelector<HTMLButtonElement>('.shift-open-file-thumb');
      card()?.dispatchEvent(
        new MouseEvent('click', { bubbles: true, detail: 1 })
      );
      expect(getWorkspaceFiles()).toHaveLength(1);
      card()?.dispatchEvent(
        new MouseEvent('click', { bubbles: true, detail: 1 })
      );
      expect(getWorkspaceFiles()).toHaveLength(0);
    });
  });

  it('renames a handled PDF on disk and in the library', async () => {
    mountLibrary();
    const handle = {
      queryPermission: vi.fn().mockResolvedValue('granted'),
      move: vi.fn().mockResolvedValue(undefined),
      kind: 'file',
      getFile: vi.fn(),
    } as unknown as FileSystemFileHandle;
    const saved = await addPdfToLibrary(
      new File(['pdf'], 'report.pdf', { type: 'application/pdf' }),
      'handoff',
      { handle }
    );
    setHomeLibraryFiles([
      {
        id: saved.id,
        name: saved.name,
        size: saved.size,
        source: saved.source,
        blob: saved.file,
        handle,
      },
    ]);

    document
      .querySelector<HTMLButtonElement>(
        '#shift-my-pdfs-body .shift-my-pdfs-rename'
      )
      ?.click();
    const input = document.querySelector<HTMLInputElement>(
      '.shift-confirm-input'
    );
    expect(input?.value).toBe('report.pdf');
    if (input) input.value = 'Q1 report';
    document.querySelector<HTMLButtonElement>('.shift-confirm-accept')?.click();

    await vi.waitFor(async () => {
      const [entry] = await readPdfLibrary();
      expect(entry?.name).toBe('Q1 report.pdf');
    });
    expect(
      (handle as FileSystemFileHandle & { move: ReturnType<typeof vi.fn> }).move
    ).toHaveBeenCalledWith('Q1 report.pdf');
    expect(document.querySelector('.shift-my-pdfs-row')?.textContent).toContain(
      'Q1 report.pdf'
    );
  });

  it('hides rename when the library entry has no file handle', () => {
    mountLibrary();
    setHomeLibraryFiles([
      { id: 'a', name: 'keep.pdf', size: 10, source: 'upload' },
    ]);

    expect(document.querySelector('.shift-my-pdfs-rename')).toBeNull();
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

    document
      .querySelector<HTMLInputElement>(
        '.shift-my-pdfs-row .shift-my-pdfs-checkbox'
      )
      ?.click();
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
   * Thumbnail cards used to be a fixed 160px with a 154px preview strip and a
   * single-line filename, so a letter page smeared and two files that shared
   * a prefix looked identical. The row is a wrapping grid with a 280px floor,
   * the preview keeps a portrait page ratio, and the name wraps to two lines.
   * The canvas fills that frame; height:auto must not be allowed to grow it.
   * The collapsed rail's 24px preview is a different control.
   */
  it('lays My PDFs thumbnail cards out wide enough to read', () => {
    const css = readFileSync('src/css/shift-theme.css', 'utf8');
    const ruleBody = (selector: string): string => {
      const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const match = new RegExp(`(?<=\\n)(?<!,\\n)${escaped} \\{`).exec(css);
      if (!match) throw new Error(`No rule found for ${selector}`);
      return css.slice(match.index, css.indexOf('\n}', match.index));
    };

    const grid = ruleBody('.shift-open-file-thumbs');
    expect(grid).toMatch(/display:\s*grid/);
    expect(grid).toMatch(
      /grid-template-columns:\s*repeat\(auto-fill,\s*minmax\(280px,\s*1fr\)\)/
    );

    const card = ruleBody('.shift-open-file-thumb');
    expect(card).toMatch(/width:\s*100%/);
    expect(card).not.toMatch(/width:\s*160px/);
    expect(ruleBody('.shift-my-pdfs-thumb-item')).not.toMatch(/width:\s*160px/);
    expect(ruleBody('.shift-my-pdfs-thumb-item')).toMatch(/width:\s*100%/);

    const empty = ruleBody('.shift-open-file-thumb.shift-my-pdfs-empty-card');
    expect(empty).toMatch(/width:\s*100%/);
    expect(empty).not.toMatch(/16\.5rem/);
    expect(empty).not.toMatch(/width:\s*160px/);

    const preview = ruleBody('.shift-open-file-thumb-preview');
    expect(preview).toMatch(/aspect-ratio:\s*8\.5\s*\/\s*11/);
    expect(preview).not.toMatch(/height:\s*154px/);
    expect(preview).not.toMatch(/min-height:/);
    expect(preview).toContain('overflow: hidden');

    const canvas = ruleBody('.shift-open-file-thumb-preview canvas');
    expect(canvas).toContain('width: 100%');
    expect(canvas).toContain('height: 100%');
    expect(canvas).toContain('object-fit: contain');
    expect(canvas).not.toMatch(/height:\s*auto/);

    const name = ruleBody('.shift-open-file-thumb-name');
    expect(name).toMatch(/-webkit-line-clamp:\s*2/);
    expect(name).toMatch(/line-clamp:\s*2/);
    expect(name).toMatch(/white-space:\s*normal/);
    expect(name).not.toMatch(/white-space:\s*nowrap/);

    const actions = ruleBody(
      '.shift-my-pdfs-thumb-actions .shift-my-pdfs-view,\n.shift-my-pdfs-thumb-actions .shift-my-pdfs-download'
    );
    expect(actions).toMatch(/min-height:\s*32px/);
    expect(actions).toMatch(
      /background:\s*var\(--action-button-surface-secondary-default\)/
    );
    expect(actions).toMatch(/border-radius:\s*var\(--radius-8\)/);

    const remove = ruleBody(
      '.shift-my-pdfs-thumb-actions .shift-my-pdfs-rename,\n.shift-my-pdfs-thumb-actions .shift-my-pdfs-delete'
    );
    expect(remove).toMatch(/min-height:\s*32px/);
    expect(remove).toMatch(/height:\s*32px/);

    const rail = ruleBody('.shift-open-file-preview');
    expect(rail).toMatch(/width:\s*24px/);
    expect(rail).toMatch(/height:\s*24px/);
  });
});
